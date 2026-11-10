import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Layers,
  Loader2,
  ShieldAlert,
  Zap
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { useAppStore } from '../store/useAppStore'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { formatBytes } from '../utils/format'
import { calculateDownloadSimulation, SIMULATION_ASSUMPTIONS } from '../utils/simulationEngine'
import { ANIME_MASCOT_CAUTION, ANIME_MASCOT_READY, ANIME_MASCOT_TURBO } from './ascii/animeAsciiArt'

interface PreDownloadSimulationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  fileSizeBytes: number
  thumbnailUrl?: string
  pageUrl?: string
  onConfirmDownload: (selectedInterfaceIds: string[]) => void
  isStarting?: boolean
}

export function PreDownloadSimulationDialog({
  open,
  onOpenChange,
  title,
  fileSizeBytes,
  pageUrl,
  onConfirmDownload,
  isStarting = false
}: PreDownloadSimulationDialogProps): React.JSX.Element | null {
  const interfaces = useAppStore((store) => store.interfaces || [])
  const networkPreferences = useAppStore((store) => store.networkPreferences || {})
  const destinationDir = useAppStore((store) => store.destinationDir)
  const setDestinationDir = useAppStore((store) => store.setDestinationDir)

  const [freeSpace, setFreeSpace] = useState<number | null>(null)
  const [networkUsage, setNetworkUsage] = useState<Record<string, number>>({})
  const [disabledIfaces, setDisabledIfaces] = useState<Set<string>>(new Set())
  const networkVisual = useNetworkVisuals()

  // Fetch live disk space and network usage upon dialog opening
  useEffect(() => {
    if (!open) return
    let active = true

    const loadMetrics = async (): Promise<void> => {
      try {
        if (destinationDir) {
          const space = await window.plexo.freeSpace(destinationDir)
          if (active) setFreeSpace(space)
        }
        const usage = await window.plexo.networkUsage()
        if (active && usage) setNetworkUsage(usage)
      } catch {
        // keep fallback
      }
    }

    void loadMetrics()
    return () => {
      active = false
    }
  }, [open, destinationDir])

  // Filter interfaces with local dialog override toggles
  const activeInterfaces = useMemo(() => {
    return (interfaces || []).filter((i) => !disabledIfaces.has(i.id))
  }, [interfaces, disabledIfaces])

  const simulation = useMemo(() => {
    return calculateDownloadSimulation({
      fileSizeBytes,
      interfaces: activeInterfaces,
      networkPreferences,
      networkUsage,
      freeDiskSpaceBytes: freeSpace
    })
  }, [fileSizeBytes, activeInterfaces, networkPreferences, networkUsage, freeSpace])

  const toggleInterface = (id: string): void => {
    setDisabledIfaces((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        // Prevent disabling all interfaces
        if (activeInterfaces.length > 1) {
          next.add(id)
        }
      }
      return next
    })
  }

  const handleChangeFolder = async (): Promise<void> => {
    try {
      const selected = await window.plexo.chooseDestinationFolder(destinationDir || '')
      if (selected) {
        setDestinationDir(selected)
        const space = await window.plexo.freeSpace(selected)
        setFreeSpace(space)
      }
    } catch {
      // ignore
    }
  }

  const handleLaunchBrowser = (): void => {
    if (pageUrl) {
      void window.plexo.openExternalUrl(pageUrl)
    }
  }

  const handleConfirm = (): void => {
    const selectedIds = simulation.interfaces.map((i) => i.id)
    onConfirmDownload(selectedIds)
  }

  // Choose the authentic anime ASCII art matching the simulation readiness state
  const mascotAscii =
    simulation.mascotState === 'turbo'
      ? ANIME_MASCOT_TURBO
      : simulation.mascotState === 'caution'
        ? ANIME_MASCOT_CAUTION
        : ANIME_MASCOT_READY

  const bannerLabel =
    simulation.mascotState === 'turbo'
      ? 'MULTI-INTERFACE ACCELERATION ACTIVE'
      : simulation.mascotState === 'caution'
        ? 'STORAGE OR NETWORK NOTICE'
        : 'PRE-FLIGHT SIMULATION READY'

  const bannerColorClass =
    simulation.mascotState === 'turbo'
      ? 'text-cyan-400 border-cyan-500/40 bg-cyan-950/20'
      : simulation.mascotState === 'caution'
        ? 'text-amber-400 border-amber-500/40 bg-amber-950/20'
        : 'text-emerald-400 border-emerald-500/40 bg-emerald-950/20'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[620px] max-h-[92vh] overflow-y-auto border border-border bg-card p-0 shadow-2xl [scrollbar-width:thin]">
        {/* Terminal Header with Authentic Anime ASCII Art */}
        <div className="relative border-b border-border bg-black/90 p-4">
          <div className="flex items-center justify-between pb-2">
            <div
              className={`inline-flex items-center gap-2 rounded border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider uppercase ${bannerColorClass}`}
            >
              <Activity className="size-3 animate-pulse" />
              <span>{bannerLabel}</span>
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {simulation.interfaces.length}{' '}
              {simulation.interfaces.length === 1 ? 'interface' : 'interfaces'} bonded
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 pt-1">
            {/* ASCII Canvas */}
            <div className="flex shrink-0 items-center justify-center rounded border border-border/60 bg-muted/10 p-2 shadow-inner">
              <pre className="font-mono text-[8.5px] leading-[1.05] text-primary/90 select-none">
                {mascotAscii}
              </pre>
            </div>

            {/* Quick Summary in Terminal */}
            <div className="flex flex-1 flex-col justify-center space-y-2 text-left">
              <DialogTitle className="line-clamp-1 font-sans text-base font-bold text-foreground">
                {title}
              </DialogTitle>
              <div className="flex flex-col gap-1 font-mono text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Bonded Throughput:</span>
                  <span className="font-semibold text-foreground">
                    ~{formatBytes(simulation.aggregatedSpeedBytesPerSec)}/s
                  </span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Speedup Factor:</span>
                  <span className="font-semibold text-cyan-400">
                    {simulation.speedupMultiplier}x faster
                  </span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Projected Time:</span>
                  <span className="font-bold text-emerald-400 text-sm">
                    {simulation.formattedEta}
                  </span>
                </div>
                {simulation.timeSavedSeconds > 0 && (
                  <div className="rounded bg-emerald-950/40 border border-emerald-500/30 px-1.5 py-0.5 text-[11px] text-emerald-300">
                    Saves {simulation.formattedTimeSaved} compared to single connection
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Simulation Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Dual Storage Analysis */}
          <div className="space-y-2">
            <div className="flex items-center justify-between font-mono text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5">
                <HardDrive className="size-3.5 text-primary" />
                Storage Requirements
              </span>
              <span className="text-[11px] text-muted-foreground">
                Destination Drive Assessment
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Peak Staging Storage */}
              <div className="rounded-md border border-border bg-muted/20 p-2.5">
                <div className="font-mono text-[11px] text-muted-foreground">
                  While Downloading (Peak)
                </div>
                <div className="mt-1 font-mono text-base font-bold text-foreground">
                  {formatBytes(simulation.peakStorageBytes)}
                </div>
                <div className="mt-0.5 text-[10.5px] text-muted-foreground leading-tight">
                  Temporary range buffer blocks and cache staging.
                </div>
              </div>

              {/* Final Reassembled Storage */}
              <div className="rounded-md border border-border bg-muted/20 p-2.5">
                <div className="font-mono text-[11px] text-muted-foreground">
                  Final Assembled File
                </div>
                <div className="mt-1 font-mono text-base font-bold text-foreground">
                  {formatBytes(simulation.finalStorageBytes)}
                </div>
                <div className="mt-0.5 text-[10.5px] text-muted-foreground leading-tight">
                  Permanent footprint after reassembly completes.
                </div>
              </div>
            </div>

            {/* Destination Directory & Headroom Status */}
            <div className="rounded-md border border-border bg-muted/10 p-2.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span
                  className="truncate max-w-[340px] font-mono text-[11px] text-muted-foreground"
                  title={destinationDir}
                >
                  Target: {destinationDir || 'Default directory'}
                </span>
                <button
                  type="button"
                  onClick={handleChangeFolder}
                  className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
                >
                  <FolderOpen className="size-3" />
                  <span>Change Directory</span>
                </button>
              </div>

              {/* Status Banner */}
              <div
                className={`flex items-start gap-2 rounded border p-2 text-xs font-mono ${
                  simulation.storageSafetyStatus === 'insufficient'
                    ? 'border-destructive/50 bg-destructive/10 text-destructive'
                    : simulation.storageSafetyStatus === 'low_margin'
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                }`}
              >
                {simulation.storageSafetyStatus === 'insufficient' ? (
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                ) : simulation.storageSafetyStatus === 'low_margin' ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                )}
                <div className="flex-1">
                  <div className="font-bold">
                    {simulation.storageSafetyStatus === 'insufficient'
                      ? 'INSUFFICIENT DISK CAPACITY'
                      : simulation.storageSafetyStatus === 'low_margin'
                        ? 'LOW DISK HEADROOM'
                        : 'STORAGE CAPACITY VERIFIED'}
                  </div>
                  <div className="text-[11px] opacity-90">
                    {freeSpace !== null ? (
                      <>
                        Free Space: {formatBytes(freeSpace)} | {simulation.storageSafetyMessage}
                      </>
                    ) : (
                      'Drive capacity query in progress...'
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Multi-NIC Chunk Distribution Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between font-mono text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5">
                <Layers className="size-3.5 text-primary" />
                Multi-Interface Chunk Partitioning
              </span>
              <span className="text-[11px] text-muted-foreground">
                Bayesian Bandit Range Slices
              </span>
            </div>

            {/* Segmented Distribution Bar */}
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted/60 p-0.5">
              {simulation.interfaces.map((iface) => {
                const vis = networkVisual(iface.id, iface.kind, iface.name)
                return (
                  <div
                    key={iface.id}
                    style={{
                      width: `${iface.chunkAllocationPct}%`,
                      backgroundColor: vis.solid
                    }}
                    className="h-full first:rounded-l-full last:rounded-r-full transition-all"
                    title={`${iface.name}: ${iface.chunkAllocationPct}% (${formatBytes(iface.allocatedBytes)})`}
                  />
                )
              })}
            </div>

            {/* Individual Interface Checklist */}
            <div className="space-y-1.5 pt-1">
              {simulation.interfaces.map((iface) => {
                const vis = networkVisual(iface.id, iface.kind, iface.name)
                const isChecked = !disabledIfaces.has(iface.id)
                return (
                  <div
                    key={iface.id}
                    onClick={() => toggleInterface(iface.id)}
                    className="flex cursor-pointer items-center justify-between rounded-md border border-border/70 bg-card p-2 text-xs font-mono transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleInterface(iface.id)}
                        className="size-3.5 rounded border-border"
                      />
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: vis.solid }}
                      />
                      <span className="font-semibold text-foreground">{iface.name}</span>
                      <span className="text-[10.5px] text-muted-foreground">[{iface.kind}]</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">
                        ~{formatBytes(iface.estimatedSpeedBytesPerSec)}/s
                      </span>
                      <span className="font-bold text-primary">{iface.chunkAllocationPct}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Enhancement 7: the model is plain arithmetic on assumed speeds; say so. */}
          <p
            data-testid="simulation-assumptions"
            className="text-[10.5px] leading-[1.45] text-muted-foreground"
          >
            {SIMULATION_ASSUMPTIONS}
          </p>

          {/* Action Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isStarting}
            >
              Cancel
            </Button>

            <div className="flex items-center gap-2">
              {pageUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 font-sans text-xs"
                  onClick={handleLaunchBrowser}
                >
                  <ExternalLink className="size-3 text-muted-foreground" />
                  <span>Launch in Browser</span>
                </Button>
              )}

              <Button
                type="button"
                size="sm"
                className="gap-1.5 font-semibold"
                disabled={
                  isStarting ||
                  simulation.storageSafetyStatus === 'insufficient' ||
                  simulation.interfaces.length === 0
                }
                onClick={handleConfirm}
              >
                {isStarting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Initializing Range Slices...
                  </>
                ) : (
                  <>
                    <Zap className="size-3.5" />
                    Start Bonded Download
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
