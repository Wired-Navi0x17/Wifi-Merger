import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface FetchResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
  json: () => Promise<unknown>
}

/**
 * Universal web client that uses Chromium's native network stack when running
 * in Electron (inheriting Chrome TLS fingerprints, HTTP/2, and session cookies),
 * with fallback to curl and standard global fetch for CLI environments.
 */
export async function robustFetch(
  url: string,
  options?: { timeoutMs?: number; headers?: Record<string, string> }
): Promise<FetchResponse> {
  const timeoutMs = options?.timeoutMs ?? 8000
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    ...options?.headers
  }

  // Strategy 1: Try Electron Chromium net.fetch if running inside Electron
  try {
    const electron = await import('electron').catch(() => null)
    if (electron?.net?.fetch) {
      const res = await electron.net.fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (res.ok) {
        return {
          ok: true,
          status: res.status,
          text: () => res.text(),
          json: () => res.json()
        }
      }
      // If Electron net.fetch returned 403/503/etc, throw to escalate to curl
      throw new Error(`Electron net.fetch returned HTTP ${res.status}`)
    }
  } catch {
    // Fall through to curl fallback
  }

  // Strategy 2: Try curl subprocess (handles Cloudflare/CDN TLS fingerprints cleanly)
  try {
    const curlArgs = [
      '-sL',
      '--compressed',
      '--max-time',
      String(Math.max(2, Math.round(timeoutMs / 1000))),
      '-A',
      headers['User-Agent'],
      '-H',
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      '-H',
      'Accept-Language: en-US,en;q=0.9',
      '-H',
      'Sec-Fetch-Dest: document',
      '-H',
      'Sec-Fetch-Mode: navigate',
      '-H',
      'Sec-Fetch-Site: cross-site',
      '-H',
      'Sec-Fetch-User: ?1',
      '-H',
      'Upgrade-Insecure-Requests: 1',
      url
    ]
    const { stdout } = await execFileAsync('curl', curlArgs, { maxBuffer: 25 * 1024 * 1024 })
    if (stdout && stdout.length > 0) {
      return {
        ok: true,
        status: 200,
        text: async () => stdout,
        json: async () => JSON.parse(stdout)
      }
    }
  } catch {
    // Fall through to global fetch
  }

  // Strategy 3: Standard global fetch
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  })
  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
    json: () => res.json()
  }
}
