# Design System: Wifi-Merger (Plexo Enhancement) — CS2403 Computer Networks

## 0. Dials
VARIANCE: 6 | MOTION: 4 | DENSITY: 8   (tuned for high-density networking telemetry & academic evaluation)

## 1. Atmosphere
High-precision engineering console with tactile depth and material layering. Combines deep slate background (`#0c1015`) with sharp hairline boundaries, subtle translucent acrylic surfaces, and high-contrast status feedback. Data is direct, readable at a glance, and avoids decorative fluff.

## 1b. Signature element (mandatory, exactly one)
**Real-Time Multi-Interface Chunk Allocation Matrix (`BlockGrid` / `CombineDiagram`)** — live, byte-exact block visualization showing concurrent chunk acquisition across bonded network adapters (Wi-Fi, Ethernet, LTE) mapped to distinct interface hues (Net-Steel `#8fa7d6`, Net-Teal `#57c9b5`, Net-Amber `#e0b25c`) with real-time throughput pacing and hedge indicators.
Sustained in: Active Download screens, Bandwidth Combine diagram, Speed Test live telemetry, and Interactive Whitepaper merge simulation.

## 2. Palette and roles
- **Base Solid** (`#0c1015`) — Window foundation and dark canvas background
- **Surface Panel** (`#161d26` / `rgba(24, 31, 40, 0.66)`) — Cards, popovers, and dialog containers
- **Signal Ink** (`#35c7f5`) — Primary interactive accent, active toggles, focus rings (saturation < 75%)
- **Network Interface Steel** (`#8fa7d6`) — Primary bonded link (Wi-Fi)
- **Network Interface Teal** (`#57c9b5`) — Secondary bonded link (Ethernet / Tethering)
- **Network Interface Amber** (`#e0b25c`) — Tertiary / fallback link
- **Status Good** (`#3ddc97`) — Verification passed, completed download
- **Status Warn** (`#f5c451`) — Throttled / rate-limited link, retry event
- **Status Bad** (`#ff7a7a`) — Corrupted chunk, dead route, verification failure
- **Muted Text** (`#a6b0ba` / `#7f8a94`) — Descriptive metadata, technical labels
- Banned: pure `#000000`, oversaturated neon purples, glowing shadows, gradient headings.

## 3. Typography
- Display: `Manrope` (Variable woff2) — tight tracking (`tracking-tight`), hierarchy driven by weight (600/700) rather than oversized dimensions.
- Body: `Manrope` — relaxed leading (`leading-relaxed`), max-width 65ch for prose.
- Mono: `Roboto Mono` — strictly enforced on all transfer speeds, byte offsets, IP addresses, port numbers, hashes, and ETA counters.
- Banned: `Inter` as a generic default, serif typefaces in application dashboard/cockpit views.

## 4. Components
- **Buttons:** Tactile feedback on `:active` (`scale-[0.98]` or `-translate-y-[1px]`). Sharp border radii with subtle 1px hairline (`rgba(255, 255, 255, 0.09)`). No floating glow effects.
- **Cards & Rows:** High-density split borders and divide lines (`border-t`, `divide-y`) rather than floating shadow cards.
- **Inputs:** Concrete labels positioned strictly above inputs; validation messages and errors placed directly below with 1px accent focus rings.
- **Loaders & Progress:** Direct byte-proportional progress bars and block-matrix fillers representing real chunk states (`pending`, `downloading`, `verifying`, `done`). No generic circular loading spinners.
- **Empty States:** Clear guidance on pasting a URL or connecting a second network adapter, never an empty "No Data" placeholder.

## 5. Layout
- Grid-first architecture with responsive collapse below 768px (`w-full px-4`).
- No absolute overlap stacking; sticky headers and modal backdrops have defined z-indexes (`z-10` / `z-20`).
- Container constraints: `max-w-7xl mx-auto` or `max-w-[1020px]`.
- Viewport heights use `min-h-[100dvh]` to eliminate mobile browser bar jumps.

## 6. Motion
- Native CSS transitions and spring transforms (`transform`, `opacity` only).
- Never animate geometry properties (`width`, `height`, `top`, `left`) during continuous layout renders.
- Strict respect for `prefers-reduced-motion`: animation states fall back to instant transitions without blocking content visibility.

## 7. Anti-patterns (BANNED)
- NO emojis anywhere in status bars, dialogs, or documentation headers.
- NO AI copy cliches ("Elevate", "Seamless", "Next-Gen", "Supercharge").
- NO fake round metrics (`99.99%`, `10x`); metrics are measured real-world benchmarks (`+47.2% merge gain`, `8.4 Mbps`).
- NO generic placeholder names ("John Doe", "Jane Doe", "Acme").
- NO oversaturated AI-style neon purple or rainbow drop shadows.
