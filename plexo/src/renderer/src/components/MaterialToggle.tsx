import type { WindowMaterial } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/**
 * Feature 3: how translucent the window is. A cycling button like the theme toggle beside it:
 * solid, glass panels, desktop glass. The tooltip and label always name the level in use and the
 * one a click moves to, since the icon alone cannot say which of three levels is on.
 */
const OPTIONS: { id: WindowMaterial; label: string; icon: React.JSX.Element }[] = [
  {
    id: 'solid',
    label: 'Opaque',
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <rect x="2.5" y="2.5" width="11" height="11" fill="currentColor" />
      </svg>
    )
  },
  {
    id: 'panels',
    label: 'Glass panels',
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <rect
          x="2.5"
          y="2.5"
          width="11"
          height="11"
          stroke="currentColor"
          strokeWidth="1.3"
          fill="none"
        />
        <path d="M2.5 6.2h11" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  },
  {
    id: 'desktop',
    label: 'Desktop glass',
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <rect
          x="2.5"
          y="5.5"
          width="9"
          height="8"
          stroke="currentColor"
          strokeWidth="1.3"
          fill="none"
        />
        <path d="M5.5 5.5v-3h8v8" stroke="currentColor" strokeWidth="1.3" fill="none" />
      </svg>
    )
  }
]

export function MaterialToggle(): React.JSX.Element {
  const windowMaterial = useAppStore((store) => store.windowMaterial)
  const setWindowMaterial = useAppStore((store) => store.setWindowMaterial)

  const index = Math.max(
    0,
    OPTIONS.findIndex((option) => option.id === windowMaterial)
  )
  const current = OPTIONS[index]
  const next = OPTIONS[(index + 1) % OPTIONS.length]
  const label = `${current.label} window. Switch to ${next.label.toLowerCase()}`

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={() => setWindowMaterial(next.id)}
            className="flex size-[26px] shrink-0 cursor-default items-center justify-center rounded-none border-[0.5px] border-border bg-secondary text-[var(--text-secondary)] [-webkit-app-region:no-drag]"
          >
            {current.icon}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
