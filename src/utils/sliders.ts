import type { DesmosState, SliderSpec } from '../types';

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

/**
 * Desmos writes subscripts as `p_{j}`, which is unreadable as a control label.
 * Unicode subscripts cover the digits and enough lowercase letters to carry the
 * names actually used; anything outside that set keeps its braces rather than
 * being silently mangled.
 */
const SUBSCRIPTS: Record<string, string> = {
	'0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
	'5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
	a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ',
	m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ',
	u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

export function labelFor(symbol: string): string {
	return symbol.replace(/_\{([^}]*)\}/g, (whole, inner: string) => {
		const mapped = [...inner].map(c => SUBSCRIPTS[c]);
		return mapped.every(Boolean) ? mapped.join('') : whole;
	});
}

/** Enough decimals to show the step moving, and no more. */
export function formatValue(value: number, step: number): string {
	const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
	return value.toFixed(decimals);
}
