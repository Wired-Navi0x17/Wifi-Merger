import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

// Feature 1 imports
import {
  categoryForFileName,
  extensionOf,
  previewOrganizePath,
  resolveOrganizeDir
} from '../src/main/download/organize.ts'

// Feature 2 imports
import {
  chooseArm,
  freshBeliefs,
  rewardOf,
  updateBelief
} from '../src/main/download/learning/bandit.ts'
import { contextKey, normalizeHost, sizeBand } from '../src/main/download/learning/context.ts'
import {
  freshHostProfile,
  looksRateLimited,
  recordOutcome
} from '../src/main/download/learning/profiles.ts'
import { LearningStore } from '../src/main/download/learning/store.ts'

// Feature 3 imports
import {
  applyWindowMaterial,
  registerWindowRebuild,
  setInitialWindowMaterial,
  windowIsTransparent
} from '../src/main/windowMaterial.ts'

// Feature 4 imports
import { SpeedTestRun } from '../src/main/download/speedTest.ts'

// ==========================================
// FEATURE 1: Automatic File Organization
// ==========================================
test('Feature 1 (TS): extensionOf handles edge cases', () => {
  assert.equal(extensionOf('report.pdf'), 'pdf')
  assert.equal(extensionOf('ARCHIVE.ZIP'), 'zip')
  assert.equal(extensionOf('archive.tar.gz'), 'gz')
  assert.equal(extensionOf('no_extension'), '')
  assert.equal(extensionOf('.hidden'), '')
  assert.equal(extensionOf('.'), '')
})

test('Feature 1 (TS): categoryForFileName categorizes extensions properly', () => {
  assert.equal(categoryForFileName('doc.pdf').id, 'documents')
  assert.equal(categoryForFileName('movie.mp4').id, 'videos')
  assert.equal(categoryForFileName('backup.zip').id, 'archives')
  assert.equal(categoryForFileName('installer.exe').id, 'programs')
  assert.equal(categoryForFileName('unknown.xyz123').id, 'others')
})

test('Feature 1 (TS): resolveOrganizeDir safeguards against path traversal', () => {
  const base = '/downloads'
  const normal = resolveOrganizeDir(base, 'file.pdf')
  assert.equal(normal.dir, '/downloads/Documents')

  // Malicious path traversal attempts must fall back to default
  const traversal = resolveOrganizeDir(base, 'file.pdf', {
    enabled: true,
    categories: [{ id: 'documents', label: 'Documents', folder: '../../etc', extensions: ['pdf'] }]
  })
  assert.equal(traversal.dir, '/downloads/Documents')
})

test('Feature 1 (TS): previewOrganizePath respects enabled setting', () => {
  const base = '/downloads'
  assert.equal(previewOrganizePath(base, 'test.pdf', true), '/downloads/Documents/test.pdf')
  assert.equal(previewOrganizePath(base, 'test.pdf', false), null)
})

test('Feature 1 (Python): scripts/organize.py dry-run works as expected', () => {
  const out = execFileSync('python3', [
    'scripts/organize.py',
    '--dry-run',
    '--base-dir',
    '/tmp/test-dl',
    '--filename',
    'sample.mp4'
  ], { encoding: 'utf8' })
  const res = JSON.parse(out)
  assert.equal(res.category, 'videos')
  assert.equal(res.finalPath, '/tmp/test-dl/Videos/sample.mp4')
})

// ==========================================
// FEATURE 2: Network Learning & Bandit Math
// ==========================================
test('Feature 2: Bandit arm selection explores untried arms first', () => {
  const seen = new Set<number>()
  for (let i = 0; i < 30; i++) {
    seen.add(chooseArm(freshBeliefs(), Math.random))
  }
  assert.equal(seen.size, 3, 'All 3 preset arms should be explored')
})

test('Feature 2: Rewards move beliefs toward the higher performing arm', () => {
  const beliefs = freshBeliefs()
  for (let i = 0; i < 5; i++) updateBelief(beliefs, 2, 1.5)
  for (let i = 0; i < 5; i++) updateBelief(beliefs, 0, -1)
  assert.ok(beliefs[2].mean > beliefs[0].mean)
})

test('Feature 2: rewardOf accurately rewards fast completions and penalizes retries/failures', () => {
  const base = {
    host: 'h',
    networkKind: 'wifi' as const,
    networkKey: 'k',
    bytes: 100,
    durationMs: 1000,
    ttfbMs: 50,
    retries: 0,
    stalls: 0,
    completed: true,
    tailMs: 0
  }
  // Max reward 2
  assert.equal(rewardOf({ ...base, tailMs: 0 }, 5000), 2)
  // Failed reward -2
  assert.equal(rewardOf({ ...base, completed: false }, 5000), -2)
  // Retries decrease reward
  const highRetries = rewardOf({ ...base, tailMs: 1000, retries: 10 }, 5000)
  const noRetries = rewardOf({ ...base, tailMs: 1000, retries: 0 }, 5000)
  assert.ok(highRetries < noRetries)
})

test('Feature 2: Welford variance and mean updates correctly', () => {
  const beliefs = freshBeliefs()
  const samples = [1.2, 0.4, -0.8, 1.6]
  for (const s of samples) updateBelief(beliefs, 1, s)
  assert.equal(beliefs[1].pulls, 4)
  const expectedMean = samples.reduce((a, b) => a + b, 0) / samples.length
  assert.ok(Math.abs(beliefs[1].mean - expectedMean) < 1e-5)
})

test('Feature 2: Context keys and host normalization', () => {
  assert.equal(
    contextKey('Example.COM:8080', 'wifi', 5 * 1024 * 1024, true),
    'example.com|wifi|s|r'
  )
  assert.equal(normalizeHost('not a host!!'), 'unknown')
  assert.equal(sizeBand(0), 'l')
  assert.equal(sizeBand(1024), 's')
  assert.equal(sizeBand(10 * 1024 * 1024), 'm')
  assert.equal(sizeBand(600 * 1024 * 1024), 'l')
})

test('Feature 2: Learning store handles LRU eviction and corruption recovery', async () => {
  const tmpFile = join(tmpdir(), `test-learning-${Date.now()}.json`)
  const store = new LearningStore(tmpFile)
  await store.loaded

  // Test LRU capping to 200
  for (let i = 0; i < 220; i++) {
    const h = store.host(`host-${i}.com`)
    h.updatedAt = i
  }
  await store.save(tmpFile)
  const stored = JSON.parse(await readFile(tmpFile, 'utf8'))
  assert.equal(Object.keys(stored.hosts).length, 200)
  assert.ok(stored.hosts['host-219.com'])
  assert.equal(stored.hosts['host-0.com'], undefined)

  // Test recovery from corrupt JSON
  await writeFile(tmpFile, '{{corrupt-json!!', 'utf8')
  const storeRecover = new LearningStore(tmpFile)
  await storeRecover.loaded
  assert.equal(storeRecover.host('example.com').downloads, 0)

  await rm(tmpFile, { force: true })
})

// ==========================================
// FEATURE 3: Window Material
// ==========================================
test('Feature 3: Window material transparency and rebuild triggers', () => {
  setInitialWindowMaterial('desktop')
  assert.equal(windowIsTransparent(), true)

  let rebuildCalls = 0
  registerWindowRebuild(() => { rebuildCalls++ })

  // Changing from desktop to solid on Linux requires window rebuild
  applyWindowMaterial(null, 'solid')
  assert.equal(windowIsTransparent(), false)
  assert.equal(rebuildCalls, 1)
})

// ==========================================
// FEATURE 4: In-App Speed Test
// ==========================================
test('Feature 4: SpeedTestRun instantiation, cancellation, and empty network handling', async () => {
  const runner = new SpeedTestRun(
    { url: 'https://example.com/test.bin', networkIds: [] },
    [],
    () => {}
  )
  const result = await runner.run()
  assert.equal(result.outcome, 'done')
  assert.equal(result.networks.length, 0)
  assert.equal(result.combinedMbps, null)

  const runnerCancelled = new SpeedTestRun(
    { url: 'https://example.com/test.bin', networkIds: ['mock-net'] },
    [],
    () => {}
  )
  runnerCancelled.cancel()
  const resCancelled = await runnerCancelled.run()
  assert.equal(resCancelled.outcome, 'cancelled')
})

