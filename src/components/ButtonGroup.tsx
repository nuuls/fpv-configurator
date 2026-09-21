import { Button } from '@/components/ui/button'

interface ButtonGroupProps<T extends string | number> {
  /** Accessible name of the group. */
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}

/** Pick one of a few values: joined buttons, the current one filled. */
export function ButtonGroup<T extends string | number>({ label, options, value, onChange, disabled }: ButtonGroupProps<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={option.value === value ? 'default' : 'outline'}
          aria-pressed={option.value === value}
          disabled={disabled}
          className="min-w-9 rounded-none first:rounded-l-md last:rounded-r-md not-first:-ml-px"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
