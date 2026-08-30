export type BinOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>=';
export type Node = {
    t: 'num';
    v: number;
} | {
    t: 'str';
    v: string;
} | {
    t: 'bool';
    v: boolean;
} | {
    t: 'err';
    code: string;
} | {
    t: 'ref';
    a1: string;
} | {
    t: 'range';
    a: string;
    b: string;
} | {
    t: 'named';
    block: string;
    name: string;
} | {
    t: 'qref';
    sheet: string;
    a: string;
    b?: string;
} | {
    t: 'unary';
    op: '-' | '+' | '%';
    x: Node;
} | {
    t: 'binary';
    op: BinOp;
    l: Node;
    r: Node;
} | {
    t: 'call';
    name: string;
    args: Node[];
};
