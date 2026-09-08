import { buildDocument, detectMode } from './utils/calculatorDocument';
import type DesmosLivePlugin from './main';
import type { CalculatorMode, DesmosState } from './types';

function showError(el: HTMLElement, msg: string): void {
	el.createDiv({
		text: `Desmos Live: ${msg}`,
		cls: 'desmos-live-error',
	});
}

export function renderBlock(
	source: string,
	el: HTMLElement,
	plugin: DesmosLivePlugin,
	forcedMode?: CalculatorMode,
): void {
	let state: DesmosState;
	const trimmed = source.trim();
	try {
		state = trimmed.length > 0 ? (JSON.parse(trimmed) as DesmosState) : {};
	} catch (e) {
		showError(el, `Invalid JSON — ${(e as Error).message}`);
		return;
	}

	if (!plugin.calculatorJsPath) {
		showError(el, 'Desmos API is not ready yet — try reloading the note.');
		return;
	}

	const mode = forcedMode ?? detectMode(state);
	const jsUrl = plugin.app.vault.adapter.getResourcePath(plugin.calculatorJsPath);
	const html = buildDocument(jsUrl, mode, JSON.stringify(state));

	// The frame must be loaded from a blob: URL rather than via srcdoc. A srcdoc
	// document has the URL about:srcdoc, whose location.origin serializes to the
	// string "null", which breaks any postMessage the framed page attempts. A
	// blob: URL inherits the real app://obsidian.md origin.
	// Cast needed because lib.dom's Window interface omits URL/Blob, even though
	// they're present on every real window object (incl. Obsidian popouts) — the
	// declared type of the `window` global itself already includes them.
	const win = (el.ownerDocument.defaultView ?? activeWindow) as typeof window;
	const url = win.URL.createObjectURL(new win.Blob([html], { type: 'text/html' }));

	const iframe = el.createEl('iframe', {
		attr: {
			src: url,
			style: `width:100%;height:${plugin.settings.defaultHeight}px;border:none;display:block;`,
		},
	});
	iframe.addEventListener('load', () => win.URL.revokeObjectURL(url), { once: true });
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
