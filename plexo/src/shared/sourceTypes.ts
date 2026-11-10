export type ContentCategory = 'game' | 'tool' | 'media' | 'archive' | 'other'

export interface ContentItem {
  id: string
  sourceId: string
  sourceName: string
  title: string
  description: string
  thumbnailUrl: string
  category: ContentCategory
  version?: string
  fileSizeBytes: number | null
  platforms: ('windows' | 'linux' | 'macos' | 'all')[]
  pageUrl: string
  downloadUrl?: string
  hash?: { algorithm: 'md5' | 'sha1' | 'sha256'; value: string }
  year?: number
}

export type SourceType = 'archive-org' | 'universal-web' | 'catalog-feed'

export interface ContentSourceConfig {
  id: string
  name: string
  type: SourceType
  url: string
  enabled: boolean
  lastIndexedAt?: number
  itemCount: number
  status: 'ready' | 'indexing' | 'error'
  errorMessage?: string
  rateLimitMs?: number
}

export interface SearchQuery {
  query: string
  category?: ContentCategory
  sourceId?: string
  limit?: number
}

export interface SourceSearchResult {
  items: ContentItem[]
  sourceId: string
  sourceName: string
  durationMs: number
  error?: string
}

export interface ResolvedDownload {
  url: string
  fileName: string
  totalBytes: number
  supportsRanges: boolean
  etag: string | null
  sourceName: string
  contentTitle: string
}
