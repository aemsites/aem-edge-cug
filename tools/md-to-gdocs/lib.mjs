// eslint-disable-next-line import/no-extraneous-dependencies
import MarkdownIt from 'markdown-it';

function isBorderLine(line) {
  return /^\+[-+]+\+\s*$/.test(line);
}

function columnOffsets(borderLine) {
  const offsets = [];
  for (let i = 0; i < borderLine.length; i += 1) {
    if (borderLine[i] === '+') offsets.push(i);
  }
  return offsets;
}

function sliceRow(line, offsets) {
  const width = offsets[offsets.length - 1] + 1;
  const padded = line.length < width ? line.padEnd(width, ' ') : line;
  const cells = [];
  for (let k = 0; k < offsets.length - 1; k += 1) {
    const start = offsets[k] + 1;
    const end = offsets[k + 1];
    cells.push(padded.slice(start, end).trim());
  }
  return cells;
}

// Strip exactly one level of "| ... |" wrapping from a single-column line,
// used to unwrap a nested grid table embedded inside an outer table's cell.
function stripOuterWrapper(line, offsets) {
  const inner = line.slice(offsets[0] + 1, offsets[offsets.length - 1]);
  return inner.replace(/^ /, '').replace(/ $/, '');
}

/**
 * Parses a self-contained run of grid-table lines (starting and ending with a
 * top-level border line) into a list of rows. Each row is either:
 *   { cells: string[] }              - a normal row
 *   { nested: true, rows: Row[] }     - a row whose sole cell is itself a nested grid table
 */
function parseGridLines(lines) {
  const rows = [];
  let i = 0;
  while (i < lines.length - 1) {
    const border = lines[i];
    const offsets = columnOffsets(border);
    const contentLines = [];
    let j = i + 1;
    while (j < lines.length && !isBorderLine(lines[j])) {
      contentLines.push(lines[j]);
      j += 1;
    }
    if (contentLines.length === 0) {
      i = j;
      // eslint-disable-next-line no-continue
      continue;
    }

    const isSingleColumn = offsets.length === 2;
    const strippedFirst = isSingleColumn ? stripOuterWrapper(contentLines[0], offsets) : null;

    if (isSingleColumn && isBorderLine(strippedFirst)) {
      const innerLines = contentLines.map((l) => stripOuterWrapper(l, offsets));
      rows.push({ nested: true, rows: parseGridLines(innerLines) });
    } else {
      const perLineCells = contentLines.map((l) => sliceRow(l, offsets));
      const numCols = offsets.length - 1;
      const cells = [];
      for (let col = 0; col < numCols; col += 1) {
        cells.push(
          perLineCells
            .map((r) => r[col])
            .filter((v) => v)
            .join(' ')
            .trim(),
        );
      }
      rows.push({ cells });
    }
    i = j;
  }
  return rows;
}

// Splits raw markdown lines into alternating 'prose' and 'table' regions.
// A top-level table border line always starts at column 0 with '+'; nested
// table borders are indented behind a leading '| ', so this check only ever
// matches top-level tables.
function splitTopLevelRegions(lines) {
  const regions = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('+') && isBorderLine(lines[i])) {
      let j = i;
      while (j < lines.length && (lines[j].startsWith('+') || lines[j].startsWith('|'))) {
        j += 1;
      }
      regions.push({ type: 'table', lines: lines.slice(i, j) });
      i = j;
    } else {
      let j = i;
      while (j < lines.length && !(lines[j].startsWith('+') && isBorderLine(lines[j]))) {
        j += 1;
      }
      regions.push({ type: 'prose', lines: lines.slice(i, j) });
      i = j;
    }
  }
  return regions;
}

function renderCell(md, text) {
  return md.renderInline((text || '').trim());
}

function renderRow(md, row) {
  const tds = row.cells.map((c) => `<td>${renderCell(md, c)}</td>`).join('');
  return `<tr>${tds}</tr>`;
}

function renderBlock(md, name, dataRows) {
  const lower = name.toLowerCase();

  if (lower === 'table') {
    const nested = dataRows.find((r) => r.nested);
    const innerRows = nested ? nested.rows : [];
    const innerTrs = innerRows.map((r) => renderRow(md, r)).join('\n');
    return [
      '<table border="1" cellspacing="0" cellpadding="8">',
      '<tr><td>Table</td></tr>',
      '<tr><td>',
      '<table border="1" cellspacing="0" cellpadding="8" width="100%">',
      innerTrs,
      '</table>',
      '</td></tr>',
      '</table>',
    ].join('\n');
  }

  if (!['metadata', 'section metadata'].includes(lower)) {
    // eslint-disable-next-line no-console
    console.warn(`md-to-gdocs: unrecognized block "${name}" — rendered as a generic flat table, please review.`);
  }
  const numCols = Math.max(1, ...dataRows.map((r) => (r.cells ? r.cells.length : 1)));
  const rowsHtml = dataRows.map((r) => renderRow(md, r)).join('\n');
  return [
    '<table border="1" cellspacing="0" cellpadding="8">',
    `<tr><td colspan="${numCols}">${name}</td></tr>`,
    rowsHtml,
    '</table>',
  ].join('\n');
}

// eslint-disable-next-line import/prefer-default-export
export function mdToHtml(markdown) {
  const md = new MarkdownIt({ html: false });
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const regions = splitTopLevelRegions(lines);

  let title = null;
  const htmlParts = [];

  regions.forEach((region) => {
    if (region.type === 'table') {
      const rows = parseGridLines(region.lines);
      if (rows.length === 0) return;
      const [nameRow, ...dataRows] = rows;
      const name = (nameRow.cells && nameRow.cells[0]) || 'Table';
      htmlParts.push(renderBlock(md, name, dataRows));
    } else {
      const proseText = region.lines.join('\n').trim();
      if (!proseText) return;
      let html = md.render(proseText);
      html = html.replace(/<(h[1-3])>\s*<strong>([\s\S]*?)<\/strong>\s*<\/\1>/g, '<$1>$2</$1>');
      if (!title) {
        const m = html.match(/<h1>(.*?)<\/h1>/);
        if (m) title = m[1].replace(/<[^>]+>/g, '');
      }
      htmlParts.push(html);
    }
  });

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title || 'Converted Document'}</title></head>
<body>

${htmlParts.join('\n\n')}

</body>
</html>
`;
}
