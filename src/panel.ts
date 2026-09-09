import { buildLiveDocument, buildShotDocument, detectMode, sanitiseColour } from './utils/calculatorDocument';
import { normaliseColours } from './utils/colours';
import { formatValue, labelFor, parseSliders } from './utils/sliders';
import type DesmosLivePlugin from './main';
import type {
	BundleSource,
	CalculatorMode,
	DesmosBlock,
	DesmosState,
	Palette,
	PanelMode,
	SliderSpec,
} from './types';

/** Only one calculator runs at a time, so cost is flat in the number of panels. */
let livePanel: Panel | undefined;

const panels = new Set<Panel>();

/** How long to wait for a live frame to report ready before assuming it cannot run. */
const FRAME_TIMEOUT_MS = 8000;

/**
 * Screenshots get their own, longer deadline, and it must exceed the one inside
 * the shot document or that one can never report. Rendering and serialising the
 * graph is the slow part: a few hundred milliseconds on a desktop, but seconds on
 * a phone, and killing it early is indistinguishable here from a frame that never
 * ran at all.
 */
const SHOT_TIMEOUT_MS = 25000;

/**
 * How a frame's document reaches it.
 *
 * `blob` is preferred: the document inherits the app's origin, so it can pull the
 * Desmos bundle from an `app://` URL and each frame stays small. `srcdoc` has no
 * origin at all, which rules that out and forces the bundle to be embedded, but
 * it needs nothing of the platform beyond an iframe. The community Desmos plugin
 * has always used srcdoc, which is what makes it the sensible thing to fall back
 * to when blob delivery turns out not to work.
 *
 * Nothing here reads `event.origin`; frames are matched by nonce, so a null-origin
 * document is not a problem for the message channel.
 */
type Delivery = 'blob' | 'srcdoc';

/** Hand a document to a frame, returning a cleanup for anything it allocated. */
function deliver(frame: HTMLIFrameElement, html: string, how: Delivery, win: typeof window): () => void {
	if (how === 'srcdoc') {
		// allow-scripts and nothing else, which is what the community Desmos plugin
		// does and the only structural difference between its frame and this one.
		// It denies the frame same-origin, which a srcdoc frame has no use for: the
		// bundle is embedded rather than fetched, and the message channel is matched
		// by nonce rather than by origin.
		frame.sandbox.add('allow-scripts');
		frame.srcdoc = html;
		return () => {};
	}
	const url = win.URL.createObjectURL(new win.Blob([html], { type: 'text/html' }));
	frame.src = url;
	return () => win.URL.revokeObjectURL(url);
}

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
 * Desmos accepts only a 3- or 6-character hex colour for backgroundColor and
 * textColor, and **silently substitutes white** for anything else, warning to the
 * console. Obsidian themes resolve their variables to `rgb()` or `hsl()`, so a
 * value taken straight from the theme is rejected every time. CSS has no such
 * limit, which is why the static image stayed themed while the live calculator
 * turned white: the same colour, accepted by one path and discarded by the other.
 *
 * Normalising through a probe element leaves the browser to do the conversion,
 * whatever notation the theme happens to use.
 */
function toHex(value: string, el: HTMLElement): string | undefined {
	const doc = el.ownerDocument;
	const probe = doc.body.createSpan({ cls: 'desmos-live-probe' });
	probe.style.color = value;
	// An unparseable colour leaves the property empty rather than throwing.
	if (!probe.style.color) {
		probe.remove();
		return undefined;
	}
	const computed = doc.defaultView?.getComputedStyle(probe).color ?? '';
	probe.remove();

	const parts = /rgba?\(([^)]+)\)/.exec(computed);
	if (!parts?.[1]) return undefined;
	const channels = parts[1].split(',').slice(0, 3).map(n => Math.round(Number.parseFloat(n)));
	if (channels.length !== 3 || channels.some(c => !Number.isFinite(c))) return undefined;
	return `#${channels.map(c => Math.min(255, Math.max(0, c)).toString(16).padStart(2, '0')).join('')}`;
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
	// Hex throughout, so one palette serves both the Desmos config and the CSS.
	const pick = (name: string, alt: string, miss: string) => {
		const raw = sanitiseColour(style.getPropertyValue(name) || style.getPropertyValue(alt), miss);
		return toHex(raw, el) ?? miss;
	};

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
	private readonly themed: boolean;
	private readonly state: DesmosState;
	private readonly nonce = Math.random().toString(36).slice(2);

	private frame?: HTMLIFrameElement;
	private ready = false;
	private pending = new Map<string, string>();
	private onFrameMessage?: (ev: MessageEvent) => void;
	private readyTimer = 0;
	private shotError?: string;

	constructor(
		private readonly plugin: DesmosLivePlugin,
		private readonly el: HTMLElement,
		private readonly block: DesmosBlock,
		private readonly panelMode: PanelMode,
		forcedMode?: CalculatorMode,
	) {
		const raw = block.state ?? {};
		const { height, mode: _mode, ...blockOptions } = block.options ?? {};
		this.themed = plugin.settings.followTheme;
		this.palette = readPalette(el);
		this.background = this.palette.background;
		this.mode = forcedMode ?? detectMode(raw);
		this.sliders = parseSliders(raw);

		// expressions:false is not a preference. A screenshot captures the
		// graphpaper only, so leaving Desmos's panel on would render the live
		// view 320px narrower than its own static image.
		this.options = { border: false, expressions: false };
		if (!plugin.settings.showBranding) this.options.branding = false;
		if (plugin.settings.followTheme) {
			// Named colours rather than invertedColors, which crudely inverts every
			// hue and is what made the live view disagree with its own static image.
			// Desmos reads these through getBackgroundColor/getTextColor, which the
			// screenshot path uses too, so both sides match by construction.
			this.options.backgroundColor = this.palette.background;
			this.options.textColor = this.palette.text;
		}
		Object.assign(this.options, blockOptions);

		this.state = normaliseColours(raw, this.themed ? this.palette.text : undefined);

		const px = height ?? plugin.settings.defaultHeight;
		const root = el.createDiv({ cls: 'desmos-live-panel' });
		// The live view is a canvas coloured by the config; the static image is SVG
		// coloured by stylesheet. Both hang off this one class so they cannot end
		// up themed differently, which is what happened when only the config half
		// was conditional.
		if (plugin.settings.followTheme) {
			root.addClass('is-themed');
			// Hand the stylesheet the same hex the calculator was given. Left to its
			// own defaults it would resolve the theme variables independently, and
			// the two halves would differ by whatever hex normalisation dropped:
			// alpha, or a fractional channel. Same values, same picture.
			root.setCssProps({
				'--desmos-live-background': this.palette.background,
				'--desmos-live-text': this.palette.text,
				'--desmos-live-gridline': this.palette.gridline,
			});
		}
		this.graphEl = root.createDiv({ cls: 'desmos-live-graph' });
		this.graphEl.style.height = `${px}px`;
		if (plugin.settings.followTheme) this.graphEl.style.background = this.background;
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
			// Say which stage failed. "Could not render" covers a missing download
			// and a frame that will not run alike, and those need different fixes.
			const haveBundle = (await this.plugin.bundleSource()) !== undefined;
			const reason = this.shotError ? ` (${this.shotError})` : '';
			this.graphEl.createDiv({
				cls: 'desmos-live-error',
				text: haveBundle
					? `Desmos Live: could not render this graph to an image${reason}. ` +
						'Tap to open it as a live calculator instead.'
					: 'Desmos Live: the Desmos bundle has not been downloaded. ' +
						'Check the API key and connection, then reload the plugin.',
			});
			// The live path is known to work where the screenshot does not, so leave
			// the panel usable rather than dead.
			if (this.panelMode !== 'figure') {
				this.graphEl.addClass('is-activatable');
				this.graphEl.addEventListener('click', () => void this.activate(), { once: true });
			}
			return;
		}
		const node = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
		node.setAttribute('class', 'desmos-live-svg');
		// Width and height come off so the image scales with the note, but that only
		// works if a viewBox carries the coordinate system. Derive one when Desmos
		// did not supply it, or the drawing renders at native size in the corner.
		const w = Number.parseFloat(node.getAttribute('width') ?? '');
		const h = Number.parseFloat(node.getAttribute('height') ?? '');
		if (!node.getAttribute('viewBox') && Number.isFinite(w) && Number.isFinite(h)) {
			node.setAttribute('viewBox', `0 0 ${w} ${h}`);
		}
		node.removeAttribute('width');
		node.removeAttribute('height');
		this.graphEl.appendChild(node);

		if (this.panelMode === 'interactive') {
			this.graphEl.addClass('is-activatable');
			this.graphEl.addEventListener('click', () => void this.activate(), { once: true });
		}
	}

	/**
	 * What the picture depends on, which is not the pixel width. Desmos derives the
	 * y range from the x range and the frame's aspect ratio, so only the ratio
	 * changes what is drawn; the SVG carries a viewBox and scales to whatever box
	 * it lands in. Keying on raw pixels therefore missed the cache on every window
	 * resize, sidebar toggle and change of device, and re-shot the graph each time.
	 *
	 * Rounding to two decimals leaves at most a half-percent of distortion, which
	 * is invisible, and collapses the jitter into one entry.
	 */
	private shotGeometry(): { width: number; height: number; aspect: number } {
		const height = this.graphEl.clientHeight || 400;
		const width = this.graphEl.clientWidth || 600;
		const aspect = Math.round((width / height) * 100) / 100;
		return { width: Math.round(height * aspect), height, aspect };
	}

	private async staticSvg(): Promise<string | undefined> {
		const { height, aspect } = this.shotGeometry();
		const key = hash(
			JSON.stringify([
				this.state,
				this.options,
				this.mode,
				this.themed ? this.palette : null,
				aspect,
				height,
			]),
		);
		const cached = await this.plugin.readCache(key);
		if (cached) return cached;

		const svg = await this.screenshot();
		if (svg) await this.plugin.writeCache(key, svg);
		return svg;
	}

	/**
	 * Referencing the bundle is the cheap path and works wherever a blob frame
	 * inherits the app's origin, so an `app://` script counts as same-origin.
	 * Where it does not, the frame simply never answers, so a retry with the
	 * bundle embedded covers the difference rather than leaving a blank panel.
	 */
	private async screenshot(): Promise<string | undefined> {
		if (!this.plugin.calculatorJsPath) return undefined;
		const url = this.plugin.app.vault.adapter.getResourcePath(this.plugin.calculatorJsPath);

		const referenced = await this.shotAttempt({ url }, 'blob');
		if (referenced) return referenced;

		const source = await this.plugin.bundleSource();
		return source ? this.shotAttempt({ source }, 'srcdoc') : undefined;
	}

	private shotAttempt(bundle: BundleSource, delivery: Delivery): Promise<string | undefined> {
		return new Promise(resolve => {
			const win = frameWindow(this.el);
			const nonce = Math.random().toString(36).slice(2);

			// Shoot at the bucketed geometry rather than the measured one, so the
			// image cached under a given key is the image that key describes.
			const { width, height } = this.shotGeometry();

			const html = buildShotDocument(
				bundle,
				this.mode,
				this.state,
				this.options,
				this.themed ? this.palette : undefined,
				nonce,
			);
			const style = `position:absolute;left:-10000px;top:0;border:none;width:${Math.round(width)}px;height:${Math.round(height)}px;`;

			let shot: HTMLIFrameElement | undefined;
			let release = () => {};
			let timer = 0;
			const done = (svg: string | undefined) => {
				win.clearTimeout(timer);
				win.removeEventListener('message', onMessage);
				release();
				shot?.remove();
				resolve(svg);
			};
			const onMessage = (ev: MessageEvent) => {
				const d = ev.data as { t?: string; nonce?: string; ok?: boolean; svg?: string; error?: string };
				if (!d || d.t !== 'desmos-live-shot' || d.nonce !== nonce) return;
				// The frame says why it failed; discarding that leaves every failure
				// looking like a frame that would not run.
				if (!d.ok) this.shotError = d.error ?? 'no reason given';
				done(d.ok ? d.svg : undefined);
			};
			win.addEventListener('message', onMessage);
			// A frame that cannot run the script never reports at all, so the caller
			// needs its own deadline rather than the one inside the document.
			timer = win.setTimeout(() => {
				this.shotError = `timed out after ${SHOT_TIMEOUT_MS / 1000}s`;
				done(undefined);
			}, SHOT_TIMEOUT_MS);
			shot = this.el.ownerDocument.body.createEl('iframe', { attr: { style } });
			release = deliver(shot, html, delivery, win);
		});
	}

	/** Swap the static image for a running calculator in the same box. */
	async activate(): Promise<void> {
		if (this.frame || this.panelMode === 'figure') return;
		if (!this.plugin.calculatorJsPath) return;

		if (livePanel && livePanel !== this) await livePanel.deactivate();
		claimLive(this);

		const jsUrl = this.plugin.app.vault.adapter.getResourcePath(this.plugin.calculatorJsPath);
		await this.mount({ url: jsUrl }, 'blob');
	}

	/**
	 * Build the live frame. If it never reports ready, the script could not run
	 * from a referenced URL, so it is rebuilt once with the bundle embedded. That
	 * is the arrangement the community Desmos plugin uses and the one that works
	 * where a blob frame does not inherit the app's origin.
	 */
	private async mount(bundle: BundleSource, delivery: Delivery): Promise<void> {
		const win = frameWindow(this.el);
		const html = buildLiveDocument(
			bundle,
			this.mode,
			this.state,
			this.options,
			this.themed ? this.palette : undefined,
			this.nonce,
		);


		this.onFrameMessage = (ev: MessageEvent) => {
			const d = ev.data as { t?: string; nonce?: string };
			if (!d || d.t !== 'desmos-live-ready' || d.nonce !== this.nonce) return;
			win.clearTimeout(this.readyTimer);
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
			attr: { style: 'width:100%;height:100%;border:none;display:block;' },
		});
		const release = deliver(this.frame, html, delivery, win);
		this.frame.addEventListener('load', () => release(), { once: true });

		this.readyTimer = win.setTimeout(() => {
			if (this.ready || !this.frame) return;
			void this.retryInline();
		}, FRAME_TIMEOUT_MS);
	}

	private async retryInline(): Promise<void> {
		const source = await this.plugin.bundleSource();
		this.teardownFrame();
		if (!source) {
			this.graphEl.createDiv({
				cls: 'desmos-live-error',
				text: 'Desmos Live: the calculator could not be loaded.',
			});
			return;
		}
		await this.mount({ source }, 'srcdoc');
	}

	private teardownFrame(): void {
		const win = frameWindow(this.el);
		win.clearTimeout(this.readyTimer);
		if (this.onFrameMessage) win.removeEventListener('message', this.onFrameMessage);
		this.onFrameMessage = undefined;
		this.frame?.remove();
		this.frame = undefined;
		this.ready = false;
		this.graphEl.empty();
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
