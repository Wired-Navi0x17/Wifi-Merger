import type { ContentItem, ResolvedDownload } from '@shared/sourceTypes'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  HardDrive,
  Layers,
  Loader2,
  Sparkles
} from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { PreDownloadSimulationDialog } from './PreDownloadSimulationDialog'
import { useAppStore } from '../store/useAppStore'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { formatBytes } from '../utils/format'

interface ContentDetailsDialogProps {
  item: ContentItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ContentDetailsDialog({
  item,
  open,
  onOpenChange
}: ContentDetailsDialogProps): React.JSX.Element | null {
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [downloadSuccess, setDownloadSuccess] = useState(false)
  const [simulationOpen, setSimulationOpen] = useState(false)

  const interfaces = useAppStore((store) => store.interfaces || [])
  const networkPreferences = useAppStore((store) => store.networkPreferences || {})
  const destinationDir = useAppStore((store) => store.destinationDir)
  const autoOrganize = useAppStore((store) => store.autoOrganize?.enabled)
  const setView = useAppStore((store) => store.setView)

  const networkVisual = useNetworkVisuals()
  const activeInterfaces = (interfaces || []).filter((i) => !networkPreferences?.[i.id]?.off)

  if (!item) return null

  const handleExecuteDownload = async (selectedInterfaceIds?: string[]): Promise<void> => {
    setResolving(true)
    setResolveError(null)
    setDownloadSuccess(false)

    try {
      // Step 1: Resolve the raw downloadable URL
      const resolved: ResolvedDownload = await window.plexo.content.resolve(item)

      // Step 2: Handoff directly to Plexo's multi-interface bonding download engine
      const interfaceIds =
        selectedInterfaceIds && selectedInterfaceIds.length > 0
          ? selectedInterfaceIds
          : activeInterfaces.map((i) => i.id)

      const id = await window.plexo.startDownload({
        kind: 'http',
        url: resolved.url,
        destinationDir,
        suggestedFileName: resolved.fileName || item.title,
        totalBytes: resolved.totalBytes ?? (item.fileSizeBytes || 0),
        supportsRanges: resolved.supportsRanges,
        interfaceIds,
        etag: resolved.etag ?? null,
        lastModified: null,
        organize: autoOrganize,
        // Enhancement 5: a digest the page publishes is checked once the file is in.
        ...(item.hash && {
          checksum: {
            algorithm: item.hash.algorithm,
            value: item.hash.value,
            source: 'page' as const
          }
        })
      })

      setDownloadSuccess(true)
      setSimulationOpen(false)
      // Switch view to downloads and show the newly started download
      setTimeout(() => {
        onOpenChange(false)
        setView({ name: 'download', id })
      }, 700)
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : String(err))
    } finally {
      setResolving(false)
    }
  }

  const handleOpenBrowser = (): void => {
    if (item?.pageUrl) {
      void window.plexo.openExternalUrl(item.pageUrl)
    }
  }

  const categoryLabel = item.category ? item.category.toUpperCase() : 'GAME'
  const displaySize = item.fileSizeBytes ? formatBytes(item.fileSizeBytes) : 'Direct link'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] overflow-hidden border border-border bg-card p-0 shadow-2xl">
        {/* Banner / Poster Header */}
        <div className="relative aspect-[16/7] w-full overflow-hidden bg-muted/60">
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt={item.title}
              className="h-full w-full object-cover"
              onError={(e) => {
                ;(e.target as HTMLElement).style.display = 'none'
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-card via-muted to-card">
              <span className="font-mono text-3xl font-extrabold tracking-widest text-muted-foreground/40">
                {item.title.slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />

          {/* Badges Overlay */}
          <div className="absolute bottom-3 left-4 flex flex-wrap items-center gap-2">
            <span className="rounded bg-primary/90 px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider text-primary-foreground uppercase shadow-sm">
              {categoryLabel}
            </span>
            <span className="rounded border border-border/80 bg-background/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground backdrop-blur-md">
              {item.sourceName.split('—')[0].trim()}
            </span>
            {item.version && (
              <span className="rounded border border-border/60 bg-muted/80 px-2 py-0.5 font-mono text-[11px] text-muted-foreground backdrop-blur-md">
                v{item.version}
              </span>
            )}
            {item.year && (
              <span className="rounded border border-border/60 bg-muted/80 px-2 py-0.5 font-mono text-[11px] text-muted-foreground backdrop-blur-md">
                {item.year}
              </span>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="space-y-4 px-5 pt-1 pb-5">
          <DialogHeader className="gap-1 text-left">
            <DialogTitle className="font-sans text-xl font-bold tracking-tight text-foreground">
              {item.title}
            </DialogTitle>
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <HardDrive className="size-3.5 text-muted-foreground" />
                {displaySize}
              </span>
              {item.platforms && item.platforms.length > 0 && (
                <span className="flex items-center gap-1">
                  <Layers className="size-3.5 text-muted-foreground" />
                  {item.platforms.join(' · ')}
                </span>
              )}
            </div>
          </DialogHeader>

          {item.description && (
            <div className="max-h-24 overflow-y-auto text-xs leading-relaxed text-muted-foreground [scrollbar-width:thin]">
              {item.description}
            </div>
          )}

          {/* Signature Element: Multi-Interface Bonding Preview */}
          <div className="rounded-lg border-[0.5px] border-border bg-muted/20 p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-mono text-[11.5px] font-semibold text-foreground">
                <Sparkles className="size-3.5 text-primary" />
                Multi-Interface Bonding Engine
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">
                {activeInterfaces.length} {activeInterfaces.length === 1 ? 'network' : 'networks'}{' '}
                active
              </span>
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {activeInterfaces.length > 0 ? (
                activeInterfaces.map((iface) => {
                  const vis = networkVisual(iface.id, iface.kind, iface.displayName)
                  return (
                    <div
                      key={iface.id}
                      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs font-medium"
                      style={{
                        backgroundColor: vis.bg,
                        borderColor: vis.border,
                        color: vis.text
                      }}
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: vis.solid }}
                      />
                      <span>{vis.name}</span>
                      <span className="opacity-70">[{vis.label}]</span>
                    </div>
                  )
                })
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-amber-500">
                  <AlertCircle className="size-3.5" />
                  No networks connected. Downloads will queue.
                </div>
              )}
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">
              {activeInterfaces.length > 1
                ? 'Plexo will slice this file into concurrent 8 MiB range blocks and bond bandwidth across all active interfaces.'
                : 'Plexo will stream this file through the active interface.'}
            </p>
          </div>

          {/* Error notice if direct resolution fails */}
          {resolveError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <div className="flex-1">
                <p className="font-semibold text-amber-200">
                  Browser verification or mirror selection required
                </p>
                <p className="mt-0.5 text-amber-300/90">
                  This game source uses Cloudflare protection or interactive download mirrors. Open
                  the page directly in your browser to start or copy the stream link into Plexo.
                </p>
                {item.pageUrl && (
                  <button
                    type="button"
                    onClick={handleOpenBrowser}
                    className="mt-2 inline-flex items-center gap-1 font-semibold text-amber-100 underline underline-offset-2 hover:text-white"
                  >
                    <span>Launch Game Page in Browser</span>
                    <ExternalLink className="size-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Action Footer */}
          <div className="flex items-center justify-between pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={resolving}
            >
              Close
            </Button>

            <div className="flex items-center gap-2">
              {item.pageUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 font-sans text-xs"
                  onClick={handleOpenBrowser}
                >
                  <ExternalLink className="size-3.5 text-muted-foreground" />
                  <span>Launch in Browser</span>
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                className="gap-1.5 font-semibold"
                disabled={resolving || downloadSuccess}
                onClick={() => setSimulationOpen(true)}
              >
                {resolving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Resolving Mirror...
                  </>
                ) : downloadSuccess ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                    Download Queued!
                  </>
                ) : (
                  <>
                    <Download className="size-3.5" />
                    Simulate & Download
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>

      <PreDownloadSimulationDialog
        open={simulationOpen}
        onOpenChange={setSimulationOpen}
        title={item.title}
        fileSizeBytes={item.fileSizeBytes || 2_500_000_000}
        thumbnailUrl={item.thumbnailUrl}
        pageUrl={item.pageUrl}
        onConfirmDownload={handleExecuteDownload}
        isStarting={resolving}
      />
    </Dialog>
  )
}
