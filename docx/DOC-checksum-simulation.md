# Doc: Enhancements 5 and 7 — how they work and how to prove it — reference / demo guide

## 0. Dials
FORMALITY: 5 | DENSITY: 6 | ORNAMENT: 2
A working reference for showing the professor, not the graded report: plain English, every claim
backed by a file, a constant or a test line.

## 1. Format and engine
Deliverable: .docx (+ .pdf) | Engine: WordCraft MCP server
Inherits typography and path colours from `docx/DOC.md` (the main report).

## 2. Structure (BLUF)
Thesis first: Enhancement 5 is now implemented (it was "designed, not implemented" in the report)
and Enhancement 7 had three fixes; both are proven by tests that anyone can run with one command.
- Key-figures line under the title
- 1 What changed in the code (one table)
- 2 Checksum verification and chunk repair: the problem, the five steps, where it lives
- 3 Pre-download simulation: the arithmetic (worked example), the three fixes
- 4 How to prove it in front of the professor (demo script, exact commands, what each line proves)
- 5 Honest limits (what the tests do and do not cover)

## 3. Signature element
**Path colour** — Wi-Fi in teal #13856f and Ethernet in amber #b8740a, the same as the app's
block grid and the main report, so "which network sent the bad bytes" reads at a glance.
Sustained in: the step table, the worked example, the demo transcript.

## 4. Voice
Short plain sentences, active voice, numbers instead of adjectives. Lists only for the five repair
steps and the demo commands. No "Furthermore/Moreover/leverage/seamless/robust". Bold rare.

## 5. Typography and layout
Headings: Segoe UI Semibold | Body: Georgia 10.5 pt, leading 1.4 | Mono: Consolas 9 pt.
A4, margins 2.4 cm. Tables with horizontal rules only.

## 6. Figures and data
Every number comes from `scripts/verify-checksum.test.mts`, `scripts/verify-simulation.test.mts`
or `src/renderer/src/utils/simulationEngine.ts` constants, as run on 7 Nov 2026.

## 7. Anti-patterns (BANNED)
No restating the task. No summary conclusion. No bold-bombing. No bullet soup. No Title Case
headings. No boxed tables. No emojis. No claim that the in-app test covers the Electron UI
end to end (it does not; the UI path is shown by hand).
