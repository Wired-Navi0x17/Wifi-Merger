import type { ContentSourceConfig } from '@shared/sourceTypes'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Globe,
  Layers,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'
import { useAppStore } from '../store/useAppStore'
import { formatWhen } from '../utils/format'

const PRESET_SOURCES = [
  {
    name: 'Internet Archive: Classic PC Games',
    url: 'https://archive.org/details/classicpcgames',
    description: 'Historical archive of classic shareware, freeware, and public domain PC titles.'
  },
  {
    name: 'Internet Archive: MS-DOS Games Collection',
    url: 'https://archive.org/details/softwarelibrary_msdos_games',
    description: 'Massive library of emulated and downloadable MS-DOS titles.'
  },
  {
    name: 'Internet Archive: Open Source Software',
    url: 'https://archive.org/details/open_source_software',
    description: 'Open source software and retro gaming archives.'
  }
]

export function SourcesScreen(): React.JSX.Element {
  const sources = useAppStore((store) => store.sources)
  const sourcesLoading = useAppStore((store) => store.sourcesLoading)
  const loadSources = useAppStore((store) => store.loadSources)
  const addSource = useAppStore((store) => store.addSource)
  const toggleSource = useAppStore((store) => store.toggleSource)
  const removeSource = useAppStore((store) => store.removeSource)
  const syncSource = useAppStore((store) => store.syncSource)
  const setView = useAppStore((store) => store.setView)

  const [addUrl, setAddUrl] = useState('')
  const [addName, setAddName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)

  useEffect(() => {
    void loadSources()
  }, [])

  const handleAddSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!addUrl.trim()) return

    setAdding(true)
    setAddError(null)
    try {
      await addSource(addUrl.trim(), addName.trim() || undefined)
      setAddUrl('')
      setAddName('')
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  const handleAddPreset = async (preset: { name: string; url: string }): Promise<void> => {
    setAdding(true)
    setAddError(null)
    try {
      await addSource(preset.url, preset.name)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  const handleSync = async (id: string): Promise<void> => {
    setSyncingId(id)
    try {
      await syncSource(id)
    } finally {
      setSyncingId(null)
    }
  }

  const list = sources || []
  const totalSources = list.length
  const activeSources = list.filter((s) => s.enabled).length
  const totalIndexed = list.reduce((sum, s) => sum + (s.itemCount || 0), 0)

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b-[0.5px] border-border bg-card/60 px-5 py-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setView({ name: 'discover' })}
            title="Back to Discover"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h2 className="font-sans text-sm font-bold text-foreground">Content Sources & Index</h2>
            <p className="font-mono text-[11px] text-muted-foreground">
              Configure websites, catalogs, or archives indexed by Plexo
            </p>
          </div>
        </div>

        {/* Quick Stats Pill */}
        <div className="flex items-center gap-4 font-mono text-xs">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Active:</span>
            <span className="font-semibold text-foreground">
              {activeSources} / {totalSources}
            </span>
          </div>
          <div className="flex items-center gap-1.5 border-l border-border pl-4">
            <Layers className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Indexed Items:</span>
            <span className="font-semibold text-foreground">{totalIndexed}</span>
          </div>
        </div>
      </div>

      {/* Main Body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-6">
        {/* Add Source Form */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 font-sans text-xs font-semibold text-foreground">
            <Plus className="size-4 text-primary" />
            Add New Content Source
          </div>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Enter any website URL, Next.js catalog, WordPress portal, Archive.org collection, or JSON feed.
          </p>

          <form onSubmit={handleAddSubmit} className="mt-3 flex flex-wrap gap-2.5">
            <input
              type="url"
              placeholder="Source URL (e.g. https://archive.org/details/...)"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              required
              className="h-8.5 min-w-[280px] flex-1 rounded-md border border-input bg-background px-3 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
            />
            <input
              type="text"
              placeholder="Display Name (Optional)"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              className="h-8.5 w-48 rounded-md border border-input bg-background px-3 font-sans text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
            />
            <Button type="submit" size="sm" disabled={adding || !addUrl.trim()} className="gap-1.5">
              {adding ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Plus className="size-3.5" />
                  Add Source
                </>
              )}
            </Button>
          </form>

          {addError && (
            <div className="mt-2.5 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              <span>{addError}</span>
            </div>
          )}

          {/* Preset Recommendations */}
          <div className="mt-4 border-t border-border/40 pt-3">
            <span className="font-mono text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider">
              Quick Add Verified Sources:
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRESET_SOURCES.map((preset) => {
                const alreadyAdded = sources.some(
                  (s) => s.url.replace(/\/$/, '') === preset.url.replace(/\/$/, '')
                )
                return (
                  <button
                    key={preset.url}
                    type="button"
                    disabled={alreadyAdded || adding}
                    onClick={() => void handleAddPreset(preset)}
                    className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-left font-mono text-[11px] transition-colors ${
                      alreadyAdded
                        ? 'border-border/40 bg-muted/30 text-muted-foreground/60 cursor-default'
                        : 'border-border bg-background hover:border-primary/50 hover:bg-muted/50 text-foreground'
                    }`}
                  >
                    <Globe className="size-3 text-muted-foreground" />
                    <span>{preset.name}</span>
                    {alreadyAdded ? (
                      <span className="text-[10px] text-emerald-500 font-semibold">[Added]</span>
                    ) : (
                      <Plus className="size-3 text-primary" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Configured Sources List */}
        <div>
          <div className="flex items-center justify-between pb-2">
            <h3 className="font-sans text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Configured Sources ({sources.length})
            </h3>
            <button
              type="button"
              onClick={() => void loadSources()}
              disabled={sourcesLoading}
              className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`size-3 ${sourcesLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {sources.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <Globe className="mx-auto size-8 text-muted-foreground/50" />
              <p className="mt-2 text-xs font-medium text-foreground">No sources configured</p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Click one of the quick add presets above to begin indexing content.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60 rounded-lg border border-border bg-card">
              {sources.map((src) => (
                <SourceRow
                  key={src.id}
                  source={src}
                  syncing={syncingId === src.id}
                  onToggle={(enabled) => void toggleSource(src.id, enabled)}
                  onSync={() => void handleSync(src.id)}
                  onRemove={() => void removeSource(src.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SourceRow({
  source,
  syncing,
  onToggle,
  onSync,
  onRemove
}: {
  source: ContentSourceConfig
  syncing: boolean
  onToggle: (enabled: boolean) => void
  onSync: () => void
  onRemove: () => void
}): React.JSX.Element {
  const isError = source.status === 'error'
  const isDisabled = !source.enabled

  const statusBadge = isDisabled ? (
    <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
      <Power className="size-2.5" />
      Disabled
    </span>
  ) : isError ? (
    <span className="inline-flex items-center gap-1 rounded bg-destructive/15 px-2 py-0.5 font-mono text-[10.5px] text-destructive">
      <AlertCircle className="size-2.5" />
      Error
    </span>
  ) : syncing || source.status === 'indexing' ? (
    <span className="inline-flex items-center gap-1 rounded bg-blue-500/15 px-2 py-0.5 font-mono text-[10.5px] text-blue-400">
      <Loader2 className="size-2.5 animate-spin" />
      Indexing
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[10.5px] text-emerald-400">
      <CheckCircle2 className="size-2.5" />
      Ready
    </span>
  )

  const typeLabel =
    source.type === 'archive-org'
      ? 'Archive.org'
      : source.type === 'catalog-feed'
        ? 'Feed'
        : 'Web Scraper'

  return (
    <div className="flex items-center justify-between p-3.5 transition-colors hover:bg-muted/20">
      <div className="min-w-0 flex-1 pr-4">
        <div className="flex items-center gap-2">
          <span className="font-sans text-xs font-semibold text-foreground truncate">
            {source.name}
          </span>
          <span className="rounded border border-border/80 bg-muted/50 px-1.5 py-0.2 font-mono text-[10px] text-muted-foreground uppercase">
            {typeLabel}
          </span>
          {statusBadge}
        </div>

        <div className="mt-1 flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
          <button
            type="button"
            onClick={() => void window.plexo.openExternalUrl(source.url)}
            className="flex items-center gap-1 truncate hover:text-foreground text-left"
          >
            <span className="truncate max-w-[280px]">{source.url}</span>
            <ExternalLink className="size-2.5 shrink-0" />
          </button>
          <span>·</span>
          <span>{source.itemCount || 0} items indexed</span>
          {source.lastIndexedAt && (
            <>
              <span>·</span>
              <span>Synced {formatWhen(source.lastIndexedAt, Date.now())}</span>
            </>
          )}
        </div>
      </div>

      {/* Row Actions */}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onSync}
          disabled={syncing || !source.enabled}
          title="Re-index source now"
          className="font-mono text-xs gap-1"
        >
          <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Sync</span>
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onToggle(!source.enabled)}
          className={`font-mono text-xs ${
            source.enabled ? 'text-foreground' : 'text-muted-foreground opacity-60'
          }`}
        >
          {source.enabled ? 'Enabled' : 'Disabled'}
        </Button>

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onRemove}
          title="Remove source"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
