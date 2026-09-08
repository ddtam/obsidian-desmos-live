import type DesmosLivePlugin from './main';

/**
 * A throwaway diagnostic answering the two questions that gate a static-by-default
 * renderer, in the environment that actually decides them rather than in a browser
 * that approximates it:
 *
 *   1. Does asyncScreenshot deliver out of a blob-URL frame under Electron?
 *   2. What does booting a calculator cost, which decides whether activating a
 *      panel needs a spinner or just a fade?
 *
 * It also settles by measurement, rather than by assertion, whether a screenshot
 * captures the expression panel or only the graphpaper. That is the fact the whole
 * seamless-swap design rests on: if the screenshot is graphpaper-only, then a live
 * panel showing a sidebar cannot match its own static render, and the controls have
 * to be ours.
 *
 * Drop this file once the answers are written down.
 */

interface SelfTestReport {
	t: 'desmos-live-selftest';
	nonce: string;
	label: string;
	ok: boolean;
	error?: string;
	scriptMs?: number;
	constructMs?: number;
	stateMs?: number;
	screenshotMs?: number;
	totalMs?: number;
	svgBytes?: number;
	svgWidth?: string;
	svgHeight?: string;
}

// The KL asymmetry panel, so the timings describe a real panel rather than an
// empty calculator.
const STATE = {
	version: 11,
	graph: { viewport: { xmin: 0, ymin: -0.1, xmax: 1, ymax: 2 } },
	expressions: {
		list: [
			{
				type: 'expression',
				id: '1',
				latex: 'K\\left(p,q\\right)=p\\ln\\left(\\frac{p}{q}\\right)+\\left(1-p\\right)\\ln\\left(\\frac{1-p}{1-q}\\right)',
			},
			{
				type: 'expression',
				id: '2',
				latex: 'p_{j}=0.3',
				slider: { hardMin: true, hardMax: true, min: '0.01', max: '0.99', step: '0.01' },
			},
			{ type: 'expression', id: '3', color: '#c74440', latex: 'y=K\\left(p_{j},x\\right)' },
			{ type: 'expression', id: '4', color: '#388c46', latex: 'y=K\\left(x,p_{j}\\right)' },
		],
	},
};

function buildProbe(jsUrl: string, nonce: string, label: string, expressions: boolean): string {
	return `<!DOCTYPE html>
<html><head><style>html,body{margin:0;padding:0;height:100%}</style></head>
<body>
<div id="calculator" style="width:100%;height:100%"></div>
<script>
(function () {
  var nonce = ${JSON.stringify(nonce)}, label = ${JSON.stringify(label)};
  var t0 = performance.now(), tScript = 0, tConstruct = 0, tState = 0;
  function send(p) {
    p.t = 'desmos-live-selftest'; p.nonce = nonce; p.label = label;
    parent.postMessage(p, '*');
  }
  var done = false;
  setTimeout(function () {
    if (!done) send({ ok: false, error: 'timed out after 20s' });
  }, 20000);
  var s = document.createElement('script');
  s.src = ${JSON.stringify(jsUrl)};
  s.onerror = function () { done = true; send({ ok: false, error: 'bundle failed to load' }); };
  s.onload = function () {
    tScript = performance.now();
    try {
      var elt = document.getElementById('calculator');
      var Calc = Desmos.GraphingCalculator(elt, { border: false, expressions: ${expressions} });
      tConstruct = performance.now();
      Calc.setState(${JSON.stringify(STATE)});
      tState = performance.now();
      Calc.asyncScreenshot({ showLabels: true, format: 'svg' }, function (data) {
        done = true;
        var tShot = performance.now();
        var w = /width="([^"]*)"/.exec(data), h = /height="([^"]*)"/.exec(data);
        send({
          ok: true,
          scriptMs: Math.round(tScript - t0),
          constructMs: Math.round(tConstruct - tScript),
          stateMs: Math.round(tState - tConstruct),
          screenshotMs: Math.round(tShot - tState),
          totalMs: Math.round(tShot - t0),
          svgBytes: String(data).length,
          svgWidth: w ? w[1] : '?',
          svgHeight: h ? h[1] : '?'
        });
      });
    } catch (err) {
      done = true;
      send({ ok: false, error: String((err && err.message) || err) });
    }
  };
  document.head.appendChild(s);
})();
</script>
</body></html>`;
}

function row(table: HTMLElement, cells: string[], header = false): void {
	const tr = table.createEl('tr');
	for (const c of cells) tr.createEl(header ? 'th' : 'td', { text: c });
}

export function registerSelfTest(plugin: DesmosLivePlugin): void {
	plugin.registerMarkdownCodeBlockProcessor('desmos-live-selftest', (_source, el) => {
		if (!plugin.calculatorJsPath) {
			el.createDiv({ text: 'Desmos Live: API not ready, reload the note.', cls: 'desmos-live-error' });
			return;
		}
		const jsUrl = plugin.app.vault.adapter.getResourcePath(plugin.calculatorJsPath);
		const win = (el.ownerDocument.defaultView ?? activeWindow) as typeof window;

		const table = el.createEl('table');
		row(table, ['probe', 'screenshot', 'bundle ms', 'construct ms', 'setState ms', 'shot ms', 'total ms', 'svg'], true);

		const probes: [string, boolean][] = [
			['expression panel shown', true],
			['expression panel hidden', false],
		];

		for (const [label, expressions] of probes) {
			const nonce = Math.random().toString(36).slice(2);

			const onMessage = (ev: MessageEvent<SelfTestReport>) => {
				const d = ev.data;
				if (!d || d.t !== 'desmos-live-selftest' || d.nonce !== nonce) return;
				win.removeEventListener('message', onMessage);
				if (!d.ok) {
					row(table, [d.label, `FAILED: ${d.error ?? 'unknown'}`, '', '', '', '', '', '']);
					return;
				}
				row(table, [
					d.label,
					'delivered',
					String(d.scriptMs),
					String(d.constructMs),
					String(d.stateMs),
					String(d.screenshotMs),
					String(d.totalMs),
					`${d.svgWidth} x ${d.svgHeight}, ${Math.round((d.svgBytes ?? 0) / 1024)} KB`,
				]);
			};
			win.addEventListener('message', onMessage);

			const html = buildProbe(jsUrl, nonce, label, expressions);
			const url = win.URL.createObjectURL(new win.Blob([html], { type: 'text/html' }));
			const frame = el.createEl('iframe', {
				attr: { src: url, style: 'width:600px;height:400px;border:none;position:absolute;left:-10000px;' },
			});
			frame.addEventListener('load', () => win.URL.revokeObjectURL(url), { once: true });
		}
	});
}
