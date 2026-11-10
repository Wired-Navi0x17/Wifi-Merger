import assert from 'node:assert/strict'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  extractHtmlCards,
  extractJsonLd,
  extractNextData,
  extractDownloadLinks,
  extractPaginationLinks,
  extractFeedOrSitemapCards
} from '../src/main/discovery/htmlParser'
import { SourceIndexManager } from '../src/main/discovery/sourceIndex'
import { ArchiveOrgAdapter } from '../src/main/discovery/adapters/archiveOrgAdapter'
import { CatalogFeedAdapter } from '../src/main/discovery/adapters/catalogFeedAdapter'

async function runTests(): Promise<void> {
  console.log('🧪 Testing HTML Parser...')

  // 1. JSON-LD extraction test
  const sampleJsonLdHtml = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "VideoGame",
            "name": "Hades",
            "description": "Defy the god of the dead as you hack and slash out of the Underworld.",
            "image": "https://example.com/hades.jpg",
            "genre": "Action Roguelike",
            "operatingSystem": "Windows, macOS"
          }
        </script>
      </head>
      <body><h1>Hades</h1></body>
    </html>
  `
  const jsonLdItems = extractJsonLd(sampleJsonLdHtml) as Record<string, unknown>[]
  assert.equal(jsonLdItems.length, 1, 'Should extract 1 JSON-LD item')
  assert.equal(jsonLdItems[0].name, 'Hades')
  assert.equal(jsonLdItems[0]['@type'], 'VideoGame')
  assert.equal(jsonLdItems[0].image, 'https://example.com/hades.jpg')
  console.log('  ✓ JSON-LD extraction passed')

  // 2. Next.js __NEXT_DATA__ extraction test
  const sampleNextDataHtml = `
    <html>
      <body>
        <script id="__NEXT_DATA__" type="application/json">
          {
            "props": {
              "pageProps": {
                "games": [
                  {
                    "id": "game-42",
                    "title": "Celeste",
                    "summary": "Help Madeline survive her inner demons on her journey to the top of Celeste Mountain.",
                    "cover": "/images/celeste.png",
                    "fileSize": 1258291200,
                    "downloadUrl": "https://example.com/files/celeste.zip"
                  }
                ]
              }
            }
          }
        </script>
      </body>
    </html>
  `
  const nextData = extractNextData(sampleNextDataHtml) as Record<string, any>
  assert.ok(nextData, 'Should extract __NEXT_DATA__')
  assert.equal(nextData.props.pageProps.games[0].title, 'Celeste')
  assert.equal(nextData.props.pageProps.games[0].downloadUrl, 'https://example.com/files/celeste.zip')
  console.log('  ✓ Next.js __NEXT_DATA__ extraction passed')

  // 3. Fallback HTML search cards parsing
  const sampleCatalogHtml = `
    <div class="search-results">
      <article class="game-card">
        <h2><a href="/game/dead-cells">Dead Cells v1.24</a></h2>
        <img src="https://example.com/covers/dead-cells.jpg" alt="Dead Cells" />
        <p class="description">Roguevania action platformer.</p>
      </article>
    </div>
  `
  const htmlCards = extractHtmlCards(sampleCatalogHtml, 'https://example.com/search?q=dead')
  assert.equal(htmlCards.length, 1, 'Should extract 1 HTML card')
  assert.equal(htmlCards[0].title, 'Dead Cells v1.24')
  assert.equal(htmlCards[0].url, 'https://example.com/game/dead-cells')
  assert.equal(htmlCards[0].thumbnailUrl, 'https://example.com/covers/dead-cells.jpg')
  console.log('  ✓ Universal HTML card parsing passed')

  // 3b. Modern Livewire / Alpine portal cards test (e.g. AnkerGames)
  const sampleLivewireHtml = `
    <div wire:key="post-card-4034"
         data-game-id="4034"
         data-game-title="Nomad Drive"
         data-game-url="https://ankergames.net/game/nomad-drive"
         data-game-image="https://ankergames.net/uploads/poster/nomad-drive.jpg">
      <article class="group relative">
        <span class="truncate">2.3 GB</span>
        <h3>Nomad Drive</h3>
        <a href="https://ankergames.net/game/nomad-drive" class="absolute inset-0"></a>
      </article>
    </div>
  `
  const modernCards = extractHtmlCards(sampleLivewireHtml, 'https://ankergames.net/games-list')
  assert.equal(modernCards.length, 1, 'Should extract 1 modern portal card')
  assert.equal(modernCards[0].title, 'Nomad Drive')
  assert.equal(modernCards[0].url, 'https://ankergames.net/game/nomad-drive')
  assert.equal(modernCards[0].thumbnailUrl, 'https://ankergames.net/uploads/poster/nomad-drive.jpg')
  assert.equal(modernCards[0].size, '2.3 GB')
  assert.equal(modernCards[0].fileSizeBytes, Math.round(2.3 * 1024 * 1024 * 1024))
  console.log('  ✓ Modern Livewire / AnkerGames card & size parsing passed')

  // 4. Mirror link resolution test
  const sampleDownloadPageHtml = `
    <div class="downloads">
      <a href="https://pixeldrain.com/u/abc123">Pixeldrain Mirror</a>
      <a href="https://archive.org/download/classic-game/game.zip">Direct Archive Mirror</a>
      <a href="/internal-tracker">Internal Tracker</a>
    </div>
  `
  const mirrors = extractDownloadLinks(sampleDownloadPageHtml, 'https://example.com/item/1')
  assert.ok(mirrors.includes('https://pixeldrain.com/u/abc123'), 'Should identify Pixeldrain')
  assert.ok(mirrors.includes('https://archive.org/download/classic-game/game.zip'), 'Should identify Archive.org zip')
  console.log('  ✓ Mirror download link resolution passed')

  // 4b. Table & list parsing test
  const sampleTableHtml = `
    <table>
      <thead><tr><th>Name</th><th>Size</th><th>Date</th></tr></thead>
      <tbody>
        <tr><td><a href="/downloads/quake3.iso">Quake III Arena</a></td><td>480 MB</td><td>2023-01-01</td></tr>
        <tr><td><a href="/downloads/doom.zip">Doom Classic</a></td><td>30 MB</td><td>2023-01-02</td></tr>
      </tbody>
    </table>
  `
  const tableCards = extractHtmlCards(sampleTableHtml, 'https://archive-mirror.org/files/')
  assert.equal(tableCards.length, 2, 'Should extract 2 table row items')
  assert.equal(tableCards[0].title, 'Quake III Arena')
  assert.equal(tableCards[0].size, '480 MB')
  assert.equal(tableCards[1].title, 'Doom Classic')
  console.log('  ✓ Table listing parser passed')

  // 4c. Dynamic pagination link discovery test
  const samplePaginationHtml = `
    <nav class="pagination">
      <a href="/catalog?page=1" class="page-numbers">1</a>
      <a href="/catalog?page=2" class="page-numbers">2</a>
      <a href="/catalog?page=3" class="page-numbers">3</a>
      <a href="/catalog?page=4" rel="next">Next »</a>
    </nav>
  `
  const pageLinks = extractPaginationLinks(samplePaginationHtml, 'https://example.com/catalog?page=1')
  assert.ok(pageLinks.length >= 3, 'Should discover multiple pagination pages')
  assert.ok(pageLinks.some((l) => l.includes('page=2')), 'Should contain page 2')
  assert.ok(pageLinks.some((l) => l.includes('page=3')), 'Should contain page 3')
  assert.ok(pageLinks.some((l) => l.includes('page=4')), 'Should contain page 4')
  console.log('  ✓ Dynamic pagination link discovery passed')

  // 4d. RSS Feed and XML Sitemap parser test
  const sampleRssXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Game Releases</title>
        <item>
          <title>Elden Ring v1.12</title>
          <link>https://example.com/games/elden-ring</link>
          <enclosure url="https://example.com/covers/elden.jpg" length="64424509440" type="application/zip" />
        </item>
      </channel>
    </rss>
  `
  const feedCards = extractFeedOrSitemapCards(sampleRssXml, 'https://example.com/feed')
  assert.equal(feedCards.length, 1, 'Should extract 1 RSS feed item')
  assert.equal(feedCards[0].title, 'Elden Ring v1.12')
  assert.equal(feedCards[0].url, 'https://example.com/games/elden-ring')
  assert.equal(feedCards[0].fileSizeBytes, 64424509440)
  console.log('  ✓ RSS feed & XML sitemap parser passed')

  // 5. SourceIndexManager SSRF & Persistence test
  console.log('\n🧪 Testing SourceIndexManager & SSRF Protection...')
  const testDir = join(tmpdir(), `plexo-sources-test-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })

  try {
    const manager = new SourceIndexManager(testDir)

    try {
      await manager.addSource('http://127.0.0.1:8080/secret')
      assert.fail('Should have thrown')
    } catch (e: any) {
      console.log('  Actual error caught:', e?.message || e)
      assert.match(e?.message, /Private, loopback, or non-HTTP/i)
    }

    try {
      await manager.addSource('http://192.168.1.1/admin')
      assert.fail('Should have thrown')
    } catch (e: any) {
      assert.match(e?.message, /Private, loopback, or non-HTTP/i)
    }
    console.log('  ✓ SSRF rejection passed for local/private IPs')

    // Add valid source (Archive.org auto-type detection)
    const archiveSource = await manager.addSource(
      'https://archive.org/details/softwarelibrary_msdos_games',
      'MS-DOS Collection'
    )
    assert.equal(archiveSource.type, 'archive-org', 'Should auto-detect Archive.org source type')
    assert.equal(archiveSource.name, 'MS-DOS Collection')
    assert.equal(archiveSource.enabled, true)

    // Toggle source off
    await manager.toggleSource(archiveSource.id, false)
    const sourcesAfterToggle = await manager.listSources()
    assert.equal(sourcesAfterToggle.find((s) => s.id === archiveSource.id)?.enabled, false)

    // Verify discover() never returns items from disabled source
    const discoverWhileDisabled = await manager.discover()
    assert.ok(
      !discoverWhileDisabled.some((it) => it.sourceId === archiveSource.id),
      'discover() must not return items from disabled sources'
    )

    // Verify search() never returns items from disabled source
    const searchWhileDisabled = await manager.search({ query: 'game' })
    assert.ok(
      !searchWhileDisabled.some((res) => res.sourceId === archiveSource.id),
      'search() must not query or return items from disabled sources'
    )
    console.log('  ✓ Source toggle state passed (disabled sources hidden from discover and search)')

    // Persistence reload test
    const reloadedManager = new SourceIndexManager(testDir)
    const reloadedSources = await reloadedManager.listSources()
    assert.equal(reloadedSources.some((s) => s.id === archiveSource.id), true)
    console.log('  ✓ sources.json file persistence passed')

    // Remove source
    await manager.removeSource(archiveSource.id)
    const sourcesAfterRemove = await manager.listSources()
    assert.equal(sourcesAfterRemove.some((s) => s.id === archiveSource.id), false)
    console.log('  ✓ Source removal passed')
  } finally {
    rmSync(testDir, { recursive: true, force: true })
  }

  // 6. Adapters Search Test
  console.log('\n🧪 Testing Adapters...')
  const archiveAdapter = new ArchiveOrgAdapter()
  assert.equal(archiveAdapter.type, 'archive-org')

  const feedAdapter = new CatalogFeedAdapter()
  assert.equal(feedAdapter.type, 'catalog-feed')
  console.log('  ✓ Adapters instantiated and verified')

  console.log('\n🎉 ALL SOURCE INDEX AND DISCOVERY TESTS PASSED!\n')
}

void runTests().catch((err) => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
