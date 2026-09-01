export interface ThemePreset {
    /** Stored in manifest.theme.name. */
    name: string;
    /** Shown in the Studio picker. */
    label: string;
    tokens: Record<string, string>;
}
/** The full preset list — tokens are complete (every var the deck CSS reads),
    so applying any theme fully re-projects the theme style block. All presets
    are light/print-safe. THEMES[0] is the default new-deck theme. */
export declare const THEMES: ThemePreset[];
export declare const THEME_CSS: string;
