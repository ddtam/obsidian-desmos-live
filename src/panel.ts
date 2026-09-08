import { buildLiveDocument, buildShotDocument, detectMode, sanitiseColour } from './utils/calculatorDocument';
import { formatValue, labelFor, parseSliders } from './utils/sliders';
import type DesmosLivePlugin from './main';
import type { CalculatorMode, DesmosBlock, PanelMode, SliderSpec } from './types';

/** Only one calculator runs at a time, so cost is flat in the number of panels. */
let livePanel: Panel | undefined;

const panels = new Set<Panel>();

const claimLive = (panel: Panel): void => {
	livePanel = panel;
};

const releaseLive = (panel: Panel): void => {
	if (livePanel === panel) livePanel = undefined;
};

function frameWindow(el: HTMLElement): typeof window {
	// Cast needed because lib.dom's Window interface omits URL/Blob, even though
	// they're present on every real window object (incl. Obsidian popouts).
	return (el.ownerDocument.defaultView ?? activeWindow) as typeof window;
}

/**
 * Read the theme off the running app rather than deriving it. Obsidian marks the
 * mode with a body class and resolves its palette into CSS variables, so both are
 * measurable; hardcoded colours would drift from whatever theme the reader has.
 */
function readTheme(el: HTMLElement): { dark: boolean; background: string } {
	const doc = el.ownerDocument;
	const dark = doc.body.classList.contains('theme-dark');
	const fallback = dark ? '#1e1e1e' : '#ffffff';
	const view = doc.defaultView;
	if (!view) return { dark, background: fallback };
	const resolved = view.getComputedStyle(doc.body).getPropertyValue('--background-primary');
	return { dark, background: sanitiseColour(resolved, fallback) };
}

/** FNV-1a, enough to key a cache of a few dozen SVGs. */
function hash(input: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}

export class Panel {
	private readonly graphEl: HTMLElement;
	private readonly sliders: SliderSpec[];
	private readonly mode: CalculatorMode;
	private readonly options: Record<string, unknown>;
	private readonly background: string;
	private readonly nonce = Math.random().toString(36).slice(2);

	private frame?: HTMLIFrameElement;
	private ready = false;
	private pending = new Map<string, string>();
	private onFrameMessage?: (ev: MessageEvent) => void;

	constructor(
		private readonly plugin: DesmosLivePlugin,
		private readonly el: HTMLElement,
		private readonly block: DesmosBlock,
		private readonly panelMode: PanelMode,
		forcedMode?: CalculatorMode,
	) {
		const state = block.state ?? {};
		const { height, mode: _mode, ...blockOptions } = block.options ?? {};
		const theme = readTheme(el);
		this.background = theme.background;
		this.mode = forcedMode ?? detectMode(state);
		this.sliders = parseSliders(state);

		// expressions:false is not a preference. A screenshot captures the
		// graphpaper only, so leaving Desmos's panel on would render the live
		// view 320px narrower than its own static image.
		this.options = { border: false, expressions: false };
		if (plugin.settings.followTheme) this.options.invertedColors = theme.dark;
		Object.assign(this.options, blockOptions);

		const px = height ?? plugin.settings.defaultHeight;
		const root = el.createDiv({ cls: 'desmos-live-panel' });
		this.graphEl = root.createDiv({ cls: 'desmos-live-graph' });
		this.graphEl.style.height = `${px}px`;
		this.graphEl.style.background = this.background;
		this.renderControls(root);

		panels.add(this);
	}

	get element(): HTMLElement {
		return this.el;
	}

	private renderControls(root: HTMLElement): void {
		if (this.sliders.length === 0 || this.panelMode === 'figure') return;
		const box = root.createDiv({ cls: 'desmos-live-controls' });

		for (const s of this.sliders) {
			const row = box.createDiv({ cls: 'desmos-live-control' });
			row.createSpan({ cls: 'desmos-live-symbol', text: labelFor(s.symbol) });
			const input = row.createEl('input', {
				attr: { type: 'range', min: String(s.min), max: String(s.max), step: String(s.step) },
			});
			input.value = String(s.value);
			const readout = row.createSpan({ cls: 'desmos-live-value', text: formatValue(s.value, s.step) });

			input.addEventListener('input', () => {
				const v = Number.parseFloat(input.value);
				readout.setText(formatValue(v, s.step));
				this.set(s, v);
			});
			// Grabbing a slider is itself a request to interact, so it activates
			// rather than requiring the reader to find a separate control first.
			input.addEventListener('pointerdown', () => void this.activate());

		}
	}

	private set(spec: SliderSpec, value: number): void {
		const latex = `${spec.symbol}=${value}`;
		if (!this.ready || !this.frame?.contentWindow) {
			this.pending.set(spec.id, latex);
			return;
		}
		this.frame.contentWindow.postMessage(
			{ t: 'desmos-live-set', nonce: this.nonce, id: spec.id, latex },
			'*',
		);
	}

	/** Draw the cached SVG, rendering and caching it first if necessary. */
	async renderStatic(): Promise<void> {
		const svg = await this.staticSvg();
		if (!this.graphEl.isConnected || this.frame) return;
		this.graphEl.empty();

		if (!svg) {
			this.graphEl.createDiv({
				cls: 'desmos-live-error',
				text: 'Desmos Live: could not render this graph.',
			});
			return;
		}
		const node = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
		node.setAttribute('class', 'desmos-live-svg');
		node.removeAttribute('width');
		node.removeAttribute('height');
		this.graphEl.appendChild(node);

		if (this.panelMode === 'interactive') {
			this.graphEl.addClass('is-activatable');
			this.graphEl.addEventListener('click', () => void this.activate(), { once: true });
		}
	}

	private async staticSvg(): Promise<string | undefined> {
		const key = hash(
			JSON.stringify([this.block.state ?? {}, this.options, this.mode, this.background]),
		);
		const cached = await this.plugin.readCache(key);
		if (cached) return cached;

		const svg = await this.screenshot();
		if (svg) await this.plugin.writeCache(key, svg);
		return svg;
	}

	private screenshot(): Promise<string | undefined> {
		return new Promise(resolve => {
			if (!this.plugin.calculatorJsPath) return resolve(undefined);
			const win = frameWindow(this.el);
			const nonce = Math.random().toString(36).slice(2);
			const jsUrl = this.plugin.app.vault.adapter.getResourcePath(this.plugin.calculatorJsPath);

			// Screenshot at the panel's own geometry, so the cached SVG matches
			// the box it will be drawn into.
			const rect = this.graphEl.getBoundingClientRect();
			const html = buildShotDocument(
				jsUrl,
				this.mode,
				this.block.state ?? {},
				this.options,
				this.background,
				nonce,
			);
			const url = win.URL.createObjectURL(new win.Blob([html], { type: 'text/html' }));

			const style = `position:absolute;left:-10000px;top:0;border:none;width:${Math.max(320, Math.round(rect.width))}px;height:${Math.max(200, Math.round(rect.height))}px;`;

			let shot: HTMLIFrameElement | undefined;
			const onMessage = (ev: MessageEvent) => {
				const d = ev.data as { t?: string; nonce?: string; ok?: boolean; svg?: string };
				if (!d || d.t !== 'desmos-live-shot' || d.nonce !== nonce) return;
				win.removeEventListener('message', onMessage);
				win.URL.revokeObjectURL(url);
				shot?.remove();
				resolve(d.ok ? d.svg : undefined);
			};
			win.addEventListener('message', onMessage);
			shot = this.el.ownerDocument.body.createEl('iframe', { attr: { src: url, style } });
		});
	}

	/** Swap the static image for a running calculator in the same box. */
	async activate(): Promise<void> {
		if (this.frame || this.panelMode === 'figure') return;
		if (!this.plugin.calculatorJsPath) return;

		if (livePanel && livePanel !== this) await livePanel.deactivate();
		claimLive(this);

		const win = frameWindow(this.el);
		const jsUrl = this.plugin.app.vault.adapter.getResourcePath(this.plugin.calculatorJsPath);
		const html = buildLiveDocument(
			jsUrl,
			this.mode,
			this.block.state ?? {},
			this.options,
			this.background,
			this.nonce,
		);
		const url = win.URL.createObjectURL(new win.Blob([html], { type: 'text/html' }));

		this.onFrameMessage = (ev: MessageEvent) => {
			const d = ev.data as { t?: string; nonce?: string };
			if (!d || d.t !== 'desmos-live-ready' || d.nonce !== this.nonce) return;
			this.ready = true;
			// Anything dragged while the engine was booting is applied on arrival,
			// so a slider grabbed immediately does not lose its movement.
			for (const [id, latex] of this.pending) {
				this.frame?.contentWindow?.postMessage(
					{ t: 'desmos-live-set', nonce: this.nonce, id, latex },
					'*',
				);
			}
			this.pending.clear();
		};
		win.addEventListener('message', this.onFrameMessage);

		this.graphEl.empty();
		this.graphEl.removeClass('is-activatable');
		this.graphEl.addClass('is-live');
		this.frame = this.graphEl.createEl('iframe', {
			attr: { src: url, style: 'width:100%;height:100%;border:none;display:block;' },
		});
		this.frame.addEventListener('load', () => win.URL.revokeObjectURL(url), { once: true });
	}

	async deactivate(): Promise<void> {
		if (!this.frame) return;
		if (this.onFrameMessage) frameWindow(this.el).removeEventListener('message', this.onFrameMessage);
		this.onFrameMessage = undefined;
		this.frame.remove();
		this.frame = undefined;
		this.ready = false;
		this.pending.clear();
		this.graphEl.removeClass('is-live');
		releaseLive(this);
		await this.renderStatic();
	}

	destroy(): void {
		if (this.onFrameMessage) frameWindow(this.el).removeEventListener('message', this.onFrameMessage);
		releaseLive(this);
		panels.delete(this);
	}
}

export function forgetPanels(): void {
	for (const p of [...panels]) p.destroy();
	panels.clear();
	livePanel = undefined;
}

export function connectedPanels(): Panel[] {
	const live: Panel[] = [];
	for (const p of [...panels]) {
		if (p.element.isConnected) live.push(p);
		else p.destroy();
	}
	return live;
}
