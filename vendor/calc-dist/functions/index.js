import { MATH } from './math.js';
import { LOGICAL } from './logical.js';
import { LOOKUP } from './lookup.js';
import { TEXT } from './text.js';
import { DATE_FNS } from './date.js';
/** The single enumerable function registry — the parser validates call names against
    it (unknown -> #NAME?), and specs/MCP schema enumerate it. */
export const FUNCTIONS = {
    ...MATH,
    ...LOGICAL,
    ...LOOKUP,
    ...TEXT,
    ...DATE_FNS,
};
