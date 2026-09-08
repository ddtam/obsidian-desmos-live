import { buildDocument, detectMode, sanitiseColour } from './utils/calculatorDocument';
import type DesmosLivePlugin from './main';
import type { CalculatorMode, DesmosBlock } from './types';

function showError(el: HTMLElement, msg: string): void {
	el.createDiv({
		text: `Desmos Live: ${msg}`,
		cls: 'desmos-live-error',
	});
}

/**
 * Every block currently on screen, so a theme change can rebuild them. A frame
 * cannot be recoloured in place: `invertedColors` is a constructor option and
 * the running calculator exposes no setter for it.
 */
interface RenderedBlock {
	el: HTMLElement;
	source: string;
	forcedMode?: CalculatorMode;
}

const rendered = new Set<RenderedBlock>();

function parseBlock(source: string): DesmosBlock {
	const trimmed = source.trim();
	if (trimmed.length === 0) return {};

	const parsed: unknown = JSON.parse(trimmed);
	if (parsed === null || typeof parsed !== 'object') {
		throw new Error('expected a JSON object');
	}
	// A wrapped block carries calculator options alongside the state; a bare one
	// is a Calc.getState() dump, which is what upstream took and what existing
	// notes contain.
	if ('state' in parsed) return parsed as DesmosBlock;
	return { state: parsed };
}

/**
 * Read the theme off the running app rather than deriving it. Obsidian marks the
 * mode with a body class and resolves its palette into CSS variables, so both
 * are measurable; a hardcoded pair of colours would drift from whatever theme or
 * snippet the reader actually has applied.
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

export function renderBlock(
	source: string,
	el: HTMLElement,
	plugin: DesmosLivePlugin,
	forcedMode?: CalculatorMode,
	track = true,
): void {
	let block: DesmosBlock;
	try {
		block = parseBlock(source);
	} catch (e) {
		showError(el, `Invalid JSON — ${(e as Error).message}`);
		return;
	}

	if (!plugin.calculatorJsPath) {
		showError(el, 'Desmos API is not ready yet — try reloading the note.');
		return;
	}

	const state = block.state ?? {};
	const { height, ...blockOptions } = block.options ?? {};
	const { dark, background } = readTheme(el);

	// Block options are applied last so a block can always override a default,
	// the theme one included: a panel that has to stay light says so.
	const options: Record<string, unknown> = { border: false };
	if (plugin.settings.followTheme) options.invertedColors = dark;
	Object.assign(options, blockOptions);

	const mode = forcedMode ?? detectMode(state);
	const jsUrl = plugin.app.vault.adapter.getResourcePath(plugin.calculatorJsPath);
	const html = buildDocument(jsUrl, mode, JSON.stringify(state), JSON.stringify(options), background);

	// The frame must be loaded from a blob: URL rather than via srcdoc. A srcdoc
	// document has the URL about:srcdoc, whose location.origin serializes to the
	// string "null", which breaks any postMessage the framed page attempts. A
	// blob: URL inherits the real app://obsidian.md origin.
	// Cast needed because lib.dom's Window interface omits URL/Blob, even though
	// they're present on every real window object (incl. Obsidian popouts) — the
	// declared type of the `window` global itself already includes them.
	const win = (el.ownerDocument.defaultView ?? activeWindow) as typeof window;
	const url = win.URL.createObjectURL(new win.Blob([html], { type: 'text/html' }));

	const px = height ?? plugin.settings.defaultHeight;
	const iframe = el.createEl('iframe', {
		attr: {
			src: url,
			style: `width:100%;height:${px}px;border:none;display:block;background:${background};`,
		},
	});
	iframe.addEventListener('load', () => win.URL.revokeObjectURL(url), { once: true });

	if (track) rendered.add({ el, source, forcedMode });
}

/**
 * Rebuild every on-screen block, dropping any whose element has since left the
 * document. Called on Obsidian's css-change, which covers the light/dark toggle
 * and a theme or snippet being edited underneath us alike.
 */
export function rerenderAll(plugin: DesmosLivePlugin): void {
	for (const block of [...rendered]) {
		if (!block.el.isConnected) {
			rendered.delete(block);
			continue;
		}
		block.el.empty();
		renderBlock(block.source, block.el, plugin, block.forcedMode, false);
	}
}

export function clearRendered(): void {
	rendered.clear();
}

export function registerDesmosRenderers(plugin: DesmosLivePlugin): void {
	// Auto-detects 2D vs 3D from the saved state (see detectMode). Preferred for
	// pasted/edited graphs, since the author doesn't have to track which flavor
	// of block a given state came from.
	plugin.registerMarkdownCodeBlockProcessor('desmos-live', (source, el) => {
		renderBlock(source, el, plugin);
	});
	// Explicit overrides — mainly useful for starting a brand new empty graph,
	// where there's no state yet for auto-detection to key off of.
	plugin.registerMarkdownCodeBlockProcessor('desmos-live-2d', (source, el) => {
		renderBlock(source, el, plugin, '2d');
	});
	plugin.registerMarkdownCodeBlockProcessor('desmos-live-3d', (source, el) => {
		renderBlock(source, el, plugin, '3d');
	});
}
