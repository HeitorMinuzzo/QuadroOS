import { type Task, localDate } from './domain.ts'
import { isoDate, jsonObject } from './rich-values.ts'

/** Count every descendant, including nested subitems, without counting a task twice. */
export function taskDescendantCounts(tasks: Task[]) {
  const byId = new Map(tasks.map((task) => [task.id, task])),
    counts = new Map<string, number>()
  for (const task of tasks) {
    const visited = new Set([task.id])
    let parent = task.parentId ? byId.get(task.parentId) : undefined
    while (parent && parent.boardId === task.boardId && !visited.has(parent.id)) {
      visited.add(parent.id)
      counts.set(parent.id, (counts.get(parent.id) || 0) + 1)
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
    }
  }
  return counts
}

export function summaryDate(value: unknown) {
  if (typeof value !== 'string' || !value) return null
  if (isoDate(value)) return value
  if (!value.includes('T') || !Number.isFinite(Date.parse(value))) return null
  return localDate(new Date(value))
}

export function groupDateRange(tasks: Task[], columnId: string, timeline = false) {
  const dates: string[] = []
  let count = 0
  for (const task of tasks) {
    const raw = columnId === 'date' ? task.dueAt || task.dueDate : task.customValues[columnId]
    const period = timeline ? jsonObject(raw) : null
    const values = (period ? [period.from, period.to] : [raw])
      .map(summaryDate)
      .filter((date): date is string => !!date)
    if (values.length) count++
    dates.push(...values)
  }
  dates.sort()
  return dates.length ? { from: dates[0], to: dates[dates.length - 1], count } : null
}

export function summaryNumber(value: string | undefined) {
  if (!value?.trim()) return null
  const number = Number(value.trim().replace(',', '.'))
  return Number.isFinite(number) ? number : null
}
