import type { DesmosState } from '../types';

/**
 * Desmos's own palette, read from the API bundle (`Np`) rather than from the
 * documentation, in the order the bundle declares.
 */
export const DESMOS_COLOURS = {
	RED: '#c74440',
	BLUE: '#2d70b3',
	GREEN: '#348543',
	PURPLE: '#6042a6',
	ORANGE: '#fa7e19',
	BLACK: '#000000',
	GRAY: '#aaaaaa',
} as const;

/**
 * Hand-written states tend to carry primary colours, which sit badly next to
 * Desmos's own palette and worse on a dark background. Mapping them happens on
 * the state rather than in a stylesheet so that the live calculator and the
 * static image get the same answer; a CSS-only fix would colour the image and
 * leave the canvas alone, which is how the two came to disagree before.
 *
 * Anything already in the palette is left alone, including Desmos's older green,
 * `#388c46`, since a colour chosen deliberately is not a colour to second-guess.
 */
const CRUDE: Record<string, string> = {
	'#ff0000': DESMOS_COLOURS.RED,
	'#f00': DESMOS_COLOURS.RED,
	'#00ff00': DESMOS_COLOURS.GREEN,
	'#0f0': DESMOS_COLOURS.GREEN,
	'#0000ff': DESMOS_COLOURS.BLUE,
	'#00f': DESMOS_COLOURS.BLUE,
	'#ffa500': DESMOS_COLOURS.ORANGE,
	'#800080': DESMOS_COLOURS.PURPLE,
};

interface Coloured {
	color?: string;
}

/**
 * `text` is the theme's foreground, so a curve drawn white or black follows the
 * theme instead of vanishing into the background it was written against.
 */
export function normaliseColours(state: DesmosState, text: string | undefined): DesmosState {
	const list = (state as { expressions?: { list?: Coloured[] } }).expressions?.list;
	if (!Array.isArray(list)) return state;

	let changed = false;
	const mapped = list.map(expr => {
		if (!expr || typeof expr.color !== 'string') return expr;
		const key = expr.color.trim().toLowerCase();
		const monochrome = key === '#ffffff' || key === '#fff' || key === '#000000' || key === '#000';
		const next = monochrome && text ? text : CRUDE[key];
		if (!next || next === expr.color) return expr;
		changed = true;
		return { ...expr, color: next };
	});

	if (!changed) return state;
	const s = state as DesmosState & { expressions?: { list?: Coloured[] } };
	return { ...s, expressions: { ...s.expressions, list: mapped } } as DesmosState;
}
