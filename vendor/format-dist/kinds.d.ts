export interface KindSpec {
    key: string;
    name: string;
    schemaComment: string[];
}
export declare const KINDS: Record<string, KindSpec>;
export declare function kindSchemaComment(kind: string): string[];
