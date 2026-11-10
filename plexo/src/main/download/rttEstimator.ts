// Feature 6: what each network's path looks like right now, the way BBR sees it.
//
// Plexo grows a network's streams until the server refuses some (see concurrency.ts). That is
// loss-based thinking, like TCP Reno/CUBIC: keep pushing until something breaks. On a home link
// the first thing to break is not the server but the router's queue. Dozens of TCP flows fill
// its buffer, every packet waits in line, and ping climbs from tens of ms to hundreds
// (bufferbloat), while the download gets no faster because the bottleneck was already full.
//
// BBR (Cardwell et al., 2016) instead models the path with two numbers:
//   - minRTT: the round trip with an empty queue, i.e. propagation delay. Taken as the lowest RTT
//     seen in a window (MIN_RTT_WINDOW_MS), so a route change can raise it again.
//   - BtlBw: the bottleneck bandwidth, taken as the highest delivery rate in a window.
// Their product, the bandwidth-delay product (BDP = BtlBw × minRTT), is how much data in flight
// fills the pipe exactly. Past it, extra data only queues. sRTT − minRTT is that queueing delay.
//
// RTT samples: a request on a reused socket skips the TCP and TLS handshakes, so its time to first
// byte is one round trip plus the server's think time (chunkDownloader.ts onResponse). Fresh
// sockets are skipped, as their TTFB also counts the handshakes.
//
// No I/O and no clock of its own: every call passes the time, so tests can drive it exactly.

/** How long the lowest RTT counts for: BBR's min_rtt filter window is 10 s. Longer here, because
 * Plexo has no ProbeRTT phase that drains the queue to re-measure it. While the queue is bloated
 * the true minimum is not seen again, and a short window would forget it and call the bloat
 * normal. */
export const MIN_RTT_WINDOW_MS = 30_000
/** How long the highest delivery rate counts for (BBR: about ten round trips; here, in ticks). */
export const BTL_BW_WINDOW_MS = 10_000
/** RFC 6298's smoothing gain for sRTT. */
const SRTT_GAIN = 1 / 8
/** Gain for the delivery-rate average across ticks. */
const RATE_GAIN = 1 / 4
/** RTT samples needed before the path is trusted at all. */
export const MIN_SAMPLES = 4

export interface PathEstimate {
  /** Lowest RTT in the window: propagation delay. */
  minRttMs: number
  /** Smoothed RTT now. */
  srttMs: number
  /** sRTT − minRTT: how long packets wait in a queue somewhere on the path. */
  queueDelayMs: number
  /** Highest delivery rate in the window: bottleneck bandwidth. */
  btlBwBps: number
  /** Delivery rate now, smoothed. */
  rateBps: number
  /** BtlBw × minRTT: the bytes in flight that fill the pipe exactly. */
  bdpBytes: number
  samples: number
}

interface Path {
  rtts: { at: number; ms: number }[]
  srttMs: number | null
  samples: number
  lastTotal: number | null
  lastAt: number
  rateBps: number
  rates: { at: number; bps: number }[]
}

export class RttEstimator {
  private readonly paths = new Map<string, Path>()

  private path(networkId: string): Path {
    let path = this.paths.get(networkId)
    if (!path) {
      path = {
        rtts: [],
        srttMs: null,
        samples: 0,
        lastTotal: null,
        lastAt: 0,
        rateBps: 0,
        rates: []
      }
      this.paths.set(networkId, path)
    }
    return path
  }

  /** A response's time to first byte. Only one on a reused socket is a round trip. */
  response(networkId: string, now: number, ttfbMs: number, reusedSocket: boolean): void {
    if (!reusedSocket || !(ttfbMs > 0) || !Number.isFinite(ttfbMs)) return
    const path = this.path(networkId)
    path.samples++
    path.srttMs = path.srttMs === null ? ttfbMs : path.srttMs + SRTT_GAIN * (ttfbMs - path.srttMs)
    // A monotonic window minimum: drop older samples that are no lower than this one, as they can
    // never be the minimum again.
    while (path.rtts.length > 0 && path.rtts[path.rtts.length - 1].ms >= ttfbMs) path.rtts.pop()
    path.rtts.push({ at: now, ms: ttfbMs })
    while (path.rtts.length > 1 && now - path.rtts[0].at > MIN_RTT_WINDOW_MS) path.rtts.shift()
  }

  /** Everything the network has received so far, read once per tick: its delivery rate. */
  delivered(networkId: string, now: number, totalBytes: number): void {
    const path = this.path(networkId)
    if (path.lastTotal !== null && now > path.lastAt) {
      const bps = (Math.max(0, totalBytes - path.lastTotal) * 1000) / (now - path.lastAt)
      path.rateBps = path.rateBps === 0 ? bps : path.rateBps + RATE_GAIN * (bps - path.rateBps)
      while (path.rates.length > 0 && path.rates[path.rates.length - 1].bps <= path.rateBps) {
        path.rates.pop()
      }
      path.rates.push({ at: now, bps: path.rateBps })
      while (path.rates.length > 1 && now - path.rates[0].at > BTL_BW_WINDOW_MS) path.rates.shift()
    }
    path.lastTotal = totalBytes
    path.lastAt = now
  }

  /** The path's model, or null until it has enough RTT samples to say anything. */
  estimate(networkId: string): PathEstimate | null {
    const path = this.paths.get(networkId)
    if (!path || path.srttMs === null || path.samples < MIN_SAMPLES || path.rtts.length === 0) {
      return null
    }
    const minRttMs = path.rtts[0].ms
    const btlBwBps = path.rates[0]?.bps ?? 0
    return {
      minRttMs,
      srttMs: path.srttMs,
      queueDelayMs: Math.max(0, path.srttMs - minRttMs),
      btlBwBps,
      rateBps: path.rateBps,
      bdpBytes: Math.round((btlBwBps * minRttMs) / 1000),
      samples: path.samples
    }
  }

  forget(networkId: string): void {
    this.paths.delete(networkId)
  }
}
