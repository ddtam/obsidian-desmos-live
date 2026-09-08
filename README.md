# Desmos Live

Embed live, interactive Desmos graphs in Obsidian notes with `desmos-live` code blocks. Sliders move and the viewport pans, because the calculator stays running rather than being screenshotted.

The community [`obsidian-desmos`](https://github.com/Nigecat/obsidian-desmos) plugin renders static cached SVG instead, which is the better choice for figures that get exported or printed. The ids do not collide, so both can be installed at once.

## Install

Add `ddtam/obsidian-desmos-live` as a beta plugin in [BRAT](https://github.com/TfTHacker/obsidian42-brat), then enable **Desmos Live** under Community plugins. Desktop and mobile both, though mobile is untested.

On first load the plugin downloads the Desmos embed API to `.obsidian/plugins/desmos-live/calculator.js`, so the first launch needs a connection. Everything after that is local.

### API key

The plugin falls back to Desmos's public demo key. Set your own under **Desmos API key** in settings; changing it re-downloads the bundle, because that download is cached per device and was fetched with the previous key.

The key is not a secret in the usual sense, since an API key of this kind is served inside the page of every site that uses one. It is still worth knowing where it lives: plugin settings are written to `.obsidian/plugins/desmos-live/data.json`, which is not part of this repository but will travel to your other devices if you sync the plugins folder.

### Attribution mark

Every graph carries a "powered by Desmos" mark in its bottom-right corner. It is pinned there and cannot be moved, so an x-axis title collides with it; put that label in your prose instead.

**Show attribution mark** in settings turns it off. Before doing so: the option behind it, `branding: false`, is one Desmos ships but does **not** list in its published API documentation, and Desmos's policies route API integration to `partnerships@desmos.com`. Whether your licence covers disabling it is a question for them, not one to settle by reading the bundle.

## Usage

The fence takes a Desmos state object. To get one, open a graph on desmos.com, open the console, run `Calc.getState()` and copy the result as an object.

````markdown
```desmos-live
{
  "version": 11,
  "graph": { "viewport": { "xmin": -3, "ymin": -2, "xmax": 3, "ymax": 6 } },
  "expressions": {
    "list": [
      { "type": "expression", "id": "1", "latex": "a=1" },
      { "type": "expression", "id": "2", "latex": "y=ax^{2}" }
    ]
  }
}
```
````

A bare definition such as `a=1` gets an automatic slider. To set its range, give the expression a `slider` key:

```json
{
  "type": "expression",
  "id": "2",
  "latex": "p_{j}=0.3",
  "slider": { "hardMin": true, "hardMax": true, "min": "0.01", "max": "0.99", "step": "0.01" }
}
```

`desmos-live` auto-detects 2D against 3D from the state. `desmos-live-2d` and `desmos-live-3d` force one, which is useful for starting an empty graph where there is no state to detect from.

### Calculator options

Wrapping the state in `{ "options": ..., "state": ... }` passes the options straight to the Desmos constructor, so the whole [documented set](https://www.desmos.com/api/v1.11/docs/index.html#document-calculator) is available. A bare state without the wrapper still works.

```json
{
  "options": { "height": 300, "expressionsCollapsed": true, "settingsMenu": false },
  "state": { "version": 11, "expressions": { "list": [] } }
}
```

`height` and `mode` are the two keys this plugin consumes itself; everything else is Desmos's. Useful ones:

| option | effect |
| --- | --- |
| `mode` | `figure`, `interactive` or `live`, see below |
| `height` | embed height in pixels, overriding the plugin setting |
| `backgroundColor`, `textColor` | graph colours, overriding the theme setting |
| `settingsMenu`, `zoomButtons`, `lockViewport` | the usual Desmos chrome |

### Modes

A running Desmos calculator is not cheap: each one is a JS heap, a Web Worker, canvases and an animation loop, so a note that boots one per graph gets expensive fast. Panels are therefore **static images by default**, and a calculator is constructed only when a reader asks for one.

| mode | behaviour |
| --- | --- |
| `figure` | a cached image, never interactive, and it survives PDF export |
| `interactive` (default) | a cached image until clicked, then a live calculator |
| `live` | boots immediately |

**At most one calculator runs at a time.** Activating a panel returns any other to its image, so a note's cost does not grow with the number of panels in it.

Sliders are drawn by the plugin rather than by Desmos, below the graph. This is not a style choice: a Desmos screenshot captures the graphpaper only, so a panel showing Desmos's own expression list renders about 320px narrower than its own static image and the graph would visibly reflow the moment it was activated. Plugin-drawn controls are the same elements in both states, so activation changes nothing but the pixels. Dragging a slider activates the panel by itself, and movement made while the engine boots is applied when it arrives.

Any expression defining a single symbol (`a=1`, `p_{j}=0.3`) becomes a slider, taking its range from the expression's `slider` key when it has one.

Images are cached under `.obsidian/plugins/desmos-live/cache/`, keyed by state, options and theme, so they are regenerated per device rather than synced around as a second copy of a figure.

### Theme

Graphs follow the Obsidian theme by default, taking their background, axis and gridline colours from it rather than from hardcoded values, so a custom theme or snippet is picked up. Panels rebuild themselves when the theme changes.

Colours are set through Desmos's own `backgroundColor` and `textColor` config, **not** its `invertedColors` flag. That matters for more than taste: `invertedColors` inverts every hue and applies to the live calculator but not to the same graph's static image, so a panel rendered one way and activated the other visibly changed colour. Named colours are honoured by both paths, including the screenshot, so the two agree by construction.

The parts Desmos does not expose as config, gridlines and axis strokes, are styled through its `dcg-svg-*` classes: directly on the inline image, and injected into the live frame, since CSS custom properties do not cross a frame boundary. Retune any of them in a snippet:

```css
.desmos-live-panel {
  --desmos-live-background: var(--background-primary);
  --desmos-live-text: var(--text-normal);
  --desmos-live-gridline: var(--background-modifier-border);
}
```

### Loading the bundle

A frame normally references the downloaded bundle by URL, which works because a `blob:` document inherits the app's origin and an `app://` script is then same-origin. Where that does not hold, the frame never reports back and the panel is rebuilt once with the bundle embedded in the document instead. Embedding costs about 4 MB per frame, so it is the fallback rather than the default; it is also the arrangement the community Desmos plugin uses, which is why it is the sensible thing to fall back to.

## Development

```sh
npm install
npm run dev      # watch build into ./main.js
npm run build    # typecheck, then production build
npm run lint
```

Releasing follows the same pattern as the other forks. `npm run brat:build` is the dry run; `npm run brat:release -- <version> [--notes "..."]` bumps `manifest.json` and `versions.json`, builds, commits, pushes and cuts the GitHub release with the artifacts attached. `main.js` is gitignored, so it ships as a release asset and is never committed.

Set `OBSIDIAN_OUTFILE` to build straight into a vault, which avoids copying after every change:

```sh
OBSIDIAN_OUTFILE=/path/to/vault/.obsidian/plugins/desmos-live/main.js npm run build
```

## Credits

Originally written by **notnilc-n** as `notnilc-n/obsidian-desmos-live`, by way of the [`n10521658/obsidian-desmos-live`](https://github.com/n10521658/obsidian-desmos-live) re-upload. This is a standalone fork; neither original repository is still available.

Graphs are rendered with the [Desmos API](https://www.desmos.com/api/v1.11/docs/index.html) using its public demo key. It is free for non-commercial use; see [desmos.com/partners](https://www.desmos.com/partners) for anything else.

## Licence

0-BSD, inherited from upstream, which declared it in `package.json` without shipping a `LICENSE` file. See `LICENSE`.
