import type { ContentItem, ContentSourceConfig } from '../../../shared/sourceTypes'
import type { SourceAdapter, ValidateResult } from '../adapter'

interface CatalogFeedItem {
  id?: string | number
  title?: string
  name?: string
  description?: string
  cover?: string
  thumbnail?: string
  image?: string
  size?: number | string
  version?: string
  platforms?: string[]
  url?: string
  pageUrl?: string
  downloadUrl?: string
  uris?: string[]
}

export class CatalogFeedAdapter implements SourceAdapter {
  readonly type = 'catalog-feed'

  async validate(url: string): Promise<ValidateResult> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return { valid: false, name: '', error: `HTTP ${res.status}` }
      const text = await res.text()
      try {
        const json = JSON.parse(text)
        const name = (json as { name?: string }).name || 'Custom Catalog Feed'
        return { valid: true, name }
      } catch {
        return { valid: false, name: '', error: 'URL did not return valid JSON' }
      }
    } catch (err) {
      return { valid: false, name: '', error: err instanceof Error ? err.message : 'Failed to reach feed' }
    }
  }

  async discover(source: ContentSourceConfig): Promise<ContentItem[]> {
    return this.search(source, '')
  }

  async search(source: ContentSourceConfig, query: string): Promise<ContentItem[]> {
    const res = await fetch(source.url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`)
    const json = (await res.json()) as { items?: CatalogFeedItem[]; games?: CatalogFeedItem[] } | CatalogFeedItem[]
    const itemsRaw: CatalogFeedItem[] = Array.isArray(json)
      ? json
      : Array.isArray(json.items)
        ? json.items
        : Array.isArray(json.games)
          ? json.games
          : []

    const q = query.toLowerCase().trim()
    const filtered = q
      ? itemsRaw.filter((item) => {
          const title = (item.title || item.name || '').toLowerCase()
          const desc = (item.description || '').toLowerCase()
          return title.includes(q) || desc.includes(q)
        })
      : itemsRaw.slice(0, 50)

    return filtered.map((item, idx): ContentItem => {
      const title = item.title || item.name || `Game ${idx}`
      const download = item.downloadUrl || (item.uris && item.uris[0]) || undefined
      return {
        id: `${source.id}:${item.id ?? idx}`,
        sourceId: source.id,
        sourceName: source.name,
        title,
        description: item.description ?? '',
        thumbnailUrl: item.cover || item.thumbnail || item.image || '',
        category: 'game',
        platforms: ['all'],
        fileSizeBytes: typeof item.size === 'number' ? item.size : null,
        version: item.version,
        pageUrl: item.pageUrl || item.url || source.url,
        downloadUrl: download
      }
    })
  }

  async resolveDownload(_source: ContentSourceConfig, item: ContentItem): Promise<string | null> {
    return item.downloadUrl ?? null
  }
}
