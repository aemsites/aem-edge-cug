#!/usr/bin/env node
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
// eslint-disable-next-line import/extensions
import { mdToHtml } from './lib.mjs';

function parseArgs(argv) {
  const args = { input: null, out: null, open: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--out') {
      i += 1;
      args.out = argv[i];
    } else if (arg === '--open') {
      args.open = true;
    } else if (!args.input) {
      args.input = arg;
    }
  }
  return args;
}

async function readInput(input) {
  if (/^https?:\/\//.test(input)) {
    const url = input.endsWith('.md') ? input : `${input}.md`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }
  return readFile(input, 'utf-8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    process.stderr.write('Usage: node convert.mjs <path-or-url.md> [-o output.html] [--open]\n');
    process.exit(1);
  }

  const markdown = await readInput(args.input);
  const html = mdToHtml(markdown);

  let outPath = args.out;
  if (args.open && !outPath) {
    const dir = await mkdtemp(join(tmpdir(), 'md-to-gdocs-'));
    outPath = join(dir, 'output.html');
  }

  if (outPath) {
    await writeFile(outPath, html, 'utf-8');
    process.stderr.write(`Wrote ${outPath}\n`);
  } else {
    process.stdout.write(html);
  }

  if (args.open && outPath) {
    spawn('open', [outPath], { stdio: 'ignore', detached: true }).unref();
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
