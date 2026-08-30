import type { JsonSchema, ToolDef, ToolRegistry } from '../core/registry.js';

/**
 * The test console — the human's agent stand-in.
 *
 * It drives ToolRegistry.invoke, the exact call path the WebMCP shim hands to a real agent,
 * so everything in this app is exercisable in plain Chrome with no flags and nothing
 * connected. It is a first-class surface, not a debug hatch.
 */
export class TestConsole {
  private selected: ToolDef | null = null;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly els: {
      toggle: HTMLButtonElement;
      body: HTMLElement;
      list: HTMLElement;
      count: HTMLElement;
      name: HTMLElement;
      desc: HTMLElement;
      schema: HTMLElement;
      args: HTMLTextAreaElement;
      invoke: HTMLButtonElement;
      state: HTMLElement;
      result: HTMLElement;
    }
  ) {
    els.toggle.addEventListener('click', () => this.setOpen(els.toggle.getAttribute('aria-expanded') !== 'true'));
    els.list.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-tool]');
      if (btn) this.select(btn.dataset.tool!);
    });
    els.invoke.addEventListener('click', () => void this.run());
    els.args.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') void this.run();
    });
    registry.subscribe(() => this.renderList());
    this.renderList();
  }

  setOpen(open: boolean): void {
    this.els.toggle.setAttribute('aria-expanded', String(open));
    this.els.body.hidden = !open;
  }

  select(name: string): void {
    const tool = this.registry.get(name);
    if (!tool) return;
    this.selected = tool;
    this.els.name.textContent = tool.name;
    this.els.desc.textContent = tool.description;
    this.els.schema.textContent = JSON.stringify(tool.inputSchema, null, 2);
    this.els.args.value = skeleton(tool.inputSchema);
    this.els.invoke.disabled = false;
    this.els.state.textContent = '';
    this.els.state.className = 'run-state';
    this.els.result.textContent = '—';
    this.els.result.className = 'result';
    for (const b of this.els.list.querySelectorAll<HTMLButtonElement>('button[data-tool]')) {
      b.setAttribute('aria-current', String(b.dataset.tool === name));
    }
  }

  private renderList(): void {
    const tools = this.registry.list();
    this.els.count.textContent = String(tools.length);
    this.els.list.replaceChildren(
      ...tools.map((t) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.tool = t.name;
        b.textContent = t.name;
        b.setAttribute('data-testid', `tool-${t.name}`);
        b.setAttribute('aria-current', String(this.selected?.name === t.name));
        li.append(b);
        return li;
      })
    );
  }

  private async run(): Promise<void> {
    if (!this.selected) return;
    let args: unknown;
    try {
      args = this.els.args.value.trim() === '' ? {} : JSON.parse(this.els.args.value);
    } catch (e) {
      this.els.state.textContent = 'Arguments are not valid JSON';
      this.els.state.className = 'run-state bad';
      this.els.result.textContent = (e as Error).message;
      this.els.result.className = 'result error';
      return;
    }
    this.els.invoke.disabled = true;
    this.els.state.textContent = 'running…';
    this.els.state.className = 'run-state';
    const started = performance.now();
    const res = await this.registry.invoke(this.selected.name, args);
    const ms = Math.round(performance.now() - started);
    this.els.invoke.disabled = false;
    this.els.state.textContent = res.isError ? `error · ${ms} ms` : `ok · ${ms} ms`;
    this.els.state.className = res.isError ? 'run-state bad' : 'run-state';
    this.els.result.textContent = res.content.map((c) => c.text).join('\n');
    this.els.result.className = res.isError ? 'result error' : 'result';
  }
}

/** A ready-to-edit args object: required fields present and empty, optionals left out. */
function skeleton(schema: JsonSchema): string {
  const required = schema.required ?? [];
  if (required.length === 0) return '{}';
  const out: Record<string, unknown> = {};
  for (const key of required) {
    const prop = schema.properties[key];
    out[key] = prop?.enum ? prop.enum[0] : prop?.type === 'integer' || prop?.type === 'number' ? 0 : prop?.type === 'boolean' ? false : prop?.type === 'array' ? [] : '';
  }
  return JSON.stringify(out, null, 2);
}
