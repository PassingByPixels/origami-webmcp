/** `url(#…)` for a downward-fading fill of `color`, creating the <defs> entry once per SVG.
    `ns` scopes the id to its host root — '' for the live stage / Studio canvas (the v0.4.0 id,
    unchanged, so saved-deck bytes do not move) and 'p' for the print clone. */
export declare function fillGradient(svg: SVGElement, color: string, ns?: string): string;
