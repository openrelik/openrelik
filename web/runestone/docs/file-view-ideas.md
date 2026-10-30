# File view ideas

Views worth adding beside the current ones (text, rendered Markdown, table,
hex), most useful first. Notes for later; nothing here is built yet.

## 1. Strings

ASCII and UTF-16LE runs, each with its byte offset, a minimum length and a
filter. A string links to its offset in Hex (offset marks already exist), so
"the C2 URL at 0x3F20" is a link.

Safe in the browser: it only scans bytes; strings are shown as escaped text,
never in `v-html`, `href` or `src`. The limit is the network, not safety, so
it complements the strings worker rather than replacing it:

- **Strings near here**: over the region Hex has loaded (or a few MB around
  it). Next to no extra requests; links back to the bytes, which the worker's
  output cannot.
- **Whole small files**: under a threshold (say 10–20 MB), scan the file as it
  streams in, as the text view reads it.
- **Large files**: point to the strings worker ("Run strings worker"), or link
  to its output if it exists for the file.
- Smallest version: a Hex toggle that highlights printable runs on screen.

## 2. JSON tree

For whole JSON documents (not JSONL): cloud audit logs, triage collector
output, API dumps. Collapsible nodes, search, and "copy path"
(`.records[3].userIdentity.arn`) for jq or a report.

## 3. Timeline on the table

An addition to the table view, not a new view. A histogram over a timestamp
column (plaso CSV/JSONL, MFT output); drag a range to filter rows. Finds the
burst of activity in millions of events without knowing what to search for.

## 4. Entropy strip on hex

A thin bar beside the hex scrollbar, coloured by per-block entropy; click to
jump. Shows packed or encrypted sections, embedded payloads and padding.
Cheap to compute, no dependencies.

## 5. Archive listing

Entries of a zip/tar (name, size, date, compression) without extracting. A
zip's central directory is at the end of the file, so a range request reads
it, which suits slow links. Answers "what's inside" before running an
extraction worker.

## Maybe later

- **Image preview with EXIF/GPS**: raster only, from a blob URL with a pinned
  MIME type. Never render SVG (it can carry script); show it as source, as
  HTML is.
- **Diff two files**: configs, registry exports, before/after triage. Needs a
  way to pick two files: a larger UX change than a tab.

## Not in the browser

SQLite, EVTX, registry hives, PE/ELF parsers: important, but parsing them
client-side means heavy dependencies (e.g. sql.js/WASM) or fragile parser
code, against the minimal-dependency rule. Better: a worker converts the
artefact to CSV/JSONL and the table view shows it, so invest in the table
view (timeline, column types, rows linked back to the source).
