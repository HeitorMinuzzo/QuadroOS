import type { CustomColumn } from './domain.ts'

export function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return jsonObject(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
export function safeUrl(value: unknown, protocols = ['https:', 'http:']) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return protocols.includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
export function isoDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T12:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export interface TimeValue {
  duration: number
  startedAt: string | null
  sessions: Record<string, unknown>[]
}
export function timeValue(value: string): TimeValue {
  const raw = jsonObject(value)
  return {
    duration: Number(raw.duration) || 0,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    sessions: Array.isArray(raw.sessions) ? raw.sessions.map(jsonObject) : [],
  }
}
export function secondsNow(value: TimeValue, now = Date.now()) {
  return (
    value.duration +
    (value.startedAt ? Math.max(0, Math.floor((now - Date.parse(value.startedAt)) / 1000)) : 0)
  )
}
export function durationText(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600),
    minutes = Math.floor((total % 3600) / 60),
    rest = total % 60
  return hours ? `${hours}h ${minutes}m ${rest}s` : `${minutes}m ${rest}s`
}
export function validateRichValue(column: CustomColumn, value: string) {
  if (column.type === 'checkbox') {
    if (!['true', 'false', ''].includes(value)) throw new Error('Marque ou desmarque o checkbox.')
    return value
  }
  if (column.type === 'last_updated' || column.source?.readOnly)
    throw new Error('Esta coluna é calculada ou preservada da origem e não aceita edição direta.')
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(value)
  } catch {
    throw new Error('O valor estruturado da coluna é inválido.')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Informe um valor estruturado válido.')
  if (column.type === 'timeline') {
    if ([raw.from, raw.to].some((date) => date != null && date !== '' && !isoDate(date)))
      throw new Error('Escolha datas válidas para o cronograma.')
    if (raw.from && raw.to && String(raw.from) > String(raw.to))
      throw new Error('O fim do cronograma deve ser igual ou posterior ao início.')
  }
  if (column.type === 'time_tracking') {
    if (
      typeof raw.duration !== 'number' ||
      !Number.isFinite(raw.duration) ||
      raw.duration < 0 ||
      raw.duration > 1e12
    )
      throw new Error('Informe uma duração válida.')
    if (
      raw.startedAt != null &&
      (typeof raw.startedAt !== 'string' || !Number.isFinite(Date.parse(raw.startedAt)))
    )
      throw new Error('O início do cronômetro é inválido.')
    if (!Array.isArray(raw.sessions) || raw.sessions.length > 10000)
      throw new Error('O histórico do cronômetro é inválido.')
  }
  if (column.type === 'external') {
    const data = jsonObject(raw.value)
    if (column.source?.type === 'link' && data.url && !safeUrl(data.url))
      throw new Error('Use um endereço HTTP ou HTTPS válido.')
    if (
      column.source?.type === 'email' &&
      data.email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))
    )
      throw new Error('Informe um e-mail válido.')
    if (
      column.source?.type === 'rating' &&
      (!Number.isFinite(Number(data.rating)) ||
        Number(data.rating) < 0 ||
        Number(data.rating) > 100)
    )
      throw new Error('Informe uma avaliação válida.')
  }
  return JSON.stringify(raw)
}
