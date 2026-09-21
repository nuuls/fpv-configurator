import { useState, type ComponentProps } from 'react'

interface NumberInputProps extends Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange'> {
  value: number
  /** Called with every number the user types; not called while the field is empty or half-typed. */
  onValueChange: (value: number) => void
}

/**
 * Number field that lets the user clear it and type a new value. While focused it shows exactly what was
 * typed; the last valid number stays in the draft and comes back on blur if the field is left empty.
 */
export function NumberInput({ value, onValueChange, onBlur, ...props }: NumberInputProps) {
  const [text, setText] = useState<string | null>(null)
  return (
    <input
      {...props}
      type="number"
      value={text ?? value}
      onChange={(e) => {
        setText(e.target.value)
        const next = e.target.valueAsNumber
        if (Number.isFinite(next)) onValueChange(next)
      }}
      onBlur={(e) => {
        setText(null)
        onBlur?.(e)
      }}
    />
  )
}
