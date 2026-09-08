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

export function buildDocument(calculatorJsUrl: string, mode: CalculatorMode, stateJson: string): string {
	// Replace </ to prevent the JSON from prematurely closing the <script> tag.
	const safeState = stateJson.replace(/<\//g, '<\\/');
	const constructor = DESMOS_CONSTRUCTOR[mode];

	return `<!DOCTYPE html>
<html>
<head>
<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}</style>
</head>
<body>
<div id="calculator" style="width:100%;height:100%"></div>
<script src="${calculatorJsUrl}"></script>
<script>
(function () {
  var elt = document.getElementById('calculator');
  var Calc = Desmos.${constructor}(elt, { border: false });
  Calc.setState(${safeState});
})();
</script>
</body>
</html>`;
}
