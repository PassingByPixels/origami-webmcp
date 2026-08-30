/** (Re)build the auto-TOC into each nav.o-toc[data-toc-mount] in the fold from the
    document's h2/h3 headings. Idempotent. `interactive` wires the smooth-scroll.
    Numbers mirror the CSS counters (h2 → "N", h3 → "N.M").

    Two behaviours worth knowing:
    - A heading marked data-onotoc is left OUT of the list but still TAKES ITS NUMBER. The
      CSS counters on the page know nothing about that attribute, so skipping it in the count
      would silently make the Contents disagree with the printed headings.
    - Subsections nest inside their section's group so the list can fold. The nesting is real
      DOM, not the old cosmetic indent — you cannot collapse a flat list of siblings. */
export declare function renderDocToc(slide: HTMLElement, interactive: boolean): void;
/** Is this text block FULL — at the page line, with no room for another line?

    ONE definition, deliberately shared by the paginator (which caps and marks the block) and by the
    Studio (which refuses the keystrokes that would overrun it). They MUST agree. A block the editor
    refuses input on but the page does not mark is a keystroke that vanishes with no explanation; a
    block the page marks but the editor still accepts is a warning the author cannot clear.

    "No room for another LINE" rather than "already overflowing" is what makes the two agree: the
    editor has to refuse the keystroke BEFORE the text overruns, because refusing afterwards would
    mean hiding something the author just watched themselves type. */
export declare function docBlockFull(b: HTMLElement): boolean;
/** SUPPRESS THE PLATE UNDER A TRANSPARENT PNG — view-only, one attribute, consumed by one CSS rule.

    `figure.o-img img` carries a drop shadow (css.ts), and a shadow is drawn from the element's BORDER
    BOX. For a raster with transparency that traces the rectangle of the FILE rather than the edge of
    the picture, so a cut-out PNG reads as artwork sitting on a white-grey plate — reported as "pngs
    with transparency get a white background erroneously". The precedent for the answer is already in
    the sheet: `figure.o-img[data-ofade] img` drops the shadow because a faded edge has none for one
    to trace. This is the same statement, made about alpha.

    THE PREDICATE IS `scan.rows !== null`, which is the trace's own word for "the silhouette is not
    the rectangle": traceAlpha sets it when any sampled row is fully transparent, or when any row's
    opaque span stops short of the raster's edges. It SUBSUMES the smaller-bbox test — an opaque bbox
    inside the raster means transparent rows or short rows, and both set it — and it is exactly the
    condition under which the shadow draws an edge the picture does not have. An opaque photo, every
    sampled row full width, answers null there and keeps its shadow.

    UNDECODED AND TAINTED BOTH MEAN "LEAVE THE SHADOW ON", deliberately: alphaScanOf answers null for
    both, and a cross-origin raster we may not read is not one to make claims about. Undecoded is not
    a verdict though — it is re-asked on `load`, which is why this hooks the event rather than
    trusting the first pass.

    IT IS DRIVEN FROM resolveAssetRefs (assets.ts) because that is the ONE seam every surface funnels
    every deck image through — the Studio canvas, the viewer's mount, Present's own boot of that same
    viewer, and the print clone — and it is the moment a src is set, so "not decoded yet" is a state
    it can hook rather than poll. Hanging it off the band passes instead would have covered FLOATED
    figures only, and a picture in the flow shows the plate just as plainly. */
export declare function markAlphaFigures(scope: ParentNode): void;
/** RELEASE every reservation reserveFloatBands wrote on a scroll — the band markers and gaps on its
    blocks — leaving the layout the model on its own describes. reserveFloatBands runs this first,
    which is what makes a second run over its own output reproduce the first rather than add to it.

    Exported for the same reason releaseCardBands is: a caller that needs to MEASURE the fold's
    natural layout needs a reading with no stale reservation still applied. The scroll drop's own slot
    commit (bandSlot, called from the isScroll branch of startFloatDrag in canvas.ts) is that caller —
    it reads the CURRENT rendering rather than a released one (a document has no reservation that
    resizes the frame a percent would be read against, so that half of the card drop's dance is
    unnecessary here), but "current" still has to mean "cleared of whatever the layer's OWN PREVIOUS
    position pushed", or a sibling still carrying that stale margin reports an inflated bottom and the
    new slot is classified against a layout that is one drop out of date. */
export declare function releaseFloatBands(doc: HTMLElement): void;
/** RESERVE THE VERTICAL BAND OF EVERY FLOATING LAYER ON A CARD — the sibling of reserveFloatBands
    above, and a separate function for one structural reason rather than a taste for symmetry.

    A DOCUMENT layer's top is PIXELS from the paper top: push the flow down and the layer does not
    move, so one forward pass lands and that is what reserveFloatBands is. A CARD layer's top is a
    PERCENT of the frame, and the frame's height is content-driven — push the flow down, the frame
    grows, the percent re-maps to a lower pixel, and the band would follow the very block it just
    pushed.

    THE CHASE IS DELETED, NOT APPROXIMATED. An earlier build let the band chase and iterated to the
    fixed point instead. The arithmetic converges; the layout does not survive it. A layer holding
    p of the frame only clears by (1 - p) of every push, so clearing `need` px of overlap costs
    need/(1 - p) px of gap — measured on a 22px layer at 75%: a gap of 232.50px, then 422.72px one
    insert later, the card ballooning 616px to 925px. Converged, and absurd to look at.

    So THE BANDS ARE FROZEN. Every reservation is released first, the layout is measured ONCE in that
    released state, and those numbers are what the flow is pushed clear of: one push per overlap,
    with no term that grows as the frame does — arithmetically the document pass, on a card. The set/
    measure/correct step stays (a margin collapses with the previous block's margin-bottom, so the
    value set is not the distance moved) and so does lowest-band-wins for stacked layers. What goes
    is everything the chase needed: the pass cap, the measured-slope correction, the divergence bail.
    Nothing chases, so nothing can diverge.

    THE LAYER IS THEN RE-ANCHORED, VIEW-ONLY. The frame ends the pass taller than the one T0 was read
    from, so the layer's percent would now render it below its own band. pinLayerTop holds it on the
    frozen pixel by overwriting the INLINE top and stashing the model's own string to put back — the
    model is never written. A layout pass that wrote to the model instead walked a layer's saved top
    from 74.92% to 102.96% over six inserts, i.e. straight out of the frame.

    WYSIWYG FALLS OUT OF THE FREEZE. Everything is derived from a reading taken with the reservations
    cleared, so it is a function of the model and the render width alone. The Studio canvas and the
    viewer run this same pass over the same model at the same width, so they compute the same T0, the
    same gaps and the same anchor — neither surface can drift into a layout of its own.

    THE PUSH IS ORDER-STICKY, NOT GEOMETRIC. A layer OWNS A SLOT in the reading order — its own DOM
    position among the column's children, committed by the drop that put it there (see bandSlot
    below, and the set-xy commit in the Studio). Every flow block BEFORE that slot renders above the
    layer's band; every block AT or AFTER it is pushed below, whether or not the band is currently
    sitting on it. The old rule was memoryless geometry — a block was pushed only while the band
    overlapped its natural slot — and that let one layer's push CHAIN a block past a SECOND layer's
    band: move the first layer away and the chain un-collapses, the block returns to its natural slot
    and visually leapfrogs the second layer. Both layouts are geometrically consistent; the FLIP
    between them is the defect, and no purely geometric rule can remove it, because the information
    that decides which side of a layer a block belongs on is not in the geometry. It is in the order.

    THE ACCEPTED RESIDUAL: a floor push from layer A can land a BEFORE-block of layer B inside B's
    band. It needs A above B with a block between their two slots. Closing it would require the layout
    pass to rewrite reading order — a model write from a layout pass, which is exactly the defect class
    that produced the walking-layer bug this file already documents. So it is left open: re-dropping
    either layer resolves it by hand, and the pass stays a pure function of the model.

    MIGRATION IS BY HAND, DELIBERATELY. A deck saved before slots were tracked carries whatever DOM
    position its layers happened to have, which may not be the slot its author would draw. The first
    re-drag of each layer self-heals it, because the drop commits the correct slot. Nothing rewrites a
    deck on load: a loader that reordered folds would be writing the model from a layout reading, and
    the whole point of the slot is that only the user's own gesture may do that.

    THE FLOW IS MEASURED OFF offsetTop/offsetHeight, deliberately. A card's blocks carry the `.anim`
    reveal, whose transform moves their RECTS for most of a second after every mount while leaving
    their layout boxes exactly where they are — reading rects here would measure the reveal, not the
    layout, and bake the 16px rise into the gaps. The LAYER is read from its rect (with any canvas fit
    SCALE divided out, as above) because its centring `translate: -50%` is precisely the offset that
    offsetTop knows nothing about, and a float never animates (see the css).

    Like the document pass this writes only to the live DOM, only view-only markers, and
    injects/reorders no node — every Studio path is a pure children[i] walk. It clears its own previous
    output first, anchor included, so a second run on the same layout produces the same layout. */
export declare function reserveCardBands(inner: HTMLElement): void;
/** THE SLOT a layer takes in reading order: the DOM child index it belongs at. Blocks whose box lies
    FULLY ABOVE the layer's band top are before it; the first block that straddles or lies below that
    line is the one it sits in front of. Below every block → the last slot.

    SHARED by both frames — a card's `.slide-inner` and a document's `.o-doc` — because the mechanics
    genuinely coincide, not just resemble each other: both read the layer's own rendered top (scale
    divided out, same as reserveCardBands/reserveFloatBands above) and classify siblings by where their
    flow boxes fall relative to it. The one axis the two frames disagree on — a card's top is a PERCENT
    that a push can move, a document's is a PIXEL that a push cannot — is irrelevant here: this reads
    the layer's CURRENT rendered position, whichever kind of top produced it, and neither frame's flow
    push moves the layer itself. There is no second, doc-flavoured version of this arithmetic to write.

    This is exactly the intersection test reserveCardBands (and, for a document, reserveFloatBands)
    used to re-derive on every layout pass, evaluated ONCE — at the drop that moved the layer — and
    then frozen into the DOM order by the commit. It lives here, beside the bands whose top it splits
    on, so the two cannot drift apart.

    THE LAYOUT PASS MUST NEVER CALL THIS. A pass that re-derived the slot would be re-deriving reading
    order on every reflow, which is the memoryless behaviour the slot exists to replace — and writing
    the answer back would be a model write from a layout pass. Its only callers are the canvas's card
    and scroll drag-drop commits.

    Call it with the reservations RELEASED, for the same reason the pass measures released: a reserved
    gap grows the column and a .slide centres that column, so a reading taken while one is applied is
    of a frame nobody resolves a percent against. A document has no reservation that grows the column
    (its gaps are pixel margins, not a resized frame), so this matters for the card caller only — the
    scroll caller may call it against the current rendering (see the drop commit in canvas.ts). */
export declare function bandSlot(inner: HTMLElement, layer: HTMLElement): number;
/** RELEASE every reservation on a card fold — the band markers and gaps on its blocks, and the
    view-only anchor on its layers — leaving the layout the model on its own describes.

    reserveCardBands runs this first, which is what makes a second run over its own output reproduce
    the first rather than add to it. It is also exported because a caller that needs to MEASURE the
    fold needs the un-reserved reading specifically: a reservation grows the content column, and a
    .slide centres that column, so measuring while one is applied reads a frame that is both taller
    and higher up than the one this pass resolves a percent against. */
export declare function releaseCardBands(inner: HTMLElement): void;
/** Reserve on a card once the layout has SETTLED, for the same reason pagination waits: web fonts
    reflow the text and images without intrinsic sizing collapse to nothing until they load, and both
    land after the first frame. Idempotent, so re-running on each is free. */
export declare function reserveCardBandsWhenSettled(slide: HTMLElement): void;
/** Lay the document's blocks onto real pages.

    Origami has never known where a page ends — Chromium decides that, at print time only, and there
    is no screen equivalent to ask. This measures the flow instead and pushes any block that would
    straddle a boundary onto the next sheet, which is what makes page NUMBERS possible at all (the
    .o-toc-pageno span has been rendered and empty since the document kind shipped).

    Two constraints shape the whole implementation:
    - It must not add, remove or reorder any node. pathOf/nodeAt are pure children[i] walks, so an
      injected spacer would shift every later block's path and send edits to the wrong element. The
      push is therefore a margin on the block itself, and the page edges are a CSS background.
    - It must not touch the saved file. It only ever writes to the live DOM; the Studio's writers
      parse the model into a detached template, so nothing here can reach disk.

    Returns the page count. Idempotent: it clears its own previous output first, so it can run on
    every re-render and every edit. */
export declare function paginateDoc(slide: HTMLElement): number;
export declare function docMount(slide: HTMLElement): void;
/** Print/static path: TOC rows, no click handlers. */
export declare function docFinalize(slide: HTMLElement): void;
