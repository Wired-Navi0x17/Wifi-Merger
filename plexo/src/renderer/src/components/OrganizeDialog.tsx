import { DEFAULT_ORGANIZE_CATEGORIES, type AutoOrganizeSettings } from '@shared/types'
import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { toDisplayPath } from '../utils/format'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Switch } from './ui/switch'

/** Feature 1 settings: automatic file organization (HTTP single-file only, torrents excluded).
 * Draft-on-open like LimitsDialog: Save writes one updateSettings patch, Cancel drops it. */
export function OrganizeDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const autoOrganize = useAppStore((store) => store.autoOrganize)
  const setAutoOrganize = useAppStore((store) => store.setAutoOrganize)
  const homeDir = useAppStore((store) => store.homeDir)
  const downloadsDir = useAppStore((store) => store.downloadsDir)
  const [draft, setDraft] = useState<AutoOrganizeSettings | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const shown = draft ?? autoOrganize
  const labelsOk = shown.categories.every((category) => category.label.trim().length > 0)

  const takeDraft = (): AutoOrganizeSettings => structuredClone(draft ?? autoOrganize)

  const scanFolder = async (): Promise<void> => {
    const picked = await window.plexo.chooseDestinationFolder(downloadsDir)
    if (!picked) return
    setScanning(true)
    setScanResult(null)
    try {
      const { count } = await window.plexo.organizeFolderNow(picked)
      setScanResult(
        count === 0
          ? `Nothing to move in ${toDisplayPath(picked, homeDir)}`
          : `Moved ${count} ${count === 1 ? 'file' : 'files'} in ${toDisplayPath(picked, homeDir)}`
      )
    } catch (error) {
      setScanResult(error instanceof Error ? error.message : String(error))
    } finally {
      setScanning(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(null)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogTitle>Auto organize downloads</DialogTitle>
        <p>
          Finished files move into subfolders of the download destination by extension, for example{' '}
          <code>Videos/demo.mp4</code>. Single files only; torrents are never moved.
        </p>
        <label>
          <Switch
            checked={shown.enabled}
            onCheckedChange={(enabled) => setDraft({ ...takeDraft(), enabled })}
          />{' '}
          Organize finished files automatically
        </label>
        {shown.categories.map((category, index) => (
          <div key={category.id}>
            <h4>
              {category.label} <small>({category.id})</small>
            </h4>
            <p>Name (also the default subfolder name)</p>
            <Input
              value={category.label}
              maxLength={40}
              onChange={(event) => {
                const next = takeDraft()
                next.categories[index] = {
                  ...next.categories[index],
                  label: event.target.value
                }
                setDraft(next)
              }}
            />
            <p>Extensions (comma separated, without dots)</p>
            <Input
              value={category.extensions.join(', ')}
              onChange={(event) => {
                const next = takeDraft()
                next.categories[index] = {
                  ...next.categories[index],
                  extensions: event.target.value
                    .split(',')
                    .map((ext) => ext.trim().toLowerCase().replace(/^\./, ''))
                    .filter((ext) => /^[a-z0-9]{1,16}$/.test(ext))
                }
                setDraft(next)
              }}
            />
            <p>Folder (blank means the default {category.label || category.id} subfolder)</p>
            <Input
              value={category.folder ?? ''}
              placeholder={category.label}
              onChange={(event) => {
                const next = takeDraft()
                next.categories[index] = {
                  ...next.categories[index],
                  folder: event.target.value || undefined
                }
                setDraft(next)
              }}
            />
          </div>
        ))}
        <p>Already have files sitting in a folder? Organize them now with the same buckets.</p>
        <div>
          <Button type="button" variant="secondary" disabled={scanning} onClick={scanFolder}>
            {scanning ? 'Organizing...' : 'Organize a folder now'}
          </Button>{' '}
          {scanResult && <span>{scanResult}</span>}
        </div>
        <div>
          <Button
            disabled={!labelsOk}
            onClick={() => {
              setAutoOrganize(takeDraft())
              onOpenChange(false)
            }}
          >
            Save
          </Button>{' '}
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(null)
              onOpenChange(false)
            }}
          >
            Cancel
          </Button>{' '}
          <Button
            variant="ghost"
            onClick={() =>
              setDraft({
                enabled: true,
                categories: structuredClone(DEFAULT_ORGANIZE_CATEGORIES)
              })
            }
          >
            Reset to defaults
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
