# The origami.gratis demo reel

A ~150-second silent 1080p screen capture of the whole site, cut to the scene plan in
`Cortex/projects/Origami Folio/Upgrade Ideas/MCP upgrade/demo-reel-plan.md`. Silent on purpose:
the Activity rail narrates on screen and a voiceover goes over the top.

## Re-cut it

```
npm run build                  # the reel records the REAL dist/, so build first
node demo/reel/reel.mjs
```

Writes `origami-reel.mp4` and `origami-reel.webm` to your Downloads folder, plus a contact sheet
and one still per scene under the scratchpad's `reel-work/`.

```
node demo/reel/reel.mjs --pace=0.9              # stretch or squeeze every beat
node demo/reel/reel.mjs --pace=0.05             # a ~35s smoke run: proves every call, no pacing
node demo/reel/reel.mjs --out=D:\cuts\reel.mp4  # .webm lands beside it
```

## What it needs

- **Installed stable Chrome >= 146.** The take drives Chrome's OWN WebMCP surface, so there is no
  fallback: the reel launches `channel: 'chrome'` with `--enable-features=WebMCP` and calls
  `document.modelContext.getTools()` / `.executeTool()` from the page, exactly as
  `tests/e2e/webmcp-native.spec.ts` and `demo/author-demo.mjs` do. Recorded on Chrome
  152.0.7977.65, whose status pill reads *connected via document.modelContext — 29 tools*.
  (Chrome 152 no longer exposes `navigator.modelContext`; the document surface is the live one.)
- **ffmpeg and ffprobe on PATH** — webm to H.264/yuv420p, the contact sheet, and the duration check.
- Nothing else. No dependency is installed, and your own Chrome profile is never opened: every
  launch gets a throwaway user-data-dir under the scratchpad and deletes it afterwards.

## The files

| File | What it is |
|---|---|
| `reel.mjs` | The driver: the browser, the transport, the camera, the encode, the self-review frames. |
| `scenes.mjs` | Every tool call and all the markup. Plain data — no pacing lives here. |
| `paper-image.mjs` | Generates the small PNG the scroll act embeds as a data URI (~2.4 KB, hand-rolled encoder — the repo has none and this may not add a dependency). |
| `end-card.html` | The closing card. Loaded from `file://`, so it fetches nothing. |

## Things that are the way they are for a reason

- **The pacing is off the render, not a stopwatch.** After every mutating call the driver waits for
  the preview iframe to remount and publish the viewer's own `window.__origami`, gives it two
  animation frames, and only then spends what is left of one short beat. A fixed sleep either
  races the 30 ms re-render debounce or wastes the difference.
- **Act 2 is ONE document fold, and the camera runs after the build, not during it.** The app takes
  the reader to the fold an agent just wrote (`src/app/shell.ts`), and every write replaces the
  preview's `srcdoc`, which destroys the document being scrolled. A scroll interleaved with the
  build doubles back at every call; a second fold would yank the camera down and then need an
  upward move to get home. One fold keeps the reader at the top through the whole build, and the
  pass afterwards is a single smoothstep — monotonic, so the scroll position never decreases.
- **`--window-size=1920,1080` is not cosmetic.** Playwright emulates the viewport, but the video is
  a screencast of the REAL window, and a headless browser's real window is 800x600. The moment the
  deck's Present button goes fullscreen the emulation is dropped and the capture shrinks into the
  corner of a grey frame.
- **The Present beat ends the drag at y=20, not y=0.** The runtime hides the deck chrome on a
  pointer drag up the top bar of more than 24 px — and the same handler reveals it again the moment
  a move lands at `clientY <= 4`. Dragging to the very top silently undoes the gesture.
- **The theme flip patches nine tokens, not one.** An accent-only patch moves hairlines nobody can
  see at 1080p. The way back is not hard-coded: the setup pass reads the deck's real token set off
  a throwaway deck and the take restores exactly that.
- **The cursor is drawn, and it moves with the real pointer.** A video capture cannot see the system
  cursor. An init script draws one and the driver glides it in step with `page.mouse`, using the
  same easing on both sides, so the arrow on screen and the `:hover` state can never disagree.
