import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/layout/PageHeader'

/** Stand-in for tabs that aren't implemented yet. Replace usages one by one. */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>Not implemented yet</CardTitle>
          <CardDescription>
            See CLAUDE.md → &quot;Adding a feature&quot; for the steps: MSP code → decoder + test → mock FC response → UI.
          </CardDescription>
        </CardHeader>
      </Card>
    </>
  )
}
