# Agent bridge

Drives the real WebMCP tool surface (`dist/`, headless Chromium) over a loopback JSON API,
so a shell-only text agent can author a Fold.

## Start

```
node tools/agent-bridge.mjs [--page folio|charts|draw|gantt] [--static-port 5188] [--bridge-port 5189]
```

Prints `[bridge] ready: N tools on http://127.0.0.1:5189` once tools are registered. Static
server binds `127.0.0.1:5188`, bridge API binds `127.0.0.1:5189` — both loopback only.

## CLI (from a second shell)

```
node tools/agent-cli.mjs tools                        # name — first sentence of description
node tools/agent-cli.mjs schema <name>                # full description + inputSchema
node tools/agent-cli.mjs call <name> '<json args>'
node tools/agent-cli.mjs call <name> --file <path>     # read args JSON from a file instead
node tools/agent-cli.mjs shot                          # tools/out/shot-<n>.png
node tools/agent-cli.mjs deck [--out <path>]           # serialized deck bytes; optionally saved
node tools/agent-cli.mjs activity
node tools/agent-cli.mjs reset                         # reload page, fresh deck state
node tools/agent-cli.mjs quit                          # closes bridge + browser, frees ports
```

**Windows quoting note**: a JSON arg on the raw command line can get its quotes mangled by
PowerShell 5.1. For args containing quotes or `<`/`>` (e.g. an `html` field), write them to a
`.json` file and use `--file <path>` instead — the CLI reads that file's bytes unmodified.

`BRIDGE_PORT` env var overrides the CLI's target port (default `5189`).
