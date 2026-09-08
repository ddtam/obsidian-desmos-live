import type { BundleSource, CalculatorMode, DesmosState, Palette } from '../types';

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

// Replace </ so embedded JSON cannot close the <script> tag early.
const embed = (value: unknown): string => JSON.stringify(value).replace(/<\//g, '<\\/');

/**
 * Desmos names its graphpaper parts with `dcg-svg-*` classes, so the parts its
 * config does not expose (gridlines, axis strokes, the halo behind axis numbers)
 * are reachable by stylesheet. The parent's CSS custom properties do not cross
 * into a frame, so the resolved literals are written in rather than referenced.
 */
export function graphpaperCss(palette: Palette): string {
	return `
.dcg-svg-background{fill:${palette.background} !important;}
.dcg-svg-major-gridline,.dcg-svg-minor-gridline{stroke:${palette.gridline} !important;}
.dcg-svg-label :nth-child(1) > * :nth-child(1){stroke-width:0 !important;}
.dcg-svg-label :nth-child(n+2) > * :nth-child(1){stroke-width:0 !important;}
.dcg-svg-label :nth-child(n+2) > * :nth-child(1) text{fill:${palette.text} !important;}`;
}

/**
 * Referencing the bundle by URL keeps each frame small, and works because a blob
 * document inherits the app's origin, so an `app://` script is same-origin.
 * Inlining it instead costs ~4 MB per frame but needs no origin at all, which is
 * the route the community Desmos plugin takes and the one that survives where
 * blob frames are handled differently.
 */
export function scriptTag(bundle: BundleSource): string {
	return 'url' in bundle
		? `<script src="${bundle.url}"></script>`
		: `<script>${bundle.source.replace(/<\//g, '<\\/')}</script>`;
}

const SHELL = (palette: Palette | undefined, body: string): string => `<!DOCTYPE html>
<html>
<head>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;${palette ? `background:${palette.background};` : ''}}
${palette ? graphpaperCss(palette) : ''}
</style>
</head>
<body>
<div id="calculator" style="width:100%;height:100%"></div>
${body}
</body>
</html>`;

/**
 * A live calculator that accepts slider updates from the parent.
 *
 * Controls are drawn by the parent rather than by Desmos, for a measured reason:
 * a screenshot captures the graphpaper only, so a panel showing Desmos's own
 * expression list renders at 280px where its static SVG is 600px, and the graph
 * would visibly reflow the moment a reader activated it. Parent-side controls
 * are the same DOM in both states, so activation changes nothing but the pixels.
 */
export function buildLiveDocument(
	bundle: BundleSource,
	mode: CalculatorMode,
	state: DesmosState,
	options: Record<string, unknown>,
	palette: Palette | undefined,
	nonce: string,
): string {
	return SHELL(
		palette,
		`${scriptTag(bundle)}
<script>
(function () {
  var nonce = ${embed(nonce)};
  var Calc = Desmos.${DESMOS_CONSTRUCTOR[mode]}(document.getElementById('calculator'), ${embed(options)});
  Calc.setState(${embed(state)});
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.t !== 'desmos-live-set' || d.nonce !== nonce) return;
    Calc.setExpression({ id: d.id, latex: d.latex });
  });
  parent.postMessage({ t: 'desmos-live-ready', nonce: nonce }, '*');
})();
</script>`,
	);
}

/**
 * Renders once off-screen, posts the SVG back and stops. This is the expensive
 * path (measured at 238 to 329ms against 21 to 41ms to construct), which is why
 * its output is cached and why activation never runs it.
 */
export function buildShotDocument(
	bundle: BundleSource,
	mode: CalculatorMode,
	state: DesmosState,
	options: Record<string, unknown>,
	palette: Palette | undefined,
	nonce: string,
): string {
	return SHELL(
		palette,
		`${scriptTag(bundle)}
<script>
(function () {
  var nonce = ${embed(nonce)};
  function send(p) { p.t = 'desmos-live-shot'; p.nonce = nonce; parent.postMessage(p, '*'); }
  var done = false;
  setTimeout(function () { if (!done) send({ ok: false, error: 'timed out' }); }, 20000);
  try {
    var Calc = Desmos.${DESMOS_CONSTRUCTOR[mode]}(document.getElementById('calculator'), ${embed(options)});
    Calc.setState(${embed(state)});
    Calc.asyncScreenshot({ showLabels: true, format: 'svg' }, function (data) {
      done = true;
      send({ ok: true, svg: String(data) });
    });
  } catch (err) {
    done = true;
    send({ ok: false, error: String((err && err.message) || err) });
  }
})();
</script>`,
	);
}
