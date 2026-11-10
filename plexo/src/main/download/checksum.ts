import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { ChecksumAlgorithm, HttpBlockState } from '../../shared/types'

export { detectAlgorithm, normalizeChecksum } from '../../shared/checksum'

/**
 * Enhancement 5: checksum verification and chunk repair.
 *
 * A file built from blocks fetched over several networks can be damaged by one of them: a 200 or
 * 206 with the right length but the wrong bytes. Lengths and ranges are already checked as blocks
 * arrive; this module checks the bytes. After the last block the whole file is hashed and compared
 * with the expected checksum. On a mismatch the blocks are compared, network by network, with a
 * fresh copy fetched over a different (better ranked) network; only blocks whose hash differs are
 * rewritten. At most MAX_REPAIR_ROUNDS rounds, then the user decides.
 */

export const MAX_REPAIR_ROUNDS = 3

export function hashBuffer(algorithm: ChecksumAlgorithm, data: Buffer): string {
  return createHash(algorithm).update(data).digest('hex')
}

/** Hashes a file by streaming it, so a large download never has to fit in memory. */
export function hashFile(algorithm: ChecksumAlgorithm, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm)
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/** The network that delivered most of a block's bytes: the one to suspect if it is wrong. */
export function deliveredBy(block: HttpBlockState): string | undefined {
  let best: string | undefined
  let most = -1
  for (const [networkId, bytes] of Object.entries(block.bytesByInterface)) {
    if (bytes > most) {
      most = bytes
      best = networkId
    }
  }
  return best ?? block.interfaceId
}

export type RepairPhase =
  | { phase: 'verifying'; round: number }
  | { phase: 'repairing'; round: number; suspect: string; checked: number; toCheck: number }

export interface RepairIo {
  /** Hashes the assembled file. */
  hashFile(): Promise<string>
  /** Reads a block from the assembled file. */
  readBlock(block: HttpBlockState): Promise<Buffer>
  /** Fetches a block's range afresh over the given network. */
  fetchBlock(block: HttpBlockState, networkId: string): Promise<Buffer>
  /** Writes a repaired block over the bad one. */
  writeBlock(block: HttpBlockState, data: Buffer): Promise<void>
  onPhase?(phase: RepairPhase): void
}

export interface RepairRequest {
  algorithm: ChecksumAlgorithm
  expected: string
  blocks: HttpBlockState[]
  /** Networks that can be used for re-fetching, best first: the learning store's ranking. */
  rankedNetworks: string[]
  maxRounds?: number
}

export interface RepairResult {
  verified: boolean
  /** The file's hash as it stands at the end. */
  actual: string
  rounds: number
  /** Block indexes found bad and rewritten, over every round. */
  repairedBlocks: number[]
  /** Bytes re-fetched to check and repair blocks (each block's range counted once per fetch). */
  bytesRefetched: number
  /** Bytes actually written back: only the bad blocks. */
  bytesRewritten: number
  /** The networks that were caught serving wrong bytes. */
  badNetworks: string[]
}

/**
 * Hashes the file; on a mismatch repairs it in rounds. Each round picks the most suspect network
 * not yet checked (the lowest ranked one that delivered bytes), fetches its blocks over the best
 * ranked other network, compares the block hashes and rewrites only those that differ. The whole
 * file is hashed again after each round. With one network only, its blocks are re-fetched over it.
 */
export async function verifyAndRepair(request: RepairRequest, io: RepairIo): Promise<RepairResult> {
  const { algorithm, blocks, rankedNetworks } = request
  const expected = request.expected.toLowerCase()
  const maxRounds = request.maxRounds ?? MAX_REPAIR_ROUNDS
  const result: RepairResult = {
    verified: false,
    actual: '',
    rounds: 0,
    repairedBlocks: [],
    bytesRefetched: 0,
    bytesRewritten: 0,
    badNetworks: []
  }

  io.onPhase?.({ phase: 'verifying', round: 0 })
  result.actual = await io.hashFile()
  if (result.actual === expected) {
    result.verified = true
    return result
  }

  const rank = (networkId: string | undefined): number => {
    const at = networkId === undefined ? -1 : rankedNetworks.indexOf(networkId)
    return at === -1 ? Number.MAX_SAFE_INTEGER : at
  }
  const checked = new Set<string>()
  const repaired = new Set<number>()

  for (let round = 1; round <= maxRounds; round++) {
    result.rounds = round
    // Suspects: networks that delivered blocks, most suspect (lowest ranked) first.
    const delivering = [...new Set(blocks.map(deliveredBy))].filter(
      (id): id is string => id !== undefined
    )
    delivering.sort((a, b) => rank(b) - rank(a))
    const suspect = delivering.find((id) => !checked.has(id))
    // Every network has been checked once and the file is still wrong: check every block again,
    // this time over the best network (a fetch can itself have been damaged).
    const suspectBlocks =
      suspect === undefined
        ? blocks.filter((block) => !repaired.has(block.index))
        : blocks.filter((block) => deliveredBy(block) === suspect)
    if (suspect !== undefined) checked.add(suspect)

    const helper =
      rankedNetworks.find((id) => id !== suspect) ?? suspect ?? rankedNetworks[0] ?? undefined
    if (helper === undefined) break

    let foundBad = false
    for (let i = 0; i < suspectBlocks.length; i++) {
      const block = suspectBlocks[i]
      io.onPhase?.({
        phase: 'repairing',
        round,
        suspect: suspect ?? 'all',
        checked: i,
        toCheck: suspectBlocks.length
      })
      const [local, fresh] = await Promise.all([io.readBlock(block), io.fetchBlock(block, helper)])
      result.bytesRefetched += fresh.length
      if (fresh.length !== local.length) continue // a short answer can't be trusted to repair
      if (hashBuffer(algorithm, local) === hashBuffer(algorithm, fresh)) continue
      await io.writeBlock(block, fresh)
      result.bytesRewritten += fresh.length
      repaired.add(block.index)
      foundBad = true
    }
    if (foundBad && suspect !== undefined && !result.badNetworks.includes(suspect)) {
      result.badNetworks.push(suspect)
    }

    io.onPhase?.({ phase: 'verifying', round })
    result.actual = await io.hashFile()
    if (result.actual === expected) {
      result.verified = true
      break
    }
  }

  result.repairedBlocks = [...repaired].sort((a, b) => a - b)
  return result
}
