# Doc: Plexo-Enhanced — CS2403 Computer Networks, RV University — mini project report

## 0. Dials
FORMALITY: 6 | DENSITY: 8 | ORNAMENT: 2
Density 8 forces a key-figures panel, a table of contents, running header and page numbers.

## 1. Format and engine
Deliverable: .docx + .pdf | Engine: python-docx over the college template (`MiniProject (1).docx`),
then WordCraft (`wordcraft-cli`, same command set as the wordcraft MCP server) for field refresh,
inspection, page renders for QA, and PDF export.
Inherits brand from: the college template (cover, certificate, Times on those two pages only) and
`CIE/DESIGN.md` (interface colours, mono for data).

## 2. Structure (BLUF)
Thesis, stated first: we added seven enhancements to Plexo (six built and tested, one designed);
together they turn a download accelerator into a tool that finds files from a pasted link, predicts
the download before it starts, picks better tail settings from past runs, and files the result.
Measured: 1.6x the Wi-Fi-only rate on a two-path bench, 31 automated checks passing, 45 files
indexed from one pasted link.

Skeleton (template order kept, sections inserted between 4 and 5 of the template):
- Key figures panel (before section 1)
- 1 Problem statement (one paragraph, as the template asks)
- 2 Introduction (five paragraphs maximum)
- 3 Network diagram (deployment view + test bench view + layer map)
- 4 Configuration setup (every device/interface, software, settings)
- 5 How base Plexo moves bytes (the substrate we built on)
- 6 The seven enhancements (one subsection each: problem, design, code, what it changes on the wire)
- 7 Results (at least three screenshot proofs; we give more, plus test logs)
- 8 Limitations and known issues (honest list, found during this evaluation)
- 9 Conclusion (one paragraph: what, how, value, next)
- References (published papers and RFCs only, IEEE style)
- Appendix A: rubric mapping; Appendix B: test log excerpt

## 3. Signature element (mandatory, exactly one)
**Path colour** — every diagram, chart, table marker and screenshot uses the same two interface
colours from the app (teal #13856f = Wi-Fi, amber #b8740a = phone tether), so the reader always
knows which network carries a byte. Comes from Plexo's own BlockGrid colours.
Sustained in: network diagrams, flowcharts (path-specific boxes), results table markers, the
Manim animation and the PPT.

## 4. Voice
FORMALITY 6, plain English, deeply technical: every claim names a file, a constant or a number.
Prose by default. Lists only for configuration items, steps and test cases. No "Furthermore",
"Moreover", "leverage", "seamless", "robust". Bold only for first use of a key term, rarely.

## 5. Typography and layout
Display/headings: Segoe UI Semibold (on Windows; Selawik locally, metric-compatible)
Body: Georgia 10.5 pt, leading 1.4 (Gelasio locally, metric-compatible)
Mono (code, constants, numbers in tables): Consolas 9 pt (Inconsolata locally)
A4, margins 2.4 cm, body measure about 70 characters. Tables: horizontal rules only.
Headings sentence case, numbered by hand to match the template.

## 6. Figures and data
Figures numbered "Figure n." with an assertive caption that states the finding, plus a source line
("Source: screenshot of Plexo-Enhanced, test bench, 5 Nov 2026" or "Source: authors, from
src/main/...").
Diagrams drawn in Manim (Python) with the path colours; screenshots from the running app driven by
Playwright. All numbers are measured in this evaluation or read from code constants.

## 7. Anti-patterns (BANNED)
No intro that restates the task. No conclusion-summary. No bold-bombing. No connector cliches.
No bullet soup. No Title Case headings. No Calibri/Times in the body. No boxed tables. No emojis.
No unmeasured claims. No fake round numbers. No claiming the checksum feature is implemented
(it is designed only). No claiming base Plexo as our work.
