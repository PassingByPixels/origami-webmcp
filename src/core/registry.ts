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
  registerTool?: (def: unknown, options?: unknown) => unknown;
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
export function connectWebMcp(registry: ToolRegistry): { surface: McpSurface; registered: number } {
  const candidates: Array<[McpSurface, ModelContextLike | undefined]> = [
    ['document.modelContext', (globalThis as any).document?.modelContext],
    ['navigator.modelContext', (globalThis as any).navigator?.modelContext],
  ];
  for (const [surface, ctx] of candidates) {
    if (!ctx || typeof ctx.registerTool !== 'function') continue;
    let registered = 0;
    for (const t of registry.list()) {
      try {
        ctx.registerTool({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          execute: (args: unknown) => registry.invoke(t.name, args),
        });
        registered++;
      } catch {
        /* one bad tool must not sink the rest — the console still exposes it */
      }
    }
    return { surface, registered };
  }
  return { surface: 'none', registered: 0 };
}
