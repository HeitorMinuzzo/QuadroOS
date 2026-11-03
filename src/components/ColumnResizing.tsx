import { useEffect, useRef, useState } from 'react'
import type { Board } from '../../shared/domain'
import { columnLayout } from '../../shared/board-layout'

export function useColumnWidths(
  board: Board,
  keys: string[],
  active: boolean,
  onSave: (boardId: string, widths: Record<string, number>) => Promise<boolean>,
) {
  const ref = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)
  const [draft, setDraft] = useState<Record<string, number> | null>(null)
  const revision = useRef(0)
  useEffect(() => {
    setDraft(null)
    revision.current++
  }, [board.id])
  useEffect(() => {
    const element = ref.current
    if (!element || !active) return
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width - 5))
    observer.observe(element)
    return () => observer.disconnect()
  }, [active, board.id])
  const saved = board.settings?.columnWidths || {}
  const widths: Record<string, number> = Object.fromEntries(
    keys.map((key) => {
      const layout = columnLayout(key)
      return [
        key,
        Math.max(layout.min, Math.min(layout.max, draft?.[key] ?? saved[key] ?? layout.width)),
      ]
    }),
  )
  if (!draft?.title && !saved.title)
    widths.title = Math.min(
      1200,
      Math.max(
        widths.title,
        available - 69 - keys.filter((k) => k !== 'title').reduce((sum, k) => sum + widths[k], 0),
      ),
    )
  async function save(next: Record<string, number>) {
    const current = ++revision.current
    setDraft(next)
    await onSave(board.id, next)
    if (revision.current === current) setDraft(null)
  }
  return {
    ref,
    widths,
    total: 69 + keys.reduce((sum, key) => sum + widths[key], 0),
    preview: setDraft,
    save,
  }
}

export function ColumnResizeHandle({
  columnKey,
  label,
  widths,
  onPreview,
  onSave,
}: {
  columnKey: string
  label: string
  widths: Record<string, number>
  onPreview: (widths: Record<string, number> | null) => void
  onSave: (widths: Record<string, number>) => Promise<void>
}) {
  const gesture = useRef<{
    start: number
    widths: Record<string, number>
    next: Record<string, number>
  } | null>(null)
  const { min, max, width: defaultWidth } = columnLayout(columnKey)
  const width = widths[columnKey]
  const clamp = (value: number) => Math.max(min, Math.min(max, Math.round(value)))
  useEffect(
    () => () => {
      document.body.classList.remove('resizing-columns')
    },
    [],
  )
  function cancel() {
    if (!gesture.current) return
    gesture.current = null
    document.body.classList.remove('resizing-columns')
    onPreview(null)
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault()
        event.stopPropagation()
        cancel()
      }
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  })
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Redimensionar coluna ${label}`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      tabIndex={0}
      className="column-resize-handle"
      title="Arraste para redimensionar · Setas para ajustar · Dois cliques para restaurar"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        gesture.current = { start: event.clientX, widths: { ...widths }, next: { ...widths } }
        document.body.classList.add('resizing-columns')
      }}
      onPointerMove={(event) => {
        const current = gesture.current
        if (!current) return
        current.next = {
          ...current.widths,
          [columnKey]: clamp(current.widths[columnKey] + event.clientX - current.start),
        }
        onPreview(current.next)
      }}
      onPointerUp={(event) => {
        const current = gesture.current
        if (!current) return
        gesture.current = null
        document.body.classList.remove('resizing-columns')
        event.currentTarget.releasePointerCapture(event.pointerId)
        if (current.next[columnKey] === current.widths[columnKey]) onPreview(null)
        else void onSave(current.next)
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onDoubleClick={(event) => {
        event.stopPropagation()
        void onSave({ ...widths, [columnKey]: defaultWidth })
      }}
      onKeyDown={(event) => {
        const next =
          event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : event.key === 'ArrowLeft'
                ? width - 10
                : event.key === 'ArrowRight'
                  ? width + 10
                  : null
        if (next === null) return
        event.preventDefault()
        event.stopPropagation()
        void onSave({ ...widths, [columnKey]: clamp(next) })
      }}
    />
  )
}
