// Feature 6: bufferbloat control. The estimator and the controller are pure, so every case here is
// an exact situation: a time, a ping, a rate, a stream count.
import assert from 'node:assert/strict'
import {
  ConcurrencyController,
  DRAIN_MS,
  GROWTH_JUDGE_MS,
  type NetworkSnapshot,
  type Snapshot
} from '../src/main/download/concurrency'
import { MIN_SAMPLES, RttEstimator } from '../src/main/download/rttEstimator'
import type { CongestionMode } from '../src/shared/types'

const MIB = 1024 * 1024

function controller(mode: CongestionMode = 'friendly'): ConcurrencyController {
  return new ConcurrencyController(
    32,
    true,
    () => Infinity,
    () => mode
  )
}

function net(streams: number, path?: NetworkSnapshot['path']): NetworkSnapshot {
  return { id: 'wlan0', streams, answered: streams, refused: 0, served: streams, path }
}

function snap(now: number, network: NetworkSnapshot): Snapshot {
  return { now, networks: [network], spareWork: 1000 }
}

const calm = { minRttMs: 20, queueDelayMs: 2, rateBps: 10 * MIB }
const bloated = { minRttMs: 20, queueDelayMs: 200, rateBps: 10 * MIB }

function run(): void {
  console.log('Testing Feature 6: bufferbloat control...')

  // 1. Estimator: minRTT, sRTT, queue delay, BDP.
  {
    const est = new RttEstimator()
    for (let i = 0; i < MIN_SAMPLES - 1; i++) est.response('wlan0', i * 100, 20, true)
    assert.equal(est.estimate('wlan0'), null, 'too few samples is no estimate')
    est.response('wlan0', 500, 400, false)
    assert.equal(
      est.estimate('wlan0'),
      null,
      'a fresh socket counts the handshakes, not a round trip'
    )
    est.response('wlan0', 600, 20, true)
    est.delivered('wlan0', 0, 0)
    est.delivered('wlan0', 1000, 10 * MIB)
    const e = est.estimate('wlan0')!
    assert.equal(e.minRttMs, 20)
    assert.equal(e.queueDelayMs, 0)
    assert.equal(e.btlBwBps, 10 * MIB)
    assert.equal(e.bdpBytes, Math.round((10 * MIB * 20) / 1000), 'BDP = BtlBw × minRTT')
    for (let i = 0; i < 30; i++) est.response('wlan0', 1000 + i * 100, 220, true)
    const late = est.estimate('wlan0')!
    assert.equal(late.minRttMs, 20, 'the empty-queue RTT is remembered while the queue is full')
    assert.ok(late.queueDelayMs > 150, `queue delay shows the bloat (${late.queueDelayMs} ms)`)
    console.log('  [PASS] estimator: minRTT, sRTT (RFC 6298 gain), queue delay, BDP')
  }

  // 2. Low ping: grows, doubling (slow start).
  {
    const c = controller()
    const actions = c.tick(snap(0, net(8, calm)))
    assert.deepEqual(actions, [{ kind: 'add', networkId: 'wlan0', count: 8 }])
    console.log('  [PASS] low queue delay: doubles streams (slow start)')
  }

  // 3. Ping far above the lowest: cuts to 3/4, and not again until DRAIN_MS.
  {
    const c = controller()
    assert.deepEqual(c.tick(snap(0, net(32, bloated))), [
      { kind: 'retire', networkId: 'wlan0', count: 8 }
    ])
    assert.equal(c.limit('wlan0'), 24)
    assert.deepEqual(c.tick(snap(1000, net(24, bloated))), [], 'no second cut while draining')
    assert.deepEqual(c.tick(snap(DRAIN_MS, net(24, bloated))), [
      { kind: 'retire', networkId: 'wlan0', count: 6 }
    ])
    console.log('  [PASS] bloat: multiplicative decrease to ⌈3/4⌉, once per drain period')
  }

  // 4. Some queue but not bloat: holds, neither grows nor cuts.
  {
    const c = controller()
    const queueing = { minRttMs: 20, queueDelayMs: 25, rateBps: 10 * MIB }
    assert.deepEqual(c.tick(snap(0, net(8, queueing))), [])
    console.log('  [PASS] queue ≥ minRTT: holds the stream count')
  }

  // 5. A growth that didn't raise the rate: plateau, then +1 at a time (congestion avoidance).
  {
    const c = controller()
    c.tick(snap(0, net(4, calm)))
    const flat = { ...calm, rateBps: 10.2 * MIB }
    assert.deepEqual(c.tick(snap(1000, net(8, flat))), [], 'waiting to judge the growth')
    assert.deepEqual(c.tick(snap(GROWTH_JUDGE_MS, net(8, flat))), [], 'plateau: no growth')
    assert.equal(c.delayState('wlan0'), 'avoidance')
    const later = 61_000 + GROWTH_JUDGE_MS
    assert.deepEqual(c.tick(snap(later, net(8, flat))), [
      { kind: 'add', networkId: 'wlan0', count: 1 }
    ])
    console.log('  [PASS] plateau: growth stops, then additive increase (+1)')
  }

  // 6. Throughput mode, or no path yet: exactly the old behaviour.
  {
    assert.deepEqual(controller('throughput').tick(snap(0, net(16, bloated))), [
      { kind: 'add', networkId: 'wlan0', count: 16 }
    ])
    assert.deepEqual(controller().tick(snap(0, net(16))), [
      { kind: 'add', networkId: 'wlan0', count: 16 }
    ])
    console.log('  [PASS] throughput mode and unmeasured paths keep the loss-based rules')
  }

  // 7. Refusals still win: a server's ceiling is kept in friendly mode too.
  {
    const c = controller()
    const refusing = { ...net(16, calm), refused: 4, served: 12 }
    assert.deepEqual(c.tick(snap(0, refusing)), [{ kind: 'retire', networkId: 'wlan0', count: 4 }])
    console.log('  [PASS] a refusing server still sets the ceiling')
  }

  console.log('All Feature 6 checks passed.')
}

run()
