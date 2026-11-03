import { useEffect, useState } from 'react'
import type { Board, CustomColumn, Task, Workspace } from '../../shared/domain'
import { taskOwnerIds } from '../../shared/domain'
import { boardColumns, columnList } from '../../shared/columns'
import { evaluateFormula } from '../../shared/formulas'
import { groupDateRange, summaryNumber } from '../../shared/group-summary'
import { durationText, jsonObject, secondsNow, timeValue } from '../../shared/rich-values'
import { SummarySegment } from './SummarySegment'
import { AssigneeAvatars } from './AssigneePicker'

const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 10 })
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
})
const fullDateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' })
const dateObject = (value: string) => new Date(value + 'T12:00:00')

export function GroupColumnSummary({
  column,
  tasks,
  board,
  people,
  attachments = [],
  overview = false,
}: {
  column: CustomColumn
  tasks: Task[]
  board: Board
  people: Workspace['people']
  attachments?: Workspace['attachments']
  overview?: boolean
}) {
  const hasRunningTimer =
    overview &&
    column.type === 'time_tracking' &&
    tasks.some((task) => !!timeValue(task.customValues[column.id] || '').startedAt)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!hasRunningTimer) return
    const interval = window.setInterval(() => setTick((tick) => tick + 1), 1000)
    return () => window.clearInterval(interval)
  }, [hasRunningTimer])

  if (column.type === 'status') {
    const options = column.options || [],
      counts = new Map<string, number>()
    for (const task of tasks) {
      const value =
        column.id === 'status' || column.id === 'priority'
          ? task[column.id]
          : task.customValues[column.id] || ''
      counts.set(value, (counts.get(value) || 0) + 1)
    }
    const segments = [
      ...options.map((option) => ({ ...option, count: counts.get(option.label) || 0 })),
      ...[...counts]
        .filter(([value]) => !options.some((option) => option.label === value))
        .map(([value, count]) => ({
          id: `other-${value}`,
          label: value || 'Sem etiqueta',
          color: '#798099',
          count,
        })),
    ].filter((option) => option.count > 0)
    return (
      <div
        className="monday-summary-bar"
        role="group"
        aria-label={
          column.id === 'status'
            ? 'Distribuição de status'
            : column.id === 'priority'
              ? 'Distribuição de prioridade'
              : `Distribuição de ${column.name}`
        }
      >
        {segments.map((option) => (
          <SummarySegment
            key={option.id || option.label}
            label={option.label}
            color={option.color}
            count={option.count}
            total={tasks.length}
            columnName={column.name}
          />
        ))}
      </div>
    )
  }
  if (!overview) return null

  if (column.type === 'date' || column.type === 'timeline') {
    const range = groupDateRange(tasks, column.id, column.type === 'timeline')
    if (!range) return <span className="group-summary-empty">Sem datas</span>
    const short = (value: string, year = true) => {
      const parts = dateFormatter.formatToParts(dateObject(value))
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value || ''
      return `${part('day')} ${part('month').replace('.', '')}${year ? ` '${part('year')}` : ''}`
    }
    const text =
      range.from === range.to
        ? short(range.from)
        : `${short(range.from, range.from.slice(0, 4) !== range.to.slice(0, 4))} – ${short(range.to)}`
    const description = `${range.count} ${range.count === 1 ? 'tarefa com data' : 'tarefas com datas'}: ${fullDateFormatter.format(dateObject(range.from))} a ${fullDateFormatter.format(dateObject(range.to))}`
    return (
      <span className="group-summary-date" title={description} aria-label={description}>
        {text}
      </span>
    )
  }
  if (column.type === 'number' || column.type === 'formula') {
    let sum = 0,
      count = 0,
      errors = 0
    const definitions = column.type === 'formula' ? boardColumns(board) : []
    for (const task of tasks) {
      const result = column.type === 'formula' ? evaluateFormula(column, definitions, task) : null
      if (result?.error) {
        errors++
        continue
      }
      const value = result
        ? typeof result.value === 'number'
          ? result.value
          : null
        : summaryNumber(task.customValues[column.id])
      if (value !== null) {
        sum += value
        count++
      }
    }
    if (column.type === 'formula' && tasks.length > 0 && !count && !errors)
      return <span className="group-summary-empty">Sem valores numéricos</span>
    const unit = jsonObject(column.source?.settings?.unit)
    const symbol =
      unit.symbol === 'custom' ? String(unit.custom_unit || '') : String(unit.symbol || '')
    const value = count || !errors ? numberFormatter.format(sum) : '—'
    return (
      <div
        className="group-summary-total"
        title={errors ? `${errors} resultado(s) com erro não incluído(s) na soma` : undefined}
      >
        <span>
          {unit.direction !== 'right' && symbol ? symbol + ' ' : ''}
          {value}
          {unit.direction === 'right' && symbol ? ' ' + symbol : ''}
        </span>
        <small>{errors ? `Total · ${errors} com erro` : 'Total'}</small>
      </div>
    )
  }
  if (column.type === 'files') {
    const ids = new Set(tasks.map((task) => task.id))
    const count = attachments.filter(
      (file) => ids.has(file.taskId) && file.columnId === column.id,
    ).length
    return (
      <div className="group-summary-total">
        <span>{count}</span>
        <small>{count === 1 ? 'Arquivo' : 'Arquivos'}</small>
      </div>
    )
  }
  if (column.type === 'people') {
    const ids = [
      ...new Set(
        tasks.flatMap((task) =>
          column.id === 'owner'
            ? taskOwnerIds(task)
            : columnList(task.customValues[column.id] || ''),
        ),
      ),
    ]
    return ids.length ? <AssigneeAvatars people={people} ids={ids} /> : null
  }
  if (column.type === 'checkbox') {
    const checked = tasks.filter((task) => task.customValues[column.id] === 'true').length
    return (
      <div className="group-summary-total">
        <span>
          {checked}/{tasks.length}
        </span>
        <small>Marcados</small>
      </div>
    )
  }
  if (column.type === 'time_tracking') {
    const total = tasks.reduce(
      (sum, task) => sum + secondsNow(timeValue(task.customValues[column.id] || '')),
      0,
    )
    return (
      <div className="group-summary-total">
        <span>{durationText(total)}</span>
        <small>{hasRunningTimer ? 'Total · em curso' : 'Total'}</small>
      </div>
    )
  }
  return null
}
