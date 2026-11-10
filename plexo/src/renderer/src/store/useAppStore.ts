import { applyDownloadUpdate } from '@shared/downloadUpdate'
import type {
  AppSettings,
  AutoOrganizeSettings,
  DownloadSchedule,
  DownloadState,
  DownloadUpdate,
  FinishedDownload,
  NetworkInterfaceInfo,
  NetworkPreference,
  NetworkPreferences,
  PendingLink,
  SpeedUnit,
  ThemeSource,
  WindowMaterial
} from '@shared/types'
import type { ContentCategory, ContentItem, ContentSourceConfig } from '@shared/sourceTypes'
import { create } from 'zustand'

export type DownloadFilter = 'all' | 'progress' | 'finished' | 'failed'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** What the window shows: downloads list, single download, discovery grid, or source index manager. */
export type View =
  { name: 'list' } | { name: 'download'; id: string } | { name: 'discover' } | { name: 'sources' }

interface AppStore {
  interfaces: NetworkInterfaceInfo[]
  interfacesStatus: LoadStatus
  interfacesError: string | null
  /** User customizations (name/color) per network interface id — persisted in the main process. */
  networkPreferences: NetworkPreferences

  /** Persisted in the main process alongside nativeTheme.themeSource. */
  themeSource: ThemeSource
  /** Feature 3 window material level (solid, panels, desktop). */
  windowMaterial: WindowMaterial
  /** Feature 4: where the speed test reads from. Shown in its dialog, editable there. */
  speedTestUrl: string

  homeDir: string
  downloadsDir: string

  /** Every download that isn't finished, by id — running, queued, paused or failed. */
  downloads: Record<string, DownloadState>
  /** Finished downloads, newest first (see main/download/history.ts). */
  history: FinishedDownload[]
  view: View
  downloadFilter: DownloadFilter
  setDownloadFilter: (filter: DownloadFilter) => void
  downloadSchedule: DownloadSchedule | undefined
  /** The New download dialog, over whatever the window shows. */
  newDownloadOpen: boolean
  /** Persisted — how many downloads run at once; the rest wait in the queue. */
  downloadsAtOnce: number
  /** Persisted — the speed limits (see AppSettings). */
  speedLimit: number | undefined
  slowMode: boolean
  slowModeSpeed: number
  /** Persisted — MB/s or Mbps, for every speed shown. */
  speedUnit: SpeedUnit

  /** Lifted out of the Idle screen so it survives a swap to/from the No-connections screen. */
  draftUrl: string
  /** Handed-over links stacked in New download, oldest first. */
  links: PendingLink[]
  /** Null while New download shows a link typed or pasted there instead. Links are named by
   * id, never by position: the list changes while a start is under way. */
  shownId: string | null
  /** Bumped to remount New download's form for another link. */
  formKey: number
  /** The link last started: still on the clipboard afterwards, so not offered again. */
  startedUrl: string
  /** Persisted — the last folder picked, falling back to downloadsDir. */
  destinationDir: string

  /** Asks the main process for the network list now; it also pushes every change. */
  loadInterfaces: () => Promise<void>
  receiveInterfaces: (interfaces: NetworkInterfaceInfo[]) => void
  setNetworkPreference: (id: string, patch: NetworkPreference) => void
  setThemeSource: (source: ThemeSource) => void
  setWindowMaterial: (material: WindowMaterial) => void
  /** Feature 4: remembers the test URL, so the next speed test starts where this one did. */
  setSpeedTestUrl: (url: string) => void
  /** A snapshot or an update of a download, from the main process. */
  receiveDownloadUpdate: (update: DownloadUpdate) => void
  /** Finished downloads as main lists them; any that finished leave `downloads`. */
  receiveHistory: (history: FinishedDownload[]) => void
  /** Drops a download from the window's view once the main process has removed it. */
  forgetDownload: (id: string) => void
  setView: (view: View) => void
  /** Opens New download, with `link` in its link field when one is given. */
  openNewDownload: (link?: string) => void
  closeNewDownload: () => void
  receiveLinks: () => Promise<void>
  showLink: (id: string) => void
  /** If it was the one shown, the newest left is shown, or New download closes. */
  finishLink: (id: string, started: boolean) => void
  /** Leaves what New download shows alone, the typed link included. */
  dropLink: (id: string, started: boolean) => void
  setDownloadsAtOnce: (count: number) => void
  /** Each one applies at once, to every download (see main/network/limits.ts). */
  setSpeedLimit: (bytesPerSec: number | undefined) => void
  setSlowMode: (on: boolean) => void
  setSlowModeSpeed: (bytesPerSec: number) => void
  setSpeedUnit: (unit: SpeedUnit) => void
  setDraftUrl: (url: string) => void
  setDestinationDir: (dir: string) => void
  /** Feature 1: automatic file organization buckets (HTTP single-file only). */
  autoOrganize: AutoOrganizeSettings
  setAutoOrganize: (settings: AutoOrganizeSettings) => void
  /** Feature 2: acts on what the local learner found (settings.learning.tailAdaptive). */
  learningTailAdaptive: boolean
  setLearningTailAdaptive: (on: boolean) => void
  /** Feature 6: bufferbloat control (settings.congestionMode). */
  congestionFriendly: boolean
  setCongestionFriendly: (on: boolean) => void

  /** Feature 5: Unified Source Index & Discovery */
  sources: ContentSourceConfig[]
  sourcesLoading: boolean
  searchResults: ContentItem[]
  searchQuery: string
  searchCategory: ContentCategory | undefined
  isSearching: boolean
  searchError: string | null
  selectedContentItem: ContentItem | null
  contentDetailsOpen: boolean
  loadSources: () => Promise<void>
  addSource: (url: string, name?: string) => Promise<ContentSourceConfig>
  toggleSource: (id: string, enabled: boolean) => Promise<void>
  removeSource: (id: string) => Promise<void>
  syncSource: (id: string) => Promise<void>
  setSearchQuery: (query: string) => void
  setSearchCategory: (category: ContentCategory | undefined) => void
  performSearch: (queryOverride?: string) => Promise<void>
  loadDiscoverCatalog: () => Promise<void>
  openContentDetails: (item: ContentItem) => void
  closeContentDetails: () => void
}

// Settings saved by the main process, read once before the first paint (see InitialState).
const initial = window.plexo.initialState

/** Every setting changes optimistically: the store is updated first so the UI feels instant,
 * then this saves it. The store stays the source of truth either way — a failed save just means
 * the change isn't remembered next launch. */
function persist(patch: AppSettings): void {
  window.plexo.updateSettings(patch).catch(() => {})
}

/** Links let go here: a listing main sent before it heard so would bring them back. */
const letGo = new Set<string>()

export const useAppStore = create<AppStore>((set, get) => ({
  interfaces: [],
  interfacesStatus: 'idle',
  interfacesError: null,
  networkPreferences: initial.networkPreferences,
  themeSource: initial.themeSource,
  windowMaterial: initial.windowMaterial,
  speedTestUrl: initial.speedTestUrl,

  homeDir: initial.homeDir,
  downloadsDir: initial.downloadsDir,

  downloads: {},
  history: [],
  view: { name: 'list' },
  downloadFilter: 'all',
  setDownloadFilter: (downloadFilter) => set({ downloadFilter }),
  downloadSchedule: initial.downloadSchedule,
  newDownloadOpen: false,
  downloadsAtOnce: initial.downloadsAtOnce,
  speedLimit: initial.speedLimit,
  slowMode: initial.slowMode,
  slowModeSpeed: initial.slowModeSpeed,
  speedUnit: initial.speedUnit,

  draftUrl: '',
  links: [],
  shownId: null,
  formKey: 0,
  startedUrl: '',
  destinationDir: initial.destinationDir ?? initial.downloadsDir,
  autoOrganize: initial.autoOrganize,
  learningTailAdaptive: initial.learningTailAdaptive,
  congestionFriendly: initial.congestionMode !== 'throughput',

  sources: [],
  sourcesLoading: false,
  searchResults: [],
  searchQuery: '',
  searchCategory: undefined,
  isSearching: false,
  searchError: null,
  selectedContentItem: null,
  contentDetailsOpen: false,

  loadInterfaces: async () => {
    // A re-scan keeps showing the last result rather than flashing back to 'loading'.
    if (get().interfacesStatus !== 'ready') set({ interfacesStatus: 'loading' })
    set({ interfacesError: null })
    try {
      get().receiveInterfaces(await window.plexo.listInterfaces())
    } catch (error) {
      set({
        interfacesStatus: 'error',
        interfacesError: error instanceof Error ? error.message : String(error)
      })
    }
  },

  receiveInterfaces: (interfaces) =>
    set({ interfaces, interfacesStatus: 'ready', interfacesError: null }),

  // An explicit `undefined` in `patch` clears that field; main drops an entry left with neither.
  setNetworkPreference: (id, patch) => {
    const networkPreferences = {
      ...get().networkPreferences,
      [id]: { ...get().networkPreferences[id], ...patch }
    }
    set({ networkPreferences })
    persist({ networkPreferences })
  },

  setThemeSource: (themeSource) => {
    set({ themeSource })
    persist({ themeSource })
  },

  // Feature 3: the material level is a root attribute the stylesheet keys off, so it applies to
  // the whole window the moment it changes; the main process only has to do the platform's own
  // half (see main/windowMaterial.ts).
  setWindowMaterial: (windowMaterial) => {
    document.documentElement.dataset.material = windowMaterial
    set({ windowMaterial })
    persist({ windowMaterial })
  },

  setSpeedTestUrl: (speedTestUrl) => {
    set({ speedTestUrl })
    persist({ speedTestUrl })
  },

  receiveDownloadUpdate: (update) => {
    const { downloads, history } = get()
    // Finished already: an update that arrives late mustn't bring it back.
    if (history.some((entry) => entry.id === update.state.id)) return
    const previous = downloads[update.state.id] ?? null
    const download = applyDownloadUpdate(previous, update)
    if (!download || download === previous) return
    set({ downloads: { ...downloads, [download.id]: download } })
  },

  receiveHistory: (history) => {
    const downloads = { ...get().downloads }
    for (const entry of history) delete downloads[entry.id]
    set({ history, downloads })
  },

  forgetDownload: (id) => {
    const { [id]: removed, ...downloads } = get().downloads
    void removed
    set({ downloads, history: get().history.filter((entry) => entry.id !== id) })
  },

  setView: (view) => set({ view }),

  openNewDownload: (link) =>
    set(link === undefined ? { newDownloadOpen: true } : { newDownloadOpen: true, draftUrl: link }),

  closeNewDownload: () => {
    const { links, shownId } = get()
    if (shownId) return get().finishLink(shownId, false)
    if (links.length > 0) return get().showLink(links[links.length - 1].id)
    set({ newDownloadOpen: false })
  },

  receiveLinks: async () => {
    // main lists every link still waiting, so a window that was closed or reloaded gets them back.
    const pending = await window.plexo.pendingLinks().catch(() => [])
    const known = new Set(get().links.map((link) => link.id))
    const arrived = pending.filter((link) => !known.has(link.id) && !letGo.has(link.id))
    if (arrived.length === 0) return
    set({ links: [...get().links, ...arrived], newDownloadOpen: true })
    get().showLink(arrived[arrived.length - 1].id)
  },

  showLink: (id) => {
    const link = get().links.find((candidate) => candidate.id === id)
    if (link) set({ shownId: id, draftUrl: link.url, formKey: get().formKey + 1 })
  },

  finishLink: (id, started) => {
    const wasShown = get().shownId === id
    get().dropLink(id, started)
    if (!wasShown) return
    const left = get().links
    set({ draftUrl: '' })
    if (left.length > 0) get().showLink(left[left.length - 1].id)
    else set({ newDownloadOpen: false })
  },

  dropLink: (id, started) => {
    const { links, shownId } = get()
    if (!links.some((link) => link.id === id)) return
    letGo.add(id)
    // Started, main has already forgotten its sign-in.
    if (!started) void window.plexo.dismissLink(id).catch(() => {})
    set({
      links: links.filter((link) => link.id !== id),
      ...(shownId === id && { shownId: null })
    })
  },

  setDownloadsAtOnce: (downloadsAtOnce) => {
    set({ downloadsAtOnce })
    persist({ downloadsAtOnce })
  },

  setSpeedLimit: (speedLimit) => {
    set({ speedLimit })
    persist({ speedLimit })
  },

  setSlowMode: (slowMode) => {
    set({ slowMode })
    persist({ slowMode })
  },

  setSlowModeSpeed: (slowModeSpeed) => {
    set({ slowModeSpeed })
    persist({ slowModeSpeed })
  },

  setSpeedUnit: (speedUnit) => {
    set({ speedUnit })
    persist({ speedUnit })
  },

  setDraftUrl: (draftUrl) => set({ draftUrl }),
  setDestinationDir: (destinationDir) => {
    set({ destinationDir })
    persist({ destinationDir })
  },

  setAutoOrganize: (autoOrganize) => {
    set({ autoOrganize })
    persist({ autoOrganize })
  },

  setLearningTailAdaptive: (on) => {
    set({ learningTailAdaptive: on })
    persist({ learning: { tailAdaptive: on } })
  },

  setCongestionFriendly: (on) => {
    set({ congestionFriendly: on })
    // Only throughput is saved; clearing the field means friendly.
    persist({ congestionMode: on ? undefined : 'throughput' })
  },

  loadSources: async () => {
    set({ sourcesLoading: true })
    try {
      const sources = await window.plexo.sources.list()
      set({ sources, sourcesLoading: false })
    } catch {
      set({ sourcesLoading: false })
    }
  },

  addSource: async (url, name) => {
    const created = await window.plexo.sources.add(url, name)
    await get().loadSources()
    return created
  },

  toggleSource: async (id, enabled) => {
    await window.plexo.sources.toggle(id, enabled)
    await get().loadSources()
    if (!enabled) {
      set((state) => ({
        searchResults: state.searchResults.filter((item) => item.sourceId !== id)
      }))
    }
    if (get().searchQuery) {
      void get().performSearch(get().searchQuery)
    } else {
      void get().loadDiscoverCatalog()
    }
  },

  removeSource: async (id) => {
    await window.plexo.sources.remove(id)
    await get().loadSources()
    set((state) => ({
      searchResults: state.searchResults.filter((item) => item.sourceId !== id)
    }))
    if (get().searchQuery) {
      void get().performSearch(get().searchQuery)
    } else {
      void get().loadDiscoverCatalog()
    }
  },

  syncSource: async (id) => {
    await window.plexo.sources.sync(id)
    await get().loadSources()
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setSearchCategory: (searchCategory) => set({ searchCategory }),

  performSearch: async (queryOverride) => {
    const term = (queryOverride !== undefined ? queryOverride : get().searchQuery).trim()
    set({ isSearching: true, searchError: null })
    try {
      if (!term) {
        const items = await window.plexo.content.discover()
        set({ searchResults: items, isSearching: false })
      } else {
        const results = await window.plexo.content.search({
          query: term,
          category: get().searchCategory
        })
        const items = results.flatMap((r) => r.items)
        set({ searchResults: items, isSearching: false })
      }
    } catch (err) {
      set({
        isSearching: false,
        searchError: err instanceof Error ? err.message : String(err)
      })
    }
  },

  loadDiscoverCatalog: async () => {
    set({ isSearching: true, searchError: null })
    try {
      const items = await window.plexo.content.discover()
      set({ searchResults: items, isSearching: false })
    } catch (err) {
      set({
        isSearching: false,
        searchError: err instanceof Error ? err.message : String(err)
      })
    }
  },

  openContentDetails: (item) => set({ selectedContentItem: item, contentDetailsOpen: true }),

  closeContentDetails: () => set({ selectedContentItem: null, contentDetailsOpen: false })
}))
