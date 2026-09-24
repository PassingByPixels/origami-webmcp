# Origami Maps v0.1.00

Self-contained agent-first fantasy / worldbuilding map lab (WebMCP mockup) — the Maps leaf of
the Origami Gratis suite. Lives at `src/app/maps.html`; the build ships it as `dist/maps/`.

## Open

After `node build.mjs`:

`dist/maps/index.html`

No server. No build. All compute is in the browser.

## What you should see

- Live procedural map (height, biomes, rivers, states, towns)
- Human paint tools on the left
- Agent lab bench on the right (`window.MapsMCP`)
- Activity log so a human can watch agent tool calls

## Try as an agent (DevTools console)

```js
MapsMCP.call("regenerate", { seed: "west-coast", template: "continent" })
MapsMCP.call("paint_height", { x: 20, y: 48, mode: "ridge", radius: 6 })
MapsMCP.call("recalculate_weather", {})
MapsMCP.call("rename_state", { id: 0, name: "Eldermark" })
MapsMCP.call("jot_note", { x: 30, y: 40, text: "Dragon fall" })
MapsMCP.get_summary()
```

Or paste JSON tool calls into the Agent panel and hit **Run tool**.

## Files

| File | Role |
|------|------|
| `src/app/maps.html` | Entire app (the leaf) |
| `docs/MAPS_AZGAAR_GAPS.md` | Why Azgaar needs a WebMCP shell |
| `docs/MAPS.md` | This file |
