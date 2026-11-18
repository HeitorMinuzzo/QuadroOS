import { localDate } from '../../shared/domain'

const sameYear = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
const otherYear = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

/** "12 de dez" for this year, the shorter "12 dez 2025" for any other year so it fits a cell. */
export function formatDay(date: Date) {
  if (date.getFullYear() === new Date().getFullYear()) return sameYear.format(date).replace('.', '')
  return otherYear.format(date).replace(/\./g, '').replace(/ de /g, ' ')
}

/** A due date ("YYYY-MM-DD") for display, or "Sem prazo". */
export function displayDate(value: string | null | undefined) {
  return value ? formatDay(new Date(`${value}T12:00:00`)) : 'Sem prazo'
}

/** Days within which a deadline counts as approaching. */
export const DUE_SOON_DAYS = 7

/** Whole days from today until a "YYYY-MM-DD" date (0 = today, negative = past). */
export function daysUntil(value: string) {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000
  return Math.round(day(value) - day(localDate()))
}
