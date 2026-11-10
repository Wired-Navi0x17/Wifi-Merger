import { basename } from 'node:path'
import type { ContentItem, ContentSourceConfig, ResolvedDownload } from '../../shared/sourceTypes'
import { probeUrl } from '../download/probe'
import type { SourceAdapter } from './adapter'

export async function resolveContentDownload(
  item: ContentItem,
  source: ContentSourceConfig,
  adapter: SourceAdapter
): Promise<ResolvedDownload> {
  const directUrl = await adapter.resolveDownload(source, item)
  if (!directUrl) {
    throw new Error(`Could not resolve a direct download stream from ${source.name}`)
  }

  // Pre-flight probe using Plexo's existing probeUrl logic
  const probe = await probeUrl(directUrl)
  if (probe.kind !== 'http') {
    throw new Error('Resolved resource is a torrent or unsupported stream')
  }

  const fileName = probe.suggestedFileName || basename(new URL(probe.finalUrl).pathname) || `${item.title}.bin`

  return {
    url: probe.finalUrl,
    fileName,
    totalBytes: probe.totalBytes ?? 0,
    supportsRanges: probe.supportsRanges,
    etag: probe.etag,
    sourceName: source.name,
    contentTitle: item.title
  }
}
