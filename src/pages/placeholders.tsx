import { PlaceholderPage } from './PlaceholderPage'

// Tabs whose section in docs/SPEC.md §2 is still "TBD". Replace one by one as their specs get written.

export function FiltersPage() {
  return <PlaceholderPage title="Filters" description="Gyro and D-term filtering." />
}

export function RatesPage() {
  return <PlaceholderPage title="Rates" description="How fast the quad rotates for a given stick movement." />
}

export function OsdPage() {
  return <PlaceholderPage title="OSD" description="What is shown in your goggles." />
}

export function VtxPage() {
  return <PlaceholderPage title="VTX" description="Video transmitter band, channel and power." />
}
