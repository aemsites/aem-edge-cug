import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// eslint-disable-next-line import/extensions
import { mdToHtml } from '../lib.mjs';

// eslint-disable-next-line no-underscore-dangle
const __dirname = dirname(fileURLToPath(import.meta.url));

test('converts the closed-user-groups fixture without leftover grid-table syntax', async () => {
  const markdown = await readFile(join(__dirname, 'fixtures/closed-user-groups.md'), 'utf-8');
  const html = mdToHtml(markdown);

  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<title>Protecting Content with Closed User Groups \(CUG\)<\/title>/);
  assert.doesNotMatch(html, /\+[-+]+\+/, 'no raw grid-table border lines should remain');
});

test('renders Metadata as a flat labeled table', async () => {
  const markdown = await readFile(join(__dirname, 'fixtures/closed-user-groups.md'), 'utf-8');
  const html = mdToHtml(markdown);

  assert.match(html, /<tr><td colspan="2">Metadata<\/td><\/tr>/);
  assert.match(html, /<tr><td>Template<\/td><td>guides<\/td><\/tr>/);
  assert.match(html, /<tr><td>Labs<\/td><td>Closed User Groups<\/td><\/tr>/);
});

test('renders Table blocks as nested outer/inner tables with bold headers and code spans', async () => {
  const markdown = await readFile(join(__dirname, 'fixtures/closed-user-groups.md'), 'utf-8');
  const html = mdToHtml(markdown);

  const nestedTableCount = (html.match(/<tr><td>Table<\/td><\/tr>/g) || []).length;
  assert.ok(nestedTableCount >= 8, `expected at least 8 Table blocks, found ${nestedTableCount}`);
  assert.match(html, /<strong>Column<\/strong>/);
  assert.match(html, /<code>cug-required<\/code>/);
  assert.match(html, /<code>x-aem-cug-required<\/code>/);
});

test('joins a cell whose text wraps across multiple physical lines', async () => {
  const markdown = await readFile(join(__dirname, 'fixtures/closed-user-groups.md'), 'utf-8');
  const html = mdToHtml(markdown);

  assert.match(
    html,
    /Login page path \(e\.g\. \/login\) or absolute URL \(e\.g\. https:\/\/idp\.example\.com\/login\) to redirect unauthenticated visitors to/,
  );
});

test('handles a minimal synthetic Metadata + Table document', () => {
  const markdown = `+------------------------+
| Metadata               |
+----------+-------------+
| Template | guides      |
+----------+-------------+

# Hello

+-------------------------------+
| Table                         |
+-------------------------------+
| +------------+---------------+ |
| | **A**      | **B**         | |
| +------------+---------------+ |
| | \`x\`        | plain text    | |
| +------------+---------------+ |
+-------------------------------+
`;
  const html = mdToHtml(markdown);
  assert.match(html, /<tr><td colspan="2">Metadata<\/td><\/tr>/);
  assert.match(html, /<h1>Hello<\/h1>/);
  assert.match(html, /<strong>A<\/strong>/);
  assert.match(html, /<code>x<\/code>/);
  assert.match(html, /plain text/);
});
