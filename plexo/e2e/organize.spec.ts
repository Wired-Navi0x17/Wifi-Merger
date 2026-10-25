import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { BLOCK, expect, test } from './fixtures'

// Feature 1: automatic file organization (HTTP single-file only).
// The transfer engine suite runs flat (organize: false) to isolate it; these
// tests cover the organizer itself: default buckets, opt-out, and previews.

test.describe('automatic file organization', () => {
  test('organized download lands in its bucket subfolder', async ({ plexo, serve }) => {
    const origin = await serve({ size: 4 * BLOCK })
    await plexo.start(origin.url('/files/clip.mp4'), origin.sha256, {
      connections: 2,
      organize: true
    })
    const state = await plexo.waitForHttpStatus('completed', 30_000)
    expect(state.destinationPath.endsWith(join('Videos', 'clip.mp4'))).toBe(true)
    expect(existsSync(state.destinationPath)).toBe(true)
  })

  test('opted-out download stays flat', async ({ plexo, serve }) => {
    const origin = await serve({ size: 4 * BLOCK })
    await plexo.start(origin.url('/files/report.pdf'), origin.sha256, {
      connections: 2,
      organize: false
    })
    const state = await plexo.waitForHttpStatus('completed', 30_000)
    expect(state.destinationPath.endsWith(join('report.pdf'))).toBe(true)
    expect(state.destinationPath.includes('Documents')).toBe(false)
  })

  test('preview predicts the bucket without downloading', async ({ plexo, dirs }) => {
    const preview = await plexo.api.previewOrganizePath('song.mp3', dirs.dest, true)
    expect(preview?.endsWith(join('Others', 'song.mp3'))).toBe(true)
    expect(await plexo.api.previewOrganizePath('song.mp3', dirs.dest, false)).toBe(null)
  })
})
