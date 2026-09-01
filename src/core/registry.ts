import { ActivityLog, type ActivitySource } from './activity.js';
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

/**
 * MCP tool annotations — the machine-readable half of "what does calling this do to me?".
 * A host can use readOnlyHint to let a tool run without asking, and destructiveHint to insist
 * on a confirmation. They are HINTS: untrusted by a careful host, and ignored entirely by one
 * that does not read them, so nothing here may be the only place a caveat is stated. Every
 * annotated tool says the same thing in its description too.
 */
export interface ToolAnnotations {
  /** Calls do not change the open Fold. */
  readOnlyHint?: boolean;
  /** Calls MAY destroy content — deleting a chunk, a block def, or replacing the open Fold. */
  destructiveHint?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
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

  /**
   * Every call through `invoke` lands here — the ONE hook, at the ONE call path, so a tool
   * driven from the console records exactly as the same tool driven by a WebMCP agent does.
   * The page pushes its own events (open, save, a card accepted by hand) into the same log.
   */
  readonly activity: ActivityLog;

  constructor(activity: ActivityLog = new ActivityLog()) {
    this.activity = activity;
  }

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

  /**
   * Run one tool and record the call. `source` says who is driving: an MCP host passes
   * nothing (a tool invocation with no stated source IS an agent call), while the page
   * passes 'console' or 'replay' for calls a human started. A call to a tool that does not
   * exist is recorded too — an agent guessing at names is exactly what the feed is for.
   */
  async invoke(name: string, args: unknown, source: ActivitySource = 'agent'): Promise<ToolResult> {
    const started = Date.now();
    const tool = this.tools.get(name);
    const result = tool
      ? await tool.execute(args)
      : {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `unknown tool "${name}"`, availableTools: [...this.tools.keys()] }, null, 2) }],
          isError: true,
        };
    // recorded AFTER the answer is built, so list_activity never appears in its own result
    this.activity.record({ tool: name, args, result, source, ms: Date.now() - started });
    return result;
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
          // MEASURED on Chrome 151.0.7922.174 (tests/e2e/webmcp-native.spec.ts): Chrome keeps
          // readOnlyHint, DISCARDS destructiveHint entirely, and normalises what is left into its
          // own vocabulary {readOnlyHint, untrustedContentHint}. So the destructive warning must
          // live in the tool's DESCRIPTION to reach a Chrome-hosted agent at all — a unit test
          // enforces that. They are still sent as written, for hosts with a fuller vocabulary.
          ...(t.annotations ? { annotations: t.annotations } : {}),
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
