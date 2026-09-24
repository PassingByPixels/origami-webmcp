/** The gallery image block — one figure that lays its pictures out six ways: a plain single
    column, an accordion that opens on hover/focus, a draggable 3-D dome, a drifting wall of tiles, a
    before/after compare reveal, or a cycling fan of cards. Dependencies stay at zero (no network, no
    library): the accordion and the drift are pure CSS, the dome is CSS 3-D plus a small pointer-drag
    handler, the compare reveal is a clip-path plus a divider drag, and the carousel is a fan whose
    transforms a timer cycles. Every look shares one click-to-enlarge spotlight (FLIP to the centre,
    click-off or Escape to close).

    Data lives in the figure's own inert `script[data-odata="gallery"]`, the same shape every other
    in-slide block uses, so the block is inert until the runtime mounts it. Images are written as
    `<img data-oasset>` so the standard asset sweep resolves them (never inline URLs in the model).

    THE DOME IS A PORT OF REACT BITS' DomeGallery (the free HTML port). Its geometry is copied, not
    invented: a 35-column grid of 2x2 tiles with a Y-row parity per column (175 reference slots),
    `computeItemBaseRotation` turns each into `rotateY(...) rotateX(...) translateZ(radius)` with
    `unit = 360 / segments / 2`, the radius is fitted to the container by a ResizeObserver, and the
    drag + release inertia follow the reference's constants. The 175 slots survive as ANGLES only:
    the images go on the slots nearest the camera-facing centre at rest, and the rest are never
    rendered (they were invisible anyway and cost 175 DOM nodes). See `buildDomeItems`.

    THE SPOTLIGHT ESCAPES THE BLOCK. Its overlay is a `position: fixed` layer appended to
    `document.body`, so it covers the viewport in Present instead of being clipped by the figure. It
    is never built for the still/print render, and `@media print` hides it. The editable canvas
    mounts with `interactive: false`, which builds the looks but wires neither the spotlight nor the
    dome drag. */
export interface GalleryImage {
    asset?: string;
    alt?: string;
    /** Optional caption: under the picture in `single`, over it in `drift`/`accordion`, on the
        carousel's front card, and in the spotlight for every look. Absent → nothing is rendered. */
    caption?: string;
    /** Optional short tag: a rounded pill in the carousel card's top-right corner. Absent → no pill. */
    tag?: string;
}
export interface GalleryData {
    style?: string;
    images?: GalleryImage[];
}
export declare const GALLERY_STYLES: readonly ["single", "accordion", "dome", "drift", "compare", "carousel"];
export type GalleryStyle = (typeof GALLERY_STYLES)[number];
/** Mount options. The editable canvas passes `interactive: false` so a click still selects the
    block (and never opens the spotlight) while authoring. */
export interface GalleryMountOptions {
    interactive?: boolean;
}
/** Parse a gallery figure's data block. Null when absent or unparseable (the figure is then left
    as inert HTML rather than guessed at). */
export declare function parseGalleryData(root: ParentNode): GalleryData | null;
export interface DomeItem {
    x: number;
    y: number;
    sizeX: number;
    sizeY: number;
    /** null is a blank reference slot: it keeps its grid angle but holds no image, and is never
        rendered (it was invisible and cost a DOM node). */
    image: GalleryImage | null;
    /** The image's position in the gallery (for the spotlight's arrows), or null on a blank slot. */
    imageIndex: number | null;
}
/** The built dome: the occupied slots, the rest rotation that centres them, and how far their
    centres reach from that centre (degrees). The fit uses the span; the drag starts from the
    centre, so the photos are centred when the dome is untouched. */
export interface DomeLayout {
    items: DomeItem[];
    /** rotX/rotY (degrees) that put the cluster's centre on the camera axis. */
    centre: {
        x: number;
        y: number;
    };
    /** Half the angular spread of the occupied slot centres, per axis (degrees). */
    span: {
        x: number;
        y: number;
    };
}
/** Angular distance, in degrees, between a tile's normal (rotateY, rotateX) and the camera axis at
    rest (0,0): the true 3-D angle `acos(cos rotY · cos rotX)`. A lexicographic |rotY|-first key
    would pick one narrow column; this picks a round patch around the centre. */
export declare function domeCentreDistance(rotY: number, rotX: number): number;
/** Port of the reference's `buildItems`: a 35-column grid whose rows alternate parity per column,
    every tile 2x2 half-segments (175 reference slots). The slots stay as ANGLES; the images are
    placed on the `n` slots nearest the camera-facing centre at rest, so every picture is in view
    when the dome is untouched. Sort is by true angular distance, tie-broken by |rotY| then |rotX|
    (front-most first) and finally by slot order, so the assignment is deterministic. */
export declare function buildDomeItems(pool: GalleryImage[], seg: number): DomeLayout;
export interface DomeRotationBounds {
    /** True when the whole sphere is populated: no horizontal clamp (full 360°, like the reference). */
    full: boolean;
    yLo: number;
    yHi: number;
    xLo: number;
    xHi: number;
}
/** The rotation range the populated slots allow: the occupied rotY/rotX range (negated, because the
    sphere's rotation cancels each slot's own angle) plus `margin` on each side. The vertical range
    is also capped by the reference's tilt limit. A full sphere (every slot occupied) has no
    horizontal clamp. The rest view (`-centre`) is always inside the range. */
export declare function domeRotationBounds(layout: DomeLayout, margin: number, verticalCap: number): DomeRotationBounds;
/** Soft boundary: inside [lo,hi] the value passes through; outside, the overshoot `d` is compressed
    to `d·give/(d+give)`, so the value eases toward the wall (derivative 1 at the wall, no hard stop)
    and can never exceed it by more than `give`. */
export declare function softLimit(value: number, lo: number, hi: number, give: number): number;
/** Clamp a pointer x to the 0..100% reveal of a box. Pure, so the drag maths is unit-tested. */
export declare function compareRevealPercent(clientX: number, left: number, width: number): number;
/** How many cards sit each side of the front one (a fan of five). */
export declare const CAROUSEL_VISIBLE = 2;
/** Default horizontal fan step in px, used when no container width is known. */
export declare const CAROUSEL_SPREAD = 46;
export interface CarouselSlot {
    /** Signed distance from the front card: 0 front, negative left, positive right. */
    d: number;
    x: number;
    y: number;
    rotate: number;
    scale: number;
    z: number;
    opacity: number;
    /** Beyond the fan: parked at the centre behind the front card, so the cycle has no visible jump. */
    hidden: boolean;
}
/** The horizontal step for one card of fan offset, derived from the container width so the fan
    spans the block instead of a fixed 46px. Clamped so a narrow block still fans and a wide one
    does not fling the outer cards off the frame. Pure. */
export declare function carouselSpread(containerWidth: number): number;
/** The fan geometry for `n` cards with card `front` at the centre. A card further than
    CAROUSEL_VISIBLE from the front is parked at the centre (behind the front, transparent): the
    cycle then wraps by sliding out from behind rather than flying across the frame. `spread` is the
    horizontal step per fan offset. Pure. */
export declare function carouselSlots(n: number, front: number, spread?: number): CarouselSlot[];
/** Interactive mount on the live stage: build every gallery figure once. `interactive: false`
    (the editable canvas) renders the looks but leaves clicks to the block-selection handler. */
export declare function mountGalleries(slide: HTMLElement, opts?: GalleryMountOptions): void;
/** Static print render: every style flattens to a still column so the paper is sane. */
export declare function finalizeGalleries(slide: HTMLElement): void;
