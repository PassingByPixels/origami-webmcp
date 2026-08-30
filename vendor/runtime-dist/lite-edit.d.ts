/** A text leaf whose every descendant element is inline phrasing — so it folds
    back losslessly through innerHTML. (children===0 was the old, stricter test.) */
export declare function isInlineEditable(el: Element): boolean;
/** The editable text leaves of a slide (clone or source — same list). Outermost
    only: an .o-pill INSIDE an editable <p> is part of that <p>, not its own unit
    (membership in the candidate set also bounds the ancestor check to `scope`). */
export declare function liteEditNodes(scope: ParentNode): HTMLElement[];
export declare function sanitizeInline(html: string): string;
export declare function buildEditedCopy(pristine: string, edits: Map<string, string[]>): string;
export declare function downloadCopy(text: string, title: string): void;
