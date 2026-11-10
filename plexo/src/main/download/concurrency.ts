import type { CongestionMode } from '../../shared/types'

// How many streams each network runs. Deliberately simple, after Gopeed and aria2: no timers and
// no speed comparisons, so noise on a flaky network can't move it.
//
// - A network starts with START_STREAMS_PER_NETWORK (see reconcile in downloadManager.ts), or
//   with the count the user picked, which it then keeps rather than grows.
// - Once every one of its streams has received data, it doubles, up to the limit. Another
//   connection costs little when the link is already full, and a server that caps each
//   connection's speed is only outrun by more of them.
// - A server that refuses some of a network's streams (503, 429, 403, or leaves them unanswered
//   for SILENT_AFTER_MS, see downloadManager.ts) while it is sending data down others is saying
//   it wants fewer connections from this address: the refused streams close, and the network
//   stays at the ones left. After RECOVER_MS without another refusal it may have one more, and
//   so on back up to the limit, as in Surge: a server that was only briefly unwell doesn't cap
//   the rest of a long download, and one that meant it costs one refused request a minute. Only
//   the streams refused count against it: one that failed some other way, or hasn't been
//   answered yet, isn't a refusal. As in Gopeed, where a refused connection stops and the others
//   carry on.
// - A server that refuses while sending nothing isn't limiting connections: it is busy, or the
//   link has expired or been denied. That is waited out or reported elsewhere (see finishFailed
//   in downloadManager.ts), and the count stays. The network doesn't grow meanwhile.
// - A disk that can't keep up holds each stream's reading until its writes catch up. Streams
//   writing to scattered places are what slow a hard drive down, so while the disk has been behind
//   for DISK_PATIENCE_MS (see DiskWatch) no network grows, and every network is cut to half the
//   most any runs; each DISK_RECOVER_MS it keeps up at the cap, the cap doubles. A hard drive
//   behind at every count is down to the one stream it writes fastest with in seconds, and a disk
//   that was only busy for a moment soon has its streams back. The disk is decided for the whole
//   download, not per network: a stream only fills its writer when it receives fast, so a fast
//   network would read as held and a slow one wouldn't, and the fast one alone would be cut while
//   the slow one's streams kept writing all over the disk. The cap is the disk's own: a server's
//   refusals keep their ceiling and pace beside it, and each network runs the lower of the two. A
//   download the disk keeps up with is never behind, so this costs nothing anywhere else. The
//   user's own pick is kept, as it is for everything but refusals.
// - Downloads running at once share a network's limit: each may run its even share of it (see
//   TransferHost.downloadsOn), so four downloads on one network run 32 streams between them, not
//   128. A download that starts lowers the others' share, and their extra streams retire; one that
//   ends raises it, and they grow back.
// - Otherwise each network is decided on its own, so one that drops out or comes back never
//   disturbs the others.
//
// - Feature 6, friendly mode (the default; see rttEstimator.ts): the rules above are loss-based,
//   like TCP Reno: they grow until a server refuses. On a home link the router's queue fills
//   long before that, and ping for everyone on it climbs (bufferbloat). So once a network's path
//   has been measured, it also listens to delay, like BBR:
//     queue delay ≥ max(minRTT, QUEUE_FLOOR_MS)       no growth: the pipe is full, more only queues
//     queue delay > max(2 × minRTT, BLOAT_FLOOR_MS)   cut to ⌈streams × 3/4⌉ (multiplicative
//                                                     decrease), at most once per DRAIN_MS
//     a growth that didn't raise the rate ≥ 10%      no growth for RECOVER_MS (the plateau)
//   A queue only builds when data arrives faster than the bottleneck sends it, so a growing queue
//   already says the rate can't rise. Growth doubles (slow start) until the first cut or plateau,
//   then adds one stream at a time (congestion avoidance). A cut is held like a server's ceiling,
//   and rises one stream per RECOVER_MS, which probes for more bandwidth the way BBR's ProbeBW
//   does. Off (throughput mode), or before the path has enough samples, nothing changes.
//
// No I/O and no clock of its own: it reads a snapshot, time included, and says what to do, so
// every rule can be checked against exact situations.

/** How long a lowered limit holds before it may rise by one. */
export const RECOVER_MS = 60_000
/** How long the disk must stay behind before streams are cut. */
export const DISK_PATIENCE_MS = 500
/** How long the disk must keep up before the cap it set rises: long against DISK_PATIENCE_MS, so a
 * count the disk fell behind at isn't tried again until it has shown it keeps up, and short enough
 * that a disk busy for a moment has its streams back within seconds. */
export const DISK_RECOVER_MS = 10_000
/** No write landed for this long: the disk has stopped rather than slowed down. A working hard drive
 * lands a writer's worth (512 KiB) in tens of ms. */
export const DISK_STALLED_MS = 500
/** Feature 6: queueing delay below this is jitter (server think time, Wi-Fi airtime), not a queue.
 * On a LAN minRTT is a few ms, and 2 × minRTT alone would read every hiccup as bloat. */
export const QUEUE_FLOOR_MS = 15
export const BLOAT_FLOOR_MS = 30
/** Between two cuts: long enough for sRTT (gain 1/8) to show what the last one did. */
export const DRAIN_MS = 5_000
/** How long after a growth its effect on the rate is judged. */
export const GROWTH_JUDGE_MS = 3_000
/** A growth that raised the rate less than this didn't help: the pipe was already full. */
export const GROWTH_GAIN = 1.1

export interface NetworkSnapshot {
  id: string
  /** Its streams, not counting any retiring. */
  streams: number
  /** Its streams that have received data. */
  answered: number
  /** Its streams the server refused a request from since the last snapshot. */
  refused: number
  /** Its streams that received data since the last snapshot. */
  served: number
  /** Feature 6: its path as rttEstimator.ts measures it; absent until it has enough samples. */
  path?: PathView
}

export interface PathView {
  minRttMs: number
  queueDelayMs: number
  rateBps: number
}

/** What DiskWatch reads, and since when without a break. */
export interface DiskSnapshot {
  reading: DiskReading
  since: number
}

export interface Snapshot {
  now: number
  /** The networks in use: the ones it may grow. */
  networks: readonly NetworkSnapshot[]
  /** How many more streams the waiting blocks could keep busy. */
  spareWork: number
  /** Absent, the disk isn't judged. */
  disk?: DiskSnapshot
}

export type Action = { kind: 'add' | 'retire'; networkId: string; count: number }

/** - behind: most of the download's writing streams hold bytes the disk hasn't taken, while writes
 *   land.
 * - keeping-up: most don't.
 * - unknown: no stream writing, or held while nothing lands: a disk that has stopped altogether
 *   (another program, a drive waking up) is waited out, as fewer streams wouldn't help it. */
export type DiskReading = 'behind' | 'keeping-up' | 'unknown'

/** Whether the disk is what holds a download back, judged by the clock rather than by how often
 * it is looked at: a look between two others only extends a reading or breaks it. */
export class DiskWatch {
  reading: DiskReading = 'unknown'
  since = 0
  private landedAt = 0

  /** A write reached the disk. */
  landed(now: number): void {
    this.landedAt = now
  }

  /** One look at the download: its streams that are fetching a block, and how many of those hold
   * bytes the disk hasn't taken. One between blocks, or waiting to retry, says nothing either way. */
  sample(now: number, writing: number, held: number): void {
    const reading: DiskReading =
      writing === 0
        ? 'unknown'
        : held * 2 <= writing
          ? 'keeping-up'
          : now - this.landedAt < DISK_STALLED_MS
            ? 'behind'
            : 'unknown'
    if (reading === this.reading) return
    this.reading = reading
    this.since = now
  }

  /** How long it has read `reading` without a break; 0 if it doesn't now. */
  lasted(reading: DiskReading, now: number): number {
    return this.reading === reading ? now - this.since : 0
  }

  reset(): void {
    this.reading = 'unknown'
    this.since = 0
  }
}

export class ConcurrencyController {
  /** Networks a server has refused on: the most streams each may run for now, and when that was
   * last changed. */
  private readonly ceilings = new Map<string, { limit: number; since: number }>()
  /** The most streams any network may run while the disk can't keep up (null: no cap), and from
   * when what the disk does counts toward moving it: when it last moved, or last ran below it. */
  private disk = { cap: null as number | null, from: 0 }
  /** Feature 6, by network: when it was last cut for bloat, a growth waiting to be judged, until
   * when growth is off after one that didn't help, and whether it is past slow start. */
  private readonly delay = new Map<
    string,
    {
      cutAt: number
      growth?: { at: number; rateBefore: number }
      plateauUntil: number
      avoid: boolean
    }
  >()

  constructor(
    /** The most streams a network may run. */
    private readonly maxPerNetwork: number,
    /** false: keep each network at maxPerNetwork (the user's pick) rather than doubling to it. */
    private readonly grows = true,
    /** The most a network may run for this download's share of it now (see the rules above). */
    private readonly share: (networkId: string) => number = () => Infinity,
    /** Feature 6: read every tick, so the setting applies to a download already running. */
    private readonly mode: () => CongestionMode = () => 'throughput'
  ) {}

  /** Feature 6: the delay rules (see above) for one network. Returns 'cut' with the new ceiling
   * already set, 'hold' when it mustn't grow now, or 'grow' with how many it may add at most. */
  private judgeDelay(
    network: NetworkSnapshot,
    now: number
  ): { kind: 'cut' } | { kind: 'hold' } | { kind: 'grow'; most: number } {
    const { id, streams, path } = network
    const slowStart = { kind: 'grow' as const, most: streams }
    if (!this.grows || this.mode() !== 'friendly' || !path) return slowStart
    let entry = this.delay.get(id)
    if (!entry) {
      entry = { cutAt: -Infinity, plateauUntil: -Infinity, avoid: false }
      this.delay.set(id, entry)
    }
    if (entry.growth && now - entry.growth.at >= GROWTH_JUDGE_MS) {
      if (path.rateBps < entry.growth.rateBefore * GROWTH_GAIN) {
        entry.plateauUntil = now + RECOVER_MS
        entry.avoid = true
      }
      entry.growth = undefined
    }
    const bloated = path.queueDelayMs > Math.max(2 * path.minRttMs, BLOAT_FLOOR_MS)
    if (bloated && streams > 1 && now - entry.cutAt >= DRAIN_MS) {
      const limit = Math.max(1, Math.ceil(streams * 0.75))
      const held = this.ceilings.get(id)
      this.ceilings.set(id, { limit: Math.min(limit, held?.limit ?? Infinity), since: now })
      entry.cutAt = now
      entry.avoid = true
      entry.growth = undefined
      return { kind: 'cut' }
    }
    if (path.queueDelayMs >= Math.max(path.minRttMs, QUEUE_FLOOR_MS)) return { kind: 'hold' }
    if (entry.growth || now < entry.plateauUntil) return { kind: 'hold' }
    return { kind: 'grow', most: entry.avoid ? 1 : streams }
  }

  /** Feature 6: a growth just happened on `networkId`; its effect is judged GROWTH_JUDGE_MS on. */
  private grew(network: NetworkSnapshot, now: number): void {
    const entry = this.delay.get(network.id)
    if (entry && network.path) entry.growth = { at: now, rateBefore: network.path.rateBps }
  }

  /** Feature 6: what the delay rules found, for the UI. */
  delayState(networkId: string): 'slow-start' | 'avoidance' | undefined {
    const entry = this.delay.get(networkId)
    if (!entry || this.mode() !== 'friendly') return undefined
    return entry.avoid ? 'avoidance' : 'slow-start'
  }

  tick(snapshot: Snapshot): Action[] {
    const actions: Action[] = []
    const { now } = snapshot
    let spare = snapshot.spareWork
    if (this.grows) this.judgeDisk(snapshot)
    const diskHolds = this.grows && !!snapshot.disk && snapshot.disk.reading !== 'keeping-up'
    for (const network of snapshot.networks) {
      const { id, streams } = network
      const refusedNow = network.refused > 0 && network.served > 0
      const entry = this.ceilings.get(id)
      if (refusedNow) {
        const limit = Math.max(1, Math.min(streams - network.refused, entry?.limit ?? Infinity))
        this.ceilings.set(id, { limit, since: now })
      } else if (entry && network.refused === 0 && now - entry.since >= RECOVER_MS) {
        entry.limit++
        entry.since = now
        if (entry.limit >= this.maxPerNetwork) this.ceilings.delete(id)
      }
      const delay = this.judgeDelay(network, now)
      const ceiling = this.limit(id)
      if (streams > ceiling) {
        actions.push({ kind: 'retire', networkId: id, count: streams - ceiling })
        continue
      }
      // Not while the server is turning requests away, or the disk isn't keeping up.
      if (network.refused > 0 || diskHolds || streams === 0 || network.answered < streams) continue
      if (delay.kind !== 'grow') continue
      const count = Math.min(this.grows ? delay.most : Infinity, ceiling - streams, spare)
      if (count < 1) continue
      spare -= count
      this.grew(network, now)
      actions.push({ kind: 'add', networkId: id, count })
    }
    return actions
  }

  /** The most streams a network may run now: the lowest of a server's ceiling, the disk's cap and
   * this download's share, and never more than the limit. Also what a network joining the download
   * starts with at most. */
  limit(networkId: string): number {
    return Math.min(
      this.maxPerNetwork,
      this.share(networkId),
      this.ceilings.get(networkId)?.limit ?? Infinity,
      this.disk.cap ?? Infinity
    )
  }

  /** Moves the disk's cap (see the rules above). */
  private judgeDisk({ now, disk, networks }: Snapshot): void {
    if (!disk) return
    const streams = Math.max(0, ...networks.map((network) => network.streams))
    const { cap, from } = this.disk
    // Only what was seen since the cap last moved says anything about the count it allows.
    const lasted = now - Math.max(disk.since, from)
    if (disk.reading === 'behind' && lasted >= DISK_PATIENCE_MS && streams > 1) {
      this.disk.cap = Math.ceil(streams / 2)
    } else if (disk.reading === 'keeping-up' && cap !== null && streams < cap) {
      // Keeping up below the cap (a server's ceiling, or too few blocks left) says nothing about
      // it: the wait starts once the streams are back at it.
    } else if (disk.reading === 'keeping-up' && cap !== null && lasted >= DISK_RECOVER_MS) {
      this.disk.cap = cap * 2 >= this.maxPerNetwork ? null : cap * 2
    } else return
    this.disk.from = now
  }
}
