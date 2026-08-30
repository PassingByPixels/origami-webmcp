import type { DiagramEdge, FlowData, GraphData } from '@origami/format';
/** Built-in node glyphs — the FULL Lucide set (ISC), shared with the icon palette.
    Each value is SVG INNER MARKUP: a fixed source-code constant, never user data, so the
    renderer may inject it with innerHTML (the same "trusted bundled constants" rule as the
    icon drawer in canvas.ts). Elements sit in a 24×24 box and inherit stroke/fill/stroke-width
    from their group. The first ten keys are the legacy set, kept with their exact paths so
    existing decks render byte-identical; the rest mirror studio-core's `lib/palette.ts` ICONS. */
export declare const DIAGRAM_ICONS: Record<string, string>;
export declare function normalizeFlowData(raw: unknown): FlowData;
export declare function normalizeGraphData(raw: unknown): GraphData;
export declare function parseFlowSlideData(slide: Element): FlowData | null;
export declare function parseGraphSlideData(slide: Element): GraphData | null;
export interface DiagramRenderOpts {
    /** Studio canvas only: ✎ opens the structured editor; nodes select (halo),
        Delete removes, dblclick renames inline, the + port click-spawns a typed
        connected node or drags an arrow onto another node; graph nodes drag. */
    edit?: {
        onCommit: (data: unknown) => void;
        onOpenEditor: () => void;
        /** A node was selected (id + its on-screen rect) or deselected (null) — the canvas opens
            an inline decoration popup right on the node (icon / line colour / fill colour). */
        onSelectNode?: (id: string | null, rect: DOMRect | null) => void;
        /** An edge was clicked (the edge + its on-screen rect) — the canvas opens an inline popup
            right on the line (label / arrow / style / colour / dash / delete). When absent, the
            runtime falls back to the bare label input. */
        onSelectEdge?: (edge: DiagramEdge, rect: DOMRect) => void;
    };
}
export declare const setDiagramSnap: (on: boolean) => void;
export declare function renderDiagramError(slide: HTMLElement, kind: 'flow' | 'graph'): void;
export declare function renderFlow(slide: HTMLElement, data: FlowData, opts?: DiagramRenderOpts): void;
export type GraphLayoutMode = 'force' | 'radial' | 'tree';
/** Reorganize graph nodes with a layout algorithm — returns PERCENT positions. */
export declare function graphLayout(data: GraphData, mode: GraphLayoutMode): Map<string, {
    x: number;
    y: number;
}>;
export declare function renderGraph(slide: HTMLElement, data: GraphData, opts?: DiagramRenderOpts): void;
/** Sweep a slide for flowchart/nodegraph blocks and render each into its own container. Diagrams are
    in-slide blocks now — swept on every fold, the mirror of mountTables. Static SVGs are already
    final, so finalize is the same sweep. Idempotent. */
export declare function mountFlows(slide: Element): void;
export declare function mountGraphs(slide: Element): void;
export declare const finalizeFlows: typeof mountFlows;
export declare const finalizeGraphs: typeof mountGraphs;
