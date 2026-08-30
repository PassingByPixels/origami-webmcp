import type { Node } from './ast.js';
import type { CalcValue } from './types.js';
import { type CalcArg } from './coerce.js';
import type { EvalCtx } from './ctx.js';
/** Collapse a range result to a scalar (1×1 -> that cell; else #VALUE!). */
export declare function toScalar(v: CalcArg): CalcValue;
/** Evaluate a node. Returns a CalcArg (a range node yields a 2D range). */
export declare function evalNode(node: Node, ctx: EvalCtx): CalcArg;
