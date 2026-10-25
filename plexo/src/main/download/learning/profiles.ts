import type { NetworkInterfaceKind } from '../../../shared/types'

// Persistent local learning: per-host and per-network profiles. Pure data plus pure
// updates, so every rule can be checked without I/O. Storage lives in store.ts.
// Nothing here touches the network. Torrents record the same shape; acting on it is
// HTTP tail-only for now (see bandit.ts).

export interface HostProfile {
  host: string
  downloads: number
  completed: number
  /** Exponential moving average of goodput in bytes/sec. */
  ewmaThroughput: number
  /** Exponential moving average of time to first byte in ms. */
  ewmaTtfb: number
  refusals: { refused403: number; refused429: number; refused503: number; other: number }
  /** Retried chunk requests across runs (proxy for server pressure; status-code
   * breakdown arrives in a later phase, see recordOutcome). */
  retries: number
  stalls: number
  /** Exponential moving average of tail length in ms (last pending block to done). */
  ewmaTailMs: number
  updatedAt: number
}

export interface NetworkLearnProfile {
  key: string
  kind: NetworkInterfaceKind
  downloads: number
  ewmaThroughput: number
  stalls: number
  updatedAt: number
}

/** What a finished run reports. Reward math lives in bandit.ts. */
export interface RunOutcome {
  host: string
  networkKind: NetworkInterfaceKind
  networkKey: string
  bytes: number
  durationMs: number
  ttfbMs: number
  retries: number
  stalls: number
  completed: boolean
  tailMs: number
}

const ALPHA = 0.3

function ewma(previous: number, sample: number): number {
  if (previous <= 0) return sample
  return previous + ALPHA * (sample - previous)
}

export function freshHostProfile(host: string, now = Date.now()): HostProfile {
  return {
    host,
    downloads: 0,
    completed: 0,
    ewmaThroughput: 0,
    ewmaTtfb: 0,
    refusals: { refused403: 0, refused429: 0, refused503: 0, other: 0 },
    retries: 0,
    stalls: 0,
    ewmaTailMs: 0,
    updatedAt: now
  }
}

export function freshNetworkProfile(
  key: string,
  kind: NetworkInterfaceKind,
  now = Date.now()
): NetworkLearnProfile {
  return { key, kind, downloads: 0, ewmaThroughput: 0, stalls: 0, updatedAt: now }
}

/** Folds one run into its host and network profiles. Returns both for the caller to persist. */
export function recordOutcome(
  host: HostProfile,
  network: NetworkLearnProfile,
  outcome: RunOutcome,
  now = Date.now()
): void {
  host.downloads += 1
  network.downloads += 1
  if (outcome.completed) host.completed += 1
  const seconds = Math.max(outcome.durationMs / 1000, 0.001)
  host.ewmaThroughput = ewma(host.ewmaThroughput, outcome.bytes / seconds)
  network.ewmaThroughput = ewma(network.ewmaThroughput, outcome.bytes / seconds)
  if (outcome.ttfbMs > 0) host.ewmaTtfb = ewma(host.ewmaTtfb, outcome.ttfbMs)
  if (outcome.tailMs > 0) host.ewmaTailMs = ewma(host.ewmaTailMs, outcome.tailMs)
  host.retries += outcome.retries
  host.stalls += outcome.stalls
  network.stalls += outcome.stalls
  host.updatedAt = now
  network.updatedAt = now
}

/** A host that repeatedly forces retries is the per-connection rate limiter the open issue
 * describes: capped, not dead. Status-code breakdown refines this in a later phase. */
export function looksRateLimited(host: HostProfile): boolean {
  const refused = host.refusals.refused429 + host.refusals.refused503 + host.refusals.refused403
  return host.downloads >= 2 && refused + host.retries >= 3
}
