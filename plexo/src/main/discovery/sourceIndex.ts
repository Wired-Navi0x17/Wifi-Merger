import { isIP } from 'node:net'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  ContentItem,
  ContentSourceConfig,
  ResolvedDownload,
  SearchQuery,
  SourceSearchResult,
  SourceType
} from '../../shared/sourceTypes'
import { readJson, updateJson } from '../jsonFile'
import type { SourceAdapter } from './adapter'
import { ArchiveOrgAdapter } from './adapters/archiveOrgAdapter'
import { CatalogFeedAdapter } from './adapters/catalogFeedAdapter'
import { UniversalWebAdapter } from './adapters/universalWebAdapter'
import { resolveContentDownload } from './resolver'

const DEFAULT_SOURCES: ContentSourceConfig[] = [
  {
    id: 'ia-pc-games',
    name: 'Internet Archive — Historical Games & Software',
    type: 'archive-org',
    url: 'https://archive.org/details/softwarelibrary_msdos_games',
    enabled: true,
    itemCount: 0,
    status: 'ready'
  },
  {
    id: 'ia-classic',
    name: 'Internet Archive — Classic PC Collection',
    type: 'archive-org',
    url: 'https://archive.org/details/classicpcgames',
    enabled: true,
    itemCount: 0,
    status: 'ready'
  }
]

export function isPrivateOrLocalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) return true
    const host = parsed.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
    if (host.endsWith('.local') || host.endsWith('.internal')) return true
    if (isIP(host)) {
      // RFC 1918 / loopback / link-local
      if (host.startsWith('10.') || host.startsWith('127.') || host.startsWith('169.254.')) return true
      if (host.startsWith('192.168.')) return true
      const secondOctet = Number(host.split('.')[1])
      if (host.startsWith('172.') && secondOctet >= 16 && secondOctet <= 31) return true
    }
    return false
  } catch {
    return true
  }
}

export class SourceIndexManager {
  private sources: ContentSourceConfig[] = []
  private readonly itemCache = new Map<string, ContentItem[]>()
  private readonly adapters = new Map<SourceType, SourceAdapter>()
  readonly loaded: Promise<void>

  constructor(private readonly customPath?: string) {
    this.adapters.set('archive-org', new ArchiveOrgAdapter())
    this.adapters.set('universal-web', new UniversalWebAdapter())
    this.adapters.set('catalog-feed', new CatalogFeedAdapter())

    this.loaded = this.load()
  }

  private storagePath(): string {
    if (this.customPath) {
      return this.customPath.endsWith('.json')
        ? this.customPath
        : join(this.customPath, 'content-sources.json')
    }
    const baseDir = app?.getPath ? app.getPath('userData') : process.cwd()
    return join(baseDir, 'content-sources.json')
  }

  private cacheStoragePath(): string {
    if (this.customPath) {
      return this.customPath.endsWith('.json')
        ? this.customPath.replace(/\.json$/, '-cache.json')
        : join(this.customPath, 'content-cache.json')
    }
    const baseDir = app?.getPath ? app.getPath('userData') : process.cwd()
    return join(baseDir, 'content-cache.json')
  }

  private async load(): Promise<void> {
    const saved = await readJson(this.storagePath())
    if (Array.isArray(saved) && saved.length > 0) {
      this.sources = saved as ContentSourceConfig[]
    } else {
      this.sources = structuredClone(DEFAULT_SOURCES)
      await this.save()
    }

    try {
      const savedCache = await readJson(this.cacheStoragePath())
      if (savedCache && typeof savedCache === 'object' && !Array.isArray(savedCache)) {
        for (const [sId, items] of Object.entries(savedCache)) {
          if (Array.isArray(items)) {
            this.itemCache.set(sId, items as ContentItem[])
          }
        }
      }
    } catch {
      // cache read failed, start with empty
    }
  }

  private async save(): Promise<void> {
    await updateJson(this.storagePath(), () => this.sources).catch(() => {})
  }

  private async saveCache(): Promise<void> {
    const cacheObj = Object.fromEntries(this.itemCache.entries())
    await updateJson(this.cacheStoragePath(), () => cacheObj).catch(() => {})
  }

  getAdapter(type: SourceType): SourceAdapter {
    const adapter = this.adapters.get(type)
    if (!adapter) throw new Error(`Unsupported source adapter: ${type}`)
    return adapter
  }

  detectSourceType(url: string): SourceType {
    try {
      const u = new URL(url)
      if (u.hostname.includes('archive.org')) return 'archive-org'
      if (u.pathname.endsWith('.json')) return 'catalog-feed'
      return 'universal-web'
    } catch {
      return 'universal-web'
    }
  }

  async listSources(): Promise<ContentSourceConfig[]> {
    await this.loaded
    return structuredClone(this.sources)
  }

  async addSource(url: string, name?: string, forcedType?: SourceType): Promise<ContentSourceConfig> {
    await this.loaded
    if (isPrivateOrLocalUrl(url)) {
      throw new Error('Private, loopback, or non-HTTP URLs are prohibited')
    }

    const type = forcedType || this.detectSourceType(url)
    const adapter = this.getAdapter(type)
    const val = await adapter.validate(url)
    if (!val.valid) {
      throw new Error(val.error || 'Source validation failed')
    }

    const newSource: ContentSourceConfig = {
      id: `source-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: name?.trim() || val.name || new URL(url).hostname,
      type,
      url,
      enabled: true,
      itemCount: 0,
      status: 'ready'
    }

    this.sources.push(newSource)
    await this.save()

    // Trigger immediate background sync so catalog is indexed right away
    void this.syncSource(newSource.id).catch(() => {})

    return newSource
  }

  async removeSource(id: string): Promise<void> {
    await this.loaded
    this.sources = this.sources.filter((s) => s.id !== id)
    this.itemCache.delete(id)
    await this.save()
    await this.saveCache()
  }

  async toggleSource(id: string, enabled: boolean): Promise<void> {
    await this.loaded
    const src = this.sources.find((s) => s.id === id)
    if (src) {
      src.enabled = enabled
      await this.save()
    }
  }

  async syncSource(id: string): Promise<number> {
    await this.loaded
    const src = this.sources.find((s) => s.id === id)
    if (!src) throw new Error('Source not found')

    src.status = 'indexing'
    const adapter = this.getAdapter(src.type)
    try {
      const items = await adapter.discover(src)
      this.itemCache.set(src.id, items)
      await this.saveCache()

      src.itemCount = items.length
      src.lastIndexedAt = Date.now()
      src.status = 'ready'
      src.errorMessage = undefined
      await this.save()
      return items.length
    } catch (err) {
      src.status = 'error'
      src.errorMessage = err instanceof Error ? err.message : String(err)
      await this.save()
      throw err
    }
  }

  async search(query: SearchQuery): Promise<SourceSearchResult[]> {
    await this.loaded
    const targetSources = query.sourceId
      ? this.sources.filter((s) => s.id === query.sourceId && s.enabled)
      : this.sources.filter((s) => s.enabled)

    if (targetSources.length === 0) return []

    const term = query.query.toLowerCase().trim()

    // Concurrently search all enabled sources
    const searches = targetSources.map(async (source): Promise<SourceSearchResult> => {
      const started = Date.now()
      try {
        const cached = this.itemCache.get(source.id) || []
        const localMatches = term
          ? cached.filter((item) => item.title.toLowerCase().includes(term))
          : cached

        // If local cache has plenty of matches, return immediately
        if (localMatches.length >= 6) {
          const filtered = query.category ? localMatches.filter((i) => i.category === query.category) : localMatches
          return {
            sourceId: source.id,
            sourceName: source.name,
            items: filtered,
            durationMs: Date.now() - started
          }
        }

        // Otherwise query adapter live
        const adapter = this.getAdapter(source.type)
        const liveItems = await adapter.search(source, query.query)

        // Merge without duplicate pageUrls
        const seenUrls = new Set(localMatches.map((i) => i.pageUrl))
        const merged = [...localMatches]
        for (const item of liveItems) {
          if (!seenUrls.has(item.pageUrl)) {
            seenUrls.add(item.pageUrl)
            merged.push(item)
          }
        }

        return {
          sourceId: source.id,
          sourceName: source.name,
          items: query.category ? merged.filter((i) => i.category === query.category) : merged,
          durationMs: Date.now() - started
        }
      } catch (err) {
        return {
          sourceId: source.id,
          sourceName: source.name,
          items: [],
          durationMs: Date.now() - started,
          error: err instanceof Error ? err.message : 'Search failed'
        }
      }
    })

    return Promise.all(searches)
  }

  async discover(): Promise<ContentItem[]> {
    await this.loaded
    const enabled = this.sources.filter((s) => s.enabled)
    const results: ContentItem[] = []

    for (const src of enabled) {
      try {
        const cached = this.itemCache.get(src.id)
        if (cached && cached.length > 0) {
          results.push(...cached.slice(0, 32))
        } else {
          const adapter = this.getAdapter(src.type)
          const items = await adapter.discover(src)
          this.itemCache.set(src.id, items)
          void this.saveCache()
          src.itemCount = items.length
          src.lastIndexedAt = Date.now()
          void this.save()
          results.push(...items.slice(0, 32))
        }
      } catch {
        // Continue to other sources
      }
    }

    return results
  }

  async resolveDownload(item: ContentItem): Promise<ResolvedDownload> {
    await this.loaded
    const source = this.sources.find((s) => s.id === item.sourceId)
    if (!source) throw new Error('Origin source not found')
    const adapter = this.getAdapter(source.type)
    return resolveContentDownload(item, source, adapter)
  }
}

