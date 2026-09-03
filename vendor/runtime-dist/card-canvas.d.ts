/** The card's own viewport. 16:9, and the same numbers print already uses for a slide page. */
export declare const CARD_W = 1280;
export declare const CARD_H = 720;
/** Build (once) the sheet that freezes every viewport unit a card can see. Idempotent: a second
    call re-reads the document, so a theme or a kind sheet that lands later is picked up. */
export declare function freezeCardUnits(doc?: Document): void;
export declare function canvasScale(el: HTMLElement): number;
/** The scale a card is drawn at inside `box`, letterboxed. */
export declare function cardScale(box: HTMLElement): number;
export declare function fitCardSlide(box: HTMLElement, slide: HTMLElement | null): () => void;
