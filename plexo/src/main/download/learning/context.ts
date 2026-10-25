import type { NetworkInterfaceKind } from '../../../shared/types'

// Context key: host plus network kind plus size band plus range support. Small enough
// to get repeat visits (learning needs repeats), specific enough to matter: a host
// that throttles phones but not Wi-Fi learns two lessons, not one blurred average.

export type SizeBand = 's' | 'm' | 'l'

export function sizeBand(totalBytes: number): SizeBand {
  if (totalBytes > 0 && totalBytes < 10 * 1024 * 1024) return 's'
  if (totalBytes > 0 && totalBytes <= 500 * 1024 * 1024) return 'm'
  return 'l'
}

/** Lowercase host without port or brackets; garbage in gives 'unknown', never throws. */
export function normalizeHost(host: string): string {
  const cleaned = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/:\d+$/, '')
  if (!/^[a-z0-9.-]{1,253}$/.test(cleaned)) return 'unknown'
  return cleaned
}

export function contextKey(
  host: string,
  kind: NetworkInterfaceKind,
  totalBytes: number,
  supportsRanges: boolean
): string {
  return `${normalizeHost(host)}|${kind}|${sizeBand(totalBytes)}|${supportsRanges ? 'r' : 's'}`
}
