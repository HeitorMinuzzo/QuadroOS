import { useState } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import type { Board, Task } from '../../shared/domain'
import { localDate } from '../../shared/domain'
import { jsonObject } from '../../shared/rich-values'
import { FieldSelect } from './FieldSelect'
import { Button } from './ui/button'
import { boardColumns } from '../../shared/columns'

function shiftDate(value: string, days: number) {
  const date = new Date(value + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
export function BoardCalendar({
  board,
  tasks,
  onOpenTask,
  onPatch,
}: {
  board: Board
  tasks: Task[]
  onOpenTask: (id: string) => void
  onPatch: (id: string, changes: Partial<Task>) => Promise<boolean>
}) {
  const today = localDate(),
    firstDate = tasks.find((task) => task.dueDate)?.dueDate
  const [month, setMonth] = useState(
    () => new Date((firstDate || today).slice(0, 7) + '-01T12:00:00'),
  )
  const [dateColumn, setDateColumn] = useState('date'),
    [dragging, setDragging] = useState<string | null>(null),
    [error, setError] = useState('')
  const definitions = boardColumns(board).filter((column) =>
    ['date', 'timeline'].includes(column.type),
  )
  const start = new Date(month.getFullYear(), month.getMonth(), 1, 12)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(date.getDate() + index)
    return localDate(date)
  })
  const range = (task: Task) => {
    if (dateColumn === 'date') {
      const day = task.dueAt ? localDate(new Date(task.dueAt)) : task.dueDate
      return { from: day, to: day }
    }
    const definition = definitions.find((column) => column.id === dateColumn),
      value = task.customValues[dateColumn] || ''
    if (definition?.type === 'timeline') {
      const raw = jsonObject(value)
      return {
        from: typeof raw.from === 'string' ? raw.from : null,
        to: typeof raw.to === 'string' ? raw.to : null,
      }
    }
    const day = value.includes('T') ? localDate(new Date(value)) : value.slice(0, 10) || null
    return { from: day, to: day }
  }
  async function move(taskId: string, day: string) {
    const task = tasks.find((task) => task.id === taskId)
    if (!task) return
    const definition = definitions.find((column) => column.id === dateColumn)
    let changes: Partial<Task>
    if (dateColumn === 'date') {
      const instant = task.dueAt ? new Date(task.dueAt) : null
      const time = instant
        ? `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}:${String(instant.getSeconds()).padStart(2, '0')}`
        : null
      changes = { dueDate: day, dueAt: time ? new Date(`${day}T${time}`).toISOString() : null }
    } else if (definition?.type === 'timeline') {
      const previous = range(task),
        duration =
          previous.from && previous.to
            ? Math.round((Date.parse(previous.to) - Date.parse(previous.from)) / 86400000)
            : 0
      changes = {
        customValues: { [dateColumn]: JSON.stringify({ from: day, to: shiftDate(day, duration) }) },
      }
    } else {
      const previous = task.customValues[dateColumn] || '',
        instant = previous.includes('T') ? new Date(previous) : null
      const time = instant
        ? `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`
        : null
      changes = {
        customValues: { [dateColumn]: time ? new Date(`${day}T${time}:00`).toISOString() : day },
      }
    }
    if (!(await onPatch(task.id, changes)))
      setError('Não foi possível mudar a data. Confira se a tarefa foi atualizada em outra janela.')
  }
  return (
    <section className="board-calendar" aria-label="Calendário do quadro">
      <header>
        <div>
          <CalendarDays size={20} />
          <h2>{month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h2>
        </div>
        <div>
          <FieldSelect
            label="Coluna do calendário"
            value={dateColumn}
            onChange={setDateColumn}
            options={definitions.map((column) => ({ value: column.id, label: column.name }))}
          />
          <Button variant="outline" size="sm" onClick={() => setMonth(new Date())}>
            Hoje
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Mês anterior"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Próximo mês"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))}
          >
            <ChevronRight />
          </Button>
        </div>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="calendar-scroll">
        <div
          className="board-calendar-grid"
          role="grid"
          aria-label={month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        >
          <div className="board-calendar-weekdays" role="row">
            {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((label) => (
              <div role="columnheader" key={label}>
                {label}
              </div>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, week) => (
            <div role="row" className="board-calendar-week" key={week}>
              {days.slice(week * 7, week * 7 + 7).map((day) => {
                const date = new Date(day + 'T12:00:00'),
                  entries = tasks.filter((task) => {
                    const value = range(task)
                    return value.from && value.from <= day && (value.to || value.from) >= day
                  })
                return (
                  <div
                    role="gridcell"
                    key={day}
                    aria-label={date.toLocaleDateString('pt-BR')}
                    data-calendar-date={day}
                    data-today={day === today || undefined}
                    data-outside={date.getMonth() !== month.getMonth() || undefined}
                    onDragOver={(event) => {
                      if (dragging) {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (dragging) void move(dragging, day)
                      setDragging(null)
                    }}
                  >
                    <span className="calendar-day-number">{date.getDate()}</span>
                    {entries.map((task) => {
                      const option = board.settings?.statusOptions?.find(
                        (option) => option.label === task.status,
                      )
                      return (
                        <button
                          type="button"
                          key={task.id}
                          draggable
                          onDragStart={(event) => {
                            setDragging(task.id)
                            event.dataTransfer.setData('text/plain', task.id)
                            event.dataTransfer.effectAllowed = 'move'
                          }}
                          onDragEnd={() => setDragging(null)}
                          onClick={() => onOpenTask(task.id)}
                          style={{ borderLeftColor: option?.color || board.color }}
                          title={task.title}
                        >
                          {task.title}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="calendar-hint">
        Abra um item para editar seus detalhes ou arraste-o para outro dia.
      </p>
    </section>
  )
}
