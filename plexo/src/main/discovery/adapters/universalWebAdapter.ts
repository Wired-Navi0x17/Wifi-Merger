import type { ContentItem, ContentSourceConfig } from '../../../shared/sourceTypes'
import type { SourceAdapter, ValidateResult } from '../adapter'
import {
  cleanText,
  extractDownloadLinks,
  extractFeedOrSitemapCards,
  extractHtmlCards,
  extractNextData,
  extractPaginationLinks,
  type ParsedCard
} from '../htmlParser'
import { robustFetch } from '../fetcher'

export class UniversalWebAdapter implements SourceAdapter {
  readonly type = 'universal-web'

  async validate(url: string): Promise<ValidateResult> {
    try {
      const u = new URL(url)
      if (!['http:', 'https:'].includes(u.protocol)) {
        return { valid: false, name: '', error: 'Only http and https protocols are supported' }
      }
      return { valid: true, name: u.hostname.replace(/^www\./, '') }
    } catch {
      return { valid: false, name: '', error: 'Invalid URL format' }
    }
  }

  private readonly defaultHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8'
  }

  async discover(source: ContentSourceConfig): Promise<ContentItem[]> {
    const items: ContentItem[] = []
    const seenUrls = new Set<string>()

    const ingestCards = (cards: ParsedCard[]): void => {
      for (const card of cards) {
        if (!seenUrls.has(card.url)) {
          seenUrls.add(card.url)
          items.push({
            id: `${source.id}:${card.url}`,
            sourceId: source.id,
            sourceName: source.name,
            title: card.title,
            description: card.description ?? `Discovered on ${source.name}`,
            thumbnailUrl: card.thumbnailUrl,
            category: 'game',
            platforms: ['all'],
            fileSizeBytes: card.fileSizeBytes ?? null,
            pageUrl: card.url
          })
        }
      }
    }

    const parsedBase = new URL(source.url)
    const crawlQueue: string[] = [source.url]
    const visitedUrls = new Set<string>()
    const MAX_PAGES_TO_CRAWL = 8
    const MAX_ITEMS = 350

    // BFS crawl loop over pagination and catalog sub-pages
    while (crawlQueue.length > 0 && visitedUrls.size < MAX_PAGES_TO_CRAWL && items.length < MAX_ITEMS) {
      const currentUrl = crawlQueue.shift()!
      if (visitedUrls.has(currentUrl)) continue
      visitedUrls.add(currentUrl)

      try {
        const res = await robustFetch(currentUrl, {
          headers: this.defaultHeaders,
          timeoutMs: 7000
        })
        if (!res.ok) continue
        const rawContent = await res.text()

        // 1. If response is XML feed or sitemap, extract items directly
        if (
          rawContent.trim().startsWith('<?xml') ||
          rawContent.includes('<rss') ||
          rawContent.includes('<urlset') ||
          currentUrl.endsWith('.xml')
        ) {
          const feedCards = extractFeedOrSitemapCards(rawContent, currentUrl)
          ingestCards(feedCards)
          continue
        }

        // 2. Extract HTML game cards
        const cards = extractHtmlCards(rawContent, currentUrl)
        ingestCards(cards)

        // 3. On initial page, inspect for linked RSS feeds and high-level catalog sections
        if (visitedUrls.size === 1) {
          // Check for linked RSS feed in <head>
          const feedMatch = rawContent.match(
            /<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]+href="([^"]+)"/i
          )
          if (feedMatch) {
            try {
              const feedUrl = new URL(feedMatch[1], currentUrl).href
              if (!visitedUrls.has(feedUrl) && !crawlQueue.includes(feedUrl)) {
                crawlQueue.unshift(feedUrl)
              }
            } catch {
              // ignore
            }
          }

          // Discover high-level catalog or browse sections dynamically
          const linkRegex = /<a[^>]+href="([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi
          let m: RegExpExecArray | null
          let catalogSectionsFound = 0
          while ((m = linkRegex.exec(rawContent)) !== null && catalogSectionsFound < 3) {
            const rawHref = m[1].trim()
            const label = m[2].replace(/<[^>]+>/g, '').trim().toLowerCase()
            const lowerHref = rawHref.toLowerCase()

            if (
              /catalog|games|all|browse|downloads|library|collection|archive|software|repacks|roms/i.test(label) ||
              /\/(?:games|catalog|browse|downloads|all|library|archive|software|collection|repacks)\b/i.test(lowerHref)
            ) {
              try {
                const resolved = new URL(rawHref, currentUrl).href
                if (
                  resolved.startsWith(parsedBase.origin) &&
                  resolved !== source.url &&
                  !visitedUrls.has(resolved) &&
                  !crawlQueue.includes(resolved)
                ) {
                  crawlQueue.push(resolved)
                  catalogSectionsFound++
                }
              } catch {
                // ignore
              }
            }
          }
        }

        // 4. Discover pagination links (pages 2, 3, 4, 5..., rel="next", etc.)
        const paginationLinks = extractPaginationLinks(rawContent, currentUrl)
        for (const pageUrl of paginationLinks) {
          if (!visitedUrls.has(pageUrl) && !crawlQueue.includes(pageUrl)) {
            crawlQueue.push(pageUrl)
          }
        }
      } catch {
        // Continue crawling remaining queue
      }
    }

    // 5. Fallback probes if 0 items were found (for SPA sites, headless frontends, etc.)
    if (items.length === 0) {
      const probeEndpoints = [
        `${parsedBase.origin}/wp-json/wp/v2/posts?per_page=50&_embed=1`,
        `${parsedBase.origin}/feed/`,
        `${parsedBase.origin}/rss`,
        `${parsedBase.origin}/sitemap.xml`,
        `${parsedBase.origin}/post-sitemap.xml`
      ]

      for (const endpoint of probeEndpoints) {
        try {
          const res = await robustFetch(endpoint, {
            headers: this.defaultHeaders,
            timeoutMs: 6000
          })
          if (!res.ok) continue

          if (endpoint.includes('/wp-json/wp/v2/posts')) {
            const posts = (await res.json()) as Array<{
              id: number
              title?: { rendered?: string }
              excerpt?: { rendered?: string }
              link: string
              _embedded?: { 'wp:featuredmedia'?: Array<{ source_url?: string }> }
            }>
            if (Array.isArray(posts) && posts.length > 0) {
              for (const post of posts) {
                if (!seenUrls.has(post.link)) {
                  seenUrls.add(post.link)
                  items.push({
                    id: `${source.id}:${post.id}`,
                    sourceId: source.id,
                    sourceName: source.name,
                    title: cleanText(post.title?.rendered ?? `Item ${post.id}`),
                    description: cleanText(post.excerpt?.rendered ?? '').slice(0, 260),
                    thumbnailUrl: post._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? '',
                    category: 'game',
                    platforms: ['all'],
                    fileSizeBytes: null,
                    pageUrl: post.link
                  })
                }
              }
              break
            }
          } else {
            const body = await res.text()
            const probedCards = extractFeedOrSitemapCards(body, endpoint)
            if (probedCards.length > 0) {
              ingestCards(probedCards)
              break
            }
          }
        } catch {
          // Probe next endpoint
        }
      }
    }

    return items
  }

  async search(source: ContentSourceConfig, query: string): Promise<ContentItem[]> {
    if (!query.trim()) {
      return this.discover(source)
    }

    const baseUrl = source.url.replace(/\/+$/, '')
    const term = query.trim()

    // 1. Try WordPress public API search first
    try {
      const wpUrl = `${baseUrl}/wp-json/wp/v2/posts?search=${encodeURIComponent(term)}&_embed=1&per_page=12`
      const wpRes = await robustFetch(wpUrl, { headers: this.defaultHeaders, timeoutMs: 5000 })
      if (wpRes.ok) {
        const posts = (await wpRes.json()) as Array<{
          id: number
          title?: { rendered?: string }
          excerpt?: { rendered?: string }
          link: string
          _embedded?: { 'wp:featuredmedia'?: Array<{ source_url?: string }> }
        }>
        if (Array.isArray(posts) && posts.length > 0) {
          return posts.map((post): ContentItem => ({
            id: `${source.id}:${post.id}`,
            sourceId: source.id,
            sourceName: source.name,
            title: cleanText(post.title?.rendered ?? `Post ${post.id}`),
            description: cleanText(post.excerpt?.rendered ?? '').slice(0, 260),
            thumbnailUrl: post._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? '',
            category: 'game',
            platforms: ['all'],
            fileSizeBytes: null,
            pageUrl: post.link
          }))
        }
      }
    } catch {
      // WP endpoint not supported, proceed to HTML search
    }

    // 2. Fetch standard HTML search queries
    const searchCandidates = [
      `${baseUrl}/?s=${encodeURIComponent(term)}`,
      `${baseUrl}/search?q=${encodeURIComponent(term)}`,
      `${baseUrl}/games-list?search=${encodeURIComponent(term)}`,
      `${baseUrl}/games?search=${encodeURIComponent(term)}`,
      `${baseUrl}/index.php?s=${encodeURIComponent(term)}`,
      `${baseUrl}/?q=${encodeURIComponent(term)}`
    ]

    for (const searchUrl of searchCandidates) {
      try {
        const res = await robustFetch(searchUrl, { headers: this.defaultHeaders, timeoutMs: 7000 })
        if (!res.ok) continue
        const html = await res.text()

        // Check for Next.js __NEXT_DATA__
        const nextData = extractNextData(html)
        if (nextData && typeof nextData === 'object') {
          const pageProps = (nextData as { props?: { pageProps?: Record<string, unknown> } })?.props?.pageProps
          if (pageProps) {
            const candidateList = Object.values(pageProps).find(Array.isArray) as unknown[] | undefined
            if (candidateList && candidateList.length > 0) {
              const items: ContentItem[] = []
              for (const raw of candidateList) {
                if (!raw || typeof raw !== 'object') continue
                const r = raw as Record<string, unknown>
                const title = String(r.title || r.name || '')
                if (!title) continue
                const slug = String(r.slug || r.id || '')
                items.push({
                  id: `${source.id}:${slug || title}`,
                  sourceId: source.id,
                  sourceName: source.name,
                  title,
                  description: String(r.description || r.summary || '').slice(0, 260),
                  thumbnailUrl: String(r.cover || r.thumbnail || r.image || ''),
                  category: 'game',
                  platforms: ['all'],
                  fileSizeBytes: typeof r.size === 'number' ? r.size : null,
                  pageUrl: slug ? `${baseUrl}/game/${slug}` : baseUrl
                })
              }
              if (items.length > 0) return items
            }
          }
        }

        // Check extracted HTML cards
        const cards = extractHtmlCards(html, searchUrl)
        if (cards.length > 0) {
          return cards.map((card, idx): ContentItem => ({
            id: `${source.id}:${idx}:${encodeURIComponent(card.url)}`,
            sourceId: source.id,
            sourceName: source.name,
            title: card.title,
            description: card.description ?? `Discovered on ${source.name}`,
            thumbnailUrl: card.thumbnailUrl,
            category: 'game',
            platforms: ['all'],
            fileSizeBytes: card.fileSizeBytes ?? null,
            pageUrl: card.url
          }))
        }
      } catch {
        // Try next candidate
      }
    }

    return []
  }

  async resolveDownload(_source: ContentSourceConfig, item: ContentItem): Promise<string | null> {
    if (!item.pageUrl) return null

    try {
      const res = await robustFetch(item.pageUrl, { headers: this.defaultHeaders, timeoutMs: 8000 })
      if (!res.ok) return null
      const html = await res.text()

      const downloadLinks = extractDownloadLinks(html, item.pageUrl)
      if (downloadLinks.length > 0) {
        // Pick first direct link or mirror
        return downloadLinks[0]
      }
    } catch {
      // Resolution failed
    }

    return null
  }
}

