import type { ContentItem, ContentSourceConfig } from '../../shared/sourceTypes'

export interface ValidateResult {
  valid: boolean
  name: string
  error?: string
}

export interface SourceAdapter {
  readonly type: string
  validate(url: string): Promise<ValidateResult>
  discover(source: ContentSourceConfig): Promise<ContentItem[]>
  search(source: ContentSourceConfig, query: string): Promise<ContentItem[]>
  resolveDownload(source: ContentSourceConfig, item: ContentItem): Promise<string | null>
}
