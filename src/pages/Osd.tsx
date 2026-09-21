import { Notice, LoadingState } from '@/components/Notice'
import { NumberInput } from '@/components/NumberInput'
import { OsdPreview } from '@/components/OsdPreview'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useDraft } from '@/hooks/useDraft'
import { useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import type { MspClient } from '@/lib/msp/client'
import { readOsdSnapshot, saveOsd } from '@/lib/osd/io'
import {
  availableElements,
  clampToCanvas,
  elementName,
  otherVisibleElements,
  setElementCell,
  setElementShown,
  toDraft,
  validateOsd,
  VIDEO_SYSTEM_NAMES,
  type OsdSnapshot,
} from '@/lib/osd/model'

const PATH = '/osd'
const CELL_INPUT = 'h-8 w-14 rounded-md border bg-transparent px-2 tabular-nums dark:bg-input/30'

/** Spec: docs/tabs/osd.md */
export function OsdPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readOsdSnapshot)
  return (
    <>
      <PageHeader title="OSD" description="What is shown in your goggles, and where." />
      {client && snapshot ? (
        snapshot.config.supported ? (
          <Editor client={client} snapshot={snapshot} reload={reload} />
        ) : (
          <Notice tone="warning">This firmware build has no OSD support.</Notice>
        )
      ) : (
        <LoadingState error={error} />
      )}
    </>
  )
}

function Editor({ client, snapshot, reload }: { client: MspClient; snapshot: OsdSnapshot; reload: () => void }) {
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, toDraft)
  const { saving, error, save } = useSave(reload)
  useUnsavedChanges(PATH, dirty)

  const { canvas, config } = snapshot
  const defs = availableElements(snapshot)
  const others = otherVisibleElements(snapshot)
  const shown = defs.flatMap((def) => {
    const el = draft.elements.find((e) => e.index === def.index && e.shown)
    return el ? [{ index: def.index, label: def.label, sample: def.sample, x: el.x, y: el.y }] : []
  })

  return (
    <>
      {!config.deviceDetected && (
        <Notice tone="warning">
          The flight controller hasn&apos;t detected an OSD device (yet). You can still set everything up here.
        </Notice>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[26rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Elements</CardTitle>
            <CardDescription>Switch on what you want to see. X and Y count characters from the top left.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3 text-sm">
              {defs.map((def) => {
                const el = draft.elements.find((e) => e.index === def.index)
                if (!el) return null
                const id = `osd-element-${def.index}`
                return (
                  <li key={def.index} className="flex min-h-8 items-center gap-3">
                    <Switch
                      id={id}
                      checked={el.shown}
                      onCheckedChange={(on) => setDraft(setElementShown(draft, def.index, on, canvas))}
                    />
                    <div className="mr-auto">
                      <label htmlFor={id} className="font-medium">
                        {def.label}
                      </label>
                      {def.hint && el.shown && <p className="text-xs text-muted-foreground">{def.hint}</p>}
                    </div>
                    {el.shown &&
                      (['x', 'y'] as const).map((axis) => (
                        <NumberInput
                          key={axis}
                          aria-label={`${def.label} ${axis.toUpperCase()}`}
                          min={0}
                          max={(axis === 'x' ? canvas.cols : canvas.rows) - 1}
                          step={1}
                          value={el[axis]}
                          onValueChange={(value) => setDraft(setElementCell(draft, def.index, { [axis]: value }))}
                          className={CELL_INPUT}
                        />
                      ))}
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              Drag elements into place, or select one and use the arrow keys. {canvas.cols} × {canvas.rows} characters (
              {VIDEO_SYSTEM_NAMES[config.videoSystem] ?? 'unknown'} video). Values are examples.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OsdPreview
              canvas={canvas}
              elements={shown}
              onMove={(index, cell) => {
                const sample = defs.find((def) => def.index === index)?.sample ?? ''
                setDraft(setElementCell(draft, index, clampToCanvas(cell, sample.length, canvas)))
              }}
            />
          </CardContent>
        </Card>
      </div>

      {others.length > 0 && (
        <Notice>
          {others.length === 1 ? '1 other element is' : `${others.length} other elements are`} switched on that this app
          doesn&apos;t manage ({others.map(elementName).join(', ')}).{' '}
          {draft.hideOthers ? (
            <strong>Will be switched off when you save.</strong>
          ) : (
            <Button variant="outline" size="sm" className="ml-1" onClick={() => setDraft({ ...draft, hideOthers: true })}>
              Hide other elements
            </Button>
          )}
        </Notice>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      <SaveBar
        dirty={dirty}
        saving={saving}
        problem={validateOsd(draft, canvas)[0]}
        reboot={false}
        onRevert={revert}
        onSave={() =>
          void save(async () => {
            await saveOsd(client, snapshot, draft)
            return false
          })
        }
      />
    </>
  )
}
