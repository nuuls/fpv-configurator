import { Button } from '@/components/ui/button'

interface SaveBarProps {
  dirty: boolean
  saving: boolean
  /** First validation problem; disables saving while set. */
  problem?: string | undefined
  /** SPEC §5: the button says "Save & Reboot" when the change needs a reboot. */
  reboot: boolean
  onRevert: () => void
  onSave: () => void
}

/** The Revert / Save row every editable tab ends with (SPEC §5 "Saving"). */
export function SaveBar({ dirty, saving, problem, reboot, onRevert, onSave }: SaveBarProps) {
  return (
    <div className="mt-6 flex items-center justify-end gap-3">
      {dirty && problem && <p className="text-destructive mr-auto text-sm">{problem}</p>}
      <Button variant="outline" disabled={!dirty || saving} onClick={onRevert}>
        Revert
      </Button>
      <Button disabled={!dirty || saving || problem !== undefined} onClick={onSave}>
        {saving ? 'Saving…' : reboot ? 'Save & Reboot' : 'Save'}
      </Button>
    </div>
  )
}
