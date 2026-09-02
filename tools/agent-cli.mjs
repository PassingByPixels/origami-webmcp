/* Thin client for tools/agent-bridge.mjs — an agent that can only run shell commands drives
   the WebMCP tool surface through this instead of touching HTTP directly.

   Usage:
     node tools/agent-cli.mjs tools
     node tools/agent-cli.mjs schema <name>
     node tools/agent-cli.mjs call <name> '<json args>'
     node tools/agent-cli.mjs call <name> --file <path-to-json-args>
     node tools/agent-cli.mjs shot
     node tools/agent-cli.mjs deck [--out <path>]
     node tools/agent-cli.mjs activity
     node tools/agent-cli.mjs reset
     node tools/agent-cli.mjs quit

   On Windows a JSON string arg passed straight on the command line can have its quotes mangled
   by the shell (PowerShell 5.1 especially). For any args with quotes, angle brackets, or other
   shell-hostile characters, write them to a .json file and pass --file <path> instead — the CLI
   reads and JSON.parses that file's contents unmodified.
*/
import { readFile, writeFile } from 'node:fs/promises';

const BASE = `http://127.0.0.1:${process.env.BRIDGE_PORT ?? '5189'}`;
const [, , cmd, ...rest] = process.argv;

function argVal(flag) {
  const i = rest.indexOf(flag);
  return i !== -1 && rest[i + 1] !== undefined ? rest[i + 1] : undefined;
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function die(msg) {
  console.error(`[cli] ${msg}`);
  process.exit(1);
}

switch (cmd) {
  case 'tools': {
    const { json } = await api('GET', '/tools');
    for (const t of json) {
      const firstSentence = (t.description ?? '').split(/(?<=\.)\s/)[0];
      console.log(`${t.name} — ${firstSentence}`);
    }
    break;
  }

  case 'schema': {
    const name = rest[0];
    if (!name) die('usage: schema <name>');
    const { json } = await api('GET', '/tools');
    const found = json.find((t) => t.name === name);
    if (!found) die(`no such tool: ${name}`);
    console.log(JSON.stringify(found, null, 2));
    break;
  }

  case 'call': {
    const name = rest[0];
    if (!name) die('usage: call <name> \'<json args>\'  OR  call <name> --file <path>');
    const filePath = argVal('--file');
    let args;
    if (filePath) {
      args = JSON.parse(await readFile(filePath, 'utf8'));
    } else {
      const raw = rest[1];
      if (raw === undefined) die('missing args — pass a JSON string or --file <path>');
      try {
        args = JSON.parse(raw);
      } catch (e) {
        die(`bad JSON args: ${e.message} (on Windows, prefer --file <path> to avoid shell quote-mangling)`);
      }
    }
    const { json } = await api('POST', '/call', { name, args });
    console.log(JSON.stringify(json.body, null, 2));
    console.log(`-- ${json.ms}ms${json.isError ? ' isError=true' : ''}`);
    if (json.isError) process.exitCode = 1;
    break;
  }

  case 'shot': {
    const { json } = await api('GET', '/screenshot');
    console.log(json.path);
    break;
  }

  case 'deck': {
    const out = argVal('--out');
    const { json } = await api('GET', '/deck');
    if (out) {
      await writeFile(out, json.text, 'utf8');
      console.log(JSON.stringify({ bytes: json.bytes, path: out }, null, 2));
    } else {
      console.log(JSON.stringify({ bytes: json.bytes }, null, 2));
      console.log('(pass --out <path> to save the deck text to a file)');
    }
    break;
  }

  case 'activity': {
    const { json } = await api('GET', '/activity');
    console.log(JSON.stringify(json.body, null, 2));
    break;
  }

  case 'reset': {
    const { json } = await api('POST', '/reset');
    console.log(JSON.stringify(json, null, 2));
    break;
  }

  case 'quit': {
    const { json } = await api('POST', '/quit');
    console.log(JSON.stringify(json, null, 2));
    break;
  }

  default:
    die(`unknown command "${cmd ?? ''}" — one of: tools, schema, call, shot, deck, activity, reset, quit`);
}
