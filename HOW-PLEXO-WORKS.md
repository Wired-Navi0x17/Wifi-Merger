# How Plexo Works — Deep Technical Documentation in Simple English

> Repo: `https://github.com/Wired-Navi0x17/plexo` (fork of `anmolkapil/plexo`)
> Studied version: `1.0.0-rc.15` — Electron + TypeScript + React + webtorrent + koffi
> Read from: `plexo/src/main`, `src/shared`, `src/renderer`, `src/preload`, `extension/`, `patches/`
> Rule of this doc: short sentences. Simple words. But every claim points to a real file, function, and constant.

---

## 0. How to read this doc

- If you know nothing: read §1, §2, §11, §24 only.
- If you have a viva / exam: read §2, §5, §6, §17, §20, §25.
- If you will change code: read everything in order. §26 tells you which file to open first.

Words we will use often:

- **Interface / network**: one physical path out, e.g. `wlan0` (Wi-Fi), `usb0` (phone). Plexo calls it `NetworkInterfaceInfo` (`src/shared/types.ts:14`).
- **Stream**: one TCP connection that fetches one block at a time. `HttpStreamState` (`types.ts:80`).
- **Block**: one byte range of the file, e.g. `bytes 0-8388607`. `HttpBlockState` (`types.ts:133`).
- **Attempt**: one try at one block by one stream. Primary = first try. Hedge = second racing try. (`src/main/download/httpTransfer.ts:45`).
- **Peer**: one BitTorrent TCP connection. `TorrentPeerState` (`types.ts:100`).
- **Piece**: torrent's own block size, set by the torrent maker. `TorrentPieceState` (`types.ts:138`).

---

## 1. Plexo in one sentence + one picture

Plexo splits one file into many small byte ranges and downloads different ranges at the same time through different internet connections, then joins them on disk.

```
File on server (100 MB, supports Range)
  [block 0][block 1][block 2][block 3]...[block 12]  (8 MB each, see plan.ts)

Wi-Fi  stream 1 -> block 0 ─┐
Wi-Fi  stream 2 -> block 2 ─┼─> staging file `name.plexo` at correct offsets
Phone  stream 1 -> block 1 ─┤   (random writes, flags 'r+', start=offset)
Phone  stream 2 -> block 3 ─┘

All blocks `completed`? -> fsync -> atomic rename `.plexo` -> final name -> Notify
Tail stuck? -> idle stream re-fetches same block (hedge). First wins.
```

No VPN. No virtual adapter. No server help. Only normal `Range` requests + normal BitTorrent TCP peers, but each socket is pinned to a chosen interface.

Why this works: most file servers and all torrent swarms can serve the same bytes from many parallel connections. The bottleneck is usually one connection's TCP speed or one ISP's speed — not the server's disk.

When it does NOT help (say this in viva): Wi-Fi + Ethernet to the **same home router** = same internet pipe = no gain. Each network needs its **own path to the internet** (home Wi-Fi + mobile data is the classic win).

---

## 2. Which layer are we on? — the full answer

### 2.1 The two models side by side

| OSI # | OSI name | TCP/IP layer | Plexo touches? | What exactly |
|-------|----------|--------------|----------------|--------------|
| 7 | Application | Application | **YES — home** | HTTP `Range`, BitTorrent wire protocol, DHT, tracker HTTP, DNS names, browser cookies, Electron UI, localhost bridge JSON |
| 6 | Presentation | Application | indirect | TLS (HTTPS) encrypts bytes. Plexo does not encrypt itself, but drives `tls` via `RoutedHttpsAgent` |
| 5 | Session | Application | indirect | TCP + TLS sessions, BitTorrent peer sessions (`wire`), keep-alive reuse |
| 4 | Transport | Transport | **YES — control** | Opens/closes/rates every TCP socket. Sets `localAddress`, `SO_BINDTODEVICE`, keep-alive, stall watchdogs, backoff |
| 3 | Network | Internet | **YES — read + steer** | Reads IPv4/IPv6 + netmask + subnet. Resolves DNS. Picks source IP. Forces egress interface on Linux |
| 2 | Data Link | Network Access | read-only | Reads adapter names/kinds (Wi-Fi vs USB vs Ethernet). Never crafts frames, never reads MAC for routing |
| 1 | Physical | Network Access | no | Cables / radio untouched |

**Exam sentence to memorize:**

> Plexo is an Application-layer (OSI L7 / TCP-IP Application) download manager that multiplies throughput by steering Transport-layer (L4) TCP connections out of different Network-layer (L3) source interfaces. It observes L2/L1 but never operates there.

### 2.2 Per-operation layer map (deeper)

| Operation | Layer | Code | Packet / API |
|-----------|-------|------|--------------|
| List adapters | L2 info via OS | `network/interfaces.ts:128 listActiveInterfaces()` → `os.networkInterfaces()` | No packets. One syscall |
| Name adapters | OS-specific | macOS `networksetup -listallhardwareports`, Windows `Get-NetAdapter`, Linux name regex | Child processes (mac/win only) |
| DNS lookup | L7 over L4+L3 | `routes.ts:32 resolveTarget()` → `dns/promises lookup(all:true)` | UDP/TCP port 53 |
| Open TCP | L4 over L3 | `deviceBinding.ts:67 connectRoute()` → `net.connect()` or fd+`SO_BINDTODEVICE` | SYN from chosen source IP, out chosen device |
| TLS handshake | L6 over L4 | `routes.ts:263 RoutedHttpsAgent` wraps raw socket | ClientHello, cert verify vs URL host, session resume |
| HTTP Range GET | L7 | `chunkDownloader.ts:217 attempt()` → `StreamConnection.request()` | `GET /file` + `Range: bytes=s-e`, expect `206` + `Content-Range` |
| Torrent peer | L7 over L4 | `torrentTransfer.ts:247 connect()` hook | BitTorrent handshake, `bitfield`, `have`, `request`, `piece` over TCP (uTP disabled) |
| DHT / tracker | L7 | `webtorrent` client (`engine.ts:66`) | UDP DHT + HTTP tracker announces (default route for magnet probe only) |
| Throttle | L4 backpressure | `limits.ts:111 take()` → `res.pause()` / `socket.pause()` | TCP receive window fills → sender slows. No drops |
| Bridge to browser | L7 loopback | `browserBridge.ts:80 handle()` → `http.createServer` on `127.0.0.1:19288-90` | `GET /ping`, `POST /add`, `POST /confirm` JSON |

### 2.3 Why not a VPN bonder (L3 tunnel)?

VPN bonding (Speedify style) joins packets at L3 inside an encrypted tunnel and needs a relay server on the internet to re-order them. Plexo stays at L7:

- If server speaks `Range` (most do), L7 splitting needs zero server changes.
- If swarm has peers, L7 peer-spreading needs zero swarm changes.
- No relay bill, no extra hop latency, no kernel VPN driver.

Cost: servers without `Range` fall back to 1 stream (no gain for that file). Swarms with 1 peer cannot spread.

### 2.4 One packet's life (HTTP example)

Say Wi-Fi IP `192.168.1.5` fetches `bytes 8000000-15999999` from `example.com:443`:

1. **DNS (L7/L3):** `lookup('example.com',{all:true})` → `[93.184.216.34 (v4), 2606:... (v6)]`.
2. **Route pick (L3):** `routesFor(wifi, ips)` keeps only routes where `local.family == remote.family`. Wi-Fi has v4+v6, so both survive.
3. **Socket (L4):** `connectRoute({device:'wlan0', localAddress:'192.168.1.5', remoteAddress:'93.184.216.34'}, 443)`. On Linux: `socket(AF_INET,SOCK_STREAM)` + `setsockopt(SO_BINDTODEVICE,'wlan0')` + `connect()`. SYN leaves via `wlan0` with source `192.168.1.5`.
4. **Happy Eyeballs (L4):** v4 and v6 attempts stagger 250 ms (`ATTEMPT_DELAY_MS`). First `connect`/`secureConnect` wins; losers destroyed. Winner cached in `lastGoodRoute`.
5. **TLS (L6):** `RoutedHttpsAgent` runs cert verify against `example.com`, caches session for resume.
6. **HTTP (L7):** `GET /file` with `Range: bytes=8000000-15999999` + `Cookie` (if browser session) + `Referer` + `User-Agent`. Reuses keep-alive socket if one is warm (`reusedSocket` → TTFB fast).
7. **Body (L7 over L4):** `206 Partial Content` + `Content-Range: bytes 8000000-15999999/100000000`. Bytes stream → `file.writer(8000000)` at offset 8M. Every chunk passes `limits.take('wifi', n)` → `pause` `wait` ms if over limit.
8. **End:** exact-length check (`downloaded == expected`). `fileStream.end()` → `close` → block `completed`. Mismatch → reject → block back to `pending` for retry. Nothing corrupt is ever marked done.

---

## 3. Code map — processes, folders, trust boundaries

```
plexo/
  src/main/            Node/Electron main. ALL network + disk. No DOM.
    index.ts           window, tray, power, updater wiring
    ipc/handlers.ts    38 typed IPC endpoints (see §21). Owns NetworkMonitor + DownloadManager
    network/           interfaces.ts, deviceBinding.ts, routes.ts, limits.ts
    download/          downloadManager.ts (2022 lines, orchestrator)
                       httpTransfer.ts (1209 lines, multi-stream core)
                       chunkDownloader.ts, scheduler.ts, concurrency.ts, plan.ts,
                       blockProgress.ts, fileVersion.ts, probe.ts, browserContext.ts,
                       downloadFile.ts, sparseFile.ts, paths.ts, history.ts,
                       savedProgress.ts, trashDownload.ts, contentDisposition.ts
      torrent/         engine.ts, torrentTransfer.ts, peers.ts, metadata.ts,
                       files.ts, paths.ts, torrentDestination.ts, ownedFiles.ts
    browserBridge.ts   localhost HTTP server for extension
    openLinks.ts       magnet/.torrent handoff + PendingLink store
    settings.ts        app-settings.json load/save + validation
    jsonFile.ts        atomic JSON read/write helper
    testKnobs.ts       E2E env overrides (ignored when packaged)
  src/preload/         contextBridge only. Exposes window.plexo. No Node leakage.
  src/renderer/        React 19 + Tailwind 4 + Zustand 5. No sockets, no fs.
  src/shared/          types.ts (442 lines, truth), ipc-channels.ts, ipc-contract.ts,
                       browserBridge.ts (shared with extension), dataLimits.ts,
                       downloadSchedule.ts, downloadUpdate.ts, errors.ts
  extension/src/       MV3 bg + popup + options. Talks ONLY via localhost bridge.
  patches/             webtorrent+3.0.21.patch (connect hook, 2 hunks)
  e2e/                 Playwright suite. Uses PLEXO_E2E_* knobs.
```

Trust boundaries (important for security viva):

1. **Renderer cannot touch net/fs.** It calls `window.plexo.invoke(channel, ...args)` → `ipcMain.handle` → main validates and acts. Channel names are the single `IpcChannels` map; arg shapes are `IpcContract` — mismatch = compile error.
2. **Extension cannot touch downloads directly.** Only `POST 127.0.0.1/add` JSON. Host header must be `127.0.0.1:port`, Origin must be `chrome-extension://`/`moz-extension://` or absent (Firefox quirk). `Content-Type` must be `application/json` (pages cannot send that cross-origin without preflight). Body cap 64 KiB.
3. **Browser cookies never touch renderer.** `startDownload` attaches `browser` from `pendingLink(linkId)` in main (`handlers.ts:202`). `pendingLinks()` strips `browser` before sending to UI (`openLinks.ts:65`). On disk they are `safeStorage.encryptString` sealed; on Linux `basic_text` backend they are dropped, not written in clear (`downloadManager.ts:140`).
4. **Paths are never trusted from UI.** `reveal/open/trash` use the download's own stored path + `pathExists` check. Torrent inner paths pass `safeTorrentPaths` (no `..`, no absolute).

Build: `electron-vite dev/build` (aliases `@shared`, `@renderer`), `electron-builder --win/mac/linux/dir`, `node extension/build.mjs` emits `dist/chrome` (service_worker) + `dist/firefox` (background.scripts + gecko id) via Vite IIFE (Firefox cannot load modules).

---

## 4. Finding networks — `network/interfaces.ts` in depth

### 4.1 The one syscall

```ts
import { networkInterfaces } from 'node:os'
const all = networkInterfaces()
// { wlan0: [{address:'192.168.1.5', family:'IPv4', internal:false, netmask:'255.255.255.0', mac:...}], ... }
```

### 4.2 The filter (lines 142-159)

Keep an address only if ALL true:

- `!addr.internal` — drops `127.0.0.1`, `::1`.
- `family IPv4 or IPv6` — drops anything exotic.
- NOT `169.254.*` — IPv4 link-local = DHCP failed, no internet.
- NOT `fe80:*` (case-insensitive) — IPv6 link-local = not routable.

Then map to Plexo shape: `{address, family: 4|6, netmask, subnet?}` where `subnet = ipv4Subnet(address, netmask)` for v4 only. Example: `192.168.1.5 + 255.255.255.0` → `192.168.1.0/24`.

`ipv4Subnet` math (lines 99-116): split to 4 octets, validate 0-255, `subnetParts = ip & mask` per octet, `maskBits = count of '1' in binary mask`. Returns `null` on malformed — caller stores `undefined`, never crashes.

### 4.3 Naming per OS (why three branches?)

Raw device names mean different things per OS:

- **macOS** (`getMacHardwarePortNames`, lines 22-44): `en0` tells you nothing. Runs `networksetup -listallhardwareports` (5 s timeout), parses positional blocks (`Hardware Port: Wi-Fi` line 1, `Device: en0` line 2) **by position, not label** — because a French Mac prints `Matériel`/`WLAN`. Regex `/^[a-z]+\d+$/` rejects trailing VLAN list. Result: `en0→Wi-Fi`, `en6→iPhone USB`. Cached in `labels`, re-read only when device set changes (`devices` string compare, line 133) — because spawning a process every second would be wasteful; addresses themselves are one cheap syscall.
- **Windows** (`getWindowsAdapters`, lines 71-96): runs `powershell.exe Get-NetAdapter | Select Name,InterfaceDescription,NdisPhysicalMedium | ConvertTo-Json`. `Name` (`Wi-Fi`, `Ethernet 2`) matches Node's key and is what users see. `NdisPhysicalMedium`: `1|9 → wifi`, `14 → ethernet` (lines 167-169) — fixes renamed/localized adapters. Failures (locked-down PowerShell) return empty map, downloads continue with raw names.
- **Linux** (`classifyLinuxDevice`, lines 50-56): no lookup exists, but systemd names encode the kind: `^wl → wifi` (`wlp2s0`, `wlan0`), `^usb|^enx|^en\w*u\d → usb` (tether: `enp0s20f0u1`, MAC-named `enx3a...`, `usb0`), `^(en|eth) → ethernet`, `^(br|virbr) → bridge`, else `other`. Generic fallback `classifyInterface` regexes English substrings (`wifi|wlan|rndis|tether|iphone|bridge|ethernet`).

`mac` field: first non-zero MAC, used only for display/debug, never for routing.

`id` = `device` today (`en0`, `wlan0`). Stable per boot, not across reinstalls. Preferences key by it.

### 4.4 Keeping it fresh — `NetworkMonitor` (lines 191-224)

```ts
POLL_MS = 1000
constructor(onChange) { refresh(); setInterval(refresh, 1000).unref() }
refresh() { serialized chain; JSON-compare; onChange only on change }
```

Why poll? No OS tells a process “phone plugged”. So look every second. Chain via `this.polling` so a slow `networksetup` never overlaps the next. `JSON.stringify` compare is cheap (few interfaces). First `refresh()` runs in constructor; `current` is `null` until it lands — `reconcile` treats `null` as “nothing known gone yet”.

Wiring (`handlers.ts:74-79`): on change → `manager.networksChanged()` (re-pin streams) + `webContents.send(networksChanged, list)` (repaint UI). Manual `listInterfaces` IPC forces `refresh()` now.

Test seam (`testKnobs.ts:47`): `PLEXO_E2E_INTERFACES=a=127.0.0.1,b=192.168.1.5` replaces the real list; tests rewrite `process.env` mid-download to fake unplug. Ignored in packaged builds.

---

## 5. Pinning sockets — `deviceBinding.ts` + `routes.ts` in depth

### 5.1 The problem in one paragraph

Your OS has a routing table: “to reach the internet, use Wi-Fi gateway”. If you `connect({localAddress: phoneIP})` on Linux, packets still leave via Wi-Fi (default route) with a phone source IP — the phone network drops them (ingress filter / no such host). macOS/Windows consult source address when picking egress; Linux does not. Fix on Linux: `SO_BINDTODEVICE` — bind the socket to the device name itself (`wlan0`), not just its IP.

### 5.2 The constants (deviceBinding.ts:10-15)

```ts
AF_INET=2, AF_INET6=10, SOCK_STREAM=1, SOCK_CLOEXEC=0o2000000
SOL_SOCKET=1, SO_BINDTODEVICE=25
```

`SOCK_CLOEXEC` = close fd on `exec`, so child processes never inherit download sockets.

### 5.3 Support probe (lines 42-64)

```ts
deviceBindingSupported(): true off-Linux immediately.
On Linux: koffi.load('libc.so.6') -> wrap socket/setsockopt/close/errno
  -> openOnDevice('lo', 4) -> close. Success => libc cached, true.
  EPERM (kernel <5.7 needs privilege) or missing koffi => warn + false.
```

Memoized in `support` promise. Called at startup (`handlers.ts:89`) so it settles before first download. Until then everything falls back to `localAddress` only.

### 5.4 Making a pinned socket (lines 28-39, 67-91)

```ts
openOnDevice(lib, device, family):
  fd = socket(family==6?AF_INET6:AF_INET, SOCK_STREAM|SOCK_CLOEXEC, 0)
  if fd<0 throw errno
  if setsockopt(fd, SOL_SOCKET, SO_BINDTODEVICE, device, len+1) != 0:
    close(fd); throw `Couldn't bind to ${device} (errno ${errno})`

connectRoute(route, port):
  if (!libc || loopback [127.* / ::1]) return connect({host, port, localAddress, family})
  try fd = openOnDevice(libc, device, family)
  catch -> return destroyed Socket surfacing error like any connect failure
  return new Socket({fd, manualStart:true}).connect({host, port, localAddress, family})
```

Three subtleties:

1. **Both device AND source IP** (`localAddress` still passed): an interface can hold several IPv6 addresses; device alone leaves source ambiguous.
2. **`manualStart:true`**: a `Socket` wrapping an fd starts reading immediately, before `connect()` — that would drop early bytes. Manual start holds it.
3. **Loopback bypass**: binding to `lo` for tests / local servers is pointless; plain connect is faster and never EPERMs.

### 5.5 Routes model (routes.ts:15-64)

```ts
NetworkRoute = { device, localAddress, remoteAddress, family }
routesFor(iface, remoteAddresses): every local×remote pair with matching family.
compatibleInterfaces(ifaces, remotes): ifaces with ≥1 route.
targetHost(url): strip [] from IPv6 literal.
```

Family matching is the IPv6 gate: a v4-only tether yields zero routes to a v6-only host → `NoCompatibleRouteError(host)` → that network is skipped / failed, not retried forever.

### 5.6 DNS with a deadline (lines 89-117)

`resolveTargetWithin(host, timeoutMs, signal)`: `lookup(name,{all:true,order:'verbatim'})` (preserves OS/DNS order) raced against `setTimeout` + `AbortSignal`. IP literals skip DNS. Why bounded? DNS is part of connect; a hanging resolver must not outlive the stream's stall budget. Used at `start()` to pre-check `usable` networks (`downloadManager.ts:963`) and inside every `connectOnInterface`.

### 5.7 Happy Eyeballs RFC 8305 (lines 121-235)

Problem: host has A + AAAA; v6 path may be blackholed (phone with no v6). Waiting full timeout costs seconds.

```ts
ATTEMPT_DELAY_MS = 250  // == Node autoSelectFamilyAttemptTimeout
lastGoodRoute: Map<`${iface.id} ${host}:${port}`, `${local} ${remote}`>
attemptOrder(routes, preferred): preferred first, then interleave families round-robin (v4,v6,v4,v6... per §4)
connectOnInterface(iface, host, port, secure, timeoutMs, signal):
  found = routesFor(iface, await resolveTargetWithin(...))
  if empty throw NoCompatibleRouteError
  race: launch route[0] now; stagger timer launches next every 250ms unless prior failed (then immediate handover)
  secure? wrap tcp in TLS BEFORE racing done — a hanging TLS handshake loses like a hanging TCP SYN
  events: 'connect' (plain) or 'secureConnect' (TLS) wins; 'error' on EITHER socket or raw tcp (refused often surfaces on raw) drops that attempt
  finish: destroy all losers (both tcp + wrapper), resolve winner / reject lastError, clear timers, detach abort listener
  remember winner in lastGoodRoute; on error delete stale memory
```

Cost of a dead address: 250 ms, not 10 s. Benefit of memory: second block on same host starts at the working route.

### 5.8 `StreamConnection` — one stream's kept-alive lane (lines 300-418)

Each HTTP worker owns one `StreamConnection(networkGetter, {timeoutMs, connectTimeoutMs, resolveHost})`:

- Holds `lifetime AbortController` + `http: RoutedHttpAgent` + `https: RoutedHttpsAgent`, both `keepAlive:true`.
- `RoutedHttpAgent.createConnection(opts, cb)` → `open(opts, null)` → `connectOnInterface(...)`. `RoutedHttpsAgent` → `open(opts, sock => super.createConnection({...opts, socket:sock}))` — so Plexo picks the TCP, Node still does cert verify + TLS session cache/resume.
- `request(target, headers, signal)`: builds `GET` opts (`hostname` unbracketed, `port`, `path`, `agent`), `req.end()`, response-header timeout `timeoutMs` (default `stallTimeoutMs` 20 s, connect slice `connectTimeoutMs` 10 s — “can't get through” is found before “slow server” would be). `connectSignal` = `any([lifetime, per-request])` so abandoning a stuck connect (refresh) kills its handshake.
- Stale-keepalive retry: server may RST an idle pooled socket; first use fails with `req.reusedSocket==true` → one automatic retry on a fresh socket (the retry Node documents). Only once (`retryStale` flag), only if not timed out/aborted.
- Errors mapped via `asConnectionError` — EXCEPT `AbortError` and `NoCompatibleRouteError` pass through (they mean “told to stop” / “wrong network”, not “network broken”).
- `reconnect()`: `agent.destroy()` both — next request dials anew. Used on address change / wake from sleep. Stays usable. `close()`: abort lifetime + destroy — terminal.

Why keep-alive matters: DNS + TCP 3-way + TLS 1.3 + TCP slow-start paid once per stream, not per 8 MB block. `TTFB + reusedSocket` is reported per response (`onResponse`) for `PLEXO_DEBUG` diagnosis.

---

## 6. Probe — “can we split it?” (`probe.ts` in depth)

### 6.1 Why `GET bytes=0-1023`, not HEAD, not 1 byte (lines 35-73)

- `HEAD` lies: many hosts answer `Accept-Ranges: bytes` on HEAD but ignore `Range` on GET. Only a real `206` proves splitting works.
- `bytes=0-0` / `0-1` lies the other way: some hosts (#101) serve the whole file with `200` for tiny ranges but honor real chunk ranges. `0-1023` is big enough to get an honest `206`.
- Body is destroyed after headers (`res.destroy()`): costs ~1 KiB, not the file.

Timeout: whole probe (redirects included) shares `PROBE_TIMEOUT_MS = stallTimeoutMs (20 s)`. A chain of slow hops cannot stretch it.

### 6.2 Redirect + 403 dance (lines 91-119)

Loop `≤ MAX_REDIRECTS (5)`: `requestFirstBytes` → if `403 && ranged` → retry once **without** `Range` (#131: hosts that forbid any Range but serve full file). Then if `3xx + location` → `new URL(location, current)` and continue (relative resolved). Else break.

`requestHeaders(url, browser)` is rebuilt per hop: session `Cookie` never leaks to next host (CDN), but same-domain cookies follow within it. See §18-adjacent `browserContext.ts`.

### 6.3 Five outcomes

1. **`magnet:`** → `fetchMagnetMetadata` → `describeTorrent` (no HTTP at all).
2. **Local `.torrent` path** (`isAbsolute + .torrent`) → `readTorrentFile` → `describeTorrent`.
3. **`416 + Content-Range: bytes */0`** → valid empty file (`totalBytes:0, supportsRanges:false`). Empty has no byte 0, so `0-` can never `206`.
4. **Torrent link** (`Content-Type: application/x-bittorrent` or path `.torrent`) → `downloadTorrentFile` (fetch ≤10 MB cap) → `describeTorrent`.
5. **HTTP file**: `supportsRanges = (status==206)` — `Accept-Ranges` header is **ignored** deliberately. `totalBytes`: from `Content-Range: .../N` on 206; else `Content-Length` on 200 only (on 206 that length is just the 1 KiB sample). `suggestedFileName`: `Content-Disposition: filename=` (RFC-parsed) else last URL path segment else `'download'`. Plus `contentType, etag, lastModified` for versioning.

`≥400` (or no response) throws `Server responded with status X` — surfaced via `describeError` in UI.

---

## 7. Plan — cutting the file (`plan.ts` in depth)

Pure functions (no I/O, no clock) — unit-testable against exact cases.

```ts
DEFAULT_MAX_BLOCK_BYTES = 8 MiB   // tail cost cap: hedge re-fetches whole block, so last block size = max stall
MIN_BLOCK_BYTES = 1 MiB           // below this, request overhead beats splitting
START_STREAMS_PER_NETWORK = 8     // IDM/XDM convention
MAX_STREAMS_PER_NETWORK = 32      // far server caps per-connection ~1 MB/s; 32 overcomes it; refusals push back (see §13)
BLOCKS_PER_STREAM = 2             // MUST exceed streams: else slow stream holds its only block while others idle
```

`planDownload({totalBytes, splittable, networkCount, maxBlockBytes?})`:

- `!splittable || totalBytes<=0` → `{blockSize: totalBytes, count:1}` (single open-ended block).
- Else `targetBlocks = networks × 32 × 2`, `blockSize = clamp(ceil(total/target), min(MIN, max), max)`, `count = ceil(total/size)`.

Worked examples:

| File | Nets | Target | Size | Blocks |
|------|------|--------|------|--------|
| 1 GB | 2 | 128 | 8 MB (capped) | 128 |
| 100 MB | 2 | 128 | 1 MB (floor: 100/128<1) | 100 |
| 5 MB | 1 | 64 | 1 MB | 5 |
| unknown / no-range | * | — | whole | 1 |

`planBlocks(total, size)`: `[{index, rangeStart:i*size, rangeEnd:min(start+size,total)-1, status:'pending', bytesDownloaded:0, bytesByInterface:{}}]`. Unknown → single `{0,0,null}` open-ended.

`planPieces(total, pieceLength)`: same geometry but torrent-owned, plus `provisionalBytes:0` (unverified live bytes kept apart from durable progress).

`startingStreams(waiting, networkCount, requested=8)`: `max(1, min(clamp(requested,1,32), ceil(waiting/networks)))`. Near end / small file: fewer (no idle streams), but never zero (joining net must still hedge). `testStreamsPerNetwork()` / user pick overrides.

`interleave(items, groupOf)`: round-robin by network of first appearance (`a,b,a,b…`). Used when starting streams so a small file spreads across networks instead of all-Wi-Fi-because-Wi-Fi-listed-first.

---

## 8. Fetching one range (`chunkDownloader.ts` in depth)

`downloadChunk(opts)` contract: **resolve = entire requested range written, nothing else. Anything else = reject** (block returns to queue; never marked done corrupt). All corruption guards exist because bytes land at fixed file offsets — a short/shifted/overlong body would poison neighbors, not just this chunk.

Inputs: `url, browser?, rangeStart, rangeEnd|null, wholeFile?, connection, createDestination()=>Writable, onNetworkProgress, onProgress, onWriteWait?, signal, acceptedVersions, onResponse?, throttle?`.

### 8.1 Range header (lines 210-215)

```ts
range = !(wholeFile && start==0) && (start>0 || end!==null)
  ? {Range: end===null ? `bytes=${start}-` : `bytes=${start}-${end}`}
  : {}
```

Whole file from 0 sends **no** `Range` (some servers 403 any Range; empty file would 416 on `0-`).

### 8.2 Request cycle (lines 217-389)

1. `connection.request(url, {...requestHeaders(url,browser), ...range}, signal)` → `{req, res, sentAt}`. Up to 5 redirects followed (`new URL(location, target)`); missing `location` or exhausted → `Too many redirects`.
2. Status check: `206` always ok. `200` ok **only if `rangeStart==0`** (else server ignored Range and would write file-start bytes into mid-file slot). Else `HttpStatusError(status, retryAfterMs)` with `transient = [408,429,500,502,503,504].includes(status)` (curl `--retry` set).
3. Version check **before any write**: `versionOf(res)` = `{etag, lastModified, totalBytes: from Content-Range total, or Content-Length if 200}` vs `compareVersion(acceptedVersions, seen)` → `RemoteChangedError` unless `same`. Nothing from this response was written — caller decides same-bytes-relabel vs new file.
4. `Content-Range` shape check on 206: must parse `bytes s-e/total`, `s == rangeStart` else `wrong range`, `e <= rangeEnd` (if bounded) else `more than requested`. Missing/malformed → reject.
5. `onResponse({ttfbMs: now-sentAt, reusedSocket})` for debug + lastBlockSpeed later.
6. `createDestination()` = `file.writer(blockStart+startOffset)` (`flags:'r+', start`) — separate fd per attempt, explicit offset, never append.
7. Arm stall watchdog `resetWatchdog()` (20 s, reset on every `data`; paused while disk/throttle holds — see below).

### 8.3 Body pump — hand-rolled, not `.pipe()` (lines 321-382)

Why hand-rolled? To **cut overlong bodies at the boundary**: `usable = chunk.subarray(0, remaining)`; if `usable < chunk` → `Server sent more data than requested` fail. Pipe would overwrite the next block.

Per `data`:

- `resetWatchdog()`.
- `remaining = expected==null ? len : expected-downloaded`; slice; if `usable>0`: `bytesDownloaded+=`, `onNetworkProgress(totalThisRun)` (counts even while disk-held — for liveness/speed), `fileStream.write(usable, cb=> cb?fail: onProgress(totalThisRun))` (counts only on durable accept — for resume frontier).
- Backpressure: `write()` returns false (buffer >512 KiB) → `onWriteWait(true)`, `hold()` (`holds++`, `clearWatchdog`, `res.pause()`), on `drain` → `onWriteWait(bodyEnded)`, `release()` (`holds--`, re-arm, `resume`). Disk-full/slow never looks like network-slow.
- Throttle: `wait = throttle(len) = limits.take(net, len)` → `hold(); setTimeout(release, wait)`. TCP window fills while paused → sender slows (§18).
- `end`: if `expected!==null && downloaded!==expected` → `returned X bytes for Y-byte range` fail. Else `bodyEnded=true`, `fileStream.end()`, on `close` → resolve. `finish` on Windows waits for handle close (else reopen/rename races).

`fail()`: `req.destroy()`, then flush-or-destroy writer: if not errored/closed, `stream.end()` and reject on `close` (buffered bytes were range-checked, so they count; next attempt resumes after them) — else `destroy()`. Prevents fd leak (pause+resume cycles would hit open-file limit) and post-retry overwrite.

Abort: `signal` (`any([streamController, attemptAbort])`) → `fail(AbortError)` — distinguished from failures (no retry counted, see `finishAborted`/`finishStopped`).

### 8.4 `fetchRange` (lines 393-430)

In-memory `start..end` fetch + `{body, version}` — for `compareSamples` (§9). Same redirect logic, strict `206 + served.start==start` else reject, `STALL_TIMEOUT_MS` via `res.setTimeout`.

`retryAfterMs(value)`: seconds (`123`) or HTTP-date → ms from now, `null` if absent/unparseable. Capped `RETRY_AFTER_MAX_MS 120 s` at use site.

---

## 9. File versions — catching “server swapped the file” (`fileVersion.ts`)

```ts
FileVersion = { etag|null, lastModified|null, totalBytes (0=unknown) }
normalizeEtag: trim, strip W/, strip quotes, strip -gzip/-br/-deflate/-zstd suffix (Apache variants)
compareVersion(accepted[], seen):
  size differs (both known, unequal) -> {kind:'size'}      // PROOF of change
  seen.etag vs accepted etags (normalized) mismatch -> {kind:'validators', detail}
  else seen.lastModified vs accepted dates mismatch -> {kind:'validators'} // HINT only
  else {kind:'same'}
```

Why hint vs proof? Load balancers label identical bytes differently per node. So `validators` triggers `confirmSameBytes`: re-fetch up to `MAX_SAMPLES (8)` × `SAMPLE_BYTES (16 KiB)` spread across blocks with data, `SAMPLE_TRIES (4)` each to land on the new-label node, compare bytes on disk vs remote (`compareSamples`, `httpTransfer.ts:230`). Verdicts: `same` → push `seen` into `acceptedVersions`, retry immediately (nothing bad written); `different` → `failDownload(msg, discard=true)` and stop ALL workers now (each would burn retries); `unknown` (nothing to compare / fetch failed) → ordinary retry.

`relink` (§15) runs the same comparison before accepting a replacement URL.

---

## 10. Block frontier — the one rule that prevents double-count (`blockProgress.ts`)

`bytesDownloaded` = **frontier**: how much from block start is secured — `max`, NOT sum. Two racing attempts re-fetch overlapping bytes; summing would credit twice and publish short.

Only three mutators (invariant: `sum(bytesByInterface) == bytesDownloaded` always):

- `advanceBlock(block, net, position)`: `next=min(position,len)`, `gained=next-downloaded`, if `>0`: `downloaded=next`, `credit(net,gained)`. Returns gained. Called on every writer callback (`onAttemptProgress`) and on completion top-up.
- `retractBlock(block, position, blamed?)`: `removed=downloaded-position`, if `>0`: `trim(block,position,blamed)`, `downloaded=position`. Used when a new primary starts after a partial (`keep=max(startOffset, otherAttemptsPos)`) — discards tail bytes the loser may still append.
- `trim(block, keep, blamed)`: `excess=attributed-keep`; take from `blamed` first, then others, deleting zeroed keys. Lost bytes are always tail, so blamed-first is exact.

UI colors `BlockGrid` from `bytesByInterface` — a block split across networks shows split.

---

## 11. Scheduler — who fetches what (`scheduler.ts` in depth)

Pure: `(snapshot, requester, now, policy) → {kind,block}|undefined`. No I/O, no own clock.

```ts
SchedulerState = { blocks, streams{id,interfaceId,status,speed}, attempts:Map<idx,AttemptView[]>,
                   avoid:Map<idx,net>, hedgesUsed:Map<idx,n>, diskBehind? }
Policy = { hedgeAfterMs:2000, maxHedgesPerBlock:2, startupMs:1000 }
Requester = { id, networkId, speedBytesPerSec? (last finished block) }
```

**Primary** (`nextWaitingBlock`): first `status=='pending'`, EXCEPT a block whose last attempt on this net delivered nothing (`avoid.get(idx)==net`) is skipped while any other net has a `pending` stream free. Prevents a dead net's streams hogging the same block while healthy nets idle. If no other net is free, take it anyway (never strand).

**Hedge** (`nextHedgeTarget`): only if (ALL must hold):

1. No `pending` block exists anywhere (hedges never steal bandwidth from real work) AND `!diskBehind` (hedge = extra writes).
2. Block `downloading`, `rangeEnd!==null` (bounded), has ≥1 `primary` attempt in flight (nothing to race if all let go — it returns to queue instead).
3. Requester not already on it; `hedgesUsed < 2`; `avoid.get(idx) != requester.net`.
4. Every attempt older than `hedgeAfterMs` (speeds need time to mean something).
5. No attempt `writeWaiting` (disk-paced holder cannot be beaten by network).
6. `remaining = len-downloaded > 0`.
7. `ETA = min_over_attempts(remaining/speed)` where speed = that stream's live `speedBytesPerSec` (0 → `Infinity` = “quiet holder has no finish time”). Worth it iff `requester.speed ? ETA ≥ 2×(startup + remaining/requesterSpeed) : ETA ≥ hedgeAfterMs`. I.e. hedge must clearly finish in under half the holder's time; unknown-speed requester races only blocks needing ≥2 s more.
8. Cross-network preference: if holder's net == requester's net AND some other net has a free non-avoided stream, defer (other net gets first go — slowness may be the net, not the socket).
9. Among survivors pick **largest ETA** (most-worth-racing first).

`pickWork`: primary if any, else hedge if any, else `undefined` (worker idles `IDLE_POLL_MS 250 ms` and retries while blocks remain in flight — covers fail-back and slow-enough-to-race transitions).

---

## 12. `HttpTransfer` — the multi-stream engine (`httpTransfer.ts`, 1209 lines)

### 12.1 State per download

- `chunkRuntimes: Map<streamId, ChunkRuntime>` — `controller` (kill whole stream), `wait` (backoff sleep cut by stop), `nudge` (cut backoff only, replaced after use), `connection` (kept-alive lane), `attempt` (current or null), `warmSince/slowSince` (crawl judging), `lastBlockSpeed` (ETA math + scheduler), `receivedBytes` (incl. duplicates, for `answered`), `failures` (backoff chain), `strikes` (server-said-no chain), `busySince` (transient window), `refused/served` (concurrency signals, cleared each tick), `retiring` (draining).
- `workers: Map<id, Promise>` — run loops; `running()` is what `run()` awaits.
- `attempts: Map<blockIdx, Attempt[]>` — in-flight (1-3: primary + ≤2 hedges).
- `avoidNetworkByBlock`, `hedgesByBlock`, `refreshesByBlock` (cap 2), `traffic: Map<net,{received,aliveAt}>`, `holdUntil: Map<net, timestamp>` (Retry-After), `concurrency: ConcurrencyController|null`, `disk: DiskWatch`, `acceptedVersions: FileVersion[]`, `reconciled: Map<net,status>`.

Tuning: `MAX_CHUNK_RETRIES=5`, `RETRY_BASE 1 s → ×2 ±20% jitter (gRPC style, avoids thundering herd) → cap 15 s`, `UNREACHABLE_RETRY 5 s` (one probing stream asks often), `SERVER_BUSY_FOR 5 min` (transients waited out however many retries), `RETRY_AFTER_MAX 120 s`, `SILENT_AFTER 5 s`, `SLOW_RATIO 0.1, SLOW_WARMUP 5 s, SLOW_FOR 10 s`, `MAX_REFRESHES_PER_BLOCK 2`, `IDLE_POLL 250 ms, REFRESH_HANDOFF 300 ms`, all E2E-overridable via `PLEXO_E2E_*` (`testKnobs.ts`).

### 12.2 Worker loop (`runWorker`, lines 1098-1188) — pseudocode

```
make ChunkRuntime + StreamConnection(()->host.networks.find(netId))
loop while state==downloading and not retiring/aborted:
  if holdUntil[net] in future: goIdle, status=retrying, backOff(hold + jitter); continue
  work = pickWork(snapshot{blocks,streams,attempts,avoid,hedges,diskBehind}, {id,net,lastBlockSpeed}, now, POLICY)
  if !work:
    goIdle
    if any block pending/downloading: scheduleUpdate; delay(250ms, wait); continue  // stay for fail-back/hedge
    else: status=completed; break
  attempt = beginAttempt(chunk, self, work)   // atomic: lease block, register, paint stream
  outcome = executeAttempt(...)                // await downloadChunk; never throws (maps to outcome)
  next = finishAttempt(...)                    // apply; finally endAttempt (idempotent deregister)
  if next==stop: break
close connection
```

### 12.3 Attempt execution (lines 686-753)

- Primary: `startOffset = supportsRanges ? block.bytesDownloaded : 0`; `keep = max(startOffset, otherAttemptsPos)`; `retractBlock(block, keep, previousWriter)` + `recomputeAggregates` if trimmed. Hedge: `startOffset = block.bytesDownloaded` (no retract — it must not disturb primary's frontier).
- Already-whole (`startOffset >= len`): primary → `completed` (idempotent), hedge → `aborted:lost`.
- `startedAt=now`, `downloadChunk({rangeStart:blockStart+offset, rangeEnd, wholeFile:!supportsRanges, createDestination:()=>file.writer(...), throttle:b=>host.limits.take(net,b), ...})` with progress hooks: `onNetworkProgress` → `traffic.received/aliveAt`, `meters.add`, `unreachable→on` flip + `failures=0`; `onProgress` → `disk.landed`, `advanceBlock` frontier + incremental `state.bytesDownloaded += gained` (O(1) fold, not O(blocks) re-sum; rare paths re-derive truth via `recomputeAggregates` so drift cannot accumulate).
- Outcome mapping: controller fired or status left `downloading` → `stopped`; `abortReason` set → `aborted`; elseante → `failed(error)`.

### 12.4 Finishing (lines 788-1019)

- **`completed`**: if block already `completed` (rival won) → `letGo surplus`. Else `endAttempt`, `status=completed`, square up (`advanceBlock(len)` + `lastBlockSpeed = networkReceived/(lastNetAt-started)`), clear failures/strikes, abort rivals `lost`, `recomputeAggregates`, update.
- **`stopped`** (pause/cancel/retire): `letGo`, paint `paused/cancelled`, return `stop`.
- **`aborted:lost`** (rival won): `letGo`, touch nothing (block no longer ours). **`aborted:refresh`** (stuck-swap): `letGo(remember-avoid iff delivered nothing)`, update, `delay(REFRESH_HANDOFF)` so a proven-fast stream grabs the block first, reset warm/slow clocks.
- **`failed`**: the decision tree —
  1. `RemoteChangedError`: `size` → `different` immediately; else `confirmSameBytes` (may await; re-check status after — paused meanwhile → `finishStopped`). `same` → accept label, `letGo`, `continue`. `different` → `failDownload(discard=true)` (stop all now, drop bytes) + `finishStopped`. `unknown` → fall through to ordinary retry.
  2. `NoCompatibleRouteError` (redirect to unreachable family): `letGo(avoid iff nothing)`, `failNetwork` (that net stops), return `stop` (this stream's work is done; another net picks the block).
  3. `ConnectionError + markUnreachable` (whole net quiet `SILENT_AFTER` while others serve): flip net, `host.reconcile()`. Retried indefinitely while net exists — connection failure is the net's news, not the server's.
  4. Hedge failure: `letGo(avoid iff nothing)`, `continue` (optional work: never retried, writes stay).
  5. Primary: `retries++` (if net `on`), reset `failures` if any network bytes, reset `strikes/busySince` if any written bytes, `failures++`, `letGo(avoid iff nothing)`.
  6. Give-up: non-connection error, `++strikes > 5`, not within `SERVER_BUSY_FOR` of first transient → `retiring=true`; if net has no live streams left → `failNetwork`. Else backoff: `retryDelayMs(failures)`, min-capped 5 s if unreachable, max-raised to `Retry-After` (capped 120 s) + `holdUntil[net]=now+asked` (all that net's streams hold). Paint `retrying`, `backOff`, then re-check status (paused meanwhile → `stop`), `goIdle`, reset warm/slow.
- `letGo`: `endAttempt`, primary+still-`downloading` → back to `pending`, `avoid.set` iff delivered nothing, `goIdle` (clear `currentBlockIndex/hedge`, speed 0).

### 12.5 Reconcile — streams ↔ networks (lines 332-380)

```ts
canSplit? usable = status on|unreachable : usable.slice(0,1)   // unsplittable: first able net only
joining = on-nets newly seen or with zero live streams (aliveAt=now)
starting = canSplit ? startingStreams(pendingCount, joining.length, testUserPick) : 1
per net: target = not-running?0 : unreachable?1 : joining? max(live, min(starting, concurrency.limit(net))) : live
retire excess (ranking: refused first, then failed, then newest), start missing (kept pre-pause streams restart by id)
start order = interleave(toStart, byNet)  // fair spread for small files
```

Retiring costs nothing: bytes stay, next taker resumes from frontier.

### 12.6 Stuck-connection refresh (lines 519-597) — crawl vs silent

Skipped entirely if `!supportsRanges` (reconnect would restart whole file from 0).

Per stream with live attempt (not aborted, not `writeWaiting` — disk-paced says nothing about net):

- **Silent**: `networkReceived==0 && now-started≥5 s && some OTHER block has bytes>0` (quiet origin is just slow until something proves serving). If whole net silent (`now-aliveAt≥5 s`) → `markUnreachable` + `host.reconcile()`. Silent-while-others-served also sets `refused=true` (some servers shed excess by stalling — counts as connection limit signal).
- **Crawling**: warm (`now-warmSince≥5 s`); reference = median of same-net peers' live speeds + their `lastBlockSpeed`s (own included — covers tail + single-stream nets; never cross-net — cellular is meant to be slower); if `speed < 0.1×median` persist `slowSince`, refresh after 10 s continuous.
- Hedge attempts only dropped, never counted; primary capped 2 refreshes/block (bounds stale-reference waste).

`tick(now)`: `refreshStuckConnections` → `host.reconcile()` → `concurrency.tick(snapshot)` → `adjustStreams` → clear per-tick `refused/served`.

---

## 13. Concurrency — how many streams (`concurrency.ts`, rule-by-rule)

Philosophy (header comment): like Gopeed/aria2 — no timers, no speed comparisons, so flaky-net noise cannot move it. Pure `tick(snapshot)→Action[]`.

- **Grow**: all live streams `answered` (received ≥1 byte ever) and none `refused` this tick and disk keeping up and `streams>0` → `add min(streams, ceiling-streams, spareWork)`. I.e. double up to cap, only if waiting blocks could keep newcomers busy. Starts at 8, caps 32 (or user pick = fixed, `grows=false`, still capped by refusals/disk/share).
- **Refuse**: `refused>0 && served>0` (server answered some, turned others away: 403/429/503 or silent-while-served) → `ceiling = max(1, min(streams-refused, oldCeiling))`, `since=now`. Means “server wants fewer from this source IP”. Retire to ceiling immediately. Recover `+1 per RECOVER_MS (60 s)` with zero refusals, up to max (Surge-style: brief illness costs little, real cap costs a refusal/minute). Only refused streams count — other failures / unanswered-yet are not refusals.
- **Busy-but-silent** (server sends nothing at all): not a connection limit — waited out / reported via `finishFailed`; count frozen, no growth.
- **Disk**: `DiskWatch.sample(writing, held)` per tick → `behind` iff majority held AND a write landed within `DISK_STALLED_MS (500 ms)` (a totally stalled disk reads `unknown` — fewer streams would not wake it); `keeping-up` iff minority held; `unknown` iff nothing writing. While `behind ≥ DISK_PATIENCE_MS (500 ms)`: no growth anywhere; cap every net at `ceil(maxStreams/2)` (whole-download decision — per-net would punish only the fast net whose streams fill writers). Cap doubles per `DISK_RECOVER_MS (10 s)` of keeping-up at cap, released at max. User pick still capped (disk is physical).
- **Share**: `downloadsOn(net)` counts running Auto splittable downloads with net `on` (this one included); each gets `floor(32/sharers)` — 4 downloads share 32, not 128. Starting one retires others' excess; ending one lets them regrow. Fixed-pick + unsplittable take no share.

`limit(net) = min(maxPerNetwork, share, serverCeiling, diskCap)` — also caps joining burst.

---

## 14. Speeds, ETA, charts (`transfer.ts`)

- `Meter`: `add(bytes)` accumulates; `read(now)` pushes `{total,now}`, drops readings older than `SPEED_WINDOW_MS (3 s)`, returns `(total-oldest)/max(elapsed,1 s)`. Read **only on tick clock**, never on arrival — arrival-sampled rates swing with socket-burst timing (7 MB/s limit read 6.9 in tests).
- `Meters`: per-connection + per-network maps (network's own counter survives stream churn).
- `updateSpeeds(runtime, now)` (only place speeds are read): per stream/peer (0 unless `downloading/receiving`), per net, total; plus upload side for torrents. Returns changed-flag to skip UI spam.
- `updateTimeLeft`: `smoothTimeLeft(prev, elapsed, remaining/speed)` — Firefox formula per-second: count down between estimates; jump to estimate if `expected≤0` or `estimate ≤ expected/2` (start/resume pickup); else move `30%` down / `10%` up per second (speed-ups show at once, wobbles do not add minutes). `undefined` when size 0 or speed 0.
- `clearSpeeds`: all zeros / `undefined` on pause/stop.
- `sampleSpeeds` (1 Hz): push each net's speed into `speedHistory[net]` (60 slots, `SPEED_HISTORY_SECONDS`); newborn nets backfill zeros so series align for `ThroughputChart` stacked areas.
- `samplePeak`: sliding 5 s (`PEAK_SECONDS`) byte-window (readings carried across pauses by shifting times — short runs between pauses still count, as AVG does); `peak = max(peak, held, average)` where `average` floors it past 5 s of downloading (peak can never read below AVG). Unfinished-soon downloads get start-to-finish speed at publish.

---

## 15. `DownloadManager` — the orchestrator (`downloadManager.ts`, 2022 lines)

### 15.1 Runtime shape (lines 74-118)

`DownloadRuntime = HttpDownloadRuntime | TorrentDownloadRuntime` = `TransferTarget` (state + requestPayload + blocks/pieces + file + meters + stop) + `transfer` + `RuntimeFields`: `publicationPath/Identity` (crash-safe publish intent), `runPromise/cancelPromise`, `scheduleStopping`, `publishing`, `pushScheduled` (200 ms coalesce), `persistenceTimer/checkpointQueued/persistenceChain` (15 s checkpoints, serialized), `removed`, `sentUpdates/sentUnits` (delta-IPC), `lastSwitchedOff/pausedForNoNetwork`, `speedSampledAt/peakReadings/fileChoices` (torrent race guard).

Persisted manifest (`version:7`): `{savedAt, partialPath, publicationPath/Identity, requestPayload (+sealed browser), state minus blocks/streams (or pieces/peers), progress: Record<net, number[]>, complete:bool}` in `~/userData/downloads/<id>/manifest.json` (+ `metadata.torrent` for torrents). Cookies sealed via `safeStorage.encryptString→base64` (lines 140-151); dropped (not cleartext) when keychain unavailable / Linux `basic_text`.

### 15.2 `start()` — birth (lines 898-1023)

1. `await initialization` (restore + limits + settings). Sanitize `browser` via `browserContextFrom` (extension-shaped only).
2. `networks.refresh()` now; `selected = available ∩ interfaceIds`; zero → `Select at least one network`.
3. **Torrent**: `probedTorrentFile(infoHash)` (LRU-8 from probe; else `Add the torrent again`) → `describeTorrent` → `planPieces` → `choosePieces` skipped-bytes → `ensureDiskSpace(total-skipped)` (`statfs().bavail*bsize`, else `Not enough disk space: needs X but Y free`) → `TorrentDestination.create(destinationDir, suggestedName, folder?, ...)` claims free name → save `.torrent` → state (`networks: all available, enabled=selected`, `peers:[]`, `files: choiceOf`, `skippedBytes`, `startedAt`).
4. **HTTP**: `resolveTargetWithin(host)` → `compatibleInterfaces(selected, ips)`; zero → `NoCompatibleRouteError`. `planDownload({total, splittable, nets: usable.length})` → `planBlocks` → `ensureDiskSpace(total)` → `reserveDestinationPath` (free name now) → `networks: available→newHttpNetwork(enabled=usable)`; if `!splittable` force single: keep only `usable[0]` enabled, rest `off`. State gets `blockSizeBytes, totalBlocks, fromBrowser?`.
5. Queue-or-run: `room = running<downloadsAtOnce && scheduleAllows`; else `enqueue` (back: `queuedAt=max+1`; `pausedAt` set so wait is not counted as downloading). `scheduled` flag stamped. `runtimes.set`, `persistNow`, `pushUpdate`, `begin` if room.

### 15.3 `begin / pause / resume / relink` (lines 1025-1247)

- `begin`: refuse if suspending/schedule-closed (re-enqueue). Stamp `scheduled`, `status=downloading`, clear queue/error/resumable/no-network flags. If no net enabled (all switched off): re-enable `lastSwitchedOff` if present else first present else first. Reset `failed/unreachable→on`. Shift `pausedAt→totalPausedMs`. Reset `downloading→pending` units + streams/peers, `transfer.reset()`, `pushUpdate`, `launch` (`runPromise=run().finally(pump)`).
- `pause(id, forSchedule?)`: queued → unqueue to paused (schedule keeps queued intent: awaits run, returns). Downloading (unless publishing) → `status=paused (+scheduled=undefined unless schedule)`, `pausedAt=now`, `clearSpeeds`, streams→`paused`, units→`pending` (+torrent `provisional=0`), `transfer.reset()`, `stopRun` (abort stop + transfer), `pushUpdate`, await run end, `persistNow`, clear `scheduleStopping`, `pump()`.
- `resume(id)`: only `paused` or (`error` + `resumable!==false`), not cancelling → `resumeAfterVerifying(false)`: await old run end, `networks.refresh()`, partial exists? (else `partial unavailable…` error), still pausable? net-gated? (`byNetwork` + none enabled → stay). Full (`running≥atOnce` / schedule closed) → `enqueue(front)` + clear error. Else `begin`.
- `relink/replaceLink` (expired signed URLs): HTTP + (`error|paused`) + `resumable!==false` + single-flight guard. Probe new URL (or given). Size must equal old (`different file: X, not Y`). Splittable→new-must-support-ranges. Then `compareWithDisk`: `compareSamples` over one live net (or first available); `same` (or nothing downloaded) → swap `requestPayload.url/browser + state.url`, `persistNow`, `resume`. `different/unknown` → throw explanatory (bytes compared, not just ETag — two files can share ETag). `failedMatch(probe)` suggests resume candidate (same name+size+strong normalized ETag on an `error` download).

### 15.4 `reconcile` — networks truth (lines 1790-1857, called every tick + on every change)

1. Prune download's net list to computer's (keep enabled / contributed bytes / live streams-peers). Add newcomers as `off` (mid-download arrivals start off for user to switch on — no surprise mobile-data burn).
2. Relabel `label/kind` from live monitor.
3. Status state machine per net: `!enabled→off`; `enabled && gone && known→offline`; `limitReached→limit`; `off|offline|limit→on` (transient clears on re-enable/reconnect/limit-lift); else keep (`on/unreachable/failed` persist until their own transitions).
4. If not running or stop fired → return (streams are transfer's business only while running). Schedule closed → `pause(forSchedule)`.
5. All enabled `failed` → `failDownload(first error)` (nothing left to try).
6. `transfer.reconcile()` (streams/peers per §12.5 / §17).

### 15.5 `networksChanged / systemResumed / keepAwake` (lines 1350-1408)

- `networksChanged`: diff `seenAddresses` vs `current`: `changed` (any address set differs) → `wake(pick=changed)` (cut backoffs: what held them may be what changed); `moved` (lost an address) → `reconnect` too (sockets may be bound to it — same as Chrome's `ERR_NETWORK_CHANGED`). Per runtime (downloading/paused/queued): `reconcile + wake + scheduleUpdate`.
- `systemResumed`: `refreshSchedule` + `transfer.systemResumed(now)` (clocks restart: aliveAt/warm/slow/answered — sleep spans no judgement) + `networks.refresh()` (poll gap may have missed changes).
- `keepAwake`: `powerSaveBlocker.start('prevent-app-suspension')` while any `downloading` (display may still sleep). Best-effort try/catch.

### 15.6 `run` — the tick loop (lines 1630-1752)

```
reset transfer, clear meters, stop=new AbortController, reconcile
carry peakReadings across pause (shift by paused span); seed reading if bytes moved
while status==downloading and any unit !done:
  await race(each unwatched worker completion, delay(TICK_MS 500ms, stop-signal))
  if not downloading: break
  updateSpeeds + updateTimeLeft (+push if changed); 1Hz sampleSpeeds/samplePeak (+push)
  transfer.tick(now)   // stuck-refresh + concurrency + reconcile
samplePeak(final); stop.abort(); await all workers; clearSpeeds
if not downloading: error? push (+discard file if !resumable); return   // paused/failed/cancelled
publishing=true
  assert all done else refuse-to-publish
  persistNow; file.publish(dest, total, intentSaver)  // atomic rename, free-name loop, identity dev/ino saved BEFORE rename
  stamp dest/fileName/completedAt; peak fallback start-to-finish; bytesDownloaded = total-skipped (or kept)
  persistNow; discardLeftover; notify complete
catch -> status=error + notify failed(describeError)
publishing=false; pushUpdate; completed? moveToHistory
```

`publish` (`downloadFile.ts:50`): size must equal expected (if known) → `sync()` → free-name loop ≤10000 (` (1)` suffixes, 255-byte cap with stem trimming, skip candidates whose `.plexo` exists, skip existing dest, `rename` same-dir = no copy/no extra space; `EEXIST` → next). Intent (`publicationPath + dev/ino`) persisted before rename so a crash mid-rename restores as completed on next launch (`restoreOne` identity check).

`moveToHistory`: strip blocks/streams (or pieces/peers), add `unitsWritten` (+torrent `downloadedFiles` relative paths), `addToHistory`, delete runtime + persisted dir, `historyChanged`.

`remove/cancel/reveal/open/suspendAll/chooseTorrentFiles/torrentFiles`: see code — key invariants: cancel stops writes first, keeps item visible till files+manifest gone; remove of completed optionally `trashDownload` (only owned torrent paths or single file, never UI-named); reveal/open verify `pathExists` first (`false` → `historyChanged` marks `missing`); `suspendAll` (quit) pauses downloading (schedule-aware), persists rest + `limits.save()`; `chooseTorrentFiles` single-flights via `fileChoices` counter, refuses finished files' removal + disk-checks additions, updates `skippedBytes/unwanted/filesChosen()` + immediate `pushUpdate`.

UI push: `scheduleUpdate` coalesces to `UI_UPDATE_MS (200 ms)`; `takeUpdate` sends `{seq:++sentUpdates, state minus units, changedUnits only}` — tens of thousands of blocks are never recopied at 5 Hz. `changedUnits` diffs `status/interfaceId/bytesDownloaded(+provisional)` vs `sentUnits`. Renderer merges by index with seq guard (`applyDownloadUpdate`).

Persistence: `schedulePersistence` → 15 s routine checkpoint (one running + one queued max; queued takes state at turn-time so nothing lost) + forced `persistNow` on pause/publish. Chained (`persistenceChain`) + temp-then-rename manifest. `restoreOne` on launch: unseal browser, `restoreBlocks/restorePieces` (plan-fit validated, else fresh), `downloading|queued→paused`, clear speeds, `downloading→pending`, verify partial size vs plan (misfits reset to pending/zero), `scheduled==true→queued`, recompute aggregates. Version-mismatch / garbled / missing → `discardUnrestorable` (only unmistakable `.plexo` leftovers + empty v2 placeholder, never user files). Duplicate partial claimants: newest kept.

---

## 16. Disk I/O — random writes done right

**HTTP staging** (`downloadFile.ts`): one file beside final (`<name>.plexo`, same volume → publish = rename, no copy, no 2× space). `writer(pos) = createWriteStream(path,{flags:'r+', start:pos, highWaterMark:512 KiB})` — own fd + explicit offset per attempt, never append. While a write is in flight, next ones queue ≤512 KiB then flush as one `writev`: slow disk gets fewer, larger writes. 32 streams × 512 KiB = ≤16 MiB buffered; full buffer is also Auto's disk-behind signal (§13). `read(pos,len)` for sampling, `sync()` (`fsync`) before checkpoints/publish, `size()` guards.

**Windows sparse** (`sparseFile.ts`): NTFS fills gaps with on-disk zeros on non-sparse random writes (Old New Thing 2011-09-22) — streams scattered over a 1 GB file would write it twice. `markSparse(path)` via koffi `kernel32: CreateFileW + DeviceIoControl(FSCTL_SET_SPARSE=0x900c4) + CloseHandle` (async, `SHARE_ALL`, never throws; `false` on non-Windows / exFAT refusal = plain file, just slower). Called at file creation (best-effort optimisation, not correctness).

**Torrent store** (`engine.ts:35 storeNamed`): subclasses `fs-chunk-store`, rewrites `files[].path` to `join(claimedName, ...inner.slice(1))` (free-name claim like HTTP), reports each written file into `written` set (for trash/ownership). `TorrentDestination` owns folder-vs-file layout + `unwanted` (deselected) + publish/cleanup.

**Checkpointing** (`savedProgress.ts`): `saveBlocks` → `{progress: {netId: number[blockCount]}, complete: all-done}` (complete flag covers unknown-size single open-ended block whose length cannot prove done). `restoreBlocks/restorePieces`: validate counts are safe ints, plan geometry matches (`ceil(total/size)==totalBlocks`, `pieceLength>0`), columns are arrays of exact length of safe ints — else fresh plan (distrust disk: start over rather than account unaccountable bytes); overfull blocks reset; `complete||full-bytes → completed`.

---

## 17. Torrents — spreading peers (`torrent/*` in depth)

### 17.1 Engine (`engine.ts`)

```ts
new Client({ utp:false, webSeeds:false, tracker:{wrtc:false},
             natUpnp:false, natPmp:false, lsd:false, dht:testKnobs.torrentDht, ...{connect, maxConns} })
```

Each `false` has a pinning reason (comment lines 58-65): uTP = UDP sockets un-pinnable; webSeeds = webtorrent's own HTTP past the hook; WebRTC = non-TCP past the hook (+ simple-peer native patch avoids `node-datachannel`); UPnP/NAT-PMP/LSD = beyond-peers chatter. ESM-only webtorrent lazy `import()` once (main is CJS); peer-id naming via `bittorrent-peerid` (`qBittorrent 4.6.2` or null).

Patch (`patches/webtorrent+3.0.21.patch`, 2 hunks): stash `opts.connect` as `client._connect`; in `torrent.js _createConnection`, `peer.conn = client._connect ? client._connect(opts) : net.connect(opts)`. One injection point = every outgoing TCP peer flows through Plexo's chooser.

### 17.2 Metadata (`metadata.ts`)

- `describeTorrent(bytes, link)`: `parse-torrent` → v2-only (no `info.pieces`) → `V2_ONLY` error; else `safeTorrentPaths` (reject `..`/absolute) → `remember(infoHash→bytes, LRU 8)` → `TorrentInfo{infoHash, pieceLength, files[]}` + probe (`supportsRanges:true` so UI enables multi-net, `totalBytes=sum`, `suggestedFileName=name??hash`). `start()` re-derives from remembered bytes (`probedTorrentFile` miss → `Add the torrent again`).
- `readTorrentFile` (local, 10 MB cap), `downloadTorrentFile` (link, `fetch` + cap + non-OK→status error; `headers` per-URL so Cookie drops on cross-origin redirect).
- `fetchMagnetMetadata`: warm lifelong `probeClient` (DHT stays hot) + `client.add(magnet,{path:tmpdir/plexo-magnet, deselect:true})` (metadata only). Timeout `magnetTimeoutMs 3 min` → `No peers responded…`. Newest magnet cancels older (`Replaced by a newer link`); `torrent.destroy({destroyStore:true})` on finish. **Default route only** — probe is not pinned (only a download's client is).

### 17.3 Transfer (`torrentTransfer.ts`, 434 lines)

One client per run (`run()`): pause destroys, resume starts new from `bitfieldOf(done[])` (MSB-first bitfield) + `deselect:true` then `selectFiles` (chosen only). `maxConns = 30 × usable.length` (`PEERS_PER_NETWORK=30`).

- **`connect({host,port})` hook** (outgoing): `isIP(host)` family (hostname `x.pe` → no family → error socket, no net takes it). Per usable (`on|unreachable`) net: `host.networks.find(id)` → `routesFor(iface,[{address,family}])[0]`; unreachable nets capped at 1 dial in flight (probe, not flood). `pickNetwork([{id, peers: dialling+connected}])` = fewest-peers-first (`peers.ts:18`; faster net then earns more automatically — each peer keeps a full request queue answered sooner). Record `chosen.set(addressOf(host,port)→net)` (`[v6]:port` bracketing), `dialling++/dials++`, `connectRoute(route,port)`, settle dialling on `connect|close`, `limit(socket,net)`.
- **`limit(socket,net)`**: monkey-patch `socket.push` (where inbound bytes enter, whoever reads — a `data` listener would force flowing before webtorrent is ready): `wait=limits.take(net, chunk.length)`; if `>0`: `pause(); setTimeout(resume, wait)`. Debt carries (see Bucket) so ponytail early-resume still rate-holds.
- **`onIncoming(socket)`**: `localAddress.strip(::ffff:)` matched against usable nets' addresses → `chosen.set(remoteAddr:port→net)` + `limit`. No match → untracked → `onWire` destroys it (never unattributed).
- **`onWire(wire, address)`**: `chosen.get(address)` → net else `wire.destroy()`. Reset `reach{dials=0, answeredAt=now}`, `unreachable→on`. Create `TorrentPeerState{id:nextPeerId++, interfaceId, status:'connected', bytesDownloaded:0, ..., client:nameClient(peerId)}`, push, `peakPeers=max`. `wire.on('piece',(idx,off,buf))`: `peer.bytes+=len`, `status=receiving`, `unverified[idx][net]+=len`, piece `pending→downloading` + `provisionalBytes=min(len, Σpending)` (live, not durable), `meters.add`. `wire.on('upload',b)` → `onUpload` (per-peer/net/global `bytesUploaded` + `uploadMeters`; every net uploads — tit-for-tat needs it). `wire.once('close')` → `removePeer` (splice + drop meters + update).
- **`onVerified(idx)`**: `received=unverified[idx]??{}` (cleared), skip if `completed|skipped|open-ended`. `fallback = piece.interfaceId ?? usable[0] ?? nets[0]` (found-on-disk bytes). `shares=creditPiece(received,len,fallback)`; `state.bytesDownloaded += len-piece.bytesDownloaded`; re-attribute nets (subtract old, add new); `piece={bytesByInterface:shares, bytesDownloaded:len, provisional:0, interfaceId:topShare, status:completed}`.
- **`tick`**: nets with `dials≥5 && 60 s && zero peers here && peers elsewhere` → `unreachable` (keeps 1 dial to detect return). Peers repaint `connected/receiving` by speed>0. `host.reconcile()`.
- **`reconcile`**: first call starts `run()`; resize `maxConns`; destroy peers on disabled/gone nets. `reset`: clear chosen/dialling/reach/unverified, `downloading→pending`, `provisional=0` (webtorrent drops unfinished pieces with its client). `wake`: destroy peers on moved nets (dead sockets; fresh dials follow). `systemResumed`: `answeredAt=now` (sleep proves nothing).
- **`selectFiles/filesChosen`**: `deselect(all)` then `select()` chosen (none chosen = all). Prior bytes stay (deselected pieces just unrequested). `followEngine`: any `completed` bit webtorrent lacks on disk (hash recheck) → back to `pending/0/{}` + recompute (never publish without it).

`peers.ts` pure: `pickNetwork` (min-peers, first-on-tie), `creditPiece` (floor-proportional whole bytes + remainder to largest share; zero-known → all fallback), `bitfieldOf`. `files.ts` pure: `chosenFiles` (validate indexes, non-empty, all→null), `fileSpans` (first/last piece per file; empty→null), `wantedPieces` (any-byte overlap; edge pieces pull neighbor bytes — verified whole, trimmed at publish), `finishedFiles` (all pieces in; empty counts as finished — blocks dropping a finished file).

---

## 18. Limits — token buckets + TCP backpressure (`limits.ts` in depth)

```ts
Bucket{rate, tokens=0, at=now}
take(bytes, now): tokens = min(rate, tokens + elapsed*rate); at=now; tokens-=bytes
  return tokens>=0 ? 0 : (-tokens/rate)*1000
```

One second of tokens max — idle never banks a burst over the limit. Debt carries: a 5 MB chunk on a 1 MB/s bucket waits ~5 s spread over next takes.

`Limits{total:Bucket|null, perNetwork:Map, dataLimits/periods:Map, usage:{day,week,month:{key,bytes}}, saveTimer}`:

- `configure(settings)`: `total = slowMode ? slowModeSpeed??2 MiB/s : speedLimit` (`adjust` reuses bucket so debt survives setting change; `undefined|≤0` = none). Per-net buckets reconciled by id. Data limits + periods (`??'month'`) rebuilt.
- `take(net, bytes)`: `rollPeriods(now)` (day/week/month key via `dataPeriodKey` — week starts Monday local; rollover zeroes that period + schedules save); count into **all three** period maps; debounce-save 10 s → `network-usage.json v2`; once-per-crossing `onLimitReached` (deferred `setImmediate` — caller may be stopping the connection the bytes came on); return `max(total.take, perNet.take)`.
- `limitReached(net)`: selected-period usage ≥ limit (rolled first). Drives `reconcile` → `status='limit'` (stops use; UI excludes from New-download picker; lifted on period end / raise / reset). `usedByPeriod()` (per-net selected-period usage for UsageBar), `resetUsage(net)` (zero selected period, atomic `updateJson`, rollback on failure), `save()` (quit path: clear timer, no-roll-then-write).

How pausing slows the sender (say in viva): HTTP `res.pause()` / torrent `socket.pause()` stops reading → kernel receive buffer fills → TCP window shrinks to 0 → sender's congestion control stalls → effective rate = bucket rate. No loss, no RST. That is why `take()` returns a *wait*, not a drop.

---

## 19. Schedule — local-time windows (`downloadSchedule.ts` + manager)

`DownloadSchedule{enabled, startMinute, endMinute (0-1439, ≠start), days[0-6 Sun..Sat], endDate? YYYY-MM-DD}` validated by `validSchedule` (incl. real-calendar `endDate` check).

`scheduleWindow(schedule, now)`: scan offsets `-1..+7` days (yesterday covers overnight spill): keep days containing `start.getDay()`, `localDate(start)≤endDate`; `endDay=start+(end<start?1:0)`; `atLocalMinute` both (DST spring-forward gap: `setHours` lands past the gap — walk back minute-by-minute to first minute after jump; that minute is used). `now∈[start,end)` → `{allowed:true, endsAt}`; else `{allowed:false, nextStart? (first future), expired? (none)}`.

Manager: `scheduleLoaded` gates `scheduleAllowsDownloads` (false until settings read — never run before knowing). `armScheduleTimer`: sleep till `endsAt|nextStart` (capped 1 s granularity + unref; re-armed after fire; also checks clock for TZ jumps). `refreshSchedule`: closed → `pause(all downloading, forSchedule=true)` (queued intent persisted → resumes next window even after relaunch); open → `pump()`. `reconcile` mid-run cutoff → same pause. `begin` when closed → `enqueue`. UI: `scheduleMessage` (`Downloads stop at H:MM` / `Waiting until H:MM today|Mon` / `Schedule ended`), `useDownloadSchedule` re-evaluates 1 s when enabled.

---

## 20. Browser bridge + extension — handoff without doubles

### 20.1 Contract (`src/shared/browserBridge.ts`, imported by BOTH sides)

```ts
BRIDGE_PORTS=[19288,19289,19290] (first free; no setting needed)
BRIDGE_API=1 (bump on breaking /ping|/add change; mismatch → 'update' state)
BRIDGE_DEADLINE_MS=8000 (Plexo adds nothing after; extension waits deadline+2s; never both)
BridgePing{app:'plexo', version, api}
BridgeAddRequest{url, browser?, pageUrl?, minBytes?, fileName?}
BridgeHandoff{token}  // show ONLY after POST /confirm returns it
```

### 20.2 Server (`browserBridge.ts`, 257 lines)

`startBridge({manager, offer})`: try ports in order on `127.0.0.1`; all taken → log, extension shows closed. `keepsRunningForBrowser()` (window-close → tray while extension ever used).

`handle(req,res,port)` defenses (each is a viva point):

1. `Host ∈ {127.0.0.1:port, localhost:port}` else 403 — blocks **DNS rebinding** (evil page whose DNS returns 127.0.0.1 still sends `Host: evil.com`).
2. `Origin` absent (Firefox extension quirk / curl) or matching `/^(chrome|moz)-extension:\/\/...$/` else 403. CORS headers echo valid origin only. `OPTIONS` → 204.
3. `POST` requires `Content-Type: application/json` else 415 — pages cannot send that cross-origin without a preflight that only extension origin passes.
4. Body cap 64 KiB, `JSON.parse` guarded → 400/500.
5. `GET /ping` → `{app,version,api}` + `noteExtension` (persists `browserExtensionUsed` → tray behavior).
6. `POST /add` → `addRequestFrom` validation (url `https?|magnet` ≤8192, browser via `browserContextFrom`, pageUrl `https?`, minBytes safe-int, fileName `1-255 chars, no /\\ controls`) → `add()`.
7. `POST /confirm {token}` → `handoffs.get(token)` else 410; delete + `host.offer(offer)` (UI `linkReceived` → New-download prefill) + `{}`.

`add()`: magnets → `hold` immediately (nothing to probe — DHT lookup happens in New-download). Else `checked()` = race(`probeUrl(url,browser)`, 8 s timer→keep-reason, client-gone→`'gone'`); probe not cancelled, just unwaited (its own 20 s timeout ends it). After race: response already ended/destroyed → return silently (extension gave up; adding now would double). `string` → `422 {reason}` (browser keeps). `minBytes` filter → 422 `smaller than the minimum size`. Else `hold({url, probe(+fileName override), browser, from:name, signedInTo, resumes:failedMatch})`: `token=randomUUID`, `handoffs.set` + 15 s expiry (`HANDOFF_MS`), `200 {token}`. Unconfirmed expiries show nothing — **never both**.

`signedInTo`: page's host (arg `pageUrl ?? referer ?? fileUrl`), not the CDN file host — but only if a `Cookie` actually matches the file URL (else no session to name).

### 20.3 Cookies (`download/browserContext.ts`)

`requestHeaders(url, browser)`: `User-Agent` (browser's or `Plexo/1.0`), `Referer` (if any), `Cookie` from `cookieHeader` (RFC 6265 §5.4): filter `domain` (leading-dot stripped; `hostOnly ? exact : exact-or-subdomain`) + `path` (exact or prefix-on-`/`-boundary) + `secure→https-only`; sort longest-path-first (most specific first); join `name=value` (`; `). Recomputed per redirect hop.

`browserContextFrom(value)`: untrusted-input gate (extension JSON or manifest restore): object with `cookies[] ≤500`, `referer/userAgent/name` text ≤8192/40, no control chars (`;` also banned inside cookie name/value — would split headers), `domain/path` text with `/`-rooted path, `hostOnly/secure` booleans. Anything else → `null` (whole context refused, not trimmed).

### 20.4 Extension (`extension/src/`)

- `manifest.json` MV3: `Download with Plexo`, popup+options, `permissions: alarms,downloads,contextMenus,cookies,storage,tabs`, `<all_urls>`. `build.mjs` → `dist/chrome` (service_worker, min Chrome 123) + `dist/firefox` (background.scripts, gecko id) via Vite IIFE.
- `plexo.ts`: `ask(port)` → `fetch 127.0.0.1:port/ping (1.5 s)` → `ok|closed|update` (non-Plexo squatter = closed). `reach()` pings all three in parallel, caches `found`. `send(req)`: `reach()` FIRST every time (sign-in only to just-verified Plexo) → `POST /add (deadline+2 s)` → `Handoff{port,token}|kept(422/timeout)|closed`. `confirm({port,token})`: `POST /confirm (3 s)` → bool. `browserContext(urls, storeId, referer)`: `cookies.getAll({url,storeId})` per URL (+Firefox first-party-isolation fallback with `firstPartyDomain:null` filtered to download/page hosts), dedupe by `domain\npath\nname`, attach UA + browser name. `storeOf`: `cookieStoreId ?? incognito?'1'`. `wake()`: open `plexo://open` (user-gesture only — browser asks before launching app) + poll `reach()` 20×500 ms, close tab on success.
- `background.ts`: `capture(item)`: skip unless `capture && ^https? && !excluded(sites,[url,finalUrl,referrer])` (host+suffix match). Build `BridgeAddRequest{url:finalUrl||url, browser, pageUrl:referrer, minBytes, fileName:basename(filename)}` → `send` → `closed→icon update, return false`; `kept→false`. Taken → `downloads.cancel(id)` + re-`search`: `complete` already (Firefox small-file race — cannot hold like Chrome) → return false (browser keeps; Plexo's unconfirmed handoff expires). Else `erase(id)` → `confirm(handoff)` → Plexo shows → `closeEmptyTab` (tabs opened ≤30 s ago showing the URL) + icon. Chromium path uses `onDeterminingFilename(item,suggest)` (return `true` async; `suggest()` only if not taken → Save-As never double-prompts); Firefox lacks it → `onCreated`. Manual: context-menu `Download with Plexo (link)` → `sendLink` (+`wake` retry if closed; no browser copy to cancel). `alarms CHECK_PLEXO 0.5 min` + `storage.onChanged` + `runtime.onMessage{wakePlexo,checkPlexo}` keep icon/title truthful (`Plexo | capture off | isn't open | Update Plexo`).
- `settings.ts / popup / options`: `Settings{capture, sites[], skipSmall, minMegabytes}` in `storage.local`; popup toggles capture + per-site + grant `<all_urls>` + open Plexo/options; options edits all + shows port/version.

---

## 21. IPC + UI — typed, delta-synced, never trusted

**Channels** (`ipc-channels.ts`, 38): `network:list-interfaces|device-binding-supported|open-settings|usage|reset-usage|changed`, `download:probe|start|list|torrent-files|choose-torrent-files|pause|resume|relink|set-network|cancel|remove|updated`, `history:list|clear|changed`, `app:get-initial-state|update-settings|link-received|pending-links|resume-from-link|dismiss-link`, `dialog:choose-destination-folder|choose-torrent-file`, `clipboard:read-text`, `shell:reveal-download|open-download`, `disk:free-space`, `update:state|state-changed|show-menu`.

**Preload** (`src/preload/index.ts`): `contextBridge.exposeInMainWorld('plexo', plexoApi)` (+non-isolated fallback). `invoke<K extends keyof IpcContract>` — compile-checked both ends. `initialState` via **synchronous** `sendSync('app:get-initial-state')` (blocks page till reply; handler never throws without replying — else window never paints). Push subscriptions (`onDownloadUpdated/onHistoryChanged/onUpdateState/onNetworksChanged/onLinkReceived`) return unsubscribers.

**Main** (`handlers.ts:72`): owns `NetworkMonitor` + `DownloadManager`; `powerMonitor.on('resume')` → `systemResumed + refresh`. `deviceBindingSupported()` started eagerly. `probeUrl` direct. `freeSpace` via `statfs` (null on error). `startDownload` merges sealed browser context from `pendingLink(linkId)` (renderer never sees cookies). `getInitialState` caps destination `stat` at 300 ms (dropped share must not hang launch).

**Renderer** (`src/renderer/src`): `main.tsx → App` (mounts `useDownloadEvents/useOpenedLinks/useNewDownloadShortcuts/useNetworkEvents` then TitleBar/CurrentScreen/StatusBar/dialogs). Screens: Downloads / Downloading / Complete / Error (`assertNever` exhaustive). Store (`useAppStore`, Zustand, seeded from `initialState`): `interfaces(+status idle|loading|ready|error)`, `downloads: Record<id,state>` (unfinished only), `history[]` (newest first), `view`, `downloadFilter`, `newDownloadOpen/draftUrl/formKey`, `links[] + letGo set` (dismissed never resurrect), settings fields; all settings `persist(patch)` optimistic fire-and-forget except LimitsDialog single-save.

Key hooks/components: `useDownloadEvents` (subscribe BEFORE `listDownloads` snapshot; `seq` drops late dupes; 150 ms debounce + focus reload for `missing`), `useNetworks` (live list + `networkUsage` data bars), `NewDownloadDialog` (clipboard prefill, 600 ms debounce `probeUrl`, reuse `PendingLink.probe` for single-use links, exclude data-capped nets, remember `off` prefs, `!supportsRanges||size==null → pickedIds.slice(0,1)`, same-`subnet` conflict warning, `streamsChoice auto|4|8|16|32` HTTP-only, `startDownload` → navigate unless queued/scheduled), `downloadActions.ts` (one pure decider for row/menu/toolbar/detail) + `DownloadActionsProvider.perform` (`pause/resume/relink/remove/open/reveal/copy/cancel/trash`), `LimitsDialog` (General: total/slow/at-once/schedule/reset; per-net: speed/data+period/usage+reset-date/zero/reset), `ThroughputChart` (`speedHistory` stacked), `BlockGrid` (`bytesByInterface` colors), `Throughput`/`DetailHeader`/`HeroBand`/`TorrentFiles`/`FixLinkDialog`/`RemoveDialog`, `StatusBar` (`freeSpace` 30 s poll, queued count, `scheduleMessage`, slow toggle, `speedUnit` bytes/bits toggle → `formatSpeed`).

**Delta sync** (`downloadUpdate.ts` + `takeUpdate/changedUnits`): update = `{seq, state-minus-units, changedUnits[]}`; renderer `applyDownloadUpdate` merges by index, seq-guarded, full-snapshot fallback when `changed==total`. 10k-block file at 5 Hz would otherwise copy megabytes per second through IPC that also carries every downloaded byte's bookkeeping.

---

## 22. Failure matrix — symptom → code → status

| Symptom | Code path | What user sees |
|---------|-----------|----------------|
| Phone unplugged | `NetworkMonitor` drop → `reconcile` prunes → `transfer.reconcile` retires streams; blocks `downloading→pending`, bytes kept | Net `offline`; download continues on rest |
| Wi-Fi DHCP fails (169.254) | filtered in `listActiveInterfaces` → same as unplugged | `offline` |
| Server 429/503 + Retry-After | `HttpStatusError(transient)` → `holdUntil` + `backOff`; `refused=true` → ceiling cut | Stream `retrying`; net stays `on` |
| Server 403 on some streams only | `refused` with `served>0` → `ceilings` cut, retire refused-first | Stream count drops; recovers +1/min |
| Signed URL expired (all 403) | `strikes>5` all streams → `failNetwork` each → all `failed` → `failDownload` | Download `error`, `resumable` set; Fix-link dialog |
| File swapped on server | `RemoteChangedError(size)` → `failDownload(discard)`; validators → `compareSamples` → same? accept : fail | `error: file changed… Start over` (`resumable:false` when bytes useless) |
| Network down mid-block | `ConnectionError` + whole-net silent 5 s → `unreachable`; 1 stream probes every ≤5 s; bytes>0 resets | Net `unreachable`; auto `on` on first byte |
| Crawl (loss-collapsed cwnd) | `isCrawling` 10 s <10% median → `refresh` (reconnect, no strike); tail → `hedge` (≤2/block) | Invisible; PLEXO_DEBUG shows `aborted:refresh/hedge+lost` |
| Disk full / slow HDD | `ENOSPC` → error; `DiskWatch behind` → halve cap per 500 ms, disk badge | `error` or `diskLimited` badge; Auto recovers |
| Sleep | `powerMonitor resume` → `systemResumed` (clocks+sockets reset) | Resumes; no false `unreachable` |
| Torrent no peers on one net | `dials≥5, 60 s, peers elsewhere` → `unreachable` | Net `unreachable`, 1 dial probes |
| Data cap hit | `take()` crossing → `onLimitReached` → `reconcile` → `limit` | Net `limit`, excluded from new picks |
| Outside schedule | `refreshSchedule/reconcile` → `pause(forSchedule)` | `queued` + `Waiting until…` |

---

## 23. Constants cheat-sheet (all in one place)

| Where | Constant | Value | Meaning |
|-------|----------|-------|---------|
| interfaces | `POLL_MS` | 1 s | network re-scan |
| deviceBinding | kernel | ≥5.7 | unprivileged `SO_BINDTODEVICE` |
| routes | `ATTEMPT_DELAY_MS` | 250 ms | Happy Eyeballs stagger |
| StreamConnection | `timeout/connectTimeout` | 20 s / 10 s | headers budget / dial budget |
| probe | `MAX_REDIRECTS/TIMEOUT` | 5 / 20 s | whole-probe budget |
| plan | max/min/start/maxStreams/blocksPer | 8 MiB / 1 MiB / 8 / 32 / 2 | block + stream geometry |
| chunk | `STALL_TIMEOUT` | 20 s | silent-body watchdog |
| chunk | `MAX_REDIRECTS` | 5 | mid-download signed-URL rotation |
| version | `SAMPLE_BYTES/MAX/TRIES` | 16 KiB / 8 / 4 | relabel-vs-change proof |
| transfer | `MAX_CHUNK_RETRIES` | 5 | server-said-no give-up |
| transfer | `RETRY_BASE/MAX` | 1 s ×2 ±20% / 15 s | backoff |
| transfer | `UNREACHABLE_RETRY` | 5 s | single probe cadence |
| transfer | `SERVER_BUSY_FOR` | 5 min | transient wait-out |
| transfer | `RETRY_AFTER_MAX` | 120 s | honor cap |
| transfer | `SILENT_AFTER` | 5 s | dead-connection / dead-net |
| transfer | `SLOW_RATIO/WARMUP/FOR` | 0.1 / 5 s / 10 s | crawl refresh |
| transfer | `MAX_REFRESHES` | 2 / block | refresh bound |
| transfer | `hedgeAfter/startup/max` | 2 s / 1 s / 2 | hedge policy |
| transfer | `IDLE_POLL/REFRESH_HANDOFF` | 250 / 300 ms | fail-back / fast-handoff |
| concurrency | `RECOVER` | 60 s | refusal ceiling +1 |
| disk | `PATIENCE/RECOVER/STALLED` | 500 ms / 10 s / 500 ms | disk cap |
| disk | `WRITE_BUFFER` | 512 KiB | per-stream buffer / writev |
| speeds | `SPEED_WINDOW` | 3 s | meter window |
| speeds | `HISTORY/PEAK` | 60 samples / 5 s | chart / peak |
| manager | `TICK/UI/CHECKPOINT` | 500 / 200 ms / 15 s | loop / paint / fsync |
| bridge | ports/api/deadline/handoff/body | 19288-90 / 1 / 8 s / 15 s / 64 KiB | handoff |
| torrent | peers/net, dials/timeout | 30 / 5 / 60 s | swarm spread |
| torrent | `.torrent` cap / magnet / LRU | 10 MB / 3 min / 8 | metadata |
| ext | ping/confirm/wake | 1.5 s / 3 s / 20×500 ms | presence |

E2E overrides: `PLEXO_E2E_BLOCK_BYTES/RETRY_BASE_MS/STALL_MS/CONNECT_MS/SERVER_BUSY_MS/SLOW_WARMUP_MS/SLOW_FOR_MS/SILENT_MS/HEDGE_MS/MAGNET_MS/DHT(0|1)/STREAMS/INTERFACES/USER_DATA/HIDE_WINDOW` — all ignored when packaged.

---

## 24. Full wire walk — 100 MB over Wi-Fi + Phone

**HTTP (`https://cdn.example.com/big.iso`, 100 MB, Range OK, 2 nets):**

1. UI probes: `GET /big.iso` + `Range: bytes=0-1023` (no pin yet — default route) → `206 + Content-Range: bytes 0-1023/104857600 + ETag "abc"` → `{supportsRanges:true, total:104857600, name:big.iso}`.
2. `planDownload({total:104857600, splittable:true, nets:2})`: target 128 → size `ceil(100M/128)=781250B` → clamped min 1 MiB → 1 MiB → 100 blocks. `startingStreams(100,2,auto)=8` per net → 16 workers, `interleave` spreads first 16 blocks alternately.
3. Each worker: DNS (shared cache per host+net via `lastGoodRoute`) → Happy-Eyeballs TCP (SYNs out respective devices) → TLS (session resume after first) → `GET + Range: bytes=k*1MiB-(k+1)*1MiB-1 + Cookie?` on keep-alive lane.
4. Server: `206` × 100 (plus occasional `429 + Retry-After: 2` → that net holds 2 s; `503` subset → ceiling cut per §13).
5. Bodies → `writer(offset)` random writes into `big.iso.plexo` (sparse on NTFS). Speeds tick 500 ms; chart samples 1 Hz; checkpoints fsync 15 s; manifest rewrite temp-then-rename.
6. Block 99 slow (crawl 50 KiB/s vs median 5 MB/s): after 10 s → `refresh` (new SYN, usually healthy). Still slow at 98% with all else done and no `pending`: idle phone stream `hedge`s it (same `Range` from frontier). Wi-Fi finishes first → phone attempt `aborted:lost`; or phone wins → Wi-Fi aborted. Either way frontier = max, bytes counted once.
7. All `completed` → `persistNow` → `publish`: size==104857600? → `sync` → intent saved → `rename(big.iso.plexo→big.iso)` (or `big (1).iso` if taken) → `completed` → history (no blocks) → notification. `.plexo` leftover discarded.

**Torrent (`ubuntu.iso`, 2 GB, 512 KiB pieces, 40 peers):**

1. Magnet → warm-DHT probe client (default route) fetches metadata ≤3 min → `describeTorrent` (v1 pieces present, safe paths, LRU remember).
2. `planPieces(2G, 512K)` → 4096 pieces (all `pending`); chosen=all; `ensureDiskSpace`; `TorrentDestination.create` claims folder name.
3. Run: `createClient({connect:hook, maxConns:60})` + `add(torrentFile,{store:storeNamed, bitfield:0, deselect:true})` → `ready` → `selectFiles(all)` → swarm dials: each `connect({host,port})` → fewest-peers net → `connectRoute` pinned SYN → BitTorrent handshake (`0x13 + 'BitTorrent protocol' + reserved + info_hash + peer_id`) → `bitfield/have` → `interested` → `request` (16 KiB slices) → `piece`.
4. Per `piece` event: `unverified[piece][net]+=len`, `provisionalBytes` grows (UI shimmer, not progress). Per hash-verify: `onVerified` → proportional `creditPiece` → durable `bytesDownloaded` + net tallies.
5. Churn: phone loses signal → dials fail ×5/60 s with Wi-Fi holding peers → phone `unreachable` (1 dial probes). Phone back → first `piece` byte → `on` + `maxConns` restored + peers rebalanced by fewest-count.
6. Done (all wanted verified) → publish folder (edge-neighbor bytes trimmed) → history with `downloadedFiles[]`.

---

## 25. Viva Q&A — say these verbatim if stuck

- **“Which layer?”** — L7 app controlling L4 sockets on chosen L3 interfaces; L2/L1 observed only.
- **“TCP or UDP for downloads?”** — TCP both (HTTP + pinned BitTorrent TCP). uTP/UDP off — un-pinnable. DHT tracker chatter still UDP, but bytes ride TCP.
- **“How do two networks not fetch the same bytes?”** — Shared queue + block leases + frontier-max accounting; hedges are the only intentional duplicates, winner-takes-all.
- **“How do you know the file did not change?”** — ETag/Last-Modified/size per response vs accepted set; `size` = proof, validators = hint settled by re-fetching 8×16 KiB and byte-comparing.
- **“Linux vs Windows pinning?”** — Windows/macOS route by source IP (`localAddress` suffices); Linux needs `SO_BINDTODEVICE` via koffi fd-injection (≥5.7 unprivileged).
- **“IPv6?”** — Family-matched routes + Happy Eyeballs 250 ms + last-good cache; v6-blackhole costs 250 ms, not timeout.
- **“Congestion control vs your throttle?”** — Ours is receiver-side backpressure (pause → window fills → sender slows). TCP's own cwnd/RTT still governs wire efficiency; more streams overcome per-connection caps.
- **“Why 8→32 streams?”** — 8 starts (IDM convention), double while all answer, halve on refusal, share 32 across concurrent downloads, halve on disk-behind. Empirically saturates far servers without hammering near ones.
- **“Resume across restart?”** — Manifest v7 + per-net byte columns + staging file + validators; geometry re-validated, misfits reset, identity (`dev/ino`) detects completed publish across crash.
- **Limitations to admit:** same-router nets gain nothing; no-Range servers single-stream; 1-peer swarms cannot spread; v2-only torrents rejected; Linux <5.7 falls back; 1 s poll + 16-64 sockets cost CPU/battery vs single-stream.

---

## 26. Lab order — open these, in this order

1. `README.md:153` — 3-paragraph “How it works” (this doc's source of truth).
2. `src/shared/types.ts` — every shape (`NetworkInterfaceInfo:14`, `HttpStreamState:80`, `DownloadNetwork:189`, `DownloadState:257`, `StartDownloadRequest:442`).
3. `src/main/network/interfaces.ts:128` — listing + `ipv4Subnet:99` + `NetworkMonitor:191`.
4. `src/main/network/deviceBinding.ts:28` — `openOnDevice` + `connectRoute:67`.
5. `src/main/network/routes.ts:151` — `connectOnInterface` + `StreamConnection:300`.
6. `src/main/download/probe.ts:130` — `probeUrl` + `requestFirstBytes:39`.
7. `src/main/download/plan.ts:70` — `planDownload` + `startingStreams:93` + `interleave:50`.
8. `src/main/download/chunkDownloader.ts:131` — `downloadChunk` + `fetchRange:393`.
9. `src/main/download/fileVersion.ts:31` — `compareVersion`.
10. `src/main/download/blockProgress.ts:39` — `advanceBlock` + `retractBlock:53`.
11. `src/main/download/scheduler.ts:147` — `pickWork`.
12. `src/main/download/httpTransfer.ts:1098` — `runWorker`; then `686 executeAttempt`, `788 finishAttempt`, `332 reconcile`, `519 refreshStuckConnections`.
13. `src/main/download/concurrency.ts:148` — `tick`; `94 DiskWatch`.
14. `src/main/download/transfer.ts:96` — `Meter/Meters/updateSpeeds`; `190 smoothTimeLeft`.
15. `src/main/download/downloadManager.ts:898 start`, `1250 begin`, `1630 run`, `1790 reconcile`, `1950 persistNow`, `1938 schedulePersistence`.
16. `src/main/download/downloadFile.ts:17` + `sparseFile.ts:57` + `savedProgress.ts:32`.
17. `src/main/download/torrent/engine.ts:66` + `patches/webtorrent+3.0.21.patch` + `torrentTransfer.ts:247 connect` + `316 onWire` + `384 onVerified` + `peers.ts:18` + `metadata.ts:32` + `files.ts:7`.
18. `src/main/network/limits.ts:15 Bucket` + `111 take`.
19. `src/shared/downloadSchedule.ts:66` + `dataLimits.ts:10`.
20. `src/main/browserBridge.ts:80` + `src/shared/browserBridge.ts` + `download/browserContext.ts:8` + `extension/src/plexo.ts:48` + `extension/src/background.ts:31`.
21. `src/shared/ipc-channels.ts` + `src/main/ipc/handlers.ts:72` + `src/preload/index.ts` + `src/renderer/src/store/useAppStore.ts`.

Debug: `PLEXO_DEBUG=1 npm run dev` logs every attempt (`block, stream, network, kind, outcome, networkBytes, writtenBytes, ms, ttfbMs, reusedSocket`) + stream add/retire.

---

*Rewritten 2026-10-16 from full source reads (interfaces, deviceBinding, routes, limits, probe, plan, chunkDownloader, scheduler, httpTransfer, concurrency, transfer, downloadManager 1-2022, downloadFile, sparseFile, savedProgress, fileVersion, blockProgress, browserContext, browserBridge, openLinks, ipc/handlers, testKnobs, shared/types+browserBridge+ipc-channels+downloadSchedule+dataLimits, torrent/engine+transfer+peers+metadata+files, webtorrent patch, extension/background+plexo). Simple words, exact references.*
