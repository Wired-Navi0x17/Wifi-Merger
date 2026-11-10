import type { ContentCategory, ContentItem } from '@shared/sourceTypes'
import {
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'
import { ContentDetailsDialog } from '../components/ContentDetailsDialog'
import { useAppStore } from '../store/useAppStore'
import { formatBytes } from '../utils/format'

const CATEGORIES: { id: ContentCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'game', label: 'Games' },
  { id: 'tool', label: 'Tools' },
  { id: 'archive', label: 'Archives' },
  { id: 'media', label: 'Media' }
]

export function DiscoverScreen(): React.JSX.Element {
  const searchQuery = useAppStore((store) => store.searchQuery)
  const setSearchQuery = useAppStore((store) => store.setSearchQuery)
  const searchCategory = useAppStore((store) => store.searchCategory)
  const setSearchCategory = useAppStore((store) => store.setSearchCategory)
  const searchResults = useAppStore((store) => store.searchResults)
  const isSearching = useAppStore((store) => store.isSearching)
  const searchError = useAppStore((store) => store.searchError)
  const sources = useAppStore((store) => store.sources)
  const loadSources = useAppStore((store) => store.loadSources)
  const performSearch = useAppStore((store) => store.performSearch)
  const loadDiscoverCatalog = useAppStore((store) => store.loadDiscoverCatalog)
  const selectedContentItem = useAppStore((store) => store.selectedContentItem)
  const contentDetailsOpen = useAppStore((store) => store.contentDetailsOpen)
  const openContentDetails = useAppStore((store) => store.openContentDetails)
  const closeContentDetails = useAppStore((store) => store.closeContentDetails)
  const setView = useAppStore((store) => store.setView)

  const [inputVal, setInputVal] = useState(searchQuery)

  useEffect(() => {
    void loadSources()
    if (!searchQuery) {
      void loadDiscoverCatalog()
    }
  }, [])

  const handleSearchSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    setSearchQuery(inputVal)
    void performSearch(inputVal)
  }

  const handleClear = (): void => {
    setInputVal('')
    setSearchQuery('')
    void performSearch('')
  }

  const handleCategorySelect = (cat: ContentCategory | 'all'): void => {
    const next = cat === 'all' ? undefined : cat
    setSearchCategory(next)
    setTimeout(() => {
      void performSearch(inputVal)
    }, 0)
  }

  const enabledSourceIds = new Set((sources || []).filter((s) => s.enabled).map((s) => s.id))
  const displayedItems = (searchResults || []).filter((item) => enabledSourceIds.has(item.sourceId))
  const activeSourceCount = enabledSourceIds.size

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Top Search & Filter Bar */}
      <div className="flex flex-col gap-3 border-b-[0.5px] border-border bg-card/60 px-5 py-3">
        <div className="flex items-center gap-3">
          <form onSubmit={handleSearchSubmit} className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="Search across all indexed sources (e.g. Quake, Doom, Linux, Blender)..."
              className="h-9 w-full rounded-md border border-input bg-background/90 pr-8 pl-9 font-sans text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
            />
            {inputVal && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </form>

          <Button
            type="button"
            size="sm"
            onClick={handleSearchSubmit}
            disabled={isSearching}
            className="font-medium"
          >
            {isSearching ? <Loader2 className="size-3.5 animate-spin" /> : 'Search'}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setView({ name: 'sources' })}
            className="gap-1.5 font-mono text-xs"
          >
            <Settings className="size-3.5" />
            <span>Sources</span>
            <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">
              {activeSourceCount}
            </span>
          </Button>
        </div>

        {/* Category Pills & Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {CATEGORIES.map((cat) => {
              const active =
                cat.id === 'all' ? searchCategory === undefined : searchCategory === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategorySelect(cat.id)}
                  className={`rounded-full px-3 py-1 font-mono text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            {isSearching ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin text-primary" />
                Querying {activeSourceCount} sources...
              </span>
            ) : (
              <span>
                {displayedItems.length} {displayedItems.length === 1 ? 'item' : 'items'} found
              </span>
            )}
            <button
              type="button"
              onClick={() => void performSearch(inputVal)}
              title="Refresh results"
              className="rounded p-1 hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className="size-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {searchError && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {searchError}
          </div>
        )}

        {isSearching && displayedItems.length === 0 ? (
          /* Skeletons */
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-lg border border-border/50 bg-card p-3 space-y-3"
              >
                <div className="aspect-[16/10] w-full rounded bg-muted/60" />
                <div className="h-4 w-3/4 rounded bg-muted/60" />
                <div className="h-3 w-1/2 rounded bg-muted/40" />
              </div>
            ))}
          </div>
        ) : displayedItems.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted/40 text-muted-foreground">
              <Search className="size-6" />
            </div>
            <h3 className="mt-4 font-sans text-base font-semibold text-foreground">
              {searchQuery ? `No results found for "${searchQuery}"` : 'No discoverable items'}
            </h3>
            <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
              {activeSourceCount === 0
                ? 'You have no sources enabled. Add or enable content sources to search and discover games directly within Plexo.'
                : 'Try refining your search keyword or add more website sources in the Sources manager.'}
            </p>
            <div className="mt-4 flex gap-2">
              {searchQuery && (
                <Button type="button" variant="secondary" size="sm" onClick={handleClear}>
                  Clear Search
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => setView({ name: 'sources' })}
                className="gap-1.5"
              >
                <Plus className="size-3.5" />
                Configure Sources
              </Button>
            </div>
          </div>
        ) : (
          /* Results Grid */
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
            {displayedItems.map((item) => (
              <ContentCard key={item.id} item={item} onClick={() => openContentDetails(item)} />
            ))}
          </div>
        )}
      </div>

      {/* Details Sheet / Dialog */}
      {selectedContentItem && (
        <ContentDetailsDialog
          item={selectedContentItem}
          open={contentDetailsOpen}
          onOpenChange={(open) => {
            if (!open) closeContentDetails()
          }}
        />
      )}
    </div>
  )
}

function ContentCard({
  item,
  onClick
}: {
  item: ContentItem
  onClick: () => void
}): React.JSX.Element {
  const displaySize = item.fileSizeBytes ? formatBytes(item.fileSizeBytes) : 'Direct link'
  const shortSource = (item.sourceName || 'Source').split('—')[0].trim()
  const title = item.title || 'Untitled'

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border/70 bg-card transition-all duration-150 hover:border-primary/50 hover:shadow-lg focus-visible:border-ring focus-visible:outline-none"
    >
      {/* Thumbnail Aspect Container */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-br from-card via-muted/50 to-card">
        {/* Fallback graphic rendered underneath */}
        <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
          <span className="font-mono text-2xl font-black tracking-widest text-muted-foreground/30 select-none">
            {title.slice(0, 3).toUpperCase()}
          </span>
        </div>

        {item.thumbnailUrl && (
          <img
            src={item.thumbnailUrl}
            alt={title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={(e) => {
              ;(e.target as HTMLElement).style.display = 'none'
            }}
          />
        )}

        {/* Quick Launch in Browser Button */}
        {item.pageUrl && (
          <button
            type="button"
            title="Launch in external browser"
            onClick={(e) => {
              e.stopPropagation()
              void window.plexo.openExternalUrl(item.pageUrl!)
            }}
            className="absolute top-2 left-2 z-10 flex size-6 items-center justify-center rounded bg-background/90 text-muted-foreground opacity-0 backdrop-blur-md transition-opacity hover:text-foreground group-hover:opacity-100 shadow-xs"
          >
            <ExternalLink className="size-3" />
          </button>
        )}

        {/* Source Badge Pill */}
        <div className="absolute top-2 right-2 max-w-[75%]">
          <span className="block truncate rounded bg-background/90 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-foreground backdrop-blur-md shadow-xs">
            {shortSource}
          </span>
        </div>

        {/* Platforms Pill */}
        {item.platforms && item.platforms.length > 0 && (
          <div className="absolute bottom-2 left-2">
            <span className="rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] font-medium text-white/90 backdrop-blur-sm">
              {item.platforms[0].toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Info Body */}
      <div className="flex flex-1 flex-col justify-between p-3">
        <div>
          <h4 className="line-clamp-2 font-sans text-xs font-semibold leading-snug text-foreground group-hover:text-primary transition-colors">
            {item.title}
          </h4>
          {item.description && (
            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground leading-relaxed">
              {item.description}
            </p>
          )}
        </div>

        <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 font-mono text-[10.5px] text-muted-foreground">
          <span>{displaySize}</span>
          {item.version && <span className="opacity-80">v{item.version}</span>}
        </div>
      </div>
    </div>
  )
}
