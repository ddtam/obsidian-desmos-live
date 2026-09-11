import type { DesmosState, ReadoutOption, ReadoutSpec, SliderSpec } from '../types';

interface StateExpression {
	id?: string;
	latex?: string;
	slider?: { min?: string; max?: string; step?: string };
}

/**
 * A Desmos slider is an expression that defines a single symbol, `a=1` or
 * `p_{j}=0.3`, optionally carrying explicit bounds. Splitting on the first `=`
 * is enough to recover the symbol and its starting value; anything without a
 * definition shape is not a slider and is left to the graph.
 */
const DEFINITION = /^([^=]+)=\s*(-?[0-9.]+)\s*$/;

/**
 * Symbols the graph itself owns. `y=2` and `x=0` are lines, not parameters, and
 * Desmos offers no slider for them either; treating one as a slider puts a
 * control under the panel that changes nothing a reader would expect.
 */
const PLOTTING = new Set(['x', 'y', 'r', '\\theta', 'theta']);

const num = (value: string | undefined, fallback: number): number => {
	const n = Number.parseFloat(value ?? '');
	return Number.isFinite(n) ? n : fallback;
};

export function parseSliders(state: DesmosState): SliderSpec[] {
	const list = (state as { expressions?: { list?: StateExpression[] } }).expressions?.list ?? [];
	const sliders: SliderSpec[] = [];

	for (const expr of list) {
		if (!expr || typeof expr.latex !== 'string' || typeof expr.id !== 'string') continue;
		const match = DEFINITION.exec(expr.latex);
		if (!match || match[1] === undefined || match[2] === undefined) continue;
		if (PLOTTING.has(match[1].trim())) continue;

		// Desmos's own default range when an expression carries no explicit bounds.
		const min = num(expr.slider?.min, -10);
		const max = num(expr.slider?.max, 10);
		const value = num(match[2], min);
		sliders.push({
			id: expr.id,
			symbol: match[1].trim(),
			value,
			min,
			max,
			// A step of 0 would freeze the input; fall back to something that gives
			// a slider roughly 200 stops across its range, which reads as continuous.
			step: num(expr.slider?.step, 0) || (max - min) / 200,
		});
	}
	return sliders;
}

/** Enough decimals to show the step moving, and no more. */
export function formatValue(value: number, step: number): string {
	const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
	return value.toFixed(decimals);
}

/**
 * A readout's description, and its colour if it names one. A colour starting
 * with `#` is used as written; anything else is an expression id, and that
 * expression's colour is taken, so the row follows the element it describes
 * when the graph is recoloured. Block JSON is untrusted, hence `unknown`.
 */
function describeReadout(
	option: unknown,
	list: StateExpression[],
): { describe: string; color?: string } {
	if (typeof option === 'string') return { describe: option };
	if (!option || typeof option !== 'object') return { describe: '' };
	const { label, color } = option as { label?: unknown; color?: unknown };
	const describe = typeof label === 'string' ? label : '';
	const named = typeof color === 'string' ? color.trim() : '';
	if (!named) return { describe };
	if (named.startsWith('#')) return { describe, color: named };
	for (const expr of list) {
		if (expr && expr.id === named) {
			const own = (expr as { color?: unknown }).color;
			if (typeof own !== 'string') return { describe };
			return { describe, color: own };
		}
	}
	return { describe };
}

/**
 * A readout is an expression the block names under `readouts` whose latex defines
 * a symbol, `L=...`. The symbol is what the calculator is asked to evaluate, so an
 * expression that defines nothing has no single value to show and is skipped.
 * Listed in expression order, which is the order an author wrote them in.
 */
export function parseReadouts(
	state: DesmosState,
	described: Record<string, string | ReadoutOption>,
): ReadoutSpec[] {
	const list = (state as { expressions?: { list?: StateExpression[] } }).expressions?.list ?? [];
	const readouts: ReadoutSpec[] = [];

	for (const expr of list) {
		if (!expr || typeof expr.latex !== 'string' || typeof expr.id !== 'string') continue;
		if (!Object.prototype.hasOwnProperty.call(described, expr.id)) continue;
		const match = /^([^=]+)=/.exec(expr.latex);
		if (!match?.[1]) continue;
		const symbol = match[1].trim();
		if (PLOTTING.has(symbol)) continue;
		readouts.push({ id: expr.id, symbol, ...describeReadout(described[expr.id], list) });
	}
	return readouts;
}

/**
 * Four significant figures with trailing zeros dropped: enough to check a value
 * against a worked example, few enough that the column does not jitter. A value
 * Desmos cannot compute, such as a real eigenvalue of a rotation, reads n/a.
 */
export function formatReadout(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
	if (Number.isInteger(value)) return String(value);
	return String(Number(value.toPrecision(4)));
}
