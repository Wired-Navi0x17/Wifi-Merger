import type {
  NetworkInterfaceInfo,
  NetworkInterfaceKind,
  NetworkPreference
} from '../../../shared/types'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let exponent = Math.max(
    0,
    Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  )
  let value = bytes / 1024 ** exponent
  if (exponent < UNITS.length - 1 && Number(value.toFixed(exponent === 0 ? 0 : 1)) >= 1024) {
    exponent += 1
    value = bytes / 1024 ** exponent
  }
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${UNITS[exponent]}`
}

export interface InterfaceSimulationEntry {
  id: string
  name: string
  kind: NetworkInterfaceKind
  estimatedSpeedBytesPerSec: number
  quotaRemainingBytes: number | null
  isMetered: boolean
  willExceedQuota: boolean
  chunkAllocationPct: number
  allocatedBytes: number
}

export interface SimulationResult {
  fileSizeBytes: number
  peakStorageBytes: number
  finalStorageBytes: number
  freeDiskSpaceBytes: number | null
  diskRemainingAfterDownloadBytes: number | null
  storageSafetyStatus: 'safe' | 'low_margin' | 'insufficient'
  storageSafetyMessage: string
  interfaces: InterfaceSimulationEntry[]
  aggregatedSpeedBytesPerSec: number
  singleFastestSpeedBytesPerSec: number
  speedupMultiplier: number
  estimatedDurationSeconds: number
  singleInterfaceDurationSeconds: number
  timeSavedSeconds: number
  formattedEta: string
  formattedSingleEta: string
  formattedTimeSaved: string
  mascotState: 'ready' | 'turbo' | 'caution'
}

export interface SimulationParams {
  fileSizeBytes: number
  interfaces: NetworkInterfaceInfo[]
  networkPreferences: Record<string, NetworkPreference>
  networkUsage?: Record<string, number>
  freeDiskSpaceBytes: number | null
}

export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSecs = Math.round(seconds % 60)
  if (minutes < 60) {
    return remainingSecs > 0 ? `${minutes}m ${remainingSecs}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMins = minutes % 60
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`
}

const DEFAULT_BASE_SPEEDS: Record<string, number> = {
  ethernet: 62_914_560, // ~60 MB/s
  wifi: 29_360_128, // ~28 MB/s
  cellular: 12_582_912, // ~12 MB/s
  other: 20_971_520 // ~20 MB/s
}

/** Splits `total` into whole parts in proportion to `shares` (which sum to 1), summing exactly to
 * `total`: each gets its floor, and the leftover units go to the largest fractional parts. */
export function largestRemainder(shares: number[], total: number): number[] {
  const exact = shares.map((share) => share * total)
  const parts = exact.map(Math.floor)
  let left = total - parts.reduce((sum, part) => sum + part, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest)
  for (let i = 0; left > 0 && byRemainder.length > 0; i = (i + 1) % byRemainder.length, left--) {
    parts[byRemainder[i].index] += 1
  }
  return parts
}

/** Enhancement 7: said in the dialog, because the numbers are a model, not a measurement. */
export const SIMULATION_ASSUMPTIONS =
  'Estimate only: each network is assumed to run at a default speed for its kind (Ethernet 60 MB/s, Wi-Fi 28 MB/s, cellular 12 MB/s, other 20 MB/s), capped by any speed limit you set, with 92% efficiency when combining. Nothing has been measured yet.'

/**
 * Calculates pre-download simulation metrics including multi-interface bonding speedup,
 * ETA comparisons, chunk partitioning, and peak temporary vs final storage margins.
 */
export function calculateDownloadSimulation(params: SimulationParams): SimulationResult {
  const {
    fileSizeBytes,
    interfaces,
    networkPreferences,
    networkUsage = {},
    freeDiskSpaceBytes
  } = params

  // 1. Filter enabled interfaces
  const activeIfaces = interfaces.filter((i) => !networkPreferences?.[i.id]?.off)

  // 2. Compute speeds per interface
  const ifaceEntries: Array<{
    info: NetworkInterfaceInfo
    speed: number
    quotaRemaining: number | null
    isMetered: boolean
  }> = activeIfaces.map((i) => {
    const pref = networkPreferences?.[i.id]
    const baseSpeed = DEFAULT_BASE_SPEEDS[i.kind] ?? DEFAULT_BASE_SPEEDS.other
    const speed =
      pref?.speedLimit && pref.speedLimit > 0 ? Math.min(pref.speedLimit, baseSpeed) : baseSpeed

    let quotaRemaining: number | null = null
    const isMetered = Boolean(pref?.dataLimit && pref.dataLimit > 0)
    if (pref?.dataLimit && pref.dataLimit > 0) {
      const used = networkUsage[i.id] ?? 0
      quotaRemaining = Math.max(0, pref.dataLimit - used)
    }

    return { info: i, speed, quotaRemaining, isMetered }
  })

  // 3. Aggregate speeds with concurrency efficiency factor
  const totalRawSpeed = ifaceEntries.reduce((acc, curr) => acc + curr.speed, 0)
  const bondingEfficiency = ifaceEntries.length > 1 ? 0.92 : 1.0
  const aggregatedSpeedBytesPerSec = Math.max(1, Math.round(totalRawSpeed * bondingEfficiency))

  // The fastest network on its own. Starts from 0, not a default: a lone network capped at
  // 1 MB/s must compare against 1 MB/s. With none on, 1 B/s keeps the divisions finite.
  const singleFastestSpeedBytesPerSec = Math.max(
    1,
    ifaceEntries.reduce((max, curr) => Math.max(max, curr.speed), 0)
  )

  const speedupMultiplier =
    ifaceEntries.length > 1
      ? Math.max(
          1.0,
          Math.round((aggregatedSpeedBytesPerSec / singleFastestSpeedBytesPerSec) * 10) / 10
        )
      : 1.0

  // 4. Time calculations
  const effectiveFileSize = Math.max(fileSizeBytes, 1)
  const estimatedDurationSeconds = Math.ceil(effectiveFileSize / aggregatedSpeedBytesPerSec)
  const singleInterfaceDurationSeconds = Math.ceil(
    effectiveFileSize / singleFastestSpeedBytesPerSec
  )
  const timeSavedSeconds = Math.max(0, singleInterfaceDurationSeconds - estimatedDurationSeconds)

  // 5. Chunk distribution proportional to interface speed. Whole percentages by the largest
  // remainder method, so the shares always add up to exactly 100 (rounding each one alone can
  // give 99 or 101); bytes the same way, so they add up to the file size.
  let anyQuotaExceeded = false
  const shares = ifaceEntries.map((curr) =>
    totalRawSpeed > 0 ? curr.speed / totalRawSpeed : 1 / ifaceEntries.length
  )
  const pcts = largestRemainder(shares, 100)
  const bytesShares = largestRemainder(shares, effectiveFileSize)
  const calculatedInterfaces: InterfaceSimulationEntry[] = ifaceEntries.map((curr, index) => {
    const chunkAllocationPct = pcts[index]
    const allocatedBytes = bytesShares[index]

    const willExceedQuota = curr.quotaRemaining !== null && allocatedBytes > curr.quotaRemaining
    if (willExceedQuota) anyQuotaExceeded = true

    return {
      id: curr.info.id,
      name: curr.info.displayName || curr.info.device,
      kind: curr.info.kind,
      estimatedSpeedBytesPerSec: curr.speed,
      quotaRemainingBytes: curr.quotaRemaining,
      isMetered: curr.isMetered,
      willExceedQuota,
      chunkAllocationPct,
      allocatedBytes
    }
  })

  // 6. Storage calculations: peak buffer (1.08x) vs final file size
  const finalStorageBytes = fileSizeBytes
  const peakStorageBytes = Math.ceil(fileSizeBytes * 1.08)

  let storageSafetyStatus: 'safe' | 'low_margin' | 'insufficient' = 'safe'
  let storageSafetyMessage = 'Ready for download'
  let diskRemainingAfterDownloadBytes: number | null = null

  if (freeDiskSpaceBytes !== null && Number.isFinite(freeDiskSpaceBytes)) {
    diskRemainingAfterDownloadBytes = Math.max(0, freeDiskSpaceBytes - finalStorageBytes)
    const FIVE_GIB = 5 * 1024 * 1024 * 1024

    if (freeDiskSpaceBytes < peakStorageBytes) {
      storageSafetyStatus = 'insufficient'
      storageSafetyMessage = `Insufficient storage. Requires at least ${formatBytes(peakStorageBytes)} during download.`
    } else if (freeDiskSpaceBytes < peakStorageBytes + FIVE_GIB) {
      storageSafetyStatus = 'low_margin'
      storageSafetyMessage = `Low headroom. Less than 5 GB free will remain after download.`
    } else {
      storageSafetyStatus = 'safe'
      storageSafetyMessage = `${formatBytes(diskRemainingAfterDownloadBytes)} remaining after completion.`
    }
  }

  // 7. Mascot status determination
  let mascotState: 'ready' | 'turbo' | 'caution' = 'ready'
  if (storageSafetyStatus !== 'safe' || anyQuotaExceeded || activeIfaces.length === 0) {
    mascotState = 'caution'
  } else if (speedupMultiplier >= 1.4 && activeIfaces.length > 1) {
    mascotState = 'turbo'
  }

  return {
    fileSizeBytes,
    peakStorageBytes,
    finalStorageBytes,
    freeDiskSpaceBytes,
    diskRemainingAfterDownloadBytes,
    storageSafetyStatus,
    storageSafetyMessage,
    interfaces: calculatedInterfaces,
    aggregatedSpeedBytesPerSec,
    singleFastestSpeedBytesPerSec,
    speedupMultiplier,
    estimatedDurationSeconds,
    singleInterfaceDurationSeconds,
    timeSavedSeconds,
    formattedEta: formatDurationSeconds(estimatedDurationSeconds),
    formattedSingleEta: formatDurationSeconds(singleInterfaceDurationSeconds),
    formattedTimeSaved: formatDurationSeconds(timeSavedSeconds),
    mascotState
  }
}
