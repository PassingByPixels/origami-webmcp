/** ENGINE B — our own line breaker, ported from the reference wrap PoC's `src/engine-layout.js`.

    The browser is removed from the line-breaking decision. For each line we ask wrap-geometry which
    x-intervals are free in that band, then fill them greedily left to right, emitting one absolutely
    positioned run span per interval we put text in. Because a line may own SEVERAL intervals, text
    flows down BOTH sides of a picture — the thing a float structurally cannot do.

    THE PoC'S PREMISE IS INVERTED HERE. There, `paras` was truth and the DOM was output. Origami's
    model IS the DOM (flushEdit posts the leaf's innerHTML), so instead: the SOURCE DOM STAYS TRUTH
    and runs are a detachable VIEW. mountRuns moves the leaf's own child nodes into a stash and hangs
    positioned runs in their place; releaseRuns puts the SAME Node objects back, in order — byte
    identity by construction rather than by a string round-trip.

    RUNS CARRY THEIR TRAILING BREAK WHITESPACE, and that is not a detail. The PoC records `wsStart`
    when it tokenizes and never reads it again, so a B-rendered paragraph's textContent loses the
    space at every line break. Eleven production consumers read that text (flushEdit, the paste
    snapshot and paste-split, captureEdits, buildEditedCopy, the TOC, docx export, spellcheck,
    find-in-page, the clipboard, the e2e oracles). So the runs TILE the leaf's whole text [0, len):
    each run runs from its first word to the START OF THE NEXT RUN'S first word, carrying the break
    space at its tail, and `white-space: pre` keeps that space from collapsing — which is also what
    stops the browser ever re-wrapping inside a run box. The tail space legitimately overhangs the
    interval's right edge by a space width, exactly as a browser line box's collapsed trailing space
    overhangs a float edge (see the word-rect oracles in the e2e suite).

    S1 IS VIEW-ONLY. Editing (beforeinput routing), the caret model and vertical motion are S3/S4;
    the only editing concession here is `holdRuns`, which keeps a FOCUSED leaf un-wrapped so no pass
    mounts runs under a live caret. */
import { type Exclusion } from './wrap-geometry.js';
/** Hold (or release the hold on) the focused leaf. Pass null to clear. */
export declare function holdRuns(leaf: HTMLElement | null): void;
export declare function isRunsHeld(leaf: HTMLElement): boolean;
interface Tok {
    /** offset of the whitespace preceding this token — kept, and READ (see the break-whitespace note) */
    wsStart: number;
    start: number;
    end: number;
}
/** Break opportunities. One token per word (or per CJK character), carrying the offset of the
    whitespace that precedes it so a run can start cleanly at the word rather than at the space. */
export declare function tokenize(text: string): Tok[];
/** CAN THIS LEAF BE LAID OUT AS RUNS AT ALL? Asked for every leaf of a block BEFORE any of them
    mounts, because the fallback is per BLOCK: a block with one unlayable leaf must push (the shipped
    behaviour, which can never leave text under a layer) rather than mount the rest and print that one
    through the picture.

    TWO MVP EXCLUSIONS, both because a run is a `white-space: pre` box holding cloned inline markup:
      * A leaf carrying a node with no text of its own — `br`, `img`, `hr`, an embed — cannot be
        described by text offsets at all: it is invisible to the TreeWalker the offsets are built on,
        so it would silently vanish from every run.
      * Whitespace CSS would have collapsed (a newline, a tab, a double space) renders literally under
        `pre`: a hard line break or a visible double gap where the source shows one space. Measured
        this session across every .origami.html in the repo — 548 paragraphs, zero hits — so this
        rejects nothing Origami's own serializer writes; it is the guard for pasted text. */
export declare function runnable(leaf: HTMLElement): boolean;
export declare function runsMounted(leaf: HTMLElement): boolean;
/** LAY THIS LEAF OUT AROUND `exclusions` AND HANG THE RUNS. Returns the laid-out CONTENT height in
    px, or null if the leaf could not be laid out (see `runnable`, and a leaf with no measurable
    column).

    `exclusions` are in THIS LEAF's content-box px — the caller adapts (document.ts's
    toLeafExclusion). `minRun` is the author's own `data-owmin`, clamped to the column here for the
    same reason the PoC clamps it: a threshold wider than the column would reject even a completely
    free line, and no amount of advancing lines would ever find a usable band.

    GENERATED CONTENT RIDES THE FIRST LINE, or the leaf declines. The runs are out of flow, so a
    leaf's own `::before` is left as the ONLY in-flow content and paints at the content-box origin —
    exactly where the first run goes. A document heading therefore stamped its section number on top
    of its own first words. So the number is measured (`pseudoAdvance`), the first band's leading
    interval gives up that much width, and `text-indent` slides the number onto the same x the first
    run now starts from: the two share line one, which is what the heading looks like unwrapped.
    `text-align` is pinned left with it, because the number is now the only thing an author's
    `data-oalign` could still centre and the runs themselves ignore alignment entirely.
    A TRAILING `::after` HAS NO SUCH SEAT — it shares the ::before's line box, so it cannot ride the
    LAST line — and a leaf carrying one declines rather than stamping the mark over line one (a
    `[data-omotif="right"]` paragraph, measured at post=25.48px). Declining means the block pushes,
    which is the lattice's own safe half.

    IDEMPOTENT: mounting a mounted leaf releases first, so the settled-pass re-runs (paginateDoc's
    and reserveCardBandsWhenSettled's) reproduce their own output instead of stacking on it. */
export declare function mountRuns(leaf: HTMLElement, exclusions: Exclusion[], minRun: number): number | null;
/** PUT THE SOURCE BACK — the same Node objects, in order. Byte identity by construction: nothing was
    serialized, so nothing can come back subtly re-spelled. */
export declare function releaseRuns(leaf: HTMLElement): void;
/** RUN `fn` WITH `root`'S SUBTREE IN SOURCE FORM, then put the identical view back.
    THE ONE GATE EVERY READER AND WRITER OF A LEAF'S CHILDREN GOES THROUGH (spec Q1). A mounted leaf's
    children are RUN SPANS, so an ungated `innerHTML` read serializes the view into the model, and an
    ungated `normalize()` MERGES TEXT ACROSS RUNS — the most destructive of the eleven, because the
    result still looks like prose. Release is total and byte-identical (the same Node objects), so a
    reader sees exactly the source it would have seen had the engine never run.
    WHAT RELEASE DOES NOT RESTORE IS A LIVE `Range`, and the distinction is worth stating because the
    opposite is the intuitive guess. Anything holding a NODE is fine — the same objects come back. But
    the DOM's removing steps collapse any live range whose boundary is an inclusive descendant of a
    node being removed, so the moment `mountRuns` moves the leaf's children into the stash, a
    selection inside them collapses to a point and NO later release can un-collapse it. A caller that
    must survive a mount has to be protected from the mount itself (the canvas holds the leaf for the
    lifetime of a captured selection), not merely released afterwards.
    TAKES A SUBTREE, not just a leaf: several callers hold a BLOCK (the oversized-paste snapshot) or a
    whole fold (the exporters), and their leaves are what carry the runs.
    RE-ENTRANT and no-op when nothing is mounted, so gating a caller that is already gated costs one
    attribute check — which is what makes gating the whole audited list cheap enough to be honest. */
export declare function withSource<T>(root: HTMLElement, fn: () => T): T;
/** Release every mounted leaf at or under `root`. Both band passes' release functions call this for
    the same reason they call releaseCarve: a view a pass mounts and its sibling does not clear is a
    layout that outlives its own layer. */
export declare function releaseRunsIn(root: HTMLElement): void;
export {};
