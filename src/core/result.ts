/* The MCP tool-result envelope. Ported verbatim from vendor/mcp-reference/server.ts so a
   web tool answer and a stdio tool answer are byte-comparable for the same input. */

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
});

export const fail = (message: string, extra?: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 2) }],
  isError: true,
});

/** A refusal raised from inside a mutating callback. Throwing (rather than returning) is what
    aborts the write: the model is never touched when the edit is rejected. */
export class Refusal extends Error {
  constructor(readonly result: ToolResult) {
    super('refused');
  }
}

export const refuse = (message: string, extra?: Record<string, unknown>): never => {
  throw new Refusal(fail(message, extra));
};

/** Tool bodies throw freely; the caller always gets a clean isError result. */
export const guard =
  (fn: (args: any) => Promise<ToolResult>) =>
  async (args: any): Promise<ToolResult> => {
    try {
      return await fn(args ?? {});
    } catch (e) {
      if (e instanceof Refusal) return e.result;
      return fail((e as Error).message);
    }
  };
