import type { ReactNode } from 'react'
import { DUE_SOON_DAYS, daysUntil, displayDate } from '../lib/dates'

/** Days left until an approaching deadline, or null when it is not within the next week. */
export function dueSoonDays(
  value: string | null | undefined,
  { done, overdue }: { done: boolean; overdue: boolean },
) {
  if (!value || done || overdue) return null
  const days = daysUntil(value)
  return days >= 0 && days < DUE_SOON_DAYS ? days : null
}

export function dueSoonLabel(daysLeft: number) {
  if (daysLeft === 0) return 'Vence hoje'
  if (daysLeft === 1) return 'Vence amanhã'
  return `Vence em ${daysLeft} dias`
}

/** A ring that fills up as the deadline gets closer: one slice per day, full on the day itself. */
export function DueSoonRing({ daysLeft, size = 14 }: { daysLeft: number; size?: number }) {
  const r = 5.5
  const length = 2 * Math.PI * r
  const filled = (DUE_SOON_DAYS - daysLeft) / DUE_SOON_DAYS
  return (
    <svg
      className={`due-soon-ring ${daysLeft <= 1 ? 'urgent' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <circle className="due-soon-track" cx="7" cy="7" r={r} />
      <circle
        className="due-soon-fill"
        cx="7"
        cy="7"
        r={r}
        strokeDasharray={length}
        strokeDashoffset={length * (1 - filled)}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}

/**
 * A read-only due date: the ring and a "Vence em…" hint while the deadline is near, otherwise the
 * optional icon. Callers keep their own wrapper for colour (overdue) and layout.
 */
export function DueDateText({
  value,
  done,
  overdue,
  icon,
}: {
  value: string | null | undefined
  done: boolean
  overdue: boolean
  icon?: ReactNode
}) {
  const daysLeft = dueSoonDays(value, { done, overdue })
  const hint = daysLeft === null ? undefined : dueSoonLabel(daysLeft)
  return (
    <span className="due-date-text" title={hint}>
      {daysLeft === null ? icon : <DueSoonRing daysLeft={daysLeft} size={12} />}
      {displayDate(value)}
      {hint && <span className="sr-only"> · {hint}</span>}
    </span>
  )
}
