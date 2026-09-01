/** SHARED EXCLUSION GEOMETRY — the reference wrap PoC's `src/geometry.js`, ported whole.

    Everything here works in CONTENT-BOX coordinates: origin at the top-left of the text column's
    content box, x growing right, y growing down, CSS px. For Engine B that column is ONE LEAF (a `p`,
    an `li`), not the frame — the caller adapts the frame-px exclusions the band passes measure
    (see wrapBoxOf/`toLeafExclusion` in document.ts) into each leaf's own space before calling in.

    An exclusion is a region text must not enter. Both engines ask it the same question — "for the
    horizontal band this line occupies, which x ranges are still free?" — and differ only in what they
    may do with the answer: the A carve can consume ONE interval (a float has one side), Engine B can
    consume all of them, which is what lets text flow down both sides of a picture. */
/** `rows` is an optional contour: 3 floats per sampled row [y, left, right], in the same coordinates,
    ordered by y. When present it overrides the bounding box for band queries, which is contour
    ("tight") wrap rather than square wrap. This is structurally the WrapBox document.ts already
    measures — the same four edges plus the same row triples. */
export interface Exclusion {
    left: number;
    top: number;
    right: number;
    bottom: number;
    rows: Float64Array | null;
    /** THE FULL-WIDTH FOOT of the exclusion: a y at or below which it blocks the WHOLE measure rather
        than its own x-range. Null (the usual case) means the box blocks only what it covers.
  
        It exists for the CAPTION. A captioned figure's exclusion is the picture unioned with the
        caption VERTICALLY only — the caption's own width is the figure's, which is the inflated raster
        width the exclusion exists to stop trusting. That leaves the caption's rows describing the
        picture's x-range, so without this a line level with "Figure 1." would be set beside it, on
        either side. The A carve answers the same question by running its polygon full width below the
        caption top (contourPolygon's capY); this is that choice, expressed as geometry. */
    fullBelow?: number | null;
}
/** Free x-intervals inside [contentLeft, contentRight] for the band [bandTop, bandBottom).
    Ascending x order; an empty array means the band is fully blocked. */
export declare function freeIntervals(bandTop: number, bandBottom: number, contentLeft: number, contentRight: number, exclusions: Exclusion[]): Array<[number, number]>;
/** The horizontal span an exclusion occupies within a band, or null if it does not reach into that
    band at all.

    HALF-OPEN IN Y: an exclusion whose bottom exactly equals bandTop does not block the band. Without
    it an image ending precisely on a line boundary steals a line it does not visually touch. */
export declare function spanInBand(ex: Exclusion, bandTop: number, bandBottom: number): [number, number] | null;
/** Inflate an exclusion by a margin on all sides — the equivalent of CSS `shape-margin`, and what
    replaces the band's own +/- margin for Engine B. Contour rows are inflated horizontally; the row
    set is extended vertically by the box's own edges moving, so the margin holds along the contour
    too (spanInBand's nearest-row fallback covers the y ends). */
export declare function inflate(ex: Exclusion, m: number): Exclusion;
/** Drop intervals too narrow to set readable text in.

    Without this an image leaving a 60px gutter is dutifully filled with one-word slivers — "in the /
    it is / where" stacked down the edge. Geometrically perfect, typographically a ransom note. Word
    solves it the same way, with a threshold below which a side is simply not used. `minRun` 0
    disables the filter entirely. */
export declare function usable(intervals: Array<[number, number]>, minRun: number): Array<[number, number]>;
