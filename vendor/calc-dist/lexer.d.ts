export type Tok = {
    k: 'num';
    v: number;
} | {
    k: 'str';
    v: string;
} | {
    k: 'name';
    v: string;
} | {
    k: 'err';
    v: string;
} | {
    k: 'named';
    block: string;
    name: string;
} | {
    k: 'qref';
    sheet: string;
    a: string;
    b?: string;
    raw: string;
} | {
    k: 'op';
    v: string;
} | {
    k: 'lp';
} | {
    k: 'rp';
} | {
    k: 'comma';
} | {
    k: 'colon';
} | {
    k: 'eof';
};
/** Tokenise a formula body (the leading "=" already stripped). Throws ParseError on
    an unknown character — recalc maps that to an error cell, never repairs. */
export declare function lex(src: string): Tok[];
