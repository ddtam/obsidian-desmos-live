import { buildLiveDocument, buildShotDocument, detectMode, sanitiseColour } from './utils/calculatorDocument';
import { formatValue, labelFor, parseSliders } from './utils/sliders';
import type DesmosLivePlugin from './main';
import type { CalculatorMode, DesmosBlock, Palette, PanelMode, SliderSpec } from './types';

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
 * Read the palette off the running app rather than deriving it. Obsidian resolves
 * its theme into CSS variables, so the colours are measurable; hardcoded ones
 * would drift from whatever theme or snippet the reader actually has applied.
 *
 * Every value is overridable through a `--desmos-live-*` variable, so a snippet
 * can retune a graph without the plugin being rebuilt.
 */
function readPalette(el: HTMLElement): Palette {
	const doc = el.ownerDocument;
	const dark = doc.body.classList.contains('theme-dark');
	const fallback: Palette = dark
		? { background: '#1e1e1e', text: '#dadada', gridline: '#3a3a3a' }
		: { background: '#ffffff', text: '#222222', gridline: '#cccccc' };

	const view = doc.defaultView;
	if (!view) return fallback;
	const style = view.getComputedStyle(el);
	const pick = (name: string, alt: string, miss: string) =>
		sanitiseColour(style.getPropertyValue(name) || style.getPropertyValue(alt), miss);

	return {
		background: pick('--desmos-live-background', '--background-primary', fallback.background),
		text: pick('--desmos-live-text', '--text-normal', fallback.text),
		gridline: pick('--desmos-live-gridline', '--background-modifier-border', fallback.gridline),
	};
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
	private readonly palette: Palette;
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
		this.palette = readPalette(el);
		this.background = this.palette.background;
		this.mode = forcedMode ?? detectMode(state);
		this.sliders = parseSliders(state);

		// expressions:false is not a preference. A screenshot captures the
		// graphpaper only, so leaving Desmos's panel on would render the live
		// view 320px narrower than its own static image.
		this.options = { border: false, expressions: false };
		if (plugin.settings.followTheme) {
			// Named colours rather than invertedColors, which crudely inverts every
			// hue and is what made the live view disagree with its own static image.
			// Desmos reads these through getBackgroundColor/getTextColor, which the
			// screenshot path uses too, so both sides match by construction.
			this.options.backgroundColor = this.palette.background;
			this.options.textColor = this.palette.text;
		}
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

	/**
	 * A markdown post-processor runs before its element is laid out, so the panel
	 * can still measure 0 wide here. Screenshotting then would capture a different
	 * aspect ratio from the one the live calculator later gets, and Desmos expands
	 * whichever axis it must to fill the frame, so the two views would show
	 * different amounts of the graph. Wait for a real width before measuring.
	 */
	private async laidOut(): Promise<void> {
		for (let i = 0; i < 30 && this.graphEl.clientWidth === 0; i++) {
			await new Promise<void>(resolve => {
				frameWindow(this.el).requestAnimationFrame(() => resolve());
			});
		}
	}

	/** Draw the cached SVG, rendering and caching it first if necessary. */
	async renderStatic(): Promise<void> {
		await this.laidOut();
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
		// Geometry is part of the key: Desmos expands an axis to fill its frame, so
		// the same state at a different width is a different picture.
		const key = hash(
			JSON.stringify([
				this.block.state ?? {},
				this.options,
				this.mode,
				this.palette,
				this.graphEl.clientWidth,
				this.graphEl.clientHeight,
			]),
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
				this.palette,
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
			this.palette,
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
