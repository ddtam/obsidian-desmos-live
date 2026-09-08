export type PanelMode = 'figure' | 'interactive' | 'live';

export interface DesmosLiveSettings {
	defaultHeight: number;
	followTheme: boolean;
	defaultMode: PanelMode;
}

export type CalculatorMode = '2d' | '3d';

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
