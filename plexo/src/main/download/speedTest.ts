import { URL } from 'node:url'
import {
  SPEED_TEST_STREAMS,
  type NetworkInterfaceInfo,
  type SpeedTestNetworkResult,
  type SpeedTestProgress,
  type SpeedTestRequest,
  type SpeedTestResult,
  type SpeedTestStage
} from '../../shared/types'
import { testKnobs } from '../testKnobs'
import { requestHeaders } from './browserContext'
import { StreamConnection } from '../network/routes'

/**
 * Feature 4: measures what each network can actually carry, before any download exists.
 *
 * The method is the same one a download would use: streams of real HTTP GETs, each pinned to one
 * network (see network/routes.ts), reading the body and throwing it away. Nothing is ever written
 * to disk, so the test costs data and time, never space.
 *
 * Each stage runs the same total number of streams, so the figures are comparable: a network on
 * its own gets all of them, and in the combined stage they are shared out between the networks.
 * Every stage begins with a warm-up whose bytes are counted as data used but left out of the
 * rate, because the first second of a connection is TCP slow start rather than what it can do
 * once going. A stage stops after SPEED_TEST_STAGE_MS or SPEED_TEST_MAX_BYTES, whichever comes
 * first.
 *
 * It measures one moment. Upstream capacity is shared, so two networks behind one link will not
 * add up to their sum, and a busy hour or a different server will give other numbers.
 */

const PROBE_TIMEOUT_MS = 6000
/** How long a stream may wait for response headers before it is treated as stalled. */
const HEADERS_TIMEOUT_MS = 15_000
/** How often the progress event goes out. */
const TICK_MS = 250

/** An error as something a person can act on, rather than a Node error message. */
function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/ENETUNREACH|EHOSTUNREACH|no route/i.test(message)) return 'No route from this network'
  if (/ECONNREFUSED/i.test(message)) return 'The connection was refused'
  if (/ENOTFOUND|EAI_AGAIN|resolve/i.test(message)) return 'The host could not be resolved'
  if (/stalled|timed out|timeout/i.test(message)) return 'No answer in time'
  if (/certificate|TLS|SSL/i.test(message)) return 'The secure connection failed'
  if (/abort/i.test(message)) return 'Stopped'
  return message
}

interface StageOutcome {
  /** Bytes read in the stage, warm-up included. */
  bytes: number
  /** Each network's bytes in the stage. */
  perNetwork: Map<string, number>
  /** Bytes read after the warm-up, which the rate is taken over. */
  measuredBytes: number
  /** Seconds the rate was taken over. */
  seconds: number
  /** Mbps over the measured window. */
  mbps: number
  /** The first failure seen, if every stream failed: why the stage measured nothing. */
  failure?: string
}

export class SpeedTestRun {
  private readonly controllers = new Set<AbortController>()
  private cancelled = false
  private totalBytes = 0
  private url: URL

  constructor(
    private readonly request: SpeedTestRequest,
    private readonly interfaces: NetworkInterfaceInfo[],
    private readonly onProgress: (progress: SpeedTestProgress) => void
  ) {
    this.url = new URL(request.url)
  }

  /** Stops the running stage; run() then resolves with what was measured, marked cancelled. */
  cancel(): void {
    this.cancelled = true
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }

  async run(): Promise<SpeedTestResult> {
    const startedAt = Date.now()
    const chosen = this.request.networkIds
      .map((id) => this.interfaces.find((iface) => iface.id === id))
      .filter((iface): iface is NetworkInterfaceInfo => iface !== undefined)

    const networks = new Map<string, SpeedTestNetworkResult>(
      chosen.map((iface) => [iface.id, { networkId: iface.id, aloneMbps: null, bytes: 0 }])
    )

    // 1. One request each, so a network that cannot reach the URL at all is named before any
    //    measurement stage spends time on it.
    const reachable: NetworkInterfaceInfo[] = []
    for (const iface of chosen) {
      if (this.cancelled) break
      this.emit({
        stage: 'checking',
        networkId: iface.id,
        progress: 0,
        mbps: 0,
        bytes: this.totalBytes
      })
      const failure = await this.check(iface)
      if (failure) networks.get(iface.id)!.error = failure
      else reachable.push(iface)
    }

    // 2. Each reachable network on its own, with every stream, one after another.
    for (const [index, iface] of reachable.entries()) {
      if (this.cancelled) break
      const outcome = await this.measure('single', [{ iface, streams: SPEED_TEST_STREAMS }], {
        networkId: iface.id,
        stageIndex: index + 1,
        stageCount: reachable.length
      })
      const result = networks.get(iface.id)!
      result.aloneMbps = outcome.mbps
      result.bytes += outcome.bytes
      if (outcome.failure && outcome.measuredBytes === 0) result.error = outcome.failure
    }

    // 3. Every network that answered, together, sharing the same total number of streams.
    let combinedMbps: number | null = null
    if (!this.cancelled && reachable.length > 0) {
      const plan = shareStreams(reachable, SPEED_TEST_STREAMS)
      const outcome = await this.measure('combined', plan, {})
      combinedMbps = outcome.mbps
      for (const { iface } of plan) {
        const bytes = outcome.perNetwork.get(iface.id) ?? 0
        const result = networks.get(iface.id)!
        result.bytes += bytes
        result.share = outcome.bytes > 0 ? bytes / outcome.bytes : 0
        result.combinedMbps = outcome.measuredBytes > 0 ? (bytes * 8) / 1e6 / outcome.seconds : 0
      }
    }

    this.emit({ stage: 'done', progress: 1, mbps: combinedMbps ?? 0, bytes: this.totalBytes })

    const speeds = [...networks.values()]
      .map((network) => network.aloneMbps)
      .filter((mbps): mbps is number => mbps !== null)
    return {
      outcome: this.cancelled ? 'cancelled' : 'done',
      url: this.request.url,
      streams: SPEED_TEST_STREAMS,
      networks: [...networks.values()],
      combinedMbps,
      fastestSingleMbps: speeds.length > 0 ? Math.max(...speeds) : null,
      totalBytes: this.totalBytes,
      seconds: (Date.now() - startedAt) / 1000
    }
  }

  private emit(progress: Omit<SpeedTestProgress, 'bytes'> & { bytes?: number }): void {
    this.onProgress({ ...progress, bytes: progress.bytes ?? this.totalBytes })
  }

  /** Whether this network can reach the URL at all: headers only, the body dropped at once. */
  private async check(iface: NetworkInterfaceInfo): Promise<string | null> {
    const controller = new AbortController()
    this.controllers.add(controller)
    const connection = new StreamConnection(() => iface, {
      timeoutMs: PROBE_TIMEOUT_MS,
      connectTimeoutMs: PROBE_TIMEOUT_MS
    })
    try {
      const { res } = await connection.request(
        this.url,
        requestHeaders(this.url),
        controller.signal
      )
      res.destroy()
      const status = res.statusCode ?? 0
      if (status >= 400) return `The server answered ${status}`
      return null
    } catch (error) {
      return this.cancelled ? 'Stopped' : describeFailure(error)
    } finally {
      this.controllers.delete(controller)
      connection.close()
    }
  }

  /** Runs one stage and reports its rate. Never throws: a stage that fails says so in `failure`. */
  private async measure(
    stage: SpeedTestStage,
    plan: { iface: NetworkInterfaceInfo; streams: number }[],
    position: { networkId?: string; stageIndex?: number; stageCount?: number }
  ): Promise<StageOutcome> {
    const controller = new AbortController()
    this.controllers.add(controller)
    const startedAt = Date.now()
    const warmupEndsAt = startedAt + testKnobs.speedTestWarmupMs
    const stopsAt = warmupEndsAt + testKnobs.speedTestStageMs
    const maxBytes = testKnobs.speedTestMaxBytes

    const perNetwork = new Map<string, number>()
    let bytes = 0
    let measuredBytes = 0
    let failure: string | undefined

    const enough = (): boolean => this.cancelled || Date.now() >= stopsAt || bytes >= maxBytes
    const count = (networkId: string, read: number): void => {
      bytes += read
      perNetwork.set(networkId, (perNetwork.get(networkId) ?? 0) + read)
      if (Date.now() >= warmupEndsAt) measuredBytes += read
    }

    const tick = (): void => {
      const seconds = Math.max((Date.now() - warmupEndsAt) / 1000, 0.001)
      const spent = (Date.now() - startedAt) / 1000
      const stageSeconds = (testKnobs.speedTestWarmupMs + testKnobs.speedTestStageMs) / 1000
      this.emit({
        stage,
        ...position,
        progress: Math.min(1, maxBytes > 0 ? Math.max(bytes / maxBytes, spent / stageSeconds) : 1),
        mbps: (measuredBytes * 8) / 1e6 / seconds,
        bytes: this.totalBytes + bytes
      })
    }
    this.emit({ stage, ...position, progress: 0, mbps: 0, bytes: this.totalBytes })

    const timer = setInterval(tick, TICK_MS)
    try {
      const streams = plan.flatMap(({ iface, streams: streamCount }) =>
        Array.from({ length: streamCount }, () =>
          this.drain(iface, controller.signal, enough, (read) => count(iface.id, read)).catch(
            (error: unknown) => {
              failure ??= describeFailure(error)
            }
          )
        )
      )
      await Promise.all(streams)
    } finally {
      clearInterval(timer)
      this.controllers.delete(controller)
    }

    this.totalBytes += bytes
    const seconds = Math.max((Math.min(Date.now(), stopsAt) - warmupEndsAt) / 1000, 0.001)
    return {
      bytes,
      perNetwork,
      measuredBytes,
      seconds,
      mbps: (measuredBytes * 8) / 1e6 / seconds,
      failure
    }
  }

  /** One stream: GET after GET, every body read and dropped, until the stage is over. A response
   * that ends early (the file ran out, or the server closed it) is simply asked for again. */
  private async drain(
    iface: NetworkInterfaceInfo,
    signal: AbortSignal,
    enough: () => boolean,
    count: (bytes: number) => void
  ): Promise<void> {
    const connection = new StreamConnection(() => iface, {
      timeoutMs: HEADERS_TIMEOUT_MS,
      connectTimeoutMs: PROBE_TIMEOUT_MS
    })
    // Cache-Control: the same file again must actually be sent, not answered from a cache.
    const headers = { ...requestHeaders(this.url), 'Cache-Control': 'no-store' }
    try {
      while (!signal.aborted && !enough()) {
        const { res } = await connection.request(this.url, headers, signal)
        try {
          for await (const chunk of res) {
            count((chunk as Buffer).length)
            if (signal.aborted || enough()) {
              res.destroy()
              return
            }
          }
        } catch {
          // The socket was destroyed mid-read, by us or by the network: whatever arrived counts.
          return
        }
      }
    } finally {
      connection.close()
    }
  }
}

/** The same total number of streams, shared out as evenly as they divide. */
function shareStreams(
  interfaces: NetworkInterfaceInfo[],
  streams: number
): { iface: NetworkInterfaceInfo; streams: number }[] {
  const each = Math.floor(streams / interfaces.length)
  const spare = streams % interfaces.length
  return interfaces.map((iface, index) => ({ iface, streams: each + (index < spare ? 1 : 0) }))
}
