# ORE MCP server

[한국어](README.ko.md)

An MCP server that lets AI apps (Claude Desktop, Claude Code and other MCP clients) build and edit ORE node graphs.
The graphs are compiled with **the same compiler as the web editor** (`../html/ore_vfx_editor.html`) into
Bedrock particle JSON and `.mcpack` resource packs. It runs on your own computer (stdio).

- The AI never writes Molang or the exported JSON directly — it always edits the graph, and the graph is compiled.
- Graphs are saved in the web editor's 💾 format, so you can open them in the web editor (📂) to look at them and keep editing by hand.
- All messages are in English. You can still talk to the AI in any language.

## 1. Download

- On the GitHub repository page, choose **Code → Download ZIP**, or download a source ZIP from **Releases**.
- Unzip it and use the `mcp_tool` folder inside. A short path without spaces is easiest (for example `C:\ORE` or `~/ORE`).

## 2. Check Node.js

You need Node.js **20.3 or later**. Open a terminal (Windows: Command Prompt) and run:

```
node -v
npm -v
```

If `node -v` shows something lower than `v20.3.0`, or the command is not found, install the LTS version from [nodejs.org](https://nodejs.org/).

## 3. Install

```
cd mcp_tool
npm install
```

Optional: `npm run check` starts the server and calls its tools once, to make sure everything works.

Create a **work folder** for the files the AI reads and writes (for example `C:\Users\me\ore-work`).
The server never reads or writes files outside this folder.

## 4. Connect your AI app

### Claude Desktop

1. Quit Claude Desktop completely (Windows: right-click the tray icon → Quit).
2. Open the settings file:
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
3. Add `"mcpServers"` inside the outermost `{ }`. If the file already has other settings, put a comma after the
   previous entry and continue. Use **absolute paths**; on Windows write every `\` as `\\`.

Windows:

```json
{
  "mcpServers": {
    "ore": {
      "command": "node",
      "args": ["C:\\ORE\\mcp_tool\\src\\server.mjs"],
      "env": { "ORE_WORKDIR": "C:\\Users\\me\\ore-work" }
    }
  }
}
```

macOS:

```json
{
  "mcpServers": {
    "ore": {
      "command": "node",
      "args": ["/Users/me/ORE/mcp_tool/src/server.mjs"],
      "env": { "ORE_WORKDIR": "/Users/me/ore-work" }
    }
  }
}
```

4. Start Claude Desktop again. In the message box, click **＋ → Connectors** and check that `ore` is listed.

### Claude Code

```
claude mcp add --scope user --env ORE_WORKDIR=C:\Users\me\ore-work --transport stdio ore -- node "C:\ORE\mcp_tool\src\server.mjs"
```

Check it with `claude mcp list`. (`--scope user` makes it available in every folder.)

### Settings (environment variables)

| Name | What it does |
|---|---|
| `ORE_WORKDIR` | The work folder for reading and writing files (recommended). If empty, the folder the server was started in |
| `ORE_ALLOW_RAW_MOLANG` | `1` allows the Particle Event `expr` field (Molang that goes into the JSON unchecked). Blocked by default |

## 5. First test

Ask in the chat:

> Using ore, make a new graph called test, show me the open graphs, then check it.

You should see `ore_new_graph` → `ore_list_graphs` → `ore_validate` run, ending with **"Check passed"**.
Then ask "save test to saves/test.txt" — the file appears in your work folder, and you can open it in the web editor with 📂.

## Troubleshooting

| Problem | What to check |
|---|---|
| `ore` is not in Connectors | The settings file syntax (commas, quotes, `\\`), and that you quit the app completely before editing |
| `ore` is listed but shows an error | The log file: Windows `%APPDATA%\Claude\logs\mcp-server-ore.log`, macOS `~/Library/Logs/Claude/mcp-server-ore.log` |
| The log says `node` can't be found | Put Node's full path in `"command"` (e.g. `"C:\\Program Files\\nodejs\\node.exe"`; on macOS run `which node` in Terminal) |
| The log says `Cannot find module` | Did you run `npm install` in `mcp_tool`? Does `args` point to `mcp_tool/src/server.mjs`? |
| "Paths outside the work folder are not allowed" | Does the `ORE_WORKDIR` folder exist? Ask the AI to use paths relative to it (e.g. `saves/fire.txt`) |

To test the server alone, run `npm start` in `mcp_tool`. If it prints
`ore-vfx-mcp-server running (stdio)` with no error, the server itself is fine (stop it with Ctrl+C).

## What to ask

Just describe what you want:

- "Using ore, make a firework that shoots up and then bursts outward"
- "Make a vortex that sucks particles into the center, and check it with a simulation"
- "Open saves/fire.txt, raise the particle count to 300 and make the colors green"
- "Build fire into out/fire.mcpack"

## Tools (21)

| Group | Tools |
|---|---|
| Help | `ore_help` (basics · formula · physics · events · limits) · `ore_list_node_types` |
| Graphs | `ore_new_graph` · `ore_open_graph` · `ore_list_graphs` · `ore_get_graph` · `ore_get_node` · `ore_close_graph` |
| Editing | `ore_add_node` · `ore_set_params` · `ore_connect` · `ore_disconnect` · `ore_remove_node` · `ore_set_texture` · `ore_auto_layout` |
| Checking | `ore_validate` · `ore_simulate` · `ore_preview_json` (read-only) |
| Output | `ore_save_graph` (web editor format) · `ore_export_json` · `ore_build_mcpack` |

The editing tools refuse: unknown field names, values outside the allowed options, wrong value types, formulas with
syntax errors, unknown sockets, connections that create a loop, a second Emitter, and writing image bake data directly.
If any value in a call is wrong, nothing is changed.

**Limits**

- Nodes that need an image (Shape (Image Contour), Vector Field (Image)) can't process images through MCP.
  Add the image in the web editor and save; MCP can then open and compile that file.
- `ore_simulate` runs the main emitter file only (not the web editor's ALL playback with sub emitters).

## Folders

| Path | Contents |
|---|---|
| `src/server.mjs` | The MCP server — tool definitions |
| `src/store.mjs` | Open graphs and editing rules (checks) |
| `src/ore-headless.mjs` | Runs the core in Node without a screen |
| `core/ore-core.js` | **Generated.** The calculation part of the web editor HTML. Don't edit by hand |
| `core/node-descriptions.json` | **Generated.** Node descriptions from the web editor's palette, in English |
| `tools/sync-core.mjs` | HTML → core extraction |
| `tools/i18n-missing.mjs` | Lists Korean text in the HTML that has no English yet |
| `tests/` | Comparison with the web editor, translation checks, server checks |

## Development

```
npm run sync              # rebuild core/ from ../html/ore_vfx_editor.html
npm run sync -- --dry     # show what goes where without changing files
npm run i18n:missing      # Korean text in the HTML without an English entry
npm test                  # everything below
npm run smoke             # export all test graphs headlessly
```

What `npm test` does:

1. Checks that `core/` matches the HTML (fails if the HTML changed and `npm run sync` was forgotten).
2. Runs the real web editor in jsdom and compares its export with the headless core: 31 graphs × optimizer off/on.
3. Translation checks: no untranslated text in the HTML, compiler messages come out fully in English, the English
   screens have no Korean left, and switching language keeps open tabs.
4. Starts the MCP server and calls its tools, then opens a saved file through the web editor's load button.

How `sync` splits the code: functions that were in core stay in core; screen functions (`tools/ui-names.json`) are left out.
A new function goes to the screen side if it uses `document`/`window`, otherwise next to the code before it. The output
lists "New top-level names" so you can check where they went. If screen code ends up in core, sync stops with an error.

To keep exports identical for the same graph, MCP turns off the optimizer's "check would take more than 3 s" rule
(which measures real time) and uses only the size rule (40KB). The web editor's behavior is unchanged.
