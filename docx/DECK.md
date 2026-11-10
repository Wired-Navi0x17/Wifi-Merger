# Deck: Plexo-Enhanced (v3, 3Blue1Brown visuals on the college template) — CS2403 Computer Networks, RV University — CIE 3 project presentation

## 0. Dials
DENSITY: 3 | MOTION: 3 | VARIANCE: 6
Fade 300 ms between slides; one embedded animation (Manim, 38 s, no audio). No builds.

## 1. Format and engine
Aspect 16:9 (960 × 540 pt) | Engine: DeckCraft driven through its MCP server (`deckcraft-cli mcp`,
JSON-RPC from build_deck.py) over the college template `PPT template.pptx`.
Inherits brand from: the college template (navy header bar, gold title text, SOCSE footer, RV logo)
and `CIE/DESIGN.md` (interface colours). Deliverables: .pptx (Segoe UI / Consolas for Windows
PowerPoint) and a PDF handout rendered with the metric-compatible Selawik / Inconsolata.

## 2. Narrative arc (titles-only test) — v2, technical
1. Plexo-Enhanced (cover)
2. Plexo turns one multi-homed laptop into many parallel download paths (CN concept map)
3. At layer 7 Plexo writes the request; it steers layers 4 and 3
4. Interface binding makes each TCP socket leave through a chosen network
5. TCP carries the bytes; HTTP Range says which bytes to send
6. A 300 MiB file becomes 128 Range blocks of 2,457,600 bytes
7. Load balancing is pull-based, so the faster path ends up asking more often
8. At the tail Plexo races the slow block and still counts each byte once
9. Naive chunk downloaders need 2× the disk; Plexo needs about 1×
10. Speed limits use TCP flow control: pause reading and the sender waits
11. Fault tolerance: a network can vanish mid-block and no secured byte is lost
12. BitTorrent spreads peers across networks, one TCP connection at a time
13. Every trust boundary checks what crosses it: IPC, localhost, TLS, SSRF
14. Our seven enhancements, in computer-networks terms
15. Measured: 73.1 MB/s over two paths, split in proportion to capacity

Video: four clips are embedded and play on click: slide 3 (layer 7), 6 (chunks), 9 (2× disk),
14 (link indexing). Every other slide shows a still Manim figure, so no slide shows two videos and
the deck is not a video on every slide. All 10 clips also sit in Plexo-Enhanced_Clips/ and are
joined in Plexo-Enhanced_Technical_AllClips.mp4. No PDF handout. DENSITY raised to 6 at the user's request:
every slide carries a figure plus an explanation panel; detail continues in speaker notes.

## 3. Signature element (mandatory, exactly one)
**The two-lane strip** — a thin teal-then-amber bar under every slide title, split 62.5 : 37.5,
which is the Wi-Fi : phone byte split we measured. On slide 13 the same strip grows into the
evidence itself. Owned (it is our result and Plexo's block-grid colours), sustained (every
content slide), memorable (the audience sees the answer before they hear it).

## 4. Palette and typography
- Template navy #233039 and gold titles; Wi-Fi teal #13856F, phone amber #B8740A, ink #1E2328,
  muted #5E6772. Data uses only teal and amber.
- Display and body: Segoe UI (Selawik for the PDF). Mono for numbers: Consolas (Inconsolata).

## 5. Archetype system
Cover (1) · assertion-evidence diagram (2, 3, 6, 9) · media (4) · table (5) · two-screenshot
evidence (7, 10, 11) · screenshot + formula (8) · big number (12) · comparison bars (13) ·
two-zone comparison (14) · close with action (15). No two adjacent slides share an archetype
except where the evidence type demands it.

## 6. Charts
Slide 13: two hand-drawn 100% bars (delivered vs predicted) in teal/amber, labelled directly,
no legend, no axis.

## 7. Anti-patterns (BANNED)
No title + bullets mold. No agenda slide. No "Thank you / Questions?". No emojis, no SmartArt,
no clipart. No rainbow charts. No paragraphs on slides (detail lives in speaker notes). No fake
round numbers. No claim that checksum repair is implemented. No claim that base Plexo is ours.

## v3 (5 Nov 2026)
- Template kept strictly: cover photo, navy header bar, heading in Cantarell bold italic #D7AC54, RV logo,
  SOCSE footer, cream background. Body Georgia, code Consolas.
- Every content slide: one black 3Blue1Brown-style Manim visual (LaTeX, gold 1.5 pt frame) + three numbered
  points whose colours match the video colours (Wi-Fi blue, phone yellow, HTTP green, IP purple, failure red).
- Videos (silent, 1080p60, 3b1b style, NOT the RVU theme): embedded on slides 3, 6, 9, 14 only.
  Sources: ~/.manim-skill/plexo-3b1b/script.py (10 scenes) and figs.py (3 static figures).
  Deck builder: ~/.cache/plexo-report-work/deck/build_deck3.py (DeckCraft MCP), then embed3.py (python-pptx).

## v4 (5 Nov 2026) — current
- 17 slides: cover, 15 content, narrated backend film (16), Thank you (17, template cover style).
- Hierarchy: part kicker + 6-step progress rail -> lead sentence -> evidence -> numbered points -> source.
  Archetypes: V (video + point card), F (lead + native flowchart + visual + three row cards),
  C (TCP vs Range comparison cards), T (security table), N (big number + stat tiles), film, thank you.
- Morph (objects, 1.1 s) on every slide after the cover; persistent shapes share "!!" names
  (!!Kicker, !!Rail0-5, !!Lead, !!Visual, !!Panel, !!Card0-2, !!Table, !!Title, !!Names) so they glide
  between layouts. Flowcharts build in (zoom + wipe), cards float/fly in, tables wipe down.
- Slide 16 embeds Plexo-Enhanced_Backend_Narrated.mp4 (3 min 19 s, Kokoro voice am_michael, subtitles in .srt).
  Source: ~/.manim-skill/plexo-backend/ (script.py, narration.txt, timestamps.json).
- Builder: ~/.cache/plexo-report-work/deck/build_deck4.py, then scratchpad embed4.py. Validated with the pptx skill's
  validate.py --original "PPT template.pptx": all passed.

## v5 (5 Nov 2026), current
- 18 slides. New slide 15 "Bufferbloat control: stop adding connections once the pipe is full" (Part IV, flow archetype):
  Feature 6 in the code (numbered 8 in the deck's table). Visual: F_Bufferbloat (figs.py; rate and RTT against data in flight, knee at BDP).
- Slide 14 table is now "Our eight enhancements" with row 8 Bufferbloat control (built). Cover says eight features.
  Film moved to slide 17; its chapter reads "our features 1 to 7" (the film predates feature 8).
- Builder: ~/.cache/plexo-report-work/deck/build_deck5.py, then scratchpad embed5.py (film index 17). validate.py: all passed.
- Backup of v4: docx/Plexo-Enhanced_Presentation.v4.bak.pptx.
