export interface DesmosLiveSettings {
	defaultHeight: number;
	followTheme: boolean;
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
 * reachable from a block without this plugin having to know each name. `height`
 * is the one key intercepted here: it sizes the embed, and Desmos has no use
 * for it.
 */
export type CalculatorOptions = Record<string, unknown> & { height?: number };

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
