import { Panel, connectedPanels, forgetPanels } from './panel';
import type DesmosLivePlugin from './main';
import type { CalculatorMode, DesmosBlock, PanelMode } from './types';

const PANEL_MODES: PanelMode[] = ['figure', 'interactive', 'live'];

function showError(el: HTMLElement, msg: string): void {
	el.createDiv({ text: `Desmos Live: ${msg}`, cls: 'desmos-live-error' });
}

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

export function renderBlock(
	source: string,
	el: HTMLElement,
	plugin: DesmosLivePlugin,
	forcedMode?: CalculatorMode,
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

	const requested = block.options?.mode;
	if (requested !== undefined && !PANEL_MODES.includes(requested)) {
		showError(el, `unknown mode "${String(requested)}", expected one of ${PANEL_MODES.join(', ')}`);
		return;
	}
	const mode = requested ?? plugin.settings.defaultMode;

	const panel = new Panel(plugin, el, block, mode, forcedMode);
	if (mode === 'live') void panel.activate();
	else void panel.renderStatic();
}

/**
 * Rebuild every on-screen panel. Called on css-change, since invertedColors is
 * fixed when a calculator is constructed and the cached SVG is keyed by theme,
 * so neither survives the reader switching between light and dark.
 */
export function rerenderAll(plugin: DesmosLivePlugin): void {
	for (const panel of connectedPanels()) {
		const el = panel.element;
		const source = el.dataset.desmosLiveSource;
		const forced = el.dataset.desmosLiveForced as CalculatorMode | undefined;
		panel.destroy();
		el.empty();
		if (source !== undefined) renderBlock(source, el, plugin, forced);
	}
}

export function clearRendered(): void {
	forgetPanels();
}

export function registerDesmosRenderers(plugin: DesmosLivePlugin): void {
	const register = (fence: string, forced?: CalculatorMode) => {
		plugin.registerMarkdownCodeBlockProcessor(fence, (source, el) => {
			// Stashed so a theme change can rebuild the panel from its own source
			// rather than the plugin holding a parallel registry that can go stale.
			el.dataset.desmosLiveSource = source;
			if (forced) el.dataset.desmosLiveForced = forced;
			renderBlock(source, el, plugin, forced);
		});
	};

	// Auto-detects 2D vs 3D from the saved state (see detectMode). Preferred for
	// pasted/edited graphs, since the author doesn't have to track which flavor
	// of block a given state came from.
	register('desmos-live');
	// Explicit overrides — mainly useful for starting a brand new empty graph,
	// where there's no state yet for auto-detection to key off of.
	register('desmos-live-2d', '2d');
	register('desmos-live-3d', '3d');
}
