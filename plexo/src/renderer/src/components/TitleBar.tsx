import { Compass, Download, Globe } from 'lucide-react'
import { TITLE_BAR_HEIGHT } from '../theme'
import { useAppStore } from '../store/useAppStore'

const isMac = window.plexo.platform === 'darwin'

/** The window's title bar with OS drag regions and navigation tabs between Downloads, Discover, and Sources. */
export function TitleBar(): React.JSX.Element {
  const view = useAppStore((store) => store.view)
  const setView = useAppStore((store) => store.setView)
  const activeCount = useAppStore(
    (store) =>
      Object.values(store.downloads).filter(
        (d) => d.status === 'downloading' || d.status === 'queued'
      ).length
  )

  const isDownloadsActive = view.name === 'list' || view.name === 'download'

  return (
    <div
      style={{ height: TITLE_BAR_HEIGHT }}
      className={`flex shrink-0 items-center justify-between border-b-[0.5px] border-border bg-card [-webkit-app-region:drag] ${
        isMac ? 'pl-[76px] pr-4' : 'pl-4 pr-[140px]'
      }`}
    >
      {/* Brand logo / title */}
      <div className="flex items-center gap-2">
        <span className="font-sans text-[12.5px] font-bold tracking-tight text-foreground">
          Plexo
        </span>
        <span className="rounded bg-primary/15 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-primary">
          MULTI-PATH
        </span>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 rounded-md bg-muted/60 p-0.5 [-webkit-app-region:no-drag]">
        <button
          type="button"
          onClick={() => setView({ name: 'list' })}
          className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] font-semibold transition-all ${
            isDownloadsActive
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Download className="size-3" />
          <span>Downloads</span>
          {activeCount > 0 && (
            <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 text-[9.5px] font-bold text-primary">
              {activeCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setView({ name: 'discover' })}
          className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] font-semibold transition-all ${
            view.name === 'discover'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Compass className="size-3" />
          <span>Discover</span>
        </button>

        <button
          type="button"
          onClick={() => setView({ name: 'sources' })}
          className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] font-semibold transition-all ${
            view.name === 'sources'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Globe className="size-3" />
          <span>Sources</span>
        </button>
      </div>

      {/* Right balance container */}
      <div className="w-16" />
    </div>
  )
}
