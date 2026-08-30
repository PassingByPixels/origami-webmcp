import type { Violation } from './types.js';
/**
 * Gantt kind data — the Coty roadmap data model, carried per slide in an inert
 * JSON script block: <script type="application/json" data-odata="gantt">.
 *
 * The block never executes (type=application/json) and the serializer escapes
 * every "<" as <, so the JSON can neither close its own script tag nor
 * fake a template boundary. validateSlideContent enforces the same invariants
 * on hostile input.
 */
export interface GanttLens {
    name: string;
    color: string;
}
export interface GanttSwimlane {
    name: string;
    owner: string;
}
export interface GanttCard {
    id: string;
    title: string;
    swimlane: string;
    /** "W3" / "M2" labels, or a fractional week number from a free drag (0-based). */
    start: string | number;
    durationWeeks: number;
    lens: string;
    type: 'Technical' | 'Process' | 'Cultural';
    effort: 'EASY' | 'MED' | 'DEFER';
    what: string;
    needs: string;
    caveat: string;
    deliverable: string;
    sources: string;
    completed: boolean;
}
export interface GanttMilestone {
    label: string;
    /** 1-based, fractional ok. */
    week: number;
    color: string;
}
/** A background band marking a stretch of the timeline (e.g. a financial quarter).
    Drawn behind the cards. startWeek/endWeek are 1-based and inclusive. A second
    colour turns the fill into a left→right gradient. */
export interface GanttZone {
    label: string;
    /** 1-based, inclusive. */
    startWeek: number;
    /** 1-based, inclusive; >= startWeek. */
    endWeek: number;
    color: string;
    /** Optional second gradient stop; when set the band fades color → color2. */
    color2?: string;
}
export interface GanttData {
    totalWeeks: number;
    /** ISO date anchoring week 1 to the calendar, or null for plain W/M labels. */
    startDate: string | null;
    lenses: GanttLens[];
    swimlanes: GanttSwimlane[];
    cards: GanttCard[];
    milestones: GanttMilestone[];
    /** Optional background bands (financial quarters, phases…). Omitted when empty
        so a deck that never used zones stays byte-identical (like foldType). */
    zones?: GanttZone[];
}
export declare const GANTT_CARD_TYPES: readonly ["Technical", "Process", "Cultural"];
export declare const GANTT_CARD_EFFORTS: readonly ["EASY", "MED", "DEFER"];
/** 0-based week offset for a card start — number, "W#", "M#" (4 weeks/month) or numeric string. */
export declare function ganttWeekIndex(v: string | number): number;
/** Strict shape check for a gantt data block. REJECT, never repair. */
export declare function validateGanttData(data: unknown): Violation[];
/** Serialize gantt data for embedding — "<" escaped so the JSON can never
    terminate its script block or fake a template boundary. */
export declare function ganttDataJson(data: GanttData): string;
/** All inert data blocks in a slide inner: [kind, rawJson] pairs. String-level. */
export declare const DATA_BLOCK_RE: RegExp;
export declare function extractDataBlocks(inner: string): Array<{
    kind: string;
    json: string;
}>;
