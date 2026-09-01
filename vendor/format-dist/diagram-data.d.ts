import type { Violation } from './types.js';
/**
 * Diagram kinds (UX round H) — flowchart + node graph, carried per slide as an
 * inert JSON block (data-odata="flow" / data-odata="graph"), same carrier rules
 * as the gantt/tracker: the serializer escapes every "<" and
 * validateSlideContent enforces the literal script form.
 *
 * flow  — directed steps; the runtime auto-layouts layers left→right.
 * graph — free-form web; nodes carry manual x/y (percent of the canvas).
 */
export declare const DIAGRAM_TONES: readonly ["", "accent", "green", "amber", "red"];
export declare const FLOW_SHAPES: readonly ["box", "pill", "diamond"];
export declare const GRAPH_SHAPES: readonly ["box", "pill", "diamond", "circle", "hexagon"];
export declare const EDGE_ARROWS: readonly ["none", "end", "both"];
export declare const EDGE_STYLES: readonly ["straight", "curved"];
export interface DiagramEdge {
    from: string;
    to: string;
    label: string;
    /** Optional per-edge LINE colour, "" or #hex (overrides the kind default). */
    color?: string;
    /** Optional stroke width in px (1-8). */
    width?: number;
    /** Optional SVG dash pattern, e.g. "5,3" — numbers and separators only. */
    dash?: string;
    /** Optional arrowhead. Absent = kind default: flow `end`, graph `none`. */
    arrow?: (typeof EDGE_ARROWS)[number];
    /** Optional routing. Absent = kind default: flow `curved`, graph `straight`. */
    style?: (typeof EDGE_STYLES)[number];
}
export interface FlowNode {
    id: string;
    label: string;
    shape: (typeof FLOW_SHAPES)[number];
    tone: (typeof DIAGRAM_TONES)[number];
    /** Optional decoration: an icon key (into the runtime's built-in glyph set). */
    icon?: string;
    /** Optional LINE colour: "" or a #hex (the node outline + icon; overrides `tone`). */
    color?: string;
    /** Optional FILL colour: "" or a #hex (the node background; default is the paper colour). */
    fill?: string;
    /** Optional node size in px — default 176×60. Clamped 60-400 × 30-200. */
    width?: number;
    height?: number;
    /** Optional manual position, percent of the canvas — omitted nodes auto-layout. */
    x?: number;
    y?: number;
    /** Optional swim-lane id — the node renders inside that lane's band. */
    lane?: string;
}
/** A swim lane: a horizontal band the flow auto-layout stacks vertically. */
export interface FlowLane {
    id: string;
    label: string;
    /** Vertical stack order — lower first. */
    order: number;
    /** Optional header/tint colour, "" or #hex. */
    color?: string;
    /** Optional responsible role/person. */
    actor?: string;
}
export interface FlowData {
    nodes: FlowNode[];
    edges: DiagramEdge[];
    /** Optional swim lanes — absent = the long-standing single-band auto-layout. */
    lanes?: FlowLane[];
}
export interface GraphNode {
    id: string;
    label: string;
    /** Percent of the diagram canvas, 0–100. */
    x: number;
    y: number;
    tone: (typeof DIAGRAM_TONES)[number];
    /** Optional shape — default `pill` (the long-standing graph look) for backward compatibility. */
    shape?: (typeof GRAPH_SHAPES)[number];
    /** Optional decoration: an icon key + a "" / #hex LINE colour (overrides `tone`) +
        a "" / #hex FILL colour (the node background). */
    icon?: string;
    color?: string;
    fill?: string;
    /** Optional node size in px — default 150×50. Clamped 60-400 × 30-200. */
    width?: number;
    height?: number;
    /** Optional swim-lane id — the node snaps into that lane's horizontal band. */
    lane?: string;
}
export interface GraphData {
    nodes: GraphNode[];
    edges: DiagramEdge[];
    /** Optional swim lanes — absent = the long-standing free-form canvas. */
    lanes?: FlowLane[];
}
/** Strict shape check for a flow data block. REJECT, never repair. */
export declare function validateFlowData(data: unknown): Violation[];
/** Strict shape check for a graph data block. REJECT, never repair. */
export declare function validateGraphData(data: unknown): Violation[];
/** Serialize for embedding — "<" escaped (same invariant as ganttDataJson). */
export declare function flowDataJson(data: FlowData): string;
export declare function graphDataJson(data: GraphData): string;
