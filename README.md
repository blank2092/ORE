# ORE — Bedrock VFX Node Editor

[한국어](README.ko.md)

A web-based node editor for **Minecraft Bedrock Edition** particles.
Connect nodes the way you would in Unity VFX Graph, and ORE writes the Bedrock particle JSON (Molang) and a
resource pack (`.mcpack`) for you. An **MCP server** is included so AI apps such as Claude can build and edit the same graphs.

The editor is available in **English and Korean** (switch with the `EN · 한국어` button).

## What's in this repository

```
├── index.html                Landing page — open the web editor / MCP setup
├── html/
│   └── ore_vfx_editor.html   The web editor (a single file — open it in a browser, nothing to install)
├── mcp_tool/                 MCP server — lets AI apps edit, check and export node graphs
├── LICENSE
└── README.md
```

## Using the web editor

- **Online**: open this repository's GitHub Pages address (`https://<user>.github.io/<repository>/`) and click **Open the web editor**.
- **Offline**: download `html/ore_vfx_editor.html` and open it in a browser (Chrome, Edge…). No server or install needed.

Getting started:

1. A basic effect is **Emitter → Shape → Output**. Connect the Emitter's `j · n · h · seed` to the Shape, and the Shape's `x · y · z` to the Output's `offset`.
   (The editor opens with an example graph you can explore.)
2. Add nodes from the **Node Library** on the left, or right-click the graph. Drag from a socket to another node to connect them.
3. **▶ Preview** shows the effect in 3D, **Export →** gives you the particle JSON, and **📦 .mcpack** builds a resource pack.
4. Save your work to a `.txt` file with 💾 and open it again with 📂.

Main nodes: Emitter / Sub Emitter / Event, Shape (presets, formulas, image outlines), Noise 3D, Curl Noise, Turbulence,
Vortex · Attractor · Directional · Wind Zone · Buoyancy forces, Wall collisions, Accumulate (integration), Formula,
Color Gradient, Curve, Flipbook UV, Threshold and more. Turn on **ⓘ Descriptions** to read what each node does.

**Language:** the editor starts in English. The `EN · 한국어` button (top right; on phones, next to the Nodes / 3D Preview
tabs) switches language and keeps your open tabs. The choice is remembered. Switching language never changes the exported JSON.

## MCP server (edit graphs with AI)

`mcp_tool/` is a local server for MCP clients such as Claude Desktop and Claude Code. The AI adds and connects nodes,
then checks, simulates and exports them with **the same compiler** as the web editor. The AI never writes Molang
directly — everything is compiled from the graph, and the resulting graphs open in the web editor as they are.

Setup: [mcp_tool/README.md](mcp_tool/README.md)

## Turning on GitHub Pages (repository owner)

1. Open the repository's **Settings → Pages**.
2. **Source**: Deploy from a branch · **Branch**: `main` · **Folder**: `/ (root)` → **Save**.
3. After a minute, open the address shown on that page and check that the landing page and the editor load.

The `.nojekyll` file in the root tells Pages to publish the files exactly as they are — keep it.

## Development

The web editor's code lives in **one place**: `html/ore_vfx_editor.html`. The MCP server extracts the calculation part from it automatically.

1. Edit `html/ore_vfx_editor.html` (the version is the `Release x.y.z` in `<title>`).
2. Update the MCP copy and run the checks:
   ```
   cd mcp_tool
   npm install        # first time only
   npm run sync       # html → mcp_tool/core/ore-core.js
   npm test           # web editor and MCP give identical exports, translations are complete, the server works
   ```
3. Commit the HTML together with `mcp_tool/core/`. If you forget `npm run sync`, the GitHub Actions test fails and tells you.

### Translating new text

The editor's text is written in Korean in the code; English comes from the table `ORE_I18N_EN` near the top of the
script (`"Korean": "English"`). After adding new Korean text:

```
cd mcp_tool
npm run i18n:missing             # lists Korean text that has no English yet
npm run i18n:missing -- --json   # the same, as entries to paste into ORE_I18N_EN
```

Keep placeholders such as `{0}` and `{1}` in the English text. Text without an entry still works — it simply appears in Korean.

## License

[MIT](LICENSE) © 2026 ORE contributors
