/**
 * Lightweight, zero-dependency HTML & JSON-LD parser for scraping game catalogs and download pages.
 * Handles embedded Next.js/Nuxt state objects, meta tags, and HTML article cards.
 */

export interface ParsedCard {
  title: string
  url: string
  thumbnailUrl: string
  description?: string
  size?: string
  fileSizeBytes?: number | null
}

/** Extracts __NEXT_DATA__ JSON from modern React/Next.js pages. */
export function extractNextData(html: string): Record<string, unknown> | null {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
  if (!match || !match[1]) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

/** Extracts JSON-LD structured data if present on the page. */
export function extractJsonLd(html: string): unknown[] {
  const results: unknown[] = []
  const regex = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    try {
      results.push(JSON.parse(match[1]))
    } catch {
      // Ignore malformed JSON-LD tags
    }
  }
  return results
}

/** Strips HTML tags and normalizes whitespace. */
export function cleanText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Parses strings like "2.3 GB", "16.5 GiB", "500 MB" into raw byte counts. */
export function parseFileSizeBytes(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(GB|GiB|MB|MiB|TB|TiB|KB|KiB)\b/i)
  if (!m) return null
  const num = parseFloat(m[1])
  const unit = m[2].toUpperCase()
  if (unit.startsWith('T')) return Math.round(num * 1024 * 1024 * 1024 * 1024)
  if (unit.startsWith('G')) return Math.round(num * 1024 * 1024 * 1024)
  if (unit.startsWith('M')) return Math.round(num * 1024 * 1024)
  if (unit.startsWith('K')) return Math.round(num * 1024)
  return null
}

/** Extracts cards (title, url, thumbnail, size) from diverse HTML game catalog patterns. */
export function extractHtmlCards(html: string, baseUrl: string): ParsedCard[] {
  const cards: ParsedCard[] = []
  const seenUrls = new Set<string>()
  const parsedBase = new URL(baseUrl)

  const addCard = (
    titleRaw: string,
    hrefRaw: string,
    thumbRaw?: string,
    sizeRaw?: string,
    descRaw?: string
  ): void => {
    const title = cleanText(titleRaw)
    if (!title || title.length < 2 || !hrefRaw) return
    // Ignore navigational, legal, or utility links
    if (/^(#|javascript:|mailto:|tel:)/i.test(hrefRaw)) return
    if (/(privacy|terms|cookie|dmca|safety|about-us|contact|blog|login|register|donate)/i.test(hrefRaw)) return

    try {
      const resolved = new URL(hrefRaw, parsedBase)
      if (resolved.origin !== parsedBase.origin) return
      const resolvedUrl = resolved.href
      if (seenUrls.has(resolvedUrl)) return
      seenUrls.add(resolvedUrl)

      let resolvedThumb = ''
      if (thumbRaw) {
        try {
          resolvedThumb = new URL(thumbRaw, parsedBase).href
        } catch {
          // ignore invalid thumb URL
        }
      }

      const sizeStr = sizeRaw ? cleanText(sizeRaw) : undefined
      const fileSizeBytes = sizeStr ? parseFileSizeBytes(sizeStr) : null

      cards.push({
        title,
        url: resolvedUrl,
        thumbnailUrl: resolvedThumb,
        size: sizeStr,
        fileSizeBytes,
        description: descRaw ? cleanText(descRaw).slice(0, 240) : undefined
      })
    } catch {
      // Skip invalid URLs
    }
  }

  // Strategy 1: Livewire / Modern portal card containers with data attributes
  // e.g. <div wire:key="post-card-4034" data-game-title="Nomad Drive" data-game-url="https://.../game/..." data-game-image="...">
  const dataCardRegex =
    /<[^>]+(?:data-game-title|data-title)="([^"]+)"[^>]+(?:data-game-url|data-url)="([^"]+)"(?:[^>]+(?:data-game-image|data-image|data-poster)="([^"]*)")?[^>]*>([\s\S]*?)(?:<\/article>|<\/div>)/gi
  let dMatch: RegExpExecArray | null
  while ((dMatch = dataCardRegex.exec(html)) !== null) {
    const rawTitle = dMatch[1]
    const rawUrl = dMatch[2]
    const rawThumb = dMatch[3]
    const block = dMatch[4]
    const sizeMatch = block.match(/(\d+(?:\.\d+)?\s*(?:GB|GiB|MB|MiB|TB|KB))\b/i)
    addCard(rawTitle, rawUrl, rawThumb, sizeMatch ? sizeMatch[1] : undefined)
  }

  // Strategy 2: Structured <article> cards with separate title heading, overlay <a>, and <img>
  const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi
  let artMatch: RegExpExecArray | null
  while ((artMatch = articleRegex.exec(html)) !== null) {
    const block = artMatch[1]

    const linkMatch =
      block.match(/<a[^>]+href="([^"]*(?:\/game\/|\/download\/|\/item\/|\/post\/)[^"]+)"[^>]*>/i) ||
      block.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*(?:inset-0|overlay|cover)[^"]*"[^>]*>/i)
    if (!linkMatch) continue

    const href = linkMatch[1]

    let title = ''
    const headingMatch = block.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i)
    if (headingMatch) {
      title = cleanText(headingMatch[1])
    } else {
      const titleAttrMatch = linkMatch[0].match(/title="([^"]+)"/i) || block.match(/aria-label="([^"—]+)/i)
      if (titleAttrMatch) {
        title = cleanText(titleAttrMatch[1])
      }
    }

    if (!title) continue

    let thumb = ''
    const imgMatch = block.match(/<img[^>]+(?:data-src|src|data-lazy)="([^"]+)"/i)
    if (imgMatch) thumb = imgMatch[1]

    const sizeMatch = block.match(/(\d+(?:\.\d+)?\s*(?:GB|GiB|MB|MiB|TB|KB))\b/i)

    addCard(title, href, thumb, sizeMatch ? sizeMatch[1] : undefined)
  }

  // Strategy 3: Standard WordPress / blog / forum entry cards
  const blockRegex =
    /<(article|div|li)[^>]*class="[^"]*(?:game|item|post|entry|card|product)[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi
  let blockMatch: RegExpExecArray | null

  while ((blockMatch = blockRegex.exec(html)) !== null) {
    const blockContent = blockMatch[2]

    let title = ''
    let href = ''

    const headingLink = blockContent.match(/<h[2-4][^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (headingLink) {
      href = headingLink[1]
      title = cleanText(headingLink[2])
    } else {
      const anyLink = blockContent.match(/<a[^>]*href="([^"]+)"[^>]*title="([^"]+)"/i)
      if (anyLink) {
        href = anyLink[1]
        title = cleanText(anyLink[2])
      }
    }

    if (!title || !href) continue

    let thumbnail = ''
    const imgMatch = blockContent.match(/<img[^>]+(?:data-src|src)="([^"]+)"/i)
    if (imgMatch) {
      thumbnail = imgMatch[1]
    }

    const sizeMatch = blockContent.match(/(\d+(?:\.\d+)?\s*(?:GB|GiB|MB|MiB|TB|KB))\b/i)
    addCard(title, href, thumbnail, sizeMatch ? sizeMatch[1] : undefined)
  }

  // Strategy 3b: Table listings (common in directory indexes, open archives, ROM lists)
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch: RegExpExecArray | null
  while ((trMatch = trRegex.exec(html)) !== null) {
    const row = trMatch[1]
    const aMatch = row.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!aMatch) continue
    const href = aMatch[1]
    const linkText = cleanText(aMatch[2])
    if (!linkText || linkText.length < 2) continue
    if (/^(name|last modified|size|description|parent directory|file|date|title|actions|download)$/i.test(linkText)) continue
    if (/^(#|javascript:|mailto:)/i.test(href)) continue

    const sizeMatch = row.match(/(\d+(?:\.\d+)?\s*(?:GB|GiB|MB|MiB|TB|KB))\b/i)
    if (
      sizeMatch ||
      /\.(?:zip|rar|7z|iso|exe|torrent|tar|bin|pkg|dmg)$/i.test(href) ||
      /(?:\/game\/|\/download\/|\/item\/|\/post\/|\/file\/)/i.test(href) ||
      linkText.length > 3
    ) {
      addCard(linkText, href, undefined, sizeMatch ? sizeMatch[1] : undefined)
    }
  }

  // Strategy 3c: Catalog lists (e.g. <li><a href="...">Game Title</a> (size)</li>)
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi
  let liMatch: RegExpExecArray | null
  while ((liMatch = liRegex.exec(html)) !== null) {
    const item = liMatch[1]
    if (item.includes('class="menu-item') && !item.includes('game') && !item.includes('download')) {
      continue
    }
    const aMatch = item.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!aMatch) continue
    const href = aMatch[1]
    const linkText = cleanText(aMatch[2])
    if (!linkText || linkText.length < 3) continue
    if (/^(home|about|contact|dmca|privacy|terms|faq|donate|login|register|forum|blog)$/i.test(linkText)) continue
    if (/^(#|javascript:|mailto:)/i.test(href)) continue

    const sizeMatch = item.match(/(\d+(?:\.\d+)?\s*(?:GB|GiB|MB|MiB|TB|KB))\b/i)
    const imgMatch = item.match(/<img[^>]+(?:data-src|src)="([^"]+)"/i)
    if (
      sizeMatch ||
      /(?:\/game\/|\/download\/|\/item\/|\/post\/|\/repack\/)/i.test(href) ||
      linkText.length > 5
    ) {
      addCard(linkText, href, imgMatch ? imgMatch[1] : undefined, sizeMatch ? sizeMatch[1] : undefined)
    }
  }

  // Strategy 4: Fallback to direct game links on the page if few cards matched
  if (cards.length < 4) {
    const rawLinkRegex = /<a[^>]+href="([^"]*(?:\/game\/|\/item\/|\/download\/)[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let rMatch: RegExpExecArray | null
    while ((rMatch = rawLinkRegex.exec(html)) !== null) {
      const linkHref = rMatch[1]
      const linkText = cleanText(rMatch[2])
      if (linkText && linkText.length > 2 && !/^(download|details|view|play|buy)$/i.test(linkText)) {
        addCard(linkText, linkHref)
      }
    }
  }

  return cards
}

/**
 * Dynamically discovers pagination links on a catalog page (e.g., page 2, 3, 4, next, older).
 */
export function extractPaginationLinks(html: string, baseUrl: string): string[] {
  const links: string[] = []
  const seen = new Set<string>()
  const parsedBase = new URL(baseUrl)

  const addUrl = (rawHref: string): void => {
    if (!rawHref || /^(#|javascript:|mailto:)/i.test(rawHref)) return
    try {
      const resolved = new URL(rawHref, parsedBase)
      if (resolved.origin !== parsedBase.origin) return
      // Exclude identical URL
      if (resolved.href === parsedBase.href) return
      if (!seen.has(resolved.href)) {
        seen.add(resolved.href)
        links.push(resolved.href)
      }
    } catch {
      // ignore invalid
    }
  }

  // 1. rel="next" links
  const relNextRegex = /<(?:a|link)[^>]+rel="next"[^>]+href="([^"]+)"/gi
  let relMatch: RegExpExecArray | null
  while ((relMatch = relNextRegex.exec(html)) !== null) {
    addUrl(relMatch[1])
  }

  // 2. Class-based pagination links
  const classPaginationRegex =
    /<a[^>]+class="[^"]*(?:next|pagination-next|page-link|page-numbers)[^"]*"[^>]+href="([^"]+)"/gi
  let cMatch: RegExpExecArray | null
  while ((cMatch = classPaginationRegex.exec(html)) !== null) {
    addUrl(cMatch[1])
  }

  // 3. Anchor text with digits, "Next", "Older", "»", etc.
  const anchorRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let aMatch: RegExpExecArray | null
  while ((aMatch = anchorRegex.exec(html)) !== null) {
    const href = aMatch[1]
    const text = cleanText(aMatch[2]).toLowerCase()
    if (
      /^(?:next|older|older posts|more|next page|»|&gt;&gt;|&raquo;|\d{1,4})$/i.test(text) ||
      /(?:[?&](?:page|p|paged)=\d+|\/page\/\d+)/i.test(href)
    ) {
      addUrl(href)
    }
  }

  // Sort discovered pagination URLs so that smaller page numbers come first
  return links.sort((a, b) => {
    const getNum = (u: string): number => {
      const m = u.match(/(?:[?&](?:page|p|paged)=|\/page\/)(\d+)/i)
      return m ? parseInt(m[1], 10) : 999
    }
    return getNum(a) - getNum(b)
  })
}

/**
 * Extracts items from standard RSS feeds, Atom feeds, and XML sitemaps.
 */
export function extractFeedOrSitemapCards(xmlOrHtml: string, baseUrl: string): ParsedCard[] {
  const cards: ParsedCard[] = []
  const seen = new Set<string>()
  const parsedBase = new URL(baseUrl)

  // 1. RSS 2.0 items
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi
  let itMatch: RegExpExecArray | null
  while ((itMatch = itemRegex.exec(xmlOrHtml)) !== null) {
    const block = itMatch[1]
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)
    const linkMatch =
      block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i) ||
      block.match(/<guid[^>]*isPermaLink="true"[^>]*>([\s\S]*?)<\/guid>/i)
    if (!titleMatch || !linkMatch) continue

    const title = cleanText(titleMatch[1])
    const rawLink = cleanText(linkMatch[1])
    if (!title || !rawLink) continue

    try {
      const resolvedUrl = new URL(rawLink, parsedBase).href
      if (seen.has(resolvedUrl)) continue
      seen.add(resolvedUrl)

      // Check for media thumbnail or enclosure
      let thumb = ''
      const thumbMatch =
        block.match(/<media:thumbnail[^>]+url="([^"]+)"/i) ||
        block.match(/<enclosure[^>]+type="image\/[^"]+"[^>]+url="([^"]+)"/i) ||
        block.match(/<img[^>]+src="([^"]+)"/i)
      if (thumbMatch) thumb = thumbMatch[1]

      // Check for enclosure file size
      let sizeStr: string | undefined
      let fileSizeBytes: number | null = null
      const encMatch = block.match(/<enclosure[^>]+length="(\d+)"/i)
      if (encMatch) {
        fileSizeBytes = parseInt(encMatch[1], 10)
      } else {
        const sizeTextMatch = block.match(/(\d+(?:\.\d+)?\s*(?:GB|GiB|MB|MiB|TB|KB))\b/i)
        if (sizeTextMatch) {
          sizeStr = sizeTextMatch[1]
          fileSizeBytes = parseFileSizeBytes(sizeStr)
        }
      }

      cards.push({
        title,
        url: resolvedUrl,
        thumbnailUrl: thumb,
        size: sizeStr,
        fileSizeBytes
      })
    } catch {
      // ignore
    }
  }

  // 2. XML Sitemap <url><loc>...</loc></url>
  if (cards.length === 0) {
    const sitemapRegex = /<url>([\s\S]*?)<\/url>/gi
    let sMatch: RegExpExecArray | null
    while ((sMatch = sitemapRegex.exec(xmlOrHtml)) !== null) {
      const block = sMatch[1]
      const locMatch = block.match(/<loc>([^<]+)<\/loc>/i)
      if (!locMatch) continue
      const rawLoc = locMatch[1].trim()
      // Skip site roots, tags, categories, author pages
      if (/(?:\/category\/|\/tag\/|\/author\/|\/page\/|privacy|terms|about|contact|\.xml)$/i.test(rawLoc)) continue

      try {
        const resolved = new URL(rawLoc, parsedBase).href
        if (seen.has(resolved)) continue
        seen.add(resolved)

        // Generate clean title from slug: /game/cyberpunk-2077 -> Cyberpunk 2077
        const pathParts = new URL(resolved).pathname.split('/').filter(Boolean)
        const lastPart = pathParts[pathParts.length - 1] ?? ''
        const title = lastPart
          .replace(/[-_]+/g, ' ')
          .replace(/\b[a-z]/g, (c) => c.toUpperCase())
          .trim()

        if (title.length > 2) {
          const imgMatch = block.match(/<image:loc>([^<]+)<\/image:loc>/i)
          cards.push({
            title,
            url: resolved,
            thumbnailUrl: imgMatch ? imgMatch[1].trim() : ''
          })
        }
      } catch {
        // ignore
      }
    }
  }

  return cards
}

/** Finds direct file links or download mirror links on a game page. */
export function extractDownloadLinks(html: string, baseUrl: string): string[] {
  const links: string[] = []
  const parsedBase = new URL(baseUrl)
  const hrefRegex = /<(?:a|button)[^>]+(?:href|data-url|data-href|data-download)="([^"]+)"[^>]*>([\s\S]*?)<\/(?:a|button)>/gi
  let match: RegExpExecArray | null

  const DIRECT_EXTS = /\.(zip|rar|7z|iso|exe|tar\.gz|tar\.xz|dmg|pkg|bin|torrent)(\?.*)?$/i
  const MIRROR_HOSTS =
    /(pixeldrain\.com|mediafire\.com|gofile\.io|archive\.org\/download|1fichier\.com|qiwi\.gg|qiwi\.to|megaup\.net|krakenfiles\.com|rapidgator\.net|buzzheavier\.com|datanodes\.to|mega\.nz|drive\.google\.com)/i

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1]
    const label = cleanText(match[2]).toLowerCase()

    if (DIRECT_EXTS.test(href) || MIRROR_HOSTS.test(href) || href.startsWith('magnet:?')) {
      try {
        const resolved = href.startsWith('magnet:') ? href : new URL(href, parsedBase).href
        if (!links.includes(resolved)) links.push(resolved)
      } catch {
        // ignore invalid URL
      }
    } else if (/(?:download|mirror|server|direct link|torrent|magnet)/i.test(label) && /^https?:\/\//i.test(href)) {
      if (!links.includes(href)) links.push(href)
    }
  }

  return links
}
