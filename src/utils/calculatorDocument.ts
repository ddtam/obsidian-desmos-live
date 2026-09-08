import type { CalculatorMode, DesmosState } from '../types';

const DESMOS_CONSTRUCTOR: Record<CalculatorMode, string> = {
	'2d': 'GraphingCalculator',
	'3d': 'Calculator3D',
};

/**
 * Desmos states don't officially document a type tag, but in practice a saved
 * 3D graph's state carries graph.product === "graphing-3d", and its viewport
 * additionally has z bounds. Either signal is enough to tell 2D and 3D states
 * apart without the block author having to say so explicitly.
 */
export function detectMode(state: DesmosState): CalculatorMode {
	if (state.graph?.product === 'graphing-3d') return '3d';
	if (state.graph?.viewport?.zmin !== undefined || state.graph?.viewport?.zmax !== undefined) {
		return '3d';
	}
	return '2d';
}

/**
 * The frame gets its background from the parent rather than a hardcoded colour,
 * so it cannot be read as a CSS value the caller controls. Anything that isn't
 * a plain colour token is dropped rather than escaped, since there is no reason
 * for a resolved `--background-primary` to contain anything else.
 */
const SAFE_COLOUR = /^[#a-zA-Z0-9(),.%\s-]+$/;

export function sanitiseColour(value: string, fallback: string): string {
	const trimmed = value.trim();
	return trimmed.length > 0 && SAFE_COLOUR.test(trimmed) ? trimmed : fallback;
}

export function buildDocument(
	calculatorJsUrl: string,
	mode: CalculatorMode,
	stateJson: string,
	optionsJson: string,
	background: string,
): string {
	// Replace </ to prevent the JSON from prematurely closing the <script> tag.
	const safeState = stateJson.replace(/<\//g, '<\\/');
	const safeOptions = optionsJson.replace(/<\//g, '<\\/');
	const constructor = DESMOS_CONSTRUCTOR[mode];

	return `<!DOCTYPE html>
<html>
<head>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:${background};}
</style>
</head>
<body>
<div id="calculator" style="width:100%;height:100%"></div>
<script src="${calculatorJsUrl}"></script>
<script>
(function () {
  var elt = document.getElementById('calculator');
  var Calc = Desmos.${constructor}(elt, ${safeOptions});
  Calc.setState(${safeState});
})();
</script>
</body>
</html>`;
}
