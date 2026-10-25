import type { BrowserWindow } from 'electron'
import type { WindowMaterial } from '../shared/types'

/**
 * Feature 3, window half: the three material levels are almost entirely CSS (main.css's
 * `data-material` rules), but seeing the real desktop through the window is a platform window
 * option.
 *
 * Windows and macOS can change it on a live window, so there is nothing to rebuild:
 * `backgroundMaterial` (acrylic, Windows 11 and newer) and `vibrancy` (macOS) both blur what is
 * behind the window while the window stays opaque and keeps its normal resizing and shadow
 * behavior. Unsupported systems quietly do nothing, and the level then looks like panels.
 *
 * Linux has no equivalent, so the only way to see the desktop through is a window created with
 * `transparent: true` — a creation-time option. Switching to or from desktop glass therefore
 * rebuilds the window there. index.ts hands over its window factory for that, and the rebuild is
 * cheap: downloads live in the main process and the renderer reloads with its state restored.
 */

/** Whether the window must be created transparent (Linux, desktop glass). Read by index.ts's
 * createWindow, so it has to be settled before the first window exists. */
let transparentWindow = false

let rebuildWindow: (() => void) | null = null

export function setInitialWindowMaterial(material: WindowMaterial): void {
  transparentWindow =
    process.platform !== 'win32' && process.platform !== 'darwin' && material === 'desktop'
}

export function windowIsTransparent(): boolean {
  return transparentWindow
}

/** index.ts's createWindow, so a material change can rebuild the window where it must. */
export function registerWindowRebuild(rebuild: () => void): void {
  rebuildWindow = rebuild
}

export function applyWindowMaterial(window: BrowserWindow | null, material: WindowMaterial): void {
  const wantTransparent =
    process.platform !== 'win32' && process.platform !== 'darwin' && material === 'desktop'

  if (process.platform === 'win32') {
    try {
      window?.setBackgroundMaterial(material === 'desktop' ? 'acrylic' : 'none')
    } catch (error) {
      console.error('[plexo] window material is not supported here', error)
    }
    return
  }

  if (process.platform === 'darwin') {
    try {
      window?.setVibrancy(material === 'desktop' ? 'under-window' : null)
    } catch (error) {
      console.error('[plexo] window material is not supported here', error)
    }
    return
  }

  if (wantTransparent === transparentWindow) return
  transparentWindow = wantTransparent
  rebuildWindow?.()
}
