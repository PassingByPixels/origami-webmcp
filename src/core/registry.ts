import { guard, type ToolResult } from './result.js';

/** The subset of JSON Schema the ported tools use. WebMCP takes JSON Schema directly, so the
    zod schemas in the stdio server were hand-converted into these objects (see tools.ts). */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProp>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaProp {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: readonly string[];
  items?: JsonSchemaProp;
  /** Nested object shape — define_block's `def` is the only one deep enough to need it. */
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  minimum?: number;
  maxLength?: number;
  maxItems?: number;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (args: any) => Promise<ToolResult>;
}

/**
 * The ONE registry. Both the WebMCP shim and the in-page test console drive this same map,
 * so a tool exercised from the console runs byte-identically to the same tool called by an
 * agent — the console is the test surface, not a parallel implementation.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDef>();
  private readonly listeners = new Set<() => void>();

  register(def: ToolDef): void {
    this.tools.set(def.name, { ...def, execute: guard(def.execute) });
    for (const l of this.listeners) l();
  }

  list(): ToolDef[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  async invoke(name: string, args: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `unknown tool "${name}"`, availableTools: [...this.tools.keys()] }, null, 2) }],
        isError: true,
      };
    }
    return tool.execute(args);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export type McpSurface = 'document.modelContext' | 'navigator.modelContext' | 'none';

interface ModelContextLike {
  /** Per the W3C proposal registerTool returns a Promise that settles when registration
      completes, so a failure can arrive AFTER the call returns. */
  registerTool?: (def: unknown, options?: unknown) => unknown;
}

export interface McpConnection {
  surface: McpSurface;
  registered: number;
  failed: number;
}

/**
 * Feature-detect the WebMCP host and mirror every registered tool onto it.
 *
 * The W3C proposal (webmachinelearning/webmcp) puts the object on `document.modelContext`;
 * much of the ecosystem — and older Chrome preview builds — write `navigator.modelContext`.
 * We probe document first (the spec surface), then navigator. When NEITHER exists the local
 * registry is untouched and still fully usable: the in-page test console is the fallback
 * agent, so the app works in plain Chrome with no flags.
 */
export async function connectWebMcp(registry: ToolRegistry): Promise<McpConnection> {
  const candidates: Array<[McpSurface, ModelContextLike | undefined]> = [
    ['document.modelContext', (globalThis as any).document?.modelContext],
    ['navigator.modelContext', (globalThis as any).navigator?.modelContext],
  ];
  for (const [surface, ctx] of candidates) {
    if (!ctx || typeof ctx.registerTool !== 'function') continue;
    let registered = 0;
    let failed = 0;
    for (const t of registry.list()) {
      // awaited one at a time: registerTool can reject asynchronously, and a status line that
      // claims 14 registered tools when 3 were refused is worse than no status line at all.
      try {
        await ctx.registerTool({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          execute: (args: unknown) => registry.invoke(t.name, args),
        });
        registered++;
      } catch {
        failed++; // one bad tool must not sink the rest — the console still exposes it
      }
    }
    return { surface, registered, failed };
  }
  return { surface: 'none', registered: 0, failed: 0 };
}
