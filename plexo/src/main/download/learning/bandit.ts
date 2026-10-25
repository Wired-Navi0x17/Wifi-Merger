import type { RunOutcome } from './profiles'

// Tail strategy picker: Gaussian Thompson Sampling over three preset arms.
//
// Method (not our invention): Thompson Sampling for Bernoulli bandits is Agrawal and
// Goyal 2012; the Gaussian extension for real-valued rewards follows the same
// posterior-sampling idea. Reference implementation consulted: PyPI `thompson`
// by Erdogan Taskesen (MIT license), which implements Thompson Sampling, UCB, and
// randomized baselines for the multi-armed bandit problem. The code below is an
// independent, dependency-free port of the standard Gaussian variant, kept small
// enough to audit: no npm package, no network calls, no native code.
//
// Arms are tail strategies for one download context (see context.ts):
//   0 conservative: start 4 streams/net, hedge only after 4000 ms
//   1 standard:     start 8 streams/net, hedge after 2000 ms (today's default)
//   2 aggressive:   start 16 streams/net, hedge after 1000 ms
//
// Reward of a run: faster tails score above zero, stalled or duplicate-heavy
// tails score below. While any arm is untried, one of those is picked uniformly,
// so every arm is tried before posterior sampling starts. Tried arms sample
// from their posteriors (Welford means and variances); an epsilon floor keeps
// exploring forever.

export interface TailArm {
  startStreams: number
  hedgeAfterMs: number
}

export const TAIL_ARMS: TailArm[] = [
  { startStreams: 4, hedgeAfterMs: 4000 },
  { startStreams: 8, hedgeAfterMs: 2000 },
  { startStreams: 16, hedgeAfterMs: 1000 }
]

export interface ArmBelief {
  pulls: number
  mean: number
  /** Sum of squared deviations (for variance). */
  m2: number
}

export const freshBeliefs = (): ArmBelief[] => [
  { pulls: 0, mean: 0, m2: 0 },
  { pulls: 0, mean: 0, m2: 0 },
  { pulls: 0, mean: 0, m2: 0 }
]

/** Reward in roughly [-2, +2]. Completed fast tails approach +2; failures floor at -2. */
export function rewardOf(outcome: RunOutcome, expectedTailMs: number): number {
  if (!outcome.completed) return -2
  const saved = (expectedTailMs - outcome.tailMs) / Math.max(expectedTailMs, 1)
  const retryCost = Math.min(outcome.retries / 10, 1)
  return Math.max(-2, Math.min(2, saved * 2 - retryCost))
}

/** Welford update of one arm's Gaussian belief. Pure. */
export function updateBelief(beliefs: ArmBelief[], arm: number, reward: number): void {
  const belief = beliefs[arm]
  belief.pulls += 1
  const delta = reward - belief.mean
  belief.mean += delta / belief.pulls
  belief.m2 += delta * (reward - belief.mean)
}

function gaussianSample(random: () => number): number {
  let u = 0
  while (u === 0) u = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
}

/** Thompson sample: one draw per arm from its posterior, take the max. While any arm is
 * untried, one of the untried is picked uniformly, so each is tried at least once first. */
export function chooseArm(
  beliefs: ArmBelief[],
  random: () => number = Math.random,
  epsilon = 0.1
): number {
  if (beliefs.some((belief) => belief.pulls === 0)) {
    const untried = beliefs
      .map((belief, index) => (belief.pulls === 0 ? index : -1))
      .filter((index) => index >= 0)
    return untried[Math.floor(random() * untried.length)]
  }
  if (random() < epsilon) return Math.floor(random() * beliefs.length)
  let best = 0
  let bestSample = -Infinity
  beliefs.forEach((belief, index) => {
    const variance = belief.pulls > 1 ? belief.m2 / (belief.pulls - 1) : 1
    const sample = belief.mean + Math.sqrt(Math.max(variance, 0.01)) * gaussianSample(random)
    if (sample > bestSample) {
      bestSample = sample
      best = index
    }
  })
  return best
}
