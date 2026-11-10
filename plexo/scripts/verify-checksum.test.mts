/**
 * Enhancement 5 proof: checksum verification and chunk repair.
 *
 * A real HTTP server on 127.0.0.1 serves one 4 MiB file. Two "networks" reach it:
 *   - eth  : an honest path, answers Range requests with the right bytes.
 *   - wifi : a faulty path. It answers 206 with the RIGHT LENGTH but flips bytes in some ranges,
 *            which is exactly what length and Content-Range checks cannot catch.
 * The file is assembled block by block, alternating networks as Plexo's scheduler would, and is
 * then handed to verifyAndRepair (src/main/download/checksum.ts), the same function the download
 * manager runs before it publishes a file.
 *
 * Run: node node_modules/.bin/jiti scripts/verify-checksum.test.mts
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, request, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectAlgorithm,
  hashFile,
  normalizeChecksum,
  verifyAndRepair,
  type RepairIo
} from '../src/main/download/checksum'
import { planBlocks } from '../src/main/download/plan'
import type { HttpBlockState } from '../src/shared/types'

const MIB = 1024 * 1024
const FILE_BYTES = 4 * MIB
const BLOCK_BYTES = 256 * 1024 // 16 blocks

const original = randomBytes(FILE_BYTES)
const expectedSha256 = createHash('sha256').update(original).digest('hex')

// Which block indexes the faulty path corrupts, and whether it corrupts every answer it gives.
let corruptBlocks = new Set<number>()
let wifiAlwaysLies = false
const requestLog: { network: string; start: number; end: number }[] = []

function serve(network: 'eth' | 'wifi', start: number, end: number): Buffer {
  const body = Buffer.from(original.subarray(start, end + 1))
  const index = Math.floor(start / BLOCK_BYTES)
  if (network === 'wifi' && (wifiAlwaysLies || corruptBlocks.has(index))) {
    // Same length, wrong bytes: flip a few bytes somewhere in the middle of the block.
    const at = Math.floor(body.length / 2)
    const garbage = wifiAlwaysLies ? randomBytes(8) : Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
    for (let i = 0; i < 8; i++) body[at + i] ^= garbage[i] || 0xff
  }
  return body
}

function startServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const network = req.url === '/via/wifi' ? 'wifi' : 'eth'
    const match = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '')
    if (!match) {
      res.writeHead(200, { 'Content-Length': FILE_BYTES })
      res.end(original)
      return
    }
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), FILE_BYTES - 1)
    requestLog.push({ network, start, end })
    const body = serve(network, start, end)
    res.writeHead(206, {
      'Content-Length': body.length,
      'Content-Range': `bytes ${start}-${end}/${FILE_BYTES}`
    })
    res.end(body)
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 })
    })
  )
}

function fetchRange(port: number, network: string, start: number, end: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: `/via/${network}`,
        headers: { Range: `bytes=${start}-${end}` }
      },
      (res) => {
        // The checks base Plexo already does: status, Content-Range start, length.
        if (res.statusCode !== 206) return reject(new Error(`status ${res.statusCode}`))
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks)
          if (body.length !== end - start + 1) return reject(new Error('short body'))
          resolve(body)
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.end()
  })
}

/** Downloads every block, alternating eth and wifi, recording who delivered what. */
async function assemble(port: number, path: string, networks: string[]): Promise<HttpBlockState[]> {
  const blocks = planBlocks(FILE_BYTES, BLOCK_BYTES)
  await writeFile(path, Buffer.alloc(FILE_BYTES))
  const handle = await open(path, 'r+')
  try {
    for (const block of blocks) {
      const network = networks[block.index % networks.length]
      const body = await fetchRange(port, network, block.rangeStart, block.rangeEnd!)
      await handle.write(body, 0, body.length, block.rangeStart)
      block.status = 'completed'
      block.bytesDownloaded = body.length
      block.bytesByInterface = { [network]: body.length }
      block.interfaceId = network
    }
  } finally {
    await handle.close()
  }
  return blocks
}

function ioFor(port: number, path: string, phases: string[]): RepairIo {
  return {
    hashFile: () => hashFile('sha256', path),
    readBlock: async (block) => {
      const data = await readFile(path)
      return data.subarray(block.rangeStart, block.rangeEnd! + 1)
    },
    fetchBlock: (block, network) => fetchRange(port, network, block.rangeStart, block.rangeEnd!),
    writeBlock: async (block, data) => {
      const handle = await open(path, 'r+')
      try {
        await handle.write(data, 0, data.length, block.rangeStart)
      } finally {
        await handle.close()
      }
    },
    onPhase: (phase) => {
      const label =
        phase.phase === 'verifying'
          ? `verifying (round ${phase.round})`
          : `repairing round ${phase.round}, suspect=${phase.suspect}`
      if (phases.at(-1) !== label) phases.push(label)
    }
  }
}

const say = (line: string): void => console.log(line)

async function run(): Promise<void> {
  const { server, port } = await startServer()
  const dir = await mkdtemp(join(tmpdir(), 'plexo-checksum-'))
  try {
    say('Enhancement 5 — checksum verification and chunk repair')
    say(
      `  file: ${FILE_BYTES / MIB} MiB, ${FILE_BYTES / BLOCK_BYTES} blocks of ${BLOCK_BYTES / 1024} KiB`
    )
    say(`  expected SHA-256: ${expectedSha256}\n`)

    // 0. Parsing what the user pastes.
    assert.equal(detectAlgorithm('d41d8cd98f00b204e9800998ecf8427e'), 'md5')
    assert.equal(detectAlgorithm('da39a3ee5e6b4b0d3255bfef95601890afd80709'), 'sha1')
    assert.equal(detectAlgorithm(expectedSha256.toUpperCase()), 'sha256')
    assert.equal(detectAlgorithm('not-a-hash'), null)
    assert.equal(normalizeChecksum('sha256', `  ${expectedSha256.toUpperCase()} `), expectedSha256)
    say('[PASS] 0. MD5 / SHA-1 / SHA-256 are recognised from what the user pastes')

    // 1. Negative control: the damage is invisible to length and range checks.
    corruptBlocks = new Set([3, 9])
    const controlPath = join(dir, 'control.bin')
    await assemble(port, controlPath, ['eth', 'wifi'])
    const control = await readFile(controlPath)
    assert.equal(control.length, FILE_BYTES, 'length checks pass')
    const controlHash = createHash('sha256').update(control).digest('hex')
    assert.notEqual(controlHash, expectedSha256)
    say('[PASS] 1. Negative control: wifi damaged blocks #3 and #9 with 206 + correct length;')
    say('          every status/length/range check passed, yet the SHA-256 is wrong:')
    say(`          got ${controlHash}`)
    say('          → without Enhancement 5 this file would be published as "complete".\n')

    // 2. A clean download verifies with no extra traffic.
    corruptBlocks = new Set()
    const cleanPath = join(dir, 'clean.bin')
    const cleanBlocks = await assemble(port, cleanPath, ['eth', 'wifi'])
    requestLog.length = 0
    const clean = await verifyAndRepair(
      {
        algorithm: 'sha256',
        expected: expectedSha256,
        blocks: cleanBlocks,
        rankedNetworks: ['eth', 'wifi']
      },
      ioFor(port, cleanPath, [])
    )
    assert.equal(clean.verified, true)
    assert.equal(clean.rounds, 0)
    assert.equal(requestLog.length, 0, 'no re-fetch when the hash matches')
    say('[PASS] 2. Clean file: verified on the first hash, 0 repair rounds, 0 bytes re-fetched\n')

    // 3. The damaged file is located and repaired, block by block.
    corruptBlocks = new Set([3, 9])
    const badPath = join(dir, 'bad.bin')
    const badBlocks = await assemble(port, badPath, ['eth', 'wifi'])
    requestLog.length = 0
    const phases: string[] = []
    const repaired = await verifyAndRepair(
      // eth is ranked best by the learning store, so it is the one used to re-fetch.
      {
        algorithm: 'sha256',
        expected: expectedSha256,
        blocks: badBlocks,
        rankedNetworks: ['eth', 'wifi']
      },
      ioFor(port, badPath, phases)
    )
    const finalHash = await hashFile('sha256', badPath)
    assert.equal(repaired.verified, true)
    assert.equal(finalHash, expectedSha256)
    assert.equal(repaired.rounds, 1)
    assert.deepEqual(repaired.repairedBlocks, [3, 9], 'exactly the damaged blocks')
    assert.deepEqual(repaired.badNetworks, ['wifi'])
    assert.equal(repaired.bytesRewritten, 2 * BLOCK_BYTES, 'only two blocks written back')
    assert.ok(
      requestLog.every((entry) => entry.network === 'eth'),
      're-fetched over the best ranked network only'
    )
    assert.equal(repaired.bytesRefetched, FILE_BYTES / 2, "only wifi's share was re-fetched")
    say('[PASS] 3. Damaged file repaired')
    say(`          phases: ${phases.join(' → ')}`)
    say(`          suspect network: wifi (lowest ranked that delivered blocks)`)
    say(`          bad blocks found: #${repaired.repairedBlocks.join(', #')}`)
    say(
      `          re-fetched over eth: ${repaired.bytesRefetched / MIB} MiB (wifi's half, not the whole file)`
    )
    say(`          rewritten on disk: ${repaired.bytesRewritten / 1024} KiB (2 blocks)`)
    say(`          final SHA-256 = ${finalHash}  ✔ matches\n`)

    // 4. A link that keeps lying: three rounds, then the user decides.
    wifiAlwaysLies = true
    const liarPath = join(dir, 'liar.bin')
    const liarBlocks = await assemble(port, liarPath, ['wifi'])
    const liarPhases: string[] = []
    const gaveUp = await verifyAndRepair(
      {
        algorithm: 'sha256',
        expected: expectedSha256,
        blocks: liarBlocks,
        rankedNetworks: ['wifi']
      },
      ioFor(port, liarPath, liarPhases)
    )
    assert.equal(gaveUp.verified, false)
    assert.equal(gaveUp.rounds, 3, 'stops after three repair rounds')
    say('[PASS] 4. Only a lying network left: gave up after exactly 3 repair rounds;')
    say('          the download manager then shows "Checksum mismatch" with Retry repair /')
    say('          Publish unverified, and the file is NOT published.\n')

    say('All checksum verification and chunk repair checks passed.')
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
