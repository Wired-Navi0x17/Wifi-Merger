import { join } from 'node:path'
import { app } from 'electron'
import { readJson, updateJson } from '../../jsonFile'
import { freshBeliefs, type ArmBelief } from './bandit'
import { freshHostProfile, freshNetworkProfile, type HostProfile } from './profiles'
import type { NetworkLearnProfile } from './profiles'

// Local-only learning store: one JSON file under userData, versioned and capped.
// Nothing leaves the machine. A corrupt file falls back to empty rather than crashing.

const STORE_VERSION = 1
const MAX_HOSTS = 200
const MAX_NETWORKS = 40

interface Persisted {
  version: number
  hosts: Record<string, HostProfile>
  networks: Record<string, NetworkLearnProfile>
  beliefs: Record<string, ArmBelief[]>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export class LearningStore {
  private hosts = new Map<string, HostProfile>()
  private networks = new Map<string, NetworkLearnProfile>()
  private beliefs = new Map<string, ArmBelief[]>()
  readonly loaded: Promise<void>

  constructor(path?: string) {
    const file = path ?? join(app.getPath('userData'), 'learning.json')
    this.loaded = readJson(file)
      .then((saved) => {
        if (!isRecord(saved) || saved.version !== STORE_VERSION) return
        const data = saved as unknown as Persisted
        for (const [key, value] of Object.entries(data.hosts ?? {})) {
          if (isRecord(value) && typeof value.host === 'string') {
            this.hosts.set(key, { ...freshHostProfile(value.host), ...value } as HostProfile)
          }
        }
        for (const [key, value] of Object.entries(data.networks ?? {})) {
          if (isRecord(value) && typeof value.key === 'string') {
            this.networks.set(key, value as unknown as NetworkLearnProfile)
          }
        }
        for (const [key, value] of Object.entries(data.beliefs ?? {})) {
          if (
            Array.isArray(value) &&
            value.length === 3 &&
            value.every((entry) => isRecord(entry) && typeof entry.pulls === 'number')
          ) {
            this.beliefs.set(key, value as unknown as ArmBelief[])
          }
        }
      })
      .catch(() => {})
    void file
  }

  host(key: string): HostProfile {
    let profile = this.hosts.get(key)
    if (!profile) this.hosts.set(key, (profile = freshHostProfile(key)))
    return profile
  }

  network(key: string, kind: NetworkLearnProfile['kind']): NetworkLearnProfile {
    let profile = this.networks.get(key)
    if (!profile) this.networks.set(key, (profile = freshNetworkProfile(key, kind)))
    return profile
  }

  beliefsFor(context: string): ArmBelief[] {
    let beliefs = this.beliefs.get(context)
    if (!beliefs) this.beliefs.set(context, (beliefs = freshBeliefs()))
    return beliefs
  }

  /** Forgets every host, network and belief (the Learning dialog's Forget button). */
  clear(): void {
    this.hosts.clear()
    this.networks.clear()
    this.beliefs.clear()
  }

  /** Caps the store (least-recently-updated hosts go first) and writes it. */
  async save(path?: string): Promise<void> {
    const file = path ?? join(app.getPath('userData'), 'learning.json')
    const hosts = [...this.hosts.entries()]
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_HOSTS)
    const networks = [...this.networks.entries()].slice(0, MAX_NETWORKS)
    const snapshot: Persisted = {
      version: STORE_VERSION,
      hosts: Object.fromEntries(hosts),
      networks: Object.fromEntries(networks),
      beliefs: Object.fromEntries(this.beliefs)
    }
    await updateJson(file, () => snapshot).catch(() => {})
  }
}
