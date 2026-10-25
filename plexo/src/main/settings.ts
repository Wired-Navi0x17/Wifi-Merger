import { rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { app, nativeTheme } from 'electron'
import {
  DEFAULT_ORGANIZE_CATEGORIES,
  DOWNLOADS_AT_ONCE,
  type AppSettings,
  type AutoOrganizeSettings,
  type NetworkPreference,
  type NetworkPreferences,
  type OrganizeCategory,
  type ThemeSource
} from '../shared/types'
import { readJson, updateJson } from './jsonFile'
import { DEFAULT_DOWNLOAD_SCHEDULE, validSchedule } from '../shared/downloadSchedule'

function settingsPath(): string {
  return join(app.getPath('userData'), 'app-settings.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A rate or an amount of bytes: a positive whole number, or nothing. */
function byteCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined
}

/** Keeps only fields of the right type (what every reader downstream assumes, e.g.
 * NetworkEditPopover's `customName?.trim()`), entry by entry, rather than discarding every
 * network over one bad entry. An entry left with no field is dropped, so resetting a network
 * removes it from the file. */
function sanitizeNetworkPreferences(parsed: unknown): NetworkPreferences {
  if (!isRecord(parsed)) return {}

  const result: NetworkPreferences = {}
  for (const [id, value] of Object.entries(parsed)) {
    if (!isRecord(value)) continue
    const preference: NetworkPreference = {}
    if (typeof value.customName === 'string') preference.customName = value.customName
    if (typeof value.colorId === 'string') preference.colorId = value.colorId
    if (value.off === true) preference.off = true
    preference.speedLimit = byteCount(value.speedLimit)
    preference.dataLimit = byteCount(value.dataLimit)
    if (
      value.dataLimitPeriod === 'day' ||
      value.dataLimitPeriod === 'week' ||
      value.dataLimitPeriod === 'month'
    ) {
      preference.dataLimitPeriod = value.dataLimitPeriod
    }
    for (const key of Object.keys(preference) as (keyof NetworkPreference)[]) {
      if (preference[key] === undefined) delete preference[key]
    }
    if (Object.keys(preference).length > 0) result[id] = preference
  }
  return result
}

/** Trusts nothing past "this is valid JSON" — the file may be hand-edited or from an older
 * version, and a patch comes from the renderer. Every field is checked on its own, so one bad
 * value only loses that value. An `undefined` field in a patch clears it. */
function sanitizeSettings(parsed: unknown): AppSettings {
  if (!isRecord(parsed)) return {}

  const { themeSource, destinationDir, downloadsAtOnce } = parsed
  const settings: AppSettings = {}
  if (parsed.downloadSchedule !== undefined) {
    settings.downloadSchedule = validSchedule(parsed.downloadSchedule)
      ? parsed.downloadSchedule
      : { ...DEFAULT_DOWNLOAD_SCHEDULE, enabled: true, days: [] }
  }
  // 'system' was once an option — dropping it falls back to the OS appearance (loadThemeSource).
  if (themeSource === 'light' || themeSource === 'dark') settings.themeSource = themeSource
  if (
    parsed.windowMaterial === 'solid' ||
    parsed.windowMaterial === 'panels' ||
    parsed.windowMaterial === 'desktop'
  ) {
    settings.windowMaterial = parsed.windowMaterial
  }
  if (parsed.autoUpdate === false) settings.autoUpdate = false
  if (typeof destinationDir === 'string' && isAbsolute(destinationDir)) {
    settings.destinationDir = destinationDir
  }
  // Clamped rather than dropped: a count saved under an older, higher limit keeps the most allowed.
  if (Number.isInteger(downloadsAtOnce) && (downloadsAtOnce as number) >= DOWNLOADS_AT_ONCE.min) {
    settings.downloadsAtOnce = Math.min(downloadsAtOnce as number, DOWNLOADS_AT_ONCE.max)
  }
  if (parsed.networkPreferences !== undefined) {
    settings.networkPreferences = sanitizeNetworkPreferences(parsed.networkPreferences)
  }
  const speedLimit = byteCount(parsed.speedLimit)
  if (speedLimit !== undefined) settings.speedLimit = speedLimit
  const slowModeSpeed = byteCount(parsed.slowModeSpeed)
  if (slowModeSpeed !== undefined) settings.slowModeSpeed = slowModeSpeed
  if (parsed.slowMode === true) settings.slowMode = true
  if (parsed.speedUnit === 'bytes' || parsed.speedUnit === 'bits') {
    settings.speedUnit = parsed.speedUnit
  }
  if (parsed.browserExtensionUsed === true) settings.browserExtensionUsed = true
  if (isRecord(parsed.learning)) {
    const tailAdaptive = (parsed.learning as Record<string, unknown>).tailAdaptive
    if (tailAdaptive === true) settings.learning = { tailAdaptive: true }
  }
  if (parsed.autoOrganize !== undefined) {
    const organized = sanitizeAutoOrganize(parsed.autoOrganize)
    if (organized) settings.autoOrganize = organized
  }
  if (typeof parsed.speedTestUrl === 'string') {
    const url = sanitizeSpeedTestUrl(parsed.speedTestUrl)
    if (url) settings.speedTestUrl = url
  }
  return settings
}

/** Feature 4: only an http(s) URL is useful, and only a sane length is safe to hand a request. */
function sanitizeSpeedTestUrl(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 2048) return undefined
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : undefined
  } catch {
    return undefined
  }
}

/** Validates the Feature 1 auto-organize block entry by entry. One bad category only loses
 * that category; a fully empty result falls back to defaults so the UI never sees a hole. */
function sanitizeAutoOrganize(parsed: unknown): AutoOrganizeSettings | undefined {
  if (!isRecord(parsed)) return undefined
  const enabled = parsed.enabled === undefined ? true : parsed.enabled === true
  const rawList = Array.isArray(parsed.categories) ? parsed.categories : []
  const seen = new Set<string>()
  const categories: OrganizeCategory[] = []
  for (const entry of rawList) {
    if (!isRecord(entry)) continue
    const id = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : ''
    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    if (!/^[a-z0-9-]{1,32}$/.test(id) || seen.has(id) || label.length === 0 || label.length > 40) {
      continue
    }
    const extensions = Array.isArray(entry.extensions)
      ? [
          ...new Set(
            entry.extensions
              .filter((ext): ext is string => typeof ext === 'string')
              .map((ext) => ext.trim().toLowerCase().replace(/^\./, ''))
              .filter((ext) => /^[a-z0-9]{1,16}$/.test(ext))
          )
        ].slice(0, 64)
      : []
    let folder: string | undefined
    if (typeof entry.folder === 'string' && entry.folder.trim().length > 0) {
      const trimmed = entry.folder.trim()
      if (
        /^[/\\]|[a-zA-Z]:[\\/]/.test(trimmed)
          ? trimmed.length <= 512
          : /^[A-Za-z0-9 _.-]{1,64}$/.test(trimmed)
      ) {
        folder = trimmed
      }
    }
    seen.add(id)
    categories.push({ id, label, extensions, ...(folder !== undefined && { folder }) })
  }
  if (categories.length === 0) {
    return { enabled, categories: structuredClone(DEFAULT_ORGANIZE_CATEGORIES) }
  }
  return { enabled, categories }
}

export async function loadSettings(): Promise<AppSettings> {
  // Reading can fall back to defaults; only a save must not act on a failed read.
  try {
    return sanitizeSettings(await readJson(settingsPath()))
  } catch {
    return {}
  }
}

/** Merges `patch` over what's saved. */
export function saveSettings(patch: unknown): Promise<void> {
  if (
    isRecord(patch) &&
    patch.downloadSchedule !== undefined &&
    !validSchedule(patch.downloadSchedule)
  ) {
    return Promise.reject(new Error('Choose different start and stop times and at least one day.'))
  }
  return updateJson(settingsPath(), (current) =>
    sanitizeSettings({ ...sanitizeSettings(current), ...(isRecord(patch) ? patch : {}) })
  )
}

export async function loadThemeSource(): Promise<ThemeSource> {
  const { themeSource } = await loadSettings()
  // First run — follow whatever the OS appearance is right now rather than a fixed theme.
  return themeSource ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
}

/** Network names/colors lived in their own network-preferences.json up to 1.0.0-rc.8. Folds
 * that file into app-settings.json once, then deletes it (a corrupt one is just deleted). */
export async function migrateLegacyNetworkPreferences(): Promise<void> {
  const legacyPath = join(app.getPath('userData'), 'network-preferences.json')
  const legacy = await readJson(legacyPath)
  if (legacy !== undefined) {
    await updateJson(settingsPath(), (current) => {
      const settings = sanitizeSettings(current)
      return settings.networkPreferences
        ? settings
        : { ...settings, networkPreferences: sanitizeNetworkPreferences(legacy) }
    })
  }
  await rm(legacyPath, { force: true })
}
