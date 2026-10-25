import { isAbsolute, join, normalize } from 'node:path'
import {
  DEFAULT_ORGANIZE_CATEGORIES,
  type AutoOrganizeSettings,
  type OrganizeCategory
} from '../../shared/types'

/** Extension of a file name, lowercased without the dot. `archive.tar.gz` maps to `gz`, which
 * the default Archives bucket covers; multi-dot stems are otherwise kept intact upstream. */
export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** The bucket a file name falls into. First category (in order) whose extension list contains
 * the file extension wins; the `others` bucket (empty extension list, always last) catches the
 * rest, including extensionless names. */
export function categoryForFileName(
  fileName: string,
  categories: OrganizeCategory[] = DEFAULT_ORGANIZE_CATEGORIES
): OrganizeCategory {
  const ext = extensionOf(fileName)
  const list = categories.length > 0 ? categories : DEFAULT_ORGANIZE_CATEGORIES
  for (const category of list) {
    if (category.extensions.includes(ext)) return category
  }
  return list.find((category) => category.extensions.length === 0) ?? list[list.length - 1]
}

/** Where a finished single-file download goes. Default: `<baseDir>/<Label>/` created on demand.
 * A category `folder` overrides it: absolute stays absolute, anything else is treated as a plain
 * subfolder name inside the base dir. `..` escapes are rejected back to the default. */
export function resolveOrganizeDir(
  baseDir: string,
  fileName: string,
  settings?: AutoOrganizeSettings
): { dir: string; categoryId: string } {
  const categories = settings?.categories ?? DEFAULT_ORGANIZE_CATEGORIES
  const category = categoryForFileName(fileName, categories)
  const fallback = join(baseDir, category.label)
  const raw = category.folder?.trim()
  if (!raw) return { dir: fallback, categoryId: category.id }
  if (isAbsolute(raw)) {
    const cleaned = normalize(raw)
    if (cleaned.split('/').includes('..')) return { dir: fallback, categoryId: category.id }
    return { dir: cleaned, categoryId: category.id }
  }
  if (!/^[A-Za-z0-9 _.-]{1,64}$/.test(raw) || raw === '.' || raw === '..') {
    return { dir: fallback, categoryId: category.id }
  }
  return { dir: join(baseDir, raw), categoryId: category.id }
}

/** Preview line for the New Download dialog. Torrents never organize. */
export function previewOrganizePath(
  baseDir: string,
  fileName: string,
  organize: boolean | undefined,
  settings?: AutoOrganizeSettings
): string | null {
  const enabled = organize ?? settings?.enabled ?? true
  if (!enabled) return null
  const { dir } = resolveOrganizeDir(baseDir, fileName, settings)
  return join(dir, fileName)
}
