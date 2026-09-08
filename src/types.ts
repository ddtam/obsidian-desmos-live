export interface DesmosLiveSettings {
	defaultHeight: number;
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
