# Azgaar Fantasy Map Generator → WebMCP gaps

Source reviewed: [Azgaar/Fantasy-Map-Generator](https://github.com/Azgaar/Fantasy-Map-Generator) (README + `src/generators/*`, `src/controllers/*`).

Live app: https://azgaar.github.io/Fantasy-Map-Generator

## What Azgaar already does well

- Full client-side pipeline: grid → heightmap → features → climate → biomes → rivers → cultures → states → burgs → routes → military…
- Intended target architecture (from README): **world data / generators / editors / renderers**
  - Flow: `settings → generators → world data → renderer`
  - UI editors = controlled mutations of world state
- Extremely deep domain model (burgs, provinces, religions, goods, journeys, 3D view, `.map` save format)
- Perfect fit for “no compute on our end” — the browser is the engine

## What it is missing as a WebMCP / agent lab bench

| Need for agents | Azgaar today | Maps leaf target |
|-----------------|--------------|------------------|
| Stable tool names | UI controllers + DOM | `set_seed`, `regenerate`, `get_regions`, … |
| LLM-sized readback | Huge SVG + internal packs | `get_summary`, `sample_cells`, typed lists |
| Surgical edits | Brush UIs, hard to drive headless | `paint_height`, `paint_climate`, rename_* |
| Explicit cascade | Full regen / intertwined modules | `recalculate_weather`, `recalculate_population` |
| Human watching agent | Single-player UI | Live canvas + activity log |
| Export as deliverable | `.map` + images | JSON world file agents can re-import |
| Host registration | None | `navigator.modelContext` / page tools |

## Generators worth mirroring (Azgaar `src/generators`)

Heightmap · grid/pack · coastline · ocean · precipitation · biomes · rivers · lakes · ice · relief · cultures · religions · states · provinces · burgs · routes · population · military · markers · names · labels · goods/markets · journeys

v0.1.00 implements a **toy subset**: height, climate, biomes, rivers, population, states, settlements, notes — enough to prove the agent loop.

## Design rule locked in Gratis leaf

> Agent directs generation with parameters, reads structured result, iterates (“more mountains west, drier climate, rename this kingdom”) without needing to “see” a broken render. The editable map file is the deliverable.

See workspace: `wiki/pages/projects/origami-gratis-mcp/leaf_maps.md`
