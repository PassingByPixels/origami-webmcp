import type { JsonSchema, JsonSchemaProp, ToolDef, ToolRegistry } from '../core/registry.js';

/**
 * The tool console — the human's agent stand-in.
 *
 * It drives ToolRegistry.invoke, the exact call path the WebMCP shim hands to a real agent,
 * so everything in this app is exercisable in plain Chrome with no flags and nothing
 * connected. It is a first-class surface, not a debug hatch.
 *
 * Two things make the tool list usable by hand: the list is GROUPED by what a call is for, and the
 * arguments have a FORM generated from each tool's own inputSchema. The form is a writer, not
 * a second call path — every control writes into the JSON textarea, and the textarea is what
 * `Invoke` sends. So what the box shows is always what the agent surface would receive.
 */

/* The four groups from the design spec, in reading order, each listing its tools in the order
   a human meets them. A registered tool named in NO group still appears (under "Other"): a
   console that silently hid a tool would be worse than an ugly one. */
export type ToolGroups = ReadonlyArray<readonly [string, readonly string[]]>;

export const FOLIO_GROUPS: ToolGroups = [
  ['Learn', ['origami_guide', 'get_kind_schema', 'list_starters', 'list_block_defs', 'list_chunks', 'read_chunk', 'get_block', 'list_themes', 'inspect_render', 'list_proposals', 'list_activity']],
  ['Author', ['create_deck', 'add_fold', 'add_ledger', 'add_chunk', 'add_custom_fold', 'write_chunk', 'set_block', 'move_chunk', 'set_chunk_meta', 'delete_chunk', 'define_block', 'delete_block', 'set_header', 'set_deck_meta', 'apply_theme', 'save_theme', 'delete_theme', 'set_fold_type', 'undo']],
  ['Review', ['propose_chunk', 'propose_add', 'propose_delete', 'accept_proposal', 'reject_proposal']],
  ['File', ['run_batch', 'save_deck', 'export_deck']],
];

type Mode = 'form' | 'json';

/** One generated control. `read` returns undefined when the field is not part of the call. */
interface Field {
  key: string;
  /** Reads the control. Throws when the value cannot be serialized (bad nested JSON). */
  read(): unknown;
  /** Seeds the control from parsed JSON. false = this value cannot be shown in the form. */
  write(value: unknown): boolean;
}

class FieldError extends Error {}

export class TestConsole {
  private selected: ToolDef | null = null;
  private mode: Mode = 'form';
  private fields: Field[] = [];
  private running = false;

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
      form: HTMLElement;
      modeForm: HTMLButtonElement;
      modeJson: HTMLButtonElement;
      args: HTMLTextAreaElement;
      invoke: HTMLButtonElement;
      state: HTMLElement;
      result: HTMLElement;
    },
    /* A mini tool page registers a different set, so it supplies its own headings — its block's
       tools first, then the same Learn/Author/File vocabulary, so the grouping never forks. A
       tool in no group still appears, under "Other". */
    private readonly groups: ToolGroups = FOLIO_GROUPS
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
    // One delegated listener: the controls are rebuilt on every tool change, and a listener per
    // control would have to be torn down with them.
    els.form.addEventListener('input', () => this.syncFromForm());
    els.form.addEventListener('change', () => this.syncFromForm());
    els.modeForm.addEventListener('click', () => this.setMode('form'));
    els.modeJson.addEventListener('click', () => this.setMode('json'));
    registry.subscribe(() => this.renderList());
    this.renderList();
    this.paintMode();
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
    this.buildForm(tool.inputSchema);
    this.setArgs(JSON.parse(skeleton(tool.inputSchema)) as Record<string, unknown>);
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
    const byName = new Map(tools.map((t) => [t.name, t]));
    const items: HTMLElement[] = [];
    const grouped = new Set(this.groups.flatMap(([, names]) => names));

    for (const [heading, names] of this.groups) {
      const present = names.filter((n) => byName.has(n));
      if (present.length === 0) continue;
      items.push(this.groupHead(heading));
      for (const n of present) items.push(this.toolItem(byName.get(n)!));
    }
    const ungrouped = tools.filter((t) => !grouped.has(t.name));
    if (ungrouped.length > 0) {
      items.push(this.groupHead('Other'));
      for (const t of ungrouped) items.push(this.toolItem(t));
    }
    this.els.list.replaceChildren(...items);
  }

  private groupHead(text: string): HTMLElement {
    const li = document.createElement('li');
    li.className = 'tool-group';
    li.setAttribute('data-testid', `tool-group-${text.toLowerCase()}`);
    li.textContent = text;
    return li;
  }

  private toolItem(t: ToolDef): HTMLElement {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tool = t.name;
    b.textContent = t.name;
    b.setAttribute('data-testid', `tool-${t.name}`);
    b.setAttribute('aria-current', String(this.selected?.name === t.name));
    li.append(b);
    return li;
  }

  /* ---------- arguments: the form, and the JSON it writes ---------- */

  private setMode(mode: Mode): void {
    if (mode === this.mode) return;
    if (mode === 'form') {
      let parsed: unknown;
      try {
        parsed = this.els.args.value.trim() === '' ? {} : JSON.parse(this.els.args.value);
      } catch (e) {
        this.setState(`Arguments are not valid JSON — fix them here first: ${(e as Error).message}`, true);
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.setState('Arguments must be a JSON object for the form to show them.', true);
        return;
      }
      const refused = this.fillForm(parsed as Record<string, unknown>);
      if (refused) {
        // Refusing beats dropping: silently losing a key the human typed is how a "helpful"
        // form sends a different call from the one on screen.
        this.setState(`The form cannot show ${refused} — stay in JSON to send it.`, true);
        return;
      }
      this.setState('', false);
    } else {
      this.syncFromForm(); // the box is already current; make the hand-off explicit anyway
    }
    this.mode = mode;
    this.paintMode();
  }

  private paintMode(): void {
    const form = this.mode === 'form';
    this.els.modeForm.setAttribute('aria-pressed', String(form));
    this.els.modeJson.setAttribute('aria-pressed', String(!form));
    this.els.form.hidden = !form;
    this.els.args.hidden = form;
  }

  /** Fill both surfaces from one object. */
  private setArgs(value: Record<string, unknown>): void {
    this.fillForm(value);
    this.els.args.value = JSON.stringify(value, null, 2);
  }

  /** Seed the controls. Returns the key it could not show, or '' when every value landed. */
  private fillForm(value: Record<string, unknown>): string {
    const known = new Set(this.fields.map((f) => f.key));
    const stranger = Object.keys(value).find((k) => !known.has(k));
    if (stranger) return `"${stranger}"`;
    for (const f of this.fields) {
      if (!f.write(value[f.key])) return `"${f.key}"`;
    }
    return '';
  }

  /** Every edit in the form writes the whole call back into the textarea. */
  private syncFromForm(): void {
    const out: Record<string, unknown> = {};
    try {
      for (const f of this.fields) {
        const v = f.read();
        if (v !== undefined) out[f.key] = v;
      }
    } catch (e) {
      // A nested JSON box mid-edit. The textarea keeps its last good value, and Invoke is
      // blocked rather than quietly sending it.
      this.setState((e as Error).message, true);
      this.els.invoke.disabled = true;
      return;
    }
    this.els.args.value = JSON.stringify(out, null, 2);
    if (this.els.state.classList.contains('bad')) this.setState('', false);
    if (!this.running) this.els.invoke.disabled = this.selected === null;
  }

  private setState(text: string, bad: boolean): void {
    this.els.state.textContent = text;
    this.els.state.className = bad ? 'run-state bad' : 'run-state';
  }

  private buildForm(schema: JsonSchema): void {
    const required = new Set(schema.required ?? []);
    const rows: HTMLElement[] = [];
    this.fields = [];
    for (const [key, prop] of Object.entries(schema.properties)) {
      const { row, field } = buildField(key, prop, required.has(key));
      rows.push(row);
      this.fields.push(field);
    }
    if (rows.length === 0) {
      const none = document.createElement('p');
      none.className = 'form-none';
      none.textContent = 'This tool takes no arguments.';
      rows.push(none);
    }
    this.els.form.replaceChildren(...rows);
  }

  private async run(): Promise<void> {
    if (!this.selected) return;
    let args: unknown;
    try {
      args = this.els.args.value.trim() === '' ? {} : JSON.parse(this.els.args.value);
    } catch (e) {
      this.setState('Arguments are not valid JSON', true);
      this.els.result.textContent = (e as Error).message;
      this.els.result.className = 'result error';
      return;
    }
    this.running = true;
    this.els.invoke.disabled = true;
    this.setState('running…', false);
    const started = performance.now();
    // 'console' — a human drove this, and the Activity feed must not label it an agent call.
    const res = await this.registry.invoke(this.selected.name, args, 'console');
    const ms = Math.round(performance.now() - started);
    this.running = false;
    this.els.invoke.disabled = false;
    this.setState(res.isError ? `error · ${ms} ms` : `ok · ${ms} ms`, res.isError === true);
    this.els.result.textContent = res.content.map((c) => c.text).join('\n');
    this.els.result.className = res.isError ? 'result error' : 'result';
  }
}

/* ---------- one control per property ----------
   The mapping is the design spec's: string → input (textarea for `html` or maxLength > 200),
   integer/number → number, boolean → checkbox, enum → select, object/array → JSON textarea.

   PRESENCE is the part a form usually gets wrong. An optional field that was never touched must
   NOT appear in the call — but `set_chunk_meta({hidden:false})` is a real, meaningful call, so
   "empty means absent" cannot be the whole rule either. Every control therefore remembers
   whether it holds a value at all: seeded from JSON, or edited by the human. */

function buildField(key: string, prop: JsonSchemaProp, required: boolean): { row: HTMLElement; field: Field } {
  const row = document.createElement('div');
  row.className = 'field';
  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = `field-${key}`;
  label.textContent = required ? `${key} *` : key;
  row.append(label);

  const control = makeControl(key, prop, required);
  row.append(control.el);
  if (prop.description) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent = prop.description;
    row.append(hint);
  }
  return { row, field: { key, read: control.read, write: control.write } };
}

interface Control {
  el: HTMLElement;
  read(): unknown;
  write(value: unknown): boolean;
}

function makeControl(key: string, prop: JsonSchemaProp, required: boolean): Control {
  const id = `field-${key}`;
  const testid = `field-${key}`;

  if (prop.enum) {
    const sel = document.createElement('select');
    sel.id = id;
    sel.setAttribute('data-testid', testid);
    // An optional enum needs a way to say "not set" — a select with no blank option would put a
    // value into every call whether the human chose one or not.
    if (!required) sel.append(option('', '—'));
    for (const v of prop.enum) sel.append(option(v, v));
    return {
      el: sel,
      read: () => (sel.value === '' ? undefined : sel.value),
      write: (value) => {
        if (value === undefined) {
          sel.value = required ? (prop.enum![0] ?? '') : '';
          return true;
        }
        if (typeof value !== 'string' || !prop.enum!.includes(value)) return false;
        sel.value = value;
        return true;
      },
    };
  }

  if (prop.type === 'boolean') {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = id;
    box.className = 'field-check';
    box.setAttribute('data-testid', testid);
    box.addEventListener('change', () => {
      box.dataset.present = '1';
    });
    return {
      el: box,
      read: () => (required || box.dataset.present === '1' ? box.checked : undefined),
      write: (value) => {
        if (value === undefined) {
          box.checked = false;
          delete box.dataset.present;
          return true;
        }
        if (typeof value !== 'boolean') return false;
        box.checked = value;
        box.dataset.present = '1';
        return true;
      },
    };
  }

  if (prop.type === 'integer' || prop.type === 'number') {
    const num = document.createElement('input');
    num.type = 'number';
    num.id = id;
    num.setAttribute('data-testid', testid);
    if (prop.type === 'integer') num.step = '1';
    if (prop.minimum !== undefined) num.min = String(prop.minimum);
    return {
      el: num,
      // An empty number box is not a number. Required is the one case where the call still needs
      // the key, and the skeleton's 0 is what it gets.
      read: () => (num.value.trim() === '' ? (required ? 0 : undefined) : Number(num.value)),
      write: (value) => {
        if (value === undefined) {
          num.value = '';
          return true;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) return false;
        num.value = String(value);
        return true;
      },
    };
  }

  if (prop.type === 'object' || prop.type === 'array') {
    const area = document.createElement('textarea');
    area.id = id;
    area.rows = 3;
    area.spellcheck = false;
    area.className = 'field-json';
    area.setAttribute('data-testid', testid);
    const empty = prop.type === 'array' ? [] : {};
    return {
      el: area,
      read: () => {
        if (area.value.trim() === '') return required ? empty : undefined;
        try {
          return JSON.parse(area.value);
        } catch {
          throw new FieldError(`"${key}" is not valid JSON`);
        }
      },
      write: (value) => {
        if (value === undefined) {
          area.value = '';
          return true;
        }
        if (typeof value !== 'object' || value === null) return false;
        if (Array.isArray(value) !== (prop.type === 'array')) return false;
        area.value = JSON.stringify(value, null, 2);
        return true;
      },
    };
  }

  // string, and anything a schema left untyped — a text box holds either honestly
  const long = key === 'html' || (prop.maxLength !== undefined && prop.maxLength > 200);
  const input = document.createElement(long ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement;
  input.id = id;
  input.setAttribute('data-testid', testid);
  if (input instanceof HTMLTextAreaElement) {
    input.rows = 4;
    input.spellcheck = false;
  } else {
    input.type = 'text';
  }
  input.addEventListener('input', () => {
    input.dataset.present = '1';
  });
  return {
    el: input,
    read: () => (required || input.dataset.present === '1' ? input.value : undefined),
    write: (value) => {
      if (value === undefined) {
        input.value = '';
        delete input.dataset.present;
        return true;
      }
      if (typeof value !== 'string') return false;
      input.value = value;
      input.dataset.present = '1';
      return true;
    },
  };
}

function option(value: string, text: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

/** A ready-to-edit args object: required fields present and empty, optionals left out. */
function skeleton(schema: JsonSchema): string {
  const required = schema.required ?? [];
  if (required.length === 0) return '{}';
  const out: Record<string, unknown> = {};
  for (const key of required) {
    const prop = schema.properties[key];
    out[key] = prop?.enum
      ? prop.enum[0]
      : prop?.type === 'integer' || prop?.type === 'number'
        ? 0
        : prop?.type === 'boolean'
          ? false
          : prop?.type === 'array'
            ? []
            : prop?.type === 'object'
              ? {}
              : '';
  }
  return JSON.stringify(out, null, 2);
}
