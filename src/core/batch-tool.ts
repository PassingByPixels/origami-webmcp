/* run_batch — several tool calls in ONE turn.
   ------------------------------------------------------------------------------------------
   Every WebMCP executeTool is a model turn, and the lead's latency probe found every tool on
   this page under 6 ms except inspect_render (2.4 s) and save_deck (53 ms). So the cost of a
   deck is not compute: it is turns and payload bytes. A six-fold deck was six turns even after
   add_fold made each fold one call; this makes it one.

   It is a DRIVER, not a second dispatcher. Every inner call goes through ToolRegistry.invoke —
   the same method the WebMCP shim, the console and the review cards use — so the Activity feed
   records each step, the undo stack gets one entry per inner call (not one for the batch), and
   the page's presence indicator lights exactly as it would for six separate calls. There is no
   path here that a single call does not already take. */

import type { ToolDef } from './registry.js';
import type { ToolRegistry } from './registry.js';
import { fail, ok, type ToolResult } from './result.js';

/** A batch is a turn-saver, not a script runtime. Twenty-five calls is already a whole deck,
    and a longer list is far more likely to be a loop than a plan. */
export const BATCH_MAX = 25;

/** Tool results are JSON text; hand the agent the OBJECT so one batch reads as one payload
    rather than as N strings it has to parse itself. Non-JSON (a plain-text answer) is passed
    through as text rather than mangled. */
function body(res: ToolResult): unknown {
  const text = res.content[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function buildBatchTool(registry: ToolRegistry): ToolDef {
  return {
    name: 'run_batch',
      description: "Run several tool calls in ONE turn — this CHANGES THE DECK exactly as the same calls made one at a time would. `calls` is [{tool, args}] run IN ORDER, stopping at the FIRST failure; you get every result up to and including it, so a batch that half-lands says where it stopped and what landed. Each call takes the normal route, so the feed records every step and undo reverses them ONE AT A TIME. create_deck then five add_fold calls then apply_theme is one turn instead of seven. Nesting is refused, the cap is 25, and a read-only answer only arrives when the batch returns — put inspect_render last.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        calls: {
          type: 'array',
          maxItems: BATCH_MAX,
          description: `The calls, in order: [{ "tool": "add_fold", "args": { … } }, …]. Max ${BATCH_MAX}. Stops at the first failure.`,
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: 'A tool name from this page' },
              args: { type: 'object', description: "That tool's arguments (omit for a tool that takes none)" },
            },
            required: ['tool'],
          },
        },
      },
      required: ['calls'],
    },
    execute: async ({ calls }) => {
      if (!Array.isArray(calls) || calls.length === 0) return fail('calls must be a non-empty array of { tool, args }');
      if (calls.length > BATCH_MAX) {
        return fail(`a batch takes at most ${BATCH_MAX} calls — got ${calls.length}. Split it, or build fewer folds per turn.`, { max: BATCH_MAX });
      }
      /* The whole list is checked BEFORE anything runs. A batch that got four folds in and then
         refused the fifth for a typo would leave the deck half-built for a fault that was
         visible from the start. */
      for (let i = 0; i < calls.length; i++) {
        const c = calls[i] as { tool?: unknown } | null;
        if (c === null || typeof c !== 'object' || typeof c.tool !== 'string') {
          return fail(`calls[${i}] must be an object with a "tool" name`);
        }
        if (c.tool === 'run_batch') {
          return fail(`calls[${i}] is run_batch — a batch cannot contain another batch. Put its calls in this list instead.`);
        }
        if (!registry.get(c.tool)) {
          return fail(`calls[${i}] names unknown tool "${c.tool}" — nothing was run`, { availableTools: registry.list().map((t) => t.name) });
        }
      }

      const results: Array<{ tool: string; ok: boolean; result: unknown }> = [];
      let completed = 0;
      let stoppedAt: number | null = null;
      for (let i = 0; i < calls.length; i++) {
        const { tool, args } = calls[i] as { tool: string; args?: unknown };
        const res = await registry.invoke(tool, args ?? {});
        results.push({ tool, ok: !res.isError, result: body(res) });
        if (res.isError) {
          stoppedAt = i;
          break;
        }
        completed++;
      }

      return ok({
        requested: calls.length,
        completed,
        ...(stoppedAt === null
          ? {}
          : {
              stoppedAt,
              stoppedOn: results[stoppedAt]!.tool,
              note: `STOPPED at calls[${stoppedAt}] (${results[stoppedAt]!.tool}), which failed. The ${completed} call(s) before it DID land and are on the deck — fix the failing call and run the rest.`,
            }),
        results,
        ...(stoppedAt === null ? { note: 'every call landed on the open Fold and it re-rendered — not yet on disk (the human saves). undo reverses these ONE AT A TIME.' } : {}),
      });
    },
  };
}
