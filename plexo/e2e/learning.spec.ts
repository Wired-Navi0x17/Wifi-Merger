import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { BLOCK, expect, test } from './fixtures'
import {
  chooseArm,
  freshBeliefs,
  rewardOf,
  updateBelief
} from '../src/main/download/learning/bandit'
import { contextKey, normalizeHost, sizeBand } from '../src/main/download/learning/context'
import {
  freshHostProfile,
  looksRateLimited,
  recordOutcome
} from '../src/main/download/learning/profiles'
import { LearningStore } from '../src/main/download/learning/store'

// Feature 2: persistent local learning. The deterministic engine keeps executing; the
// learner only records in this phase (tailAdaptive defaults off), so request counts
// and file bytes must match a build without learning exactly.

// Pure math first: no app needed, and any regression here breaks learning everywhere.
test.describe('bandit math', () => {
  test('untried arms are explored before any dominates', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 30; i++) seen.add(chooseArm(freshBeliefs(), Math.random))
    expect(seen.size, 'every arm is tried while untried arms exist').toBe(3)
  })

  test('rewards move beliefs toward the better arm', () => {
    const beliefs = freshBeliefs()
    for (let i = 0; i < 5; i++) updateBelief(beliefs, 2, 1.5)
    for (let i = 0; i < 5; i++) updateBelief(beliefs, 0, -1)
    expect(beliefs[2].mean).toBeGreaterThan(beliefs[0].mean)
  })

  test('failed runs score below completed fast tails', () => {
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
      tailMs: 200
    }
    expect(rewardOf({ ...base }, 2000)).toBeGreaterThan(
      rewardOf({ ...base, completed: false }, 2000)
    )
  })

  test('rewardOf clamps within [-2, +2] and factors in retry penalties', () => {
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
    // Zero tail time relative to expected tail yields upper clamp of 2.0
    expect(rewardOf({ ...base, tailMs: 0 }, 5000)).toBe(2)
    // Excessive retries penalize reward
    const highRetries = rewardOf({ ...base, tailMs: 1000, retries: 10 }, 5000)
    const noRetries = rewardOf({ ...base, tailMs: 1000, retries: 0 }, 5000)
    expect(highRetries).toBeLessThan(noRetries)
  })

  test('welford update matches exact sample mean and variance', () => {
    const beliefs = freshBeliefs()
    const samples = [1.2, 0.4, -0.8, 1.6]
    for (const s of samples) updateBelief(beliefs, 1, s)
    expect(beliefs[1].pulls).toBe(4)
    const expectedMean = samples.reduce((a, b) => a + b, 0) / samples.length
    expect(beliefs[1].mean).toBeCloseTo(expectedMean, 5)
    const expectedVariance =
      samples.reduce((acc, s) => acc + (s - expectedMean) ** 2, 0) / (samples.length - 1)
    const variance = beliefs[1].m2 / (beliefs[1].pulls - 1)
    expect(variance).toBeCloseTo(expectedVariance, 5)
  })

  test('Thompson sampling strongly exploits superior arm with zero epsilon', () => {
    const beliefs = freshBeliefs()
    for (let i = 0; i < 20; i++) {
      updateBelief(beliefs, 0, -1.5)
      updateBelief(beliefs, 1, 0.0)
      updateBelief(beliefs, 2, 1.8)
    }
    let chosenArm2 = 0
    const trials = 100
    for (let i = 0; i < trials; i++) {
      if (chooseArm(beliefs, Math.random, 0.0) === 2) chosenArm2++
    }
    expect(chosenArm2 / trials).toBeGreaterThan(0.9)
  })

  test('contexts separate hosts, kinds, sizes and range support', () => {
    expect(contextKey('Example.COM:8080', 'wifi', 5 * 1024 * 1024, true)).toBe(
      'example.com|wifi|s|r'
    )
    expect(normalizeHost('not a host!!')).toBe('unknown')
  })

  test('sizeBand categorizes file size boundaries correctly', () => {
    expect(sizeBand(0)).toBe('l')
    expect(sizeBand(1024)).toBe('s')
    expect(sizeBand(10 * 1024 * 1024 - 1)).toBe('s')
    expect(sizeBand(10 * 1024 * 1024)).toBe('m')
    expect(sizeBand(500 * 1024 * 1024)).toBe('m')
    expect(sizeBand(500 * 1024 * 1024 + 1)).toBe('l')
  })

  test('repeated retries mark a host rate-limited', () => {
    const host = freshHostProfile('throttled.test')
    const net = {
      key: 'k',
      kind: 'wifi' as const,
      downloads: 0,
      ewmaThroughput: 0,
      stalls: 0,
      updatedAt: 0
    }
    for (let i = 0; i < 2; i++) {
      recordOutcome(host, net, {
        host: 'throttled.test',
        networkKind: 'wifi',
        networkKey: 'k',
        bytes: 100,
        durationMs: 2000,
        ttfbMs: 100,
        retries: 2,
        stalls: 0,
        completed: true,
        tailMs: 1500
      })
    }
    expect(looksRateLimited(host)).toBe(true)
  })
})

test.describe('learning store unit', () => {
  test('learning store caps hosts to MAX_HOSTS using LRU', async () => {
    const tmpFile = join(
      tmpdir(),
      `test-learning-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    )
    const store = new LearningStore(tmpFile)
    await store.loaded
    for (let i = 0; i < 250; i++) {
      const h = store.host(`host-${i}.com`)
      h.updatedAt = i
    }
    await store.save(tmpFile)
    const stored = JSON.parse(await readFile(tmpFile, 'utf8')) as {
      hosts: Record<string, { updatedAt: number }>
    }
    expect(Object.keys(stored.hosts).length).toBe(200)
    expect(stored.hosts['host-249.com']).toBeDefined()
    expect(stored.hosts['host-0.com']).toBeUndefined()
    await rm(tmpFile, { force: true })
  })

  test('learning store safely recovers from corrupt JSON without throwing', async () => {
    const tmpFile = join(
      tmpdir(),
      `test-corrupt-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    )
    await writeFile(tmpFile, '{{{bad-json', 'utf8')
    const store = new LearningStore(tmpFile)
    await store.loaded
    expect(store.host('example.com').downloads).toBe(0)
    await rm(tmpFile, { force: true })
  })
})

test.describe('learning store e2e', () => {
  test('two throttled downloads complete and are recorded locally', async ({
    plexo,
    serve,
    dirs
  }) => {
    // Per-connection throttle: every response crawls, so tails stretch and the
    // learner sees a slow host without any failure.
    const origin = await serve({ size: 8 * BLOCK })
    origin.setRule(() => ({ crawl: 60_000 }))

    await plexo.start(origin.url(), origin.sha256, { connections: 2 })
    await plexo.waitForHttpStatus('completed', 60_000)
    await plexo.start(origin.url(), origin.sha256, { connections: 2 })
    await plexo.waitForHttpStatus('completed', 60_000)

    const stored = JSON.parse(await readFile(join(dirs.userData, 'learning.json'), 'utf8')) as {
      hosts: Record<string, { downloads: number }>
    }
    expect(
      stored.hosts['127.0.0.1']?.downloads ?? 0,
      'both runs recorded against the origin host'
    ).toBeGreaterThanOrEqual(2)
  })

  test('tailAdaptive enabled activates Thompson sampling arm selection and persists updated beliefs', async ({
    plexo,
    serve,
    dirs
  }) => {
    await plexo.api.updateSettings({ learning: { tailAdaptive: true } })

    const origin = await serve({ size: 8 * BLOCK })
    origin.setRule(() => ({ crawl: 60_000 }))

    await plexo.start(origin.url(), origin.sha256, { connections: 2 })
    await plexo.waitForHttpStatus('completed', 60_000)

    const stored = JSON.parse(await readFile(join(dirs.userData, 'learning.json'), 'utf8')) as {
      hosts: Record<string, { downloads: number }>
      beliefs: Record<string, { pulls: number; mean: number }[]>
    }

    expect(stored.hosts['127.0.0.1']?.downloads).toBeGreaterThanOrEqual(1)
    const contextKeys = Object.keys(stored.beliefs ?? {})
    expect(
      contextKeys.length,
      'beliefs should record context entry when tailAdaptive is on'
    ).toBeGreaterThanOrEqual(1)
    const [firstKey] = contextKeys
    expect(firstKey).toContain('127.0.0.1')
    const arms = stored.beliefs[firstKey]
    expect(arms.length).toBe(3)
    const pulls = arms.reduce((sum, a) => sum + a.pulls, 0)
    expect(pulls).toBeGreaterThanOrEqual(1)
  })
})

test.describe('live fixtures and PLEXO_DEBUG logs', () => {
  test.use({ appEnv: { PLEXO_DEBUG: '1' } })

  test('downloads fixture sample.pdf, logs learn choose & outcome, and updates bandit beliefs', async ({
    plexo,
    dirs
  }) => {
    const fixturePort = 8125
    const server = spawn('python3', ['scripts/serve-fixtures.py', '--port', String(fixturePort)], {
      cwd: resolve(__dirname, '..'),
      stdio: 'ignore'
    })

    try {
      // Wait for server to accept connections
      const deadline = Date.now() + 5000
      let ready = false
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://127.0.0.1:${fixturePort}/sample.pdf`)
          if (res.ok) {
            ready = true
            break
          }
        } catch {
          await new Promise((r) => setTimeout(r, 100))
        }
      }
      expect(ready, 'fixture server should become ready').toBe(true)

      const samplePdfSha = 'd92cc470a80996560b24bcb7ad6779ec5c7d9b2503c57ca1122f2698439d5184'
      await plexo.api.updateSettings({ learning: { tailAdaptive: true } })

      await plexo.start(`http://127.0.0.1:${fixturePort}/sample.pdf`, samplePdfSha, {
        connections: 2
      })
      await plexo.waitForHttpStatus('completed', 60_000)

      // Verify PLEXO_DEBUG logs emitted
      const outputStr = plexo.output.join('')
      expect(outputStr).toContain('[plexo] learn choose')
      expect(outputStr).toContain('[plexo] learn outcome')

      const stored = JSON.parse(await readFile(join(dirs.userData, 'learning.json'), 'utf8')) as {
        hosts: Record<string, { downloads: number }>
        beliefs: Record<string, { pulls: number }[]>
      }
      expect(stored.hosts['127.0.0.1']?.downloads).toBeGreaterThanOrEqual(1)
      const contextKeys = Object.keys(stored.beliefs ?? {})
      expect(contextKeys.length).toBeGreaterThanOrEqual(1)
      const arms = stored.beliefs[contextKeys[0]]
      const totalPulls = arms.reduce((s, a) => s + a.pulls, 0)
      expect(totalPulls).toBeGreaterThanOrEqual(1)
    } finally {
      server.kill('SIGTERM')
    }
  })
})
