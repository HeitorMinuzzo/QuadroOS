import { useState, type ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './ui/select'

export interface FieldOption {
  value: string
  label: string
  color?: string
  icon?: ReactNode
  description?: string
}

export function FieldSelect({
  value,
  onChange,
  options,
  label,
  placeholder = 'Selecione uma opção',
  disabled = false,
  required = false,
  id,
  heading,
  variant = 'field',
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  options: readonly FieldOption[]
  label: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  id?: string
  heading?: string
  variant?: 'field' | 'toolbar'
  className?: string
}) {
  const [pointerFocus, setPointerFocus] = useState(false)
  const selected = options.find((option) => option.value === value)
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled} required={required}>
      <SelectTrigger
        id={id}
        aria-label={label}
        className={`field-select-trigger ${className}`}
        data-variant={variant}
        data-pointer-focus={pointerFocus || undefined}
        onPointerDown={() => setPointerFocus(true)}
        onKeyDown={() => setPointerFocus(false)}
        onBlur={() => setPointerFocus(false)}
      >
        <SelectValue placeholder={placeholder}>
          {selected && (
            <span className="field-select-line">
              {selected.icon}
              {selected.color && (
                <i className="field-select-dot" style={{ backgroundColor: selected.color }} />
              )}
              <span className="field-select-text">{selected.label}</span>
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        sideOffset={6}
        className="field-select-menu"
        onPointerDownCapture={() => setPointerFocus(true)}
        onKeyDownCapture={() => setPointerFocus(false)}
        onPointerDownOutside={() => setPointerFocus(true)}
      >
        <SelectGroup>
          {heading && <SelectLabel className="field-select-heading">{heading}</SelectLabel>}
          {options
            .filter((option) => option.value)
            .map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="field-select-option"
                title={option.label}
              >
                <span className="field-select-line">
                  {option.icon}
                  {option.color && (
                    <i className="field-select-dot" style={{ backgroundColor: option.color }} />
                  )}
                  <span className="field-select-copy">
                    <span>{option.label}</span>
                    {option.description && <small>{option.description}</small>}
                  </span>
                </span>
              </SelectItem>
            ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
