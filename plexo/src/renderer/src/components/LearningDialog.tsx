import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Switch } from './ui/switch'

/** Feature 2 settings: the adaptive tail strategy, plus a way to forget what was learned.
 * Everything stays local: one learning.json under the app's data folder, no network calls. */
export function LearningDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const tailAdaptive = useAppStore((store) => store.learningTailAdaptive)
  const setLearningTailAdaptive = useAppStore((store) => store.setLearningTailAdaptive)
  const [forgetting, setForgetting] = useState(false)
  const [forgotten, setForgotten] = useState(false)

  const forget = async (): Promise<void> => {
    setForgetting(true)
    setForgotten(false)
    try {
      await window.plexo.resetLearning()
      setForgotten(true)
    } finally {
      setForgetting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Network learning</DialogTitle>
        <p>
          Plexo records how each host and network behaves: speed seen, behaviour at the end of
          transfers, stalls. This is local only, counts and averages in <code>learning.json</code>{' '}
          in the app data folder. Nothing is sent anywhere.
        </p>
        <label>
          <Switch checked={tailAdaptive} onCheckedChange={setLearningTailAdaptive} /> Adapt the
          download tail to what Plexo learned
        </label>
        <p>
          Off (the default): Plexo keeps learning but never changes a download. On: the last part of
          each download may use more or fewer streams and start its fallback earlier, following the
          learned host profile. HTTP single files only; torrents are never affected.
        </p>
        <div>
          <Button type="button" variant="secondary" disabled={forgetting} onClick={forget}>
            {forgetting ? 'Forgetting...' : 'Forget learned data'}
          </Button>{' '}
          {forgotten && <span>Learned data cleared.</span>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
