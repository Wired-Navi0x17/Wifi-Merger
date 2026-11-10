import type { ChecksumState } from '@shared/types'
import { cn } from 'cn'
import { useState } from 'react'
import { formatBytes } from '../utils/format'
import { Button } from './ui/button'

/** Enhancement 5: where a download's checksum check stands, and the way out when it failed. */

function headline(checksum: ChecksumState): string {
  const algo = checksum.algorithm.toUpperCase()
  switch (checksum.status) {
    case 'pending':
      return `${algo} check waiting for the last block`
    case 'verifying':
      return checksum.round
        ? `Hashing again after repair round ${checksum.round}…`
        : `Hashing the file (${algo})…`
    case 'repairing':
      return `Repair round ${checksum.round ?? 1} of 3: checking block ${(checksum.checked ?? 0) + 1} of ${checksum.toCheck ?? '?'}`
    case 'verified':
      return checksum.repairedBlocks?.length
        ? `${algo} verified after repairing ${checksum.repairedBlocks.length} block${checksum.repairedBlocks.length === 1 ? '' : 's'}`
        : `${algo} verified`
    case 'failed':
      return `${algo} mismatch: could not repair`
    case 'skipped':
      return `${algo} not verified (published as it was)`
  }
}

export function ChecksumPanel({
  checksum,
  downloadId,
  networkName
}: {
  checksum: ChecksumState
  /** Given for a download that can still act: Retry and Publish unverified on a failure. */
  downloadId?: string
  networkName?: (id: string) => string
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const tone =
    checksum.status === 'verified'
      ? 'border-[var(--color-success)] text-[var(--color-success)]'
      : checksum.status === 'failed'
        ? 'border-[var(--color-danger)] text-[var(--color-danger)]'
        : 'border-border text-[var(--text-secondary)]'
  const act = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }
  const name = networkName ?? ((id: string) => id)
  return (
    <div
      role="status"
      data-testid="checksum-panel"
      data-status={checksum.status}
      className={cn(
        'flex w-full flex-col gap-1.5 rounded-none border-[0.5px] p-[10px_12px] text-left',
        tone
      )}
    >
      <div className="font-sans text-[12.5px] leading-[1.3] font-semibold">
        {headline(checksum)}
      </div>
      <div className="font-mono text-[10.5px] leading-[1.45] break-all text-muted-foreground">
        <div>
          expected {checksum.value} ({checksum.source === 'page' ? 'from the page' : 'typed in'})
        </div>
        {checksum.actual && checksum.actual !== checksum.value && (
          <div>got&nbsp;&nbsp;&nbsp;&nbsp; {checksum.actual}</div>
        )}
        {(checksum.repairedBlocks?.length ?? 0) > 0 && (
          <div>
            repaired blocks #{checksum.repairedBlocks!.join(', #')} ·{' '}
            {formatBytes(checksum.bytesRewritten ?? 0)} rewritten,{' '}
            {formatBytes(checksum.bytesRefetched ?? 0)} re-fetched
          </div>
        )}
        {(checksum.badNetworks?.length ?? 0) > 0 && (
          <div>wrong bytes came from {checksum.badNetworks!.map(name).join(', ')}</div>
        )}
      </div>
      {checksum.status === 'failed' && downloadId && (
        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            size="xs"
            disabled={busy}
            onClick={() => act(() => window.plexo.resumeDownload(downloadId))}
          >
            Retry repair
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => act(() => window.plexo.skipChecksum(downloadId))}
          >
            Publish unverified
          </Button>
        </div>
      )}
    </div>
  )
}
