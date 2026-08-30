import type { Manifest } from '@origami/format';
export interface AssembleInput {
    manifest: Manifest;
    /** slideId -> inner HTML (the content between the template tags). */
    slides: Record<string, string>;
    /** The built IIFE text (dist/origami-runtime.iife.js). */
    runtimeJs: string;
    /** Asset table (assetId -> data URL). The block is always emitted so saves
        never have to insert it later. */
    assets?: Record<string, string>;
    baseCss?: string;
    kindsCss?: string;
    themeCss?: string;
}
/** Update (or insert) the deck's <link rel="icon"> href in the HEAD — called at SAVE time so
    the saved file's static tab favicon stays in sync with the brand-logo, independent of the
    embedded runtime version or the browser's favicon cache (which can ignore a JS-set href).
    An attribute-unsafe href is skipped (the runtime's applyFavicon still covers it). */
export declare function setHeadFavicon(html: string, href: string): string;
/** Build a complete .origami.html from parts. Used by tests now and by the
    Studio's "New deck" later — one assembler, no drift. */
export declare function assembleDeck(input: AssembleInput): string;
