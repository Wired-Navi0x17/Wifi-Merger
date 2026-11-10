import assert from 'node:assert/strict'
import {
  calculateDownloadSimulation,
  formatDurationSeconds
} from '../src/renderer/src/utils/simulationEngine'
import {
  ANIME_MASCOT_READY,
  ANIME_MASCOT_TURBO,
  ANIME_MASCOT_CAUTION
} from '../src/renderer/src/components/ascii/animeAsciiArt'
import type { NetworkInterfaceInfo } from '../src/shared/types'

async function runTests(): Promise<void> {
  console.log('Testing Pre-Download Network & Storage Simulation Engine...')

  // 1. Test Duration Formatter
  assert.equal(formatDurationSeconds(0), '0s')
  assert.equal(formatDurationSeconds(45), '45s')
  assert.equal(formatDurationSeconds(125), '2m 5s')
  assert.equal(formatDurationSeconds(3600), '1h')
  assert.equal(formatDurationSeconds(3720), '1h 2m')
  console.log('  [PASS] Duration formatter handles ranges correctly')

  // 2. Test Multi-Interface Bonding & Peak Storage Calculations
  const mockInterfaces: NetworkInterfaceInfo[] = [
    {
      id: 'eth0',
      device: 'eth0',
      displayName: 'Ethernet',
      kind: 'ethernet',
      mac: '00:11:22:33:44:55',
      addresses: [{ address: '192.168.1.100', family: 4 }]
    },
    {
      id: 'wlan0',
      device: 'wlan0',
      displayName: 'Wi-Fi 6',
      kind: 'wifi',
      mac: 'aa:bb:cc:dd:ee:ff',
      addresses: [{ address: '192.168.1.101', family: 4 }]
    }
  ]

  const tenGigabytes = 10 * 1024 * 1024 * 1024 // 10 GiB

  const multiSim = calculateDownloadSimulation({
    fileSizeBytes: tenGigabytes,
    interfaces: mockInterfaces,
    networkPreferences: {},
    freeDiskSpaceBytes: 100 * 1024 * 1024 * 1024 // 100 GiB free
  })

  // Verify Peak Storage overhead: 10 GiB * 1.08 = 10.8 GiB
  assert.equal(multiSim.peakStorageBytes, Math.ceil(tenGigabytes * 1.08))
  assert.equal(multiSim.finalStorageBytes, tenGigabytes)
  assert.equal(multiSim.storageSafetyStatus, 'safe')
  assert.equal(multiSim.interfaces.length, 2)

  // Verify multi-interface speedup
  assert.ok(multiSim.speedupMultiplier > 1.0, 'Multi-NIC should provide >1.0x speedup')
  assert.ok(multiSim.timeSavedSeconds > 0, 'Bonding should save seconds compared to single link')
  assert.ok(multiSim.aggregatedSpeedBytesPerSec > multiSim.singleFastestSpeedBytesPerSec)
  console.log('  [PASS] Multi-interface bonding speedup and peak storage calculation verified')

  // 3. Test Storage Capacity Margin Warnings
  // Case A: Insufficient Space (Free space < Peak storage needed)
  const insufficientSim = calculateDownloadSimulation({
    fileSizeBytes: tenGigabytes,
    interfaces: mockInterfaces,
    networkPreferences: {},
    freeDiskSpaceBytes: 5 * 1024 * 1024 * 1024 // Only 5 GiB free for a 10 GiB download
  })
  assert.equal(insufficientSim.storageSafetyStatus, 'insufficient')
  assert.equal(insufficientSim.mascotState, 'caution')

  // Case B: Low Headroom (Free space is barely enough, < 5 GiB margin)
  const lowHeadroomSim = calculateDownloadSimulation({
    fileSizeBytes: tenGigabytes,
    interfaces: mockInterfaces,
    networkPreferences: {},
    freeDiskSpaceBytes: Math.ceil(tenGigabytes * 1.08) + 2 * 1024 * 1024 * 1024 // Only 2 GiB headroom remaining
  })
  assert.equal(lowHeadroomSim.storageSafetyStatus, 'low_margin')
  assert.equal(lowHeadroomSim.mascotState, 'caution')
  console.log('  [PASS] Storage headroom and safety status checks verified')

  // 4. Test Single Interface Fallback
  const singleSim = calculateDownloadSimulation({
    fileSizeBytes: tenGigabytes,
    interfaces: [mockInterfaces[0]],
    networkPreferences: {},
    freeDiskSpaceBytes: 80 * 1024 * 1024 * 1024
  })
  assert.equal(singleSim.speedupMultiplier, 1.0)
  assert.equal(singleSim.timeSavedSeconds, 0)
  assert.equal(singleSim.mascotState, 'ready')
  console.log('  [PASS] Single interface baseline verified')

  // 4b. Worked example, checked by hand: Ethernet 60 MB/s + Wi-Fi 28 MB/s on a 10 GiB file.
  const MB = 1024 * 1024
  assert.equal(multiSim.aggregatedSpeedBytesPerSec, Math.round((60 * MB + 28 * MB) * 0.92))
  assert.equal(multiSim.singleFastestSpeedBytesPerSec, 60 * MB)
  assert.equal(multiSim.speedupMultiplier, 1.3) // 88 × 0.92 / 60 = 1.349… → 1.3
  assert.equal(multiSim.estimatedDurationSeconds, Math.ceil(tenGigabytes / (88 * MB * 0.92)))
  assert.deepEqual(
    multiSim.interfaces.map((entry) => entry.chunkAllocationPct),
    [68, 32] // 60/88 = 68.18 %, 28/88 = 31.82 %
  )
  console.log('  [PASS] Worked example (60 + 28 MB/s, 92% efficiency) matches hand arithmetic')

  // 4c. A user speed limit caps the assumed speed.
  const limitedSim = calculateDownloadSimulation({
    fileSizeBytes: tenGigabytes,
    interfaces: mockInterfaces,
    networkPreferences: { eth0: { speedLimit: 5 * MB } },
    freeDiskSpaceBytes: 100 * 1024 * 1024 * 1024
  })
  assert.equal(limitedSim.interfaces[0].estimatedSpeedBytesPerSec, 5 * MB)
  assert.equal(limitedSim.singleFastestSpeedBytesPerSec, 28 * MB, 'Wi-Fi is now the fastest')
  console.log('  [PASS] Speed limit caps the assumed per-network speed')

  // 4d. A lone slow network is compared with itself, not with a 20 MB/s default.
  const slowSim = calculateDownloadSimulation({
    fileSizeBytes: 100 * MB,
    interfaces: [mockInterfaces[0]],
    networkPreferences: { eth0: { speedLimit: 1 * MB } },
    freeDiskSpaceBytes: null
  })
  assert.equal(slowSim.singleFastestSpeedBytesPerSec, 1 * MB)
  assert.equal(slowSim.estimatedDurationSeconds, 100)
  assert.equal(slowSim.singleInterfaceDurationSeconds, 100)
  console.log('  [PASS] Fastest single path is the real fastest, even when slow')

  // 4e. Shares always add up to 100 % and to the file size (three equal networks: 33.3 % each).
  const threeSim = calculateDownloadSimulation({
    fileSizeBytes: 1000,
    interfaces: [
      mockInterfaces[1],
      { ...mockInterfaces[1], id: 'wlan1', device: 'wlan1' },
      { ...mockInterfaces[1], id: 'wlan2', device: 'wlan2' }
    ],
    networkPreferences: {},
    freeDiskSpaceBytes: null
  })
  const pctSum = threeSim.interfaces.reduce((sum, entry) => sum + entry.chunkAllocationPct, 0)
  const byteSum = threeSim.interfaces.reduce((sum, entry) => sum + entry.allocatedBytes, 0)
  assert.equal(pctSum, 100, 'per-network shares add up to exactly 100 %')
  assert.equal(byteSum, 1000, 'per-network bytes add up to the file size')
  console.log('  [PASS] Chunk shares add up to exactly 100 % and to the file size')

  // 5. Test Authentic Anime ASCII Art Integrity (from emojicombos.com)
  assert.ok(ANIME_MASCOT_READY.length > 100, 'ANIME_MASCOT_READY must be populated')
  assert.ok(
    ANIME_MASCOT_READY.includes('⣿'),
    'ANIME_MASCOT_READY must contain braille dot patterns'
  )
  assert.equal(ANIME_MASCOT_READY.split('\n').length, 21, 'ANIME_MASCOT_READY must be 21 lines')

  assert.ok(ANIME_MASCOT_TURBO.length > 100, 'ANIME_MASCOT_TURBO must be populated')
  assert.equal(ANIME_MASCOT_TURBO.split('\n').length, 19, 'ANIME_MASCOT_TURBO must be 19 lines')

  assert.ok(ANIME_MASCOT_CAUTION.length > 100, 'ANIME_MASCOT_CAUTION must be populated')
  assert.equal(ANIME_MASCOT_CAUTION.split('\n').length, 25, 'ANIME_MASCOT_CAUTION must be 25 lines')
  console.log('  [PASS] Authentic anime ASCII art integrity verified from emojicombos.com')

  console.log('\nALL PRE-DOWNLOAD SIMULATION TESTS PASSED!')
}

runTests().catch((err) => {
  console.error(err)
  process.exit(1)
})
