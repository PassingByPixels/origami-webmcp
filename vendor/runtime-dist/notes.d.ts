import type { NotesData } from '@origami/format';
/** Colour swatches offered in the editor ('' = neutral default card). */
export declare const NOTE_SWATCHES: readonly ["", "#C8A04A", "#2F4A6B", "#557A4E", "#B0506A", "#5A5752"];
/** Lenient normalize — junk degrades to defaults, never throws. */
export declare function normalizeNotesData(raw: unknown): NotesData;
/** Read + normalize the slide's data block. null = no/unparseable block. */
export declare function parseNotesSlideData(slide: Element): NotesData | null;
export interface NotesRenderOpts {
    /** Wire the search box (viewer + canvas). */
    interactive?: boolean;
    /** Studio canvas only: render the editing controls and commit through this. */
    edit?: {
        onCommit: (data: NotesData) => void;
        /** Open the image picker for one note (host stores the asset, sets note.image). */
        onPickImage?: (noteId: string) => void;
    };
    /** Re-resolve data-oasset images after every (re)render. Note cards add their <img>
        dynamically, so the caller's one-shot resolve pass doesn't reach them — without this,
        any internal rerender (colour, pin, search, drag) blanks the image. */
    onResolve?: (scope: ParentNode) => void;
}
/** Render the notes board into the slide's [data-notes-mount]. Idempotent. */
export declare function renderNotes(slide: HTMLElement, data: NotesData, opts?: NotesRenderOpts): void;
/** Render an explicit failure notice — never a silent blank. */
export declare function renderNotesError(slide: HTMLElement): void;
/** Sweep a mounted slide for notes blocks and render each (search live, read-only cards).
    Notes are in-slide blocks — swept on every slide kind, the mirror of mountTrackers. */
export declare function mountNotes(slide: Element, assets?: Record<string, string>): void;
/** Print/static path: every note, no search box, no controls. */
export declare function finalizeNotes(slide: Element): void;
