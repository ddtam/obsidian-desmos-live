# Desmos Live

Embed live, interactive Desmos graphs in Obsidian notes with `desmos-live` code blocks. Sliders move and the viewport pans, because the calculator stays running rather than being screenshotted.

The community [`obsidian-desmos`](https://github.com/Nigecat/obsidian-desmos) plugin renders static cached SVG instead, which is the better choice for figures that get exported or printed. The ids do not collide, so both can be installed at once.

## Install

Add `ddtam/obsidian-desmos-live` as a beta plugin in [BRAT](https://github.com/TfTHacker/obsidian42-brat), then enable **Desmos Live** under Community plugins.

On first load the plugin downloads the Desmos embed API to `.obsidian/plugins/desmos-live/calculator.js`, so the first launch needs a connection. Everything after that is local.

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

`desmos-live` auto-detects 2D against 3D from the state. `desmos-live-2d` and `desmos-live-3d` force one, which is useful for starting an empty graph where there is no state to detect from. Graph height is a plugin setting.

## Development

```sh
npm install
npm run dev      # watch build into ./main.js
npm run build    # typecheck, then production build
npm run lint
```

Set `OBSIDIAN_OUTFILE` to build straight into a vault, which avoids copying after every change:

```sh
OBSIDIAN_OUTFILE=/path/to/vault/.obsidian/plugins/desmos-live/main.js npm run build
```

## Credits

Originally written by **notnilc-n** as `notnilc-n/obsidian-desmos-live`, by way of the [`n10521658/obsidian-desmos-live`](https://github.com/n10521658/obsidian-desmos-live) re-upload. This is a standalone fork; neither original repository is still available.

Graphs are rendered with the [Desmos API](https://www.desmos.com/api/v1.11/docs/index.html) using its public demo key. It is free for non-commercial use; see [desmos.com/partners](https://www.desmos.com/partners) for anything else.

## Licence

0-BSD, inherited from upstream, which declared it in `package.json` without shipping a `LICENSE` file. See `LICENSE`.
