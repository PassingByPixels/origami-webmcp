import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DeckStore } from '../../src/core/deck-store.js';
import { ProposalStore } from '../../src/core/proposal-store.js';
import { createRegistry } from '../../src/core/tools.js';
import { createModeDoc, createModeRegistry } from '../../src/core/mode-registry.js';
import type { ToolMode } from '../../src/core/modes.js';
import type { ToolRegistry } from '../../src/core/registry.js';
import type { ToolResult } from '../../src/core/result.js';

const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));

/** The real vendored viewer IIFE — the same bytes the app fetches in the browser. */
export const runtimeJs = (): Promise<string> => readFile(repo('vendor/runtime-dist/origami-runtime.iife.js'), 'utf8');

export const sampleDeck = (): Promise<string> => readFile(repo('sample/welcome.origami.html'), 'utf8');

export interface Harness {
  deck: DeckStore;
  proposals: ProposalStore;
  registry: ToolRegistry;
  /** Invoke a tool exactly as the console and the WebMCP shim do. */
  call(name: string, args?: unknown): Promise<ToolResult>;
  /** The tool's text payload parsed as JSON (every tool here returns JSON or a raw string). */
  json(name: string, args?: unknown): Promise<any>;
  /** The tool's text payload, raw. */
  text(name: string, args?: unknown): Promise<string>;
}

export function harness(): Harness {
  const deck = new DeckStore();
  const proposals = new ProposalStore();
  const registry = createRegistry({ deck, proposals, runtimeJs });
  const call = (name: string, args: unknown = {}) => registry.invoke(name, args);
  return {
    deck,
    proposals,
    registry,
    call,
    text: async (name, args) => (await call(name, args)).content[0]!.text,
    json: async (name, args) => JSON.parse((await call(name, args)).content[0]!.text),
  };
}

/**
 * A mini tool page, driven exactly as its browser page drives it: the mode's own scoped
 * registry, and the mode's own seeded document already open — which is the state a human finds
 * the page in, so no test here has to invent one.
 */
export async function miniHarness(mode: ToolMode): Promise<Harness> {
  const deck = new DeckStore();
  const proposals = new ProposalStore();
  const registry = createModeRegistry({ deck, proposals, runtimeJs }, mode);
  await createModeDoc(deck, mode, runtimeJs);
  const call = (name: string, args: unknown = {}) => registry.invoke(name, args);
  return {
    deck,
    proposals,
    registry,
    call,
    text: async (name, args) => (await call(name, args)).content[0]!.text,
    json: async (name, args) => JSON.parse((await call(name, args)).content[0]!.text),
  };
}

/** A minimal valid slide inner the content policy accepts. */
export const innerWith = (heading: string, body: string): string =>
  `<div class="slide-inner"><h2 data-oedit="title">${heading}</h2><p class="lede" data-oedit="text">${body}</p></div>`;
