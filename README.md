# Wifi-Merger (Plexo Enhancement) — CS2403 Computer Networks CIE 3

> ### ⚠️ ACADEMIC ASSESSMENT NOTICE & DISCLAIMER (PLEASE READ FIRST)
> **This repository is submitted strictly for the internal academic evaluation of Continuous Internal Evaluation 3 (CIE 3) for the course CS2403 - Computer Networks.**
> 
> **Important Disclaimers:**
> 1. **Not Our Project:** The base application and original architecture (**Plexo**) are **NOT** our creation or intellectual property. Full credit belongs to the original creator and contributors: [anmolkapil/plexo](https://github.com/anmolkapil/plexo).
> 2. **Course Requirement:** Our assignment objective was to identify an existing open-source networking application and design, implement, and document novel features not present in the original codebase.
> 3. **Temporary Repository:** This repository is temporarily made public solely for grading and evaluation by the course instructors. **It will be archived, made private, or deleted immediately after our internal evaluation is concluded.**

---

## 📌 Project Overview

**Wifi-Merger** is an enhanced multi-interface download accelerator built upon the open-source **Plexo** codebase. It bonds multiple network interfaces (such as Wi-Fi, Ethernet, and USB cellular tethering) to perform concurrent, parallelized downloads across available paths using HTTP range requests and BitTorrent peer spreading.

### 🚀 Novel Features Engineered for CIE 3

1. **Auto-Organize Downloads (`scripts/organize.py`, `src/main/download/organize.ts`, `OrganizeDialog.tsx`)**
   - Automatically sorts incoming downloads into classified directories (Documents, Videos, Audio, Archives, Images, Code) based on file attributes and extensions.
   - Includes verification and local deterministic fixtures (`test-fixtures/`).

2. **Adaptive Contextual Bandit Network Learning (`src/main/download/learning/`)**
   - Implements multi-armed contextual bandit reinforcement learning to dynamically discover and prioritize optimal network interfaces based on observed throughput, latency jitter, and time-of-day traffic patterns.
   - Saves persistent network performance profiles (`profiles.ts`, `store.ts`, `bandit.ts`).

3. **In-App Speed & Latency Benchmarking (`src/main/download/speedTest.ts`, `SpeedTestDialog.tsx`)**
   - Direct active probing of individual interfaces to measure ping, jitter, and bandwidth before scheduling large downloads.

4. **UI Refinements & Window Material Support (`src/main/windowMaterial.ts`, `MaterialToggle.tsx`)**
   - Native backdrop vibrancy/blur toggle, upgraded dialog interfaces for speed testing, network learning analytics, and auto-organize controls.

5. **Checksum Verification & Intelligent Chunk Repair (`plexo-feature-docs/feature-05-checksum-verification.html`)**
   - End-to-end payload integrity verification (MD5, SHA-1, SHA-256) with targeted re-download of corrupted byte ranges using bandit-ranked network paths.

6. **Bufferbloat Control: delay-based stream sizing (`src/main/download/rttEstimator.ts`, `concurrency.ts`)**
   - Measures each network's minRTT, smoothed RTT (RFC 6298) and bottleneck bandwidth from reused-socket round trips, BBR-style, and computes the bandwidth-delay product (BDP = BtlBw × minRTT).
   - Stops adding streams once queueing delay (sRTT − minRTT) reaches minRTT, and cuts streams to 3/4 when it passes 2 × minRTT. That keeps the pipe full without filling the router's queue, so ping stays low for everyone else on the network. Toggle: *Network learning → Keep ping low while downloading*. Tests: `scripts/verify-congestion.test.mts`.

---

## 📁 Repository Structure

```text
├── HOW-PLEXO-WORKS.md       # Comprehensive architectural walkthrough and viva preparation guide
├── plexo/                   # Complete enhanced Electron/TypeScript/React source code
│   ├── src/main/            # Main Electron process, transfer engines, routing, learning modules
│   ├── src/renderer/        # React UI components, dialogs, and screens
│   ├── src/preload/         # Electron IPC bridge
│   ├── e2e/                 # End-to-end Playwright tests (organize, learning, speedtest)
│   ├── scripts/             # Test fixture generators and local fixture server
│   └── test-fixtures/       # Deterministic sample files for reproducible testing
├── plexo-feature-docs/      # HTML visual feature documentation and specifications
│   ├── feature-01-auto-organize.html
│   ├── feature-02-network-learning.html
│   ├── feature-03-04-ui-plan.html
│   └── feature-05-checksum-verification.html
├── plexo-whitepaper/        # Standalone interactive whitepaper and presentation site
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── plexo-app/
    └── RUN_LIVE.txt         # Live run & testing instructions
```

---

## 🛠️ Getting Started & Testing

### Running the Whitepaper Documentation Site
```bash
python3 -m http.server 8000 --directory plexo-whitepaper
# Open http://localhost:8000 in your browser
```

### Running Dev Build (Plexo Codebase)
```bash
cd plexo
npm install --ignore-scripts
npx install-electron
npm run dev
```

### Running Tests
```bash
cd plexo
npm run typecheck
npx playwright test
```

---

> ### ⚠️ POST-EVALUATION NOTICE
> **Reminder:** This repository is maintained temporarily for the CS2403 Computer Networks CIE 3 evaluation. All upstream copyright and ownership belongs to [anmolkapil/plexo](https://github.com/anmolkapil/plexo). This repository will be deleted, archived, or made private once the CIE 3 grading is completed.
