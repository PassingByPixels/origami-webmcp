import type { CalcFn } from '../ctx.js';
/** The single enumerable function registry — the parser validates call names against
    it (unknown -> #NAME?), and specs/MCP schema enumerate it. */
export declare const FUNCTIONS: Record<string, CalcFn>;
