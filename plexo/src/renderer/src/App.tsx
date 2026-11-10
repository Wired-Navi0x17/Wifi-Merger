import type { DownloadState, FinishedDownload } from '@shared/types'
import { DownloadActionsProvider } from './components/DownloadActionsProvider'
import { NetworkBindingDialog } from './components/NetworkBindingDialog'
import { NewDownloadDialog } from './components/NewDownloadDialog'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { TooltipProvider } from './components/ui/tooltip'
import { useDownloadEvents } from './hooks/useDownloadEvents'
import { useNetworkEvents } from './hooks/useNetworks'
import { useNewDownloadShortcuts, useOpenedLinks } from './hooks/useOpenedLinks'
import { CompleteScreen } from './screens/CompleteScreen'
import { DownloadingScreen } from './screens/DownloadingScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { DiscoverScreen } from './screens/DiscoverScreen'
import { ErrorScreen } from './screens/ErrorScreen'
import { SourcesScreen } from './screens/SourcesScreen'
import { useAppStore } from './store/useAppStore'

function assertNever(status: never): never {
  throw new Error(`Unhandled download status: ${String(status)}`)
}

/** One screen per download.status — a switch with an assertNever default so a new
 * DownloadStatus value is a compile error here instead of silently falling into whichever branch
 * happened to be last. */
function renderDownload(download: DownloadState | FinishedDownload): React.JSX.Element {
  if ('unitsWritten' in download) return <CompleteScreen download={download} />
  switch (download.status) {
    case 'queued':
    case 'downloading':
    case 'paused':
      return <DownloadingScreen download={download} />
    case 'completed':
      return <CompleteScreen download={download} />
    case 'error':
    case 'cancelled':
      return <ErrorScreen download={download} />
    default:
      return assertNever(download.status)
  }
}

import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from './components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ScreenErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Plexo ScreenErrorBoundary caught an error:', error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center p-6 text-center bg-background">
          <div className="size-10 rounded-full bg-destructive/15 text-destructive flex items-center justify-center mb-3">
            <AlertCircle className="size-5" />
          </div>
          <h2 className="font-sans text-base font-bold text-foreground">Screen Error</h2>
          <p className="mt-1 max-w-md font-mono text-xs text-muted-foreground">
            {this.state.error?.message || 'An error occurred while rendering this screen.'}
          </p>
          <Button
            type="button"
            className="mt-4"
            size="sm"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              useAppStore.setState({ view: { name: 'list' } })
            }}
          >
            Back to Downloads
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

/** The download shown, or the list, discovery, or sources. */
function CurrentScreen(): React.JSX.Element {
  const view = useAppStore((store) => store.view)
  // Hooks must always be called unconditionally at the top of the component
  const shown = useAppStore((store) => {
    const { view: v } = store
    if (v.name !== 'download') return null
    const downloadId = v.id
    // A download that's gone (removed, deleted) leaves the list showing.
    return store.downloads[downloadId] ?? store.history.find((entry) => entry.id === downloadId) ?? null
  })

  if (view.name === 'discover') {
    return <DiscoverScreen />
  }
  if (view.name === 'sources') {
    return <SourcesScreen />
  }

  const cancelled = shown && !('unitsWritten' in shown) && shown.status === 'cancelled'
  return shown && !cancelled ? renderDownload(shown) : <DownloadsScreen />
}

function App(): React.JSX.Element {
  useDownloadEvents()
  useOpenedLinks()
  useNewDownloadShortcuts()
  useNetworkEvents()

  return (
    <TooltipProvider>
      <DownloadActionsProvider>
        <div className="flex h-full flex-col">
          <TitleBar />
          <div className="min-h-0 flex-1">
            <ScreenErrorBoundary>
              <CurrentScreen />
            </ScreenErrorBoundary>
          </div>
          <StatusBar />
          <NewDownloadDialog />
          <NetworkBindingDialog />
        </div>
      </DownloadActionsProvider>
    </TooltipProvider>
  )
}

export default App
