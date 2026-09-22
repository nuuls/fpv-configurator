import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/layout/PageHeader'

/** Stand-in for tabs that aren't implemented yet. Replace usages one by one. */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>Not specified yet</CardTitle>
          <CardDescription>
            This tab is still marked TBD in docs/SPEC.md. Describe what it should do in docs/tabs/
            and it can be built.
          </CardDescription>
        </CardHeader>
      </Card>
    </>
  )
}
