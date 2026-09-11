import type { BundleSource, CalculatorMode, DesmosState, Palette, ReadoutSpec } from '../types';

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
.dcg-svg-axis-line,.dcg-svg-tickmark{stroke:${palette.text} !important;}
.dcg-svg-axis-value :nth-child(1),.dcg-svg-offcenter-axis-value :nth-child(1){stroke:${palette.background} !important;}
.dcg-svg-axis-value :nth-child(2),.dcg-svg-offcenter-axis-value :nth-child(2){stroke-width:0 !important;fill:${palette.text} !important;}
.dcg-svg-axis-label,.dcg-svg-axis-label text{stroke-width:0 !important;fill:${palette.text} !important;}
.dcg-svg-label :nth-child(1) > * :nth-child(1){stroke-width:0 !important;}
.dcg-svg-label :nth-child(n+2) > * :nth-child(1){stroke-width:0 !important;}
.dcg-svg-label :nth-child(n+2) > * :nth-child(1) text{fill:${palette.text} !important;}`;
}

/**
 * Desmos strokes the live graph's axes, tick marks, arrows and gridlines in a
 * fixed black, `rgba(0,0,0,a)`, from a function no option reaches: `textColor`
 * colours the numbers and not the lines, so on a dark theme the live axes
 * vanish while the stylesheet keeps the static image's legible. The canvas is
 * the only seam. Before the bundle loads, the context's colour setters are
 * wrapped so exact black is recoloured the way `graphpaperCss` recolours the
 * screenshot: the screenshot keeps each line's stroke-opacity and replaces
 * only its colour, text for axes and ticks, gridline for the grid. The painter
 * is shared, so the alphas already agree, and the class the stylesheet keys on
 * is recovered from the alpha: axes, ticks and arrows are drawn at
 * `axisOpacity`, 0.9 in this bundle, and every grid line at something else.
 * Everything an expression or the config supplies is hex and passes untouched.
 */
export function canvasThemeScript(palette: Palette): string {
	const channels = (colour: string): string | undefined => {
		const hex = colour.replace('#', '');
		const rgb = [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
		if (hex.length !== 6 || rgb.some(c => !Number.isFinite(c))) return undefined;
		return rgb.join(',');
	};
	const text = channels(palette.text);
	const grid = channels(palette.gridline);
	if (!text || !grid) return '';
	return `<script>
(function () {
  var proto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (!proto) return;
  var black = /^rgba\\(0,0,0,([0-9.]+)\\)$/;
  var AXIS_OPACITY = '0.9';
  ['strokeStyle', 'fillStyle'].forEach(function (name) {
    var own = Object.getOwnPropertyDescriptor(proto, name);
    if (!own || !own.set || !own.get) return;
    Object.defineProperty(proto, name, {
      configurable: true,
      enumerable: own.enumerable,
      get: own.get,
      set: function (v) {
        var m = typeof v === 'string' ? black.exec(v) : null;
        if (m) {
          var rgb = m[1] === AXIS_OPACITY ? '${text}' : '${grid}';
          v = 'rgba(' + rgb + ',' + m[1] + ')';
        }
        own.set.call(this, v);
      }
    });
  });
})();
</script>
`;
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
	readouts: ReadoutSpec[],
): string {
	return SHELL(
		palette,
		`${palette ? canvasThemeScript(palette) : ''}${scriptTag(bundle)}
<script>
(function () {
  var nonce = ${embed(nonce)};
  var Calc = Desmos.${DESMOS_CONSTRUCTOR[mode]}(document.getElementById('calculator'), ${embed(options)});
  Calc.setState(${embed(state)});
  // Each readout is observed rather than polled, so a value is posted when the
  // calculator settles on it.
  if (Calc.HelperExpression) {
    ${embed(readouts)}.forEach(function (r) {
      var helper = Calc.HelperExpression({ latex: r.symbol });
      helper.observe('numericValue', function () {
        parent.postMessage({ t: 'desmos-live-value', nonce: nonce, id: r.id, value: helper.numericValue }, '*');
      });
    });
  }
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.nonce !== nonce) return;
    if (d.t === 'desmos-live-set') {
      Calc.setExpression({ id: d.id, latex: d.latex });
      return;
    }
    if (d.t === 'desmos-live-view') {
      // Scales first: a log axis rejects a non-positive bound, so the bounds
      // are only valid once the scale they were written for is in place.
      try {
        Calc.updateSettings({ xAxisScale: d.xAxisScale, yAxisScale: d.yAxisScale });
      } catch (err) {}
      var b = d.bounds;
      if (b && isFinite(b.left) && isFinite(b.right) && isFinite(b.bottom) && isFinite(b.top)) {
        Calc.setMathBounds(b);
      }
    }
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
	size: { width: number; height: number },
	readouts: ReadoutSpec[],
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
    // Size is passed rather than inferred. Left to infer, Desmos also applies
    // its own rule: under 256px in either dimension it drops the axis numbers,
    // which reflows the plot area, so a short panel's image would show a
    // different region from the live calculator beside it. preserveAxisNumbers
    // turns that off.
    // Readout values travel with the image, so a panel that has never been
    // activated still shows the numbers its picture was drawn at.
    var helpers = Calc.HelperExpression
      ? ${embed(readouts)}.map(function (r) { return { id: r.id, h: Calc.HelperExpression({ latex: r.symbol }) }; })
      : [];
    function withValues(cb, waited) {
      var values = {}, pending = false;
      helpers.forEach(function (x) {
        var v = x.h.numericValue;
        if (v === undefined) pending = true;
        else values[x.id] = isFinite(v) ? v : null;
      });
      // A helper evaluates asynchronously. Give it a moment rather than caching
      // a blank, then send whatever has arrived.
      if (pending && waited < 2000) {
        setTimeout(function () { withValues(cb, waited + 50); }, 50);
        return;
      }
      cb(values);
    }
    Calc.asyncScreenshot({
      showLabels: true,
      format: 'svg',
      preserveAxisNumbers: true,
      width: ${Math.round(size.width)},
      height: ${Math.round(size.height)}
    }, function (data) {
      withValues(function (values) {
        done = true;
        send({ ok: true, svg: String(data), values: values });
      }, 0);
    });
  } catch (err) {
    done = true;
    send({ ok: false, error: String((err && err.message) || err) });
  }
})();
</script>`,
	);
}
