# md-to-gdocs

Converts the Markdown export of a published/previewed Edge Delivery Services page (the `.md` you get by appending `.md` to any page URL) into HTML that can be pasted directly into Google Docs, preserving block structure (Metadata, Section Metadata, Table, ...).

## Why

EDS's docx2md pipeline exports every authored block as a [grid table](https://pandoc.org/MANUAL.html#extension-grid_tables) (`+---+` border syntax) with the block name as its own header row. A `Table` block specifically comes out **doubly nested**: an outer grid table whose second row is itself a complete inner grid table holding the real header/data rows. That nested structure is also what Google Docs needs on paste for the table to come out looking right (a flat single table with a merged/spanning header cell does not paste correctly). This tool parses that grid-table format and re-emits it as literal nested `<table>` HTML, so you can edit the page's Markdown directly instead of hand-building table markup.

## Usage

```bash
# from a local .md file
npm run md-to-gdocs -- path/to/page.md -o out.html

# from a live/preview URL (the .md suffix is added automatically if missing)
npm run md-to-gdocs -- https://main--site--org.aem.page/some/page --open

# print to stdout
npm run md-to-gdocs -- path/to/page.md
```

`--open` writes to a temp file and opens it (macOS `open`) so you can select-all, copy, and paste into your Google Doc.

## Scope / limitations (v1)

- Handles: headings (`#`/`##`/`###`), paragraphs, bold/italic, inline code, links, ordered/unordered lists, the `Table` block (nested), and simple key-value blocks like `Metadata` / `Section Metadata` (flat).
- Any other block type (Card List, Deprecation, Pagination, icon shortcodes like `:icon-name:`, image references, ...) is rendered as a best-effort flat table with a console warning — review the output manually for those.
- Cell text that wraps across multiple physical lines in the source (no divider between them) is joined with spaces — this matches how docx2md wraps long cell content.
- Pre-existing content quirks in the source Doc (e.g. italics that don't span across an inline code run, producing split `*...*` segments) are passed through as-is; fix those in the Doc itself rather than expecting this tool to paper over them.

## Tests

```bash
npm run test:md-to-gdocs
```

Includes a regression fixture (`test/fixtures/closed-user-groups.md`) pulled from the live CUG draft page.
