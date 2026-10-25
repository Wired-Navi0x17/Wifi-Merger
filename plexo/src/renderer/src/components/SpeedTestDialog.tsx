import {
  SPEED_TEST_STREAMS,
  type SpeedTestNetworkResult,
  type SpeedTestProgress,
  type SpeedTestResult
} from '@shared/types'
import { cn } from 'cn'
import { Gauge, Square } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useAppStore } from '../store/useAppStore'
import { formatBytes } from '../utils/format'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

/**
 * Feature 4: a network speed test to run before a link is even pasted, so "why is this slow"
 * has a number for an answer.
 *
 * What it measures, and what it does not, is said plainly in the dialog, because all three
 * points change how the numbers should be read: it reads real bytes and throws them away (data
 * is spent, nothing is saved); networks behind one connection share that connection, so
 * everything together is often less than the parts added up; and a figure is a snapshot of one
 * moment, not a promise.
 */

/** Mbps the way a plan is sold: whole numbers above 100, one decimal below. */
function formatMbps(mbps: number | null): string {
  if (mbps === null || !Number.isFinite(mbps) || mbps <= 0) return '0'
  return mbps >= 100 ? mbps.toFixed(0) : mbps.toFixed(1)
}

/** One line saying where the test is, for the running panel. */
function stageLine(progress: SpeedTestProgress, nameOf: (id: string) => string): string {
  switch (progress.stage) {
    case 'checking':
      return progress.networkId ? `Checking ${nameOf(progress.networkId)}` : 'Checking networks'
    case 'single':
      return `${nameOf(progress.networkId ?? '')} on its own${
        progress.stageCount !== undefined && progress.stageCount > 1
          ? ` (${progress.stageIndex} of ${progress.stageCount})`
          : ''
      }`
    case 'combined':
      return 'Every network together'
    default:
      return 'Done'
  }
}

/** A rate, or the reason there is none. */
function resultRate(result: SpeedTestNetworkResult): string {
  return result.aloneMbps === null ? '—' : `${formatMbps(result.aloneMbps)} Mbps`
}

/** Only an http(s) address can be measured; anything else is not worth sending. */
function validTestUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function SpeedTestDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted only while open, so every opening starts fresh: the remembered test file, every
          network picked, no results from last time. Unmounting also stops a running test. */}
      {open && <SpeedTestBody onClose={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function SpeedTestBody({ onClose }: { onClose: () => void }): React.JSX.Element {
  const interfaces = useAppStore((store) => store.interfaces)
  const visuals = useNetworkVisuals()
  const savedUrl = useAppStore((store) => store.speedTestUrl)
  const setSpeedTestUrl = useAppStore((store) => store.setSpeedTestUrl)

  const [url, setUrl] = useState(savedUrl)
  // Every network starts picked: choosing between them only matters when the answer is "not all".
  const [selected, setSelected] = useState<string[]>(() => interfaces.map((iface) => iface.id))
  const [progress, setProgress] = useState<SpeedTestProgress | null>(null)
  const [result, setResult] = useState<SpeedTestResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const running = progress !== null

  const nameOf = useMemo(() => {
    const names = new Map(interfaces.map((iface) => [iface.id, iface.displayName]))
    return (id: string): string => names.get(id) ?? id
  }, [interfaces])

  // Progress arrives while startSpeedTest is awaited. The listener lives only as long as this
  // body, and the cleanup below stops the test when the dialog closes: a test never outlives it.
  useEffect(
    () =>
      window.plexo.onSpeedTestProgress((next) => setProgress(next.stage === 'done' ? null : next)),
    []
  )
  useEffect(() => () => void window.plexo.cancelSpeedTest(), [])

  const start = async (): Promise<void> => {
    setFailure(null)
    setResult(null)
    setSpeedTestUrl(url)
    setProgress({ stage: 'checking', progress: 0, mbps: 0, bytes: 0 })
    try {
      setResult(await window.plexo.startSpeedTest({ url: url.trim(), networkIds: selected }))
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setProgress(null)
    }
  }

  const canStart = validTestUrl(url) && selected.length > 0
  const combined = result?.combinedMbps ?? null
  const fastest = result?.fastestSingleMbps ?? null
  const gain =
    combined !== null && fastest !== null && fastest > 0
      ? ((combined - fastest) / fastest) * 100
      : null
  const cancelled = result?.outcome === 'cancelled'
  const reachable = result?.networks.filter((network) => network.aloneMbps !== null).length ?? 0
  const fastestNetwork =
    result?.networks.find(
      (network) => network.aloneMbps !== null && network.aloneMbps === fastest
    ) ?? null

  return (
    <DialogContent
      showCloseButton={false}
      className="flex max-h-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-[560px]"
    >
      <div className="flex items-center gap-2 border-b-[0.5px] border-border py-3 pr-3 pl-5">
        <Gauge aria-hidden className="size-4 shrink-0 text-[var(--color-accent)]" />
        <DialogTitle className="flex-1 py-1 text-[16px] font-semibold">
          Network speed test
        </DialogTitle>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto p-4">
        <p className="text-[12.5px] leading-snug text-[var(--text-secondary)]">
          Reads real bytes from a test file and throws them away, so nothing is saved. Those bytes
          still come off your data allowance.
        </p>

        <div className="flex items-center gap-3">
          <label
            className="w-16 shrink-0 text-[12.5px] text-[var(--text-secondary)]"
            htmlFor="speedtest-url"
          >
            Test file
          </label>
          <input
            id="speedtest-url"
            type="text"
            value={url}
            disabled={running}
            spellCheck={false}
            onChange={(event) => setUrl(event.target.value)}
            className={cn(
              'h-8 min-w-0 flex-1 rounded-none border border-input bg-[var(--input-bg)] px-2.5 font-mono text-[11.5px] text-foreground outline-none focus-visible:border-ring disabled:opacity-60',
              !validTestUrl(url) && 'border-[var(--color-danger-border)]'
            )}
          />
        </div>

        <div className="flex items-start gap-3">
          <div
            id="speedtest-networks"
            className="w-16 shrink-0 pt-1 text-[12.5px] text-[var(--text-secondary)]"
          >
            Networks
          </div>
          <div
            role="group"
            aria-labelledby="speedtest-networks"
            className="flex min-w-0 flex-1 flex-wrap gap-1.5"
          >
            {interfaces.map((iface) => {
              const visual = visuals(iface.id, iface.kind, iface.displayName)
              const picked = selected.includes(iface.id)
              return (
                <button
                  key={iface.id}
                  type="button"
                  aria-pressed={picked}
                  disabled={running}
                  onClick={() =>
                    setSelected((current) =>
                      current.includes(iface.id)
                        ? current.filter((id) => id !== iface.id)
                        : [...current, iface.id]
                    )
                  }
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-none border px-2.5 text-[12.5px] transition-colors',
                    picked
                      ? 'border-transparent'
                      : 'border-border text-[var(--text-secondary)] opacity-70',
                    running && 'cursor-not-allowed opacity-50'
                  )}
                  style={picked ? { background: visual.bg, borderColor: visual.border } : undefined}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: visual.solid }}
                  />
                  {visual.name}
                </button>
              )
            })}
            {interfaces.length === 0 && (
              <span className="py-1 text-[12.5px] text-[var(--text-secondary)]">
                No networks connected
              </span>
            )}
          </div>
        </div>

        {progress && (
          <div className="flex flex-col gap-2 border-[0.5px] border-border bg-[var(--input-bg)] p-3">
            <div className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="min-w-0 truncate">{stageLine(progress, nameOf)}</span>
              <span className="font-mono tabular-nums">{formatMbps(progress.mbps)} Mbps</span>
            </div>
            <div
              role="progressbar"
              aria-label="Speed test progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress.progress * 100)}
              className="h-2.5 w-full overflow-hidden border-[0.5px] border-[var(--border-strong)] bg-[var(--track-bg)]"
            >
              <div
                className="h-full bg-[var(--color-accent)]"
                style={{ width: `${Math.round(progress.progress * 100)}%` }}
              />
            </div>
            <div className="text-[11.5px] text-[var(--text-secondary)]">
              {SPEED_TEST_STREAMS} streams · {formatBytes(progress.bytes)} read so far
            </div>
          </div>
        )}

        {result && !running && (
          <div className="flex flex-col gap-3">
            <div className="flex items-end gap-4 border-[0.5px] border-border bg-[var(--input-bg)] p-3">
              <div>
                <div className="text-[11px] tracking-wide text-[var(--text-secondary)] uppercase">
                  All networks together
                </div>
                <div className="font-mono text-[26px] leading-tight tabular-nums">
                  {combined === null ? '—' : formatMbps(combined)}
                  <span className="ml-1 text-[12px] text-[var(--text-secondary)]">Mbps</span>
                </div>
              </div>
              <div className="min-w-0 flex-1 text-[11.5px] leading-snug text-[var(--text-secondary)]">
                {cancelled ? (
                  'Stopped before every stage ran, so there is no fair comparison.'
                ) : fastest === null ? (
                  'No network answered, so there was nothing to measure.'
                ) : reachable < 2 ? (
                  'Only one network answered, so this is also its own rate.'
                ) : (
                  <>
                    Fastest on its own:{' '}
                    {fastestNetwork ? `${nameOf(fastestNetwork.networkId)}, ` : ''}
                    <span className="font-mono">{formatMbps(fastest)} Mbps</span>
                    {gain !== null && (
                      <>
                        <br />
                        All together is {Math.abs(gain).toFixed(1)}%{' '}
                        {gain >= 0 ? 'faster' : 'slower'} than that.
                      </>
                    )}
                  </>
                )}
                <br />
                Used {formatBytes(result.totalBytes)} in {result.seconds.toFixed(0)}s ·{' '}
                {result.streams} streams per stage
                {result.outcome === 'cancelled' && ' · stopped early'}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {result.networks.map((network) => {
                const iface = interfaces.find((entry) => entry.id === network.networkId)
                const visual = iface ? visuals(iface.id, iface.kind, iface.displayName) : undefined
                return (
                  <div key={network.networkId} className="flex items-start gap-3 text-[12.5px]">
                    <span
                      className="mt-1 size-2 shrink-0 rounded-full"
                      style={{ background: visual?.solid ?? 'var(--color-neutral)' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{visual?.name ?? network.networkId}</div>
                      {network.aloneMbps === null && (
                        <div className="text-[11.5px] text-[var(--color-danger)]">
                          {network.error ?? 'No answer'}
                        </div>
                      )}
                    </div>
                    <span className="w-24 shrink-0 text-right font-mono tabular-nums">
                      {resultRate(network)}
                    </span>
                    <span className="w-24 shrink-0 text-right text-[var(--text-secondary)] tabular-nums">
                      {network.share === undefined
                        ? ''
                        : `${(network.share * 100).toFixed(0)}% of the total`}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* The part a bare number leaves out. */}
            <ul className="flex flex-col gap-1 border-t-[0.5px] border-border pt-2 text-[11.5px] leading-snug text-[var(--text-secondary)]">
              <li>
                Networks behind one connection share its capacity, so all together is often less
                than the networks added up.
              </li>
              <li>
                Conditions change: another device, a busier moment or another server gives other
                numbers.
              </li>
              <li>These figures describe one moment, not what to expect every time.</li>
            </ul>
          </div>
        )}

        {failure && (
          <p className="text-[12.5px] text-[var(--color-danger)]" role="alert">
            {failure}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t-[0.5px] border-border px-4 py-2">
        <div className="flex-1" />
        {running ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void window.plexo.cancelSpeedTest()}
          >
            <Square aria-hidden className="size-3.5" />
            Stop
          </Button>
        ) : (
          <Button type="button" disabled={!canStart} onClick={() => void start()}>
            <Gauge aria-hidden className="size-4" />
            {result ? 'Test again' : 'Start test'}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </DialogContent>
  )
}
