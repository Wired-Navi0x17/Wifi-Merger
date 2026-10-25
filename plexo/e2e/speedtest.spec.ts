import { readdir } from 'node:fs/promises'
import { BLOCK, expect, test } from './fixtures'

// Feature 4: the speed test binds its streams to networks and reads real bytes, which it throws
// away. The stages are shrunk and the server throttled, so a run stays small and its numbers
// stay predictable: every response carries bytesPerSecond, so a stage's rate is streams × rate.
const RATE = 2_000_000 // bytes a second, per response
const SIZE = 8 * BLOCK // 512 KiB: never runs out inside a stage
const FAST = {
  PLEXO_E2E_SPEEDTEST_WARMUP_MS: '200',
  PLEXO_E2E_SPEEDTEST_STAGE_MS: '500',
  PLEXO_E2E_SPEEDTEST_MAX_BYTES: String(64 * 1024 * 1024)
}

test.describe('the network speed test', () => {
  test('measures each network then all together, and writes nothing', async ({
    plexo,
    dirs,
    serve
  }) => {
    await plexo.relaunch(FAST)
    const origin = await serve({ size: SIZE, bytesPerSecond: RATE })
    const interfaces = await plexo.api.listInterfaces()
    expect(interfaces.length).toBeGreaterThan(0)

    const result = await plexo.api.startSpeedTest({
      url: origin.url(),
      networkIds: interfaces.map((iface) => iface.id)
    })

    expect(result.outcome).toBe('done')
    expect(result.url).toBe(origin.url())
    expect(result.streams).toBe(8)
    expect(result.networks).toHaveLength(interfaces.length)

    // Every network was measured on its own, then took a share of the combined stage.
    for (const network of result.networks) {
      expect(network.aloneMbps).not.toBeNull()
      expect(network.aloneMbps ?? 0).toBeGreaterThan(0)
      expect(network.bytes).toBeGreaterThan(0)
      expect(network.share ?? 0).toBeGreaterThan(0)
      expect(network.combinedMbps ?? 0).toBeGreaterThan(0)
    }
    expect(result.combinedMbps ?? 0).toBeGreaterThan(0)
    expect(result.fastestSingleMbps ?? 0).toBeGreaterThan(0)
    expect(result.totalBytes).toBeGreaterThan(0)
    expect(result.seconds).toBeGreaterThan(0)

    // Eight streams on one network, before any sharing out: the same total in every stage.
    const connections = new Map<string, Set<number>>()
    for (const entry of origin.log) {
      const seen = connections.get(entry.from) ?? new Set<number>()
      seen.add(entry.connection)
      connections.set(entry.from, seen)
    }
    for (const iface of interfaces) {
      const address = iface.addresses[0].address
      expect(connections.get(address)?.size ?? 0).toBeGreaterThanOrEqual(8)
    }

    // Bodies were read and dropped: no file, not even a partial one, reached the destination.
    expect(await readdir(dirs.dest)).toEqual([])
  })

  test('names a network that cannot reach the test file, and leaves it out', async ({
    plexo,
    serve
  }) => {
    // A second "network" whose address is not on this machine: its connections cannot be sent.
    await plexo.relaunch({ ...FAST, PLEXO_E2E_INTERFACES: 'a=127.0.0.1,z=203.0.113.7' })
    const origin = await serve({ size: SIZE, bytesPerSecond: RATE })

    const result = await plexo.api.startSpeedTest({
      url: origin.url(),
      networkIds: ['a', 'z']
    })

    expect(result.outcome).toBe('done')
    const working = result.networks.find((network) => network.networkId === 'a')
    const broken = result.networks.find((network) => network.networkId === 'z')
    expect(working?.aloneMbps ?? 0).toBeGreaterThan(0)
    expect(working?.share).toBe(1)
    expect(broken?.aloneMbps).toBeNull()
    expect(broken?.error).toBeTruthy()
    expect(broken?.share).toBeUndefined()
    expect(result.combinedMbps ?? 0).toBeGreaterThan(0)
  })

  test('stops when cancelled, keeping what it measured', async ({ plexo, serve }) => {
    await plexo.relaunch({
      ...FAST,
      // Long enough that only cancelling ends it.
      PLEXO_E2E_SPEEDTEST_STAGE_MS: '30000'
    })
    const origin = await serve({ size: SIZE, bytesPerSecond: RATE })
    const interfaces = await plexo.api.listInterfaces()

    const running = plexo.api.startSpeedTest({
      url: origin.url(),
      networkIds: interfaces.map((iface) => iface.id)
    })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await plexo.api.cancelSpeedTest()
    const result = await running

    expect(result.outcome).toBe('cancelled')
    expect(result.combinedMbps).toBeNull()
    expect(result.totalBytes).toBeGreaterThan(0)
  })

  test('runs from New download before any link, and shows the result', async ({
    plexo,
    dirs,
    serve
  }) => {
    await plexo.relaunch(FAST)
    const origin = await serve({ size: SIZE, bytesPerSecond: RATE })
    const page = plexo.page

    await plexo.newDownload()
    await page.getByRole('button', { name: 'Test speed' }).click()
    const speed = page.getByRole('dialog', { name: 'Network speed test' })
    await expect(speed).toBeVisible()

    await speed.getByLabel('Test file').fill(origin.url())
    await speed.getByRole('button', { name: 'Start test' }).click()
    await expect(speed.getByRole('progressbar', { name: 'Speed test progress' })).toBeVisible()
    await expect(speed.getByText('All networks together')).toBeVisible({ timeout: 20_000 })
    await expect(speed.getByText('Mbps').first()).toBeVisible()
    await expect(speed.getByText(/streams per stage/)).toBeVisible()

    // Escape closes only the test, leaving the download dialog underneath as it was.
    await page.keyboard.press('Escape')
    await expect(speed).toBeHidden()
    await expect(page.getByRole('dialog', { name: 'New download' })).toBeVisible()

    expect(await readdir(dirs.dest)).toEqual([])
  })
})
