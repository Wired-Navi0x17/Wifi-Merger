import type { ChecksumAlgorithm } from './types'

/** Enhancement 5: helpers shared by the main process and the New Download dialog. */

export const CHECKSUM_ALGORITHMS: readonly ChecksumAlgorithm[] = ['md5', 'sha1', 'sha256']

const HEX_LENGTH: Record<ChecksumAlgorithm, number> = { md5: 32, sha1: 40, sha256: 64 }

/** Lower-case hex, whitespace stripped; null when it can't be this algorithm's digest. */
export function normalizeChecksum(algorithm: ChecksumAlgorithm, value: string): string | null {
  const hex = value.trim().toLowerCase()
  return new RegExp(`^[0-9a-f]{${HEX_LENGTH[algorithm]}}$`).test(hex) ? hex : null
}

/** Guesses the algorithm from a pasted digest's length (32 → MD5, 40 → SHA-1, 64 → SHA-256). */
export function detectAlgorithm(value: string): ChecksumAlgorithm | null {
  return (
    CHECKSUM_ALGORITHMS.find((algorithm) => normalizeChecksum(algorithm, value) !== null) ?? null
  )
}
