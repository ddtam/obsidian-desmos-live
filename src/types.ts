export type PanelMode = 'figure' | 'interactive' | 'live';

export interface DesmosLiveSettings {
	defaultHeight: number;
	followTheme: boolean;
	defaultMode: PanelMode;
	/** Desmos API key. Empty falls back to Desmos's public demo key. */
	apiKey: string;
	/** The key the cached bundle was fetched with, so a change re-downloads it. */
	bundleKey: string;
	/** Draw the "powered by Desmos" mark. See the README before turning it off. */
	showBranding: boolean;
}

export type CalculatorMode = '2d' | '3d';

/** How a frame gets the Desmos bundle: by reference, or embedded outright. */
export type BundleSource = { url: string } | { source: string };

/**
 * Graph colours, resolved from the running app. Overridable per element through
 * `--desmos-live-background`, `--desmos-live-text` and `--desmos-live-gridline`,
 * which fall back to Obsidian's own theme variables.
 */
export interface Palette {
	background: string;
	text: string;
	gridline: string;
}

// Desmos states are officially "opaque" (treat as a black box) per the API docs,
// so this only types the handful of fields this plugin actually inspects.
export interface DesmosState {
	graph?: {
		product?: string;
		viewport?: {
			zmin?: number;
			zmax?: number;
		};
	};
}

/**
 * Constructor options handed to Desmos verbatim, so the whole documented set is
 * reachable from a block without this plugin having to know each name. Two keys
 * are intercepted: `height` sizes the embed and `mode` chooses how the panel
 * renders, and Desmos has a use for neither.
 */
export type CalculatorOptions = Record<string, unknown> & {
	height?: number;
	mode?: PanelMode;
	/** Expression id to a plain-language description, shown beside the symbol. */
	sliderLabels?: Record<string, string>;
	/**
	 * Expression id to a description, for values the graph computes. Each named
	 * expression must define a symbol, `L=...`, and its value is shown read-only
	 * under the graph.
	 */
	readouts?: Record<string, string>;
};

/**
 * A block is either `{ options, state }` or a bare `Calc.getState()` dump. The
 * bare form is what upstream accepted and what every existing note uses, so it
 * keeps working. The wrapped form is the only way to reach calculator options,
 * which are constructor arguments and so cannot live inside the state itself.
 */
export interface DesmosBlock {
	options?: CalculatorOptions;
	state?: DesmosState;
}

/** A slider recovered from the state, driven by a control the plugin draws. */
export interface SliderSpec {
	id: string;
	symbol: string;
	value: number;
	min: number;
	max: number;
	step: number;
}

/** A value the graph computes, shown read-only under it. */
export interface ReadoutSpec {
	id: string;
	symbol: string;
	describe: string;
}
