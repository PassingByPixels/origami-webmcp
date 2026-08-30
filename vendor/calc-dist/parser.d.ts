import type { Node } from './ast.js';
/** Parse a formula body (NO leading "="). Throws ParseError on malformed input. */
export declare function parse(body: string): Node;
