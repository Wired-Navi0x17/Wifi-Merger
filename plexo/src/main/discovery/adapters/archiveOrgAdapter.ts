import type { ContentItem, ContentSourceConfig } from '../../../shared/sourceTypes'
import type { SourceAdapter, ValidateResult } from '../adapter'

interface ArchiveOrgItem {
  identifier: string
  title?: string
  description?: string
  mediatype?: string
  year?: string
  downloads?: number
  item_size?: number
}

interface ArchiveOrgFile {
  name: string
  source: string
  format: string
  size?: string
  md5?: string
  sha1?: string
}

export class ArchiveOrgAdapter implements SourceAdapter {
  readonly type = 'archive-org'

  async validate(url: string): Promise<ValidateResult> {
    try {
      const u = new URL(url)
      if (!u.hostname.includes('archive.org')) {
        return { valid: false, name: '', error: 'URL must belong to archive.org' }
      }
      return { valid: true, name: 'Internet Archive Games & Software' }
    } catch {
      return { valid: false, name: '', error: 'Invalid URL format' }
    }
  }

  async discover(source: ContentSourceConfig): Promise<ContentItem[]> {
    return this.search(source, 'game')
  }

  async search(source: ContentSourceConfig, query: string): Promise<ContentItem[]> {
    const trimmed = query.trim() || 'game'
    const searchUrl = new URL('https://archive.org/advancedsearch.php')
    
    // Search software/games collection on Internet Archive
    searchUrl.searchParams.set(
      'q',
      `mediatype:(software) AND (title:(${trimmed}) OR description:(${trimmed}))`
    )
    searchUrl.searchParams.set('fl[]', 'identifier,title,description,year,downloads,item_size')
    searchUrl.searchParams.set('sort[]', 'downloads desc')
    searchUrl.searchParams.set('rows', '24')
    searchUrl.searchParams.set('page', '1')
    searchUrl.searchParams.set('output', 'json')

    const response = await fetch(searchUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Plexo/1.0',
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(8000)
    })

    if (!response.ok) {
      throw new Error(`Archive.org search returned HTTP ${response.status}`)
    }

    const data = (await response.json()) as { response?: { docs?: ArchiveOrgItem[] } }
    const docs = data.response?.docs ?? []

    return docs.map((doc): ContentItem => {
      const id = doc.identifier
      return {
        id: `${source.id}:${id}`,
        sourceId: source.id,
        sourceName: source.name,
        title: doc.title || id,
        description: (doc.description || 'Historical game / software archive').slice(0, 300),
        thumbnailUrl: `https://archive.org/services/img/${id}`,
        category: 'game',
        platforms: ['windows', 'all'],
        fileSizeBytes: doc.item_size ? Number(doc.item_size) : null,
        year: doc.year ? Number(doc.year) : undefined,
        pageUrl: `https://archive.org/details/${id}`
      }
    })
  }

  async resolveDownload(_source: ContentSourceConfig, item: ContentItem): Promise<string | null> {
    const identifier = item.pageUrl.split('/').filter(Boolean).pop()
    if (!identifier) return null

    const metaUrl = `https://archive.org/metadata/${identifier}/files`
    const response = await fetch(metaUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 Plexo/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    })

    if (!response.ok) return null

    const data = (await response.json()) as { result?: ArchiveOrgFile[] }
    const files = data.result ?? []

    // Priority file types for game installation / play: ISO, ZIP, RAR, 7Z, EXE
    const GAME_FORMATS = /\.(iso|zip|rar|7z|exe|tar\.gz)$/i
    const targetFile = files.find((f) => GAME_FORMATS.test(f.name) && f.source === 'original') ||
      files.find((f) => GAME_FORMATS.test(f.name))

    if (!targetFile) return null

    return `https://archive.org/download/${identifier}/${encodeURIComponent(targetFile.name)}`
  }
}
