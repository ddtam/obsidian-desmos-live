# Desmos Live

Embed **live, interactive** Desmos graphs in Obsidian notes with `desmos-live` code blocks. Sliders move, the viewport pans and the expression list is editable, because the calculator stays running rather than being screenshotted.

## How this differs from the community Desmos plugin

[`Nigecat/obsidian-desmos`](https://github.com/Nigecat/obsidian-desmos) renders **static images by design**. It builds a real `Desmos.GraphingCalculator` inside a sandboxed iframe, calls `asyncScreenshot({ format: "svg" })`, wipes the iframe and caches the resulting SVG by content hash. Its calculator is constructed with `expressions: false`, `settingsMenu: false`, `lockViewPort: true`, `zoomButtons: false` and `trace: false`, so no configuration makes it interactive.

The two plugins do different jobs and their ids do not collide, so both can be installed at once.

| | this plugin | `obsidian-desmos` |
| --- | --- | --- |
| output | live calculator | cached SVG |
| sliders | yes | not possible |
| offline after first load | yes | yes |
| survives PDF export | no | yes |
| licence | 0-BSD | GPL-3.0 |

Use the community plugin for figures that get exported or printed. Use this one where the point is watching a parameter move.

## Install with BRAT

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

`desmos-live` auto-detects 2D against 3D from the state. `desmos-live-2d` and `desmos-live-3d` force one, which is mainly useful for starting an empty graph where there is no state to detect from. Graph height is a plugin setting.

**Authoring by pasting a `Calc.getState()` dump is the main weakness of this plugin**, since every edit round-trips through desmos.com. Replacing it with a readable fence syntax carrying named sliders is the first thing this fork intends to change.

## The iframe must load from a blob URL, not srcdoc

The one piece of non-obvious knowledge in this codebase, preserved from upstream and worth keeping in any further fork.

A `srcdoc` document has the URL `about:srcdoc`, whose origin serializes to the string `"null"`, and that breaks any `postMessage` the framed page attempts. A `blob:` URL inherits the real `app://obsidian.md` origin, so the frame can talk to its parent. See `src/renderer.ts`.

## Provenance

Forked from [`n10521658/obsidian-desmos-live`](https://github.com/n10521658/obsidian-desmos-live), itself a re-upload of `notnilc-n/obsidian-desmos-live`.

**The original is gone and there is no upstream to send anything back to.** The `notnilc-n` GitHub account returns 404, and the plugin's place in the community list went with it. On 2026-07-29 an automated mirror job in `obsidianmd/obsidian-releases` dropped roughly 87 plugins across several commits, `desmos-live` among a batch of 18 in commit `7f3b42d2`. Fifteen of those eighteen are back in the list today, so the sweep was a transient re-sync rather than a purge. Of the three that stayed out, two are exactly the two whose repositories no longer resolve. There is no entry for it in `community-plugins-removed.json`, which records a reason for every deliberate removal, nor in `community-plugin-deprecation.json`. It was collateral of its author's account disappearing, not a plugin-specific action.

**The licence rests on a single declaration.** Upstream shipped no LICENSE file; `0-BSD` appears only as the `license` field of `package.json`, and that cannot be confirmed against the original author. The `LICENSE` file here was added to match that declaration. 0-BSD imposes no conditions and the plugin is 222 lines that could be rewritten if it ever mattered, so the practical exposure is small. It is recorded because it is real.

Upstream's README also states the code was AI-generated, with no reviewers and no users.

## Desmos API terms

This plugin loads the Desmos embed API with Desmos's public demo API key, as upstream did. The API is free for public non-commercial use, and upstream's author reported being pointed at [desmos.com/partners](https://www.desmos.com/partners) when they asked about commercial use. A private research vault is neither clearly public nor clearly commercial, so the question is worth settling with Desmos before any output of this plugin reaches a publication.

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

## Licence

0-BSD, inherited. See `LICENSE` and the provenance note above.
