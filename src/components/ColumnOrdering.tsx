import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, MoreHorizontal, Pencil } from 'lucide-react'
import type { Board } from '../../shared/domain'
import { boardColumnKeys, orderedColumnKeys } from '../../shared/board-layout'
import { api, json } from '../api'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu'

export function useColumnOrder(
  board: Board | undefined,
  scope: 'tasks' | 'subitems',
  onRefresh: () => Promise<void>,
) {
  const [draft, setDraft] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setDraft(null)
    setError('')
  }, [board?.id])
  const field = scope === 'tasks' ? 'columnOrder' : 'subitemColumnOrder'
  const keys = useMemo(
    () =>
      board
        ? orderedColumnKeys(
            boardColumnKeys(board).filter((key) => key !== 'title'),
            draft ?? board.settings?.[field],
          )
        : [],
    [board, draft, field],
  )
  async function save(next: string[]) {
    if (!board || busy) return
    setDraft(next)
    setBusy(true)
    setError('')
    try {
      await api(`/boards/${board.id}/column-order`, {
        method: 'PATCH',
        body: json({ keys: next, scope }),
      })
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível mover a coluna.')
    } finally {
      setDraft(null)
      setBusy(false)
    }
  }
  return { keys, busy, error, save, scope: `${board?.id}:${scope}` }
}

export function ColumnHeading({
  columnKey,
  label,
  className,
  icon,
  order,
  visibleKeys,
  children,
  onEdit,
}: {
  columnKey: string
  label: string
  className?: string
  icon?: ReactNode
  order: ReturnType<typeof useColumnOrder>
  visibleKeys: string[]
  children?: ReactNode
  onEdit?: () => void
}) {
  const [dropSide, setDropSide] = useState<'before' | 'after' | null>(null)
  const index = visibleKeys.indexOf(columnKey)
  function move(key: string, target: string, after: boolean) {
    if (key === target || !order.keys.includes(key) || !order.keys.includes(target)) return
    const next = order.keys.filter((k) => k !== key)
    next.splice(next.indexOf(target) + Number(after), 0, key)
    void order.save(next)
  }
  return (
    <th
      scope="col"
      aria-label={label}
      className={`${className || ''} reorderable-column`}
      data-column-key={columnKey}
      data-drop-side={dropSide || undefined}
      onDragOver={(e) => {
        if (order.busy || !e.dataTransfer.types.includes('application/x-quadroos-column')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const box = e.currentTarget.getBoundingClientRect()
        setDropSide(e.clientX > box.x + box.width / 2 ? 'after' : 'before')
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropSide(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDropSide(null)
        try {
          const data = JSON.parse(e.dataTransfer.getData('application/x-quadroos-column'))
          if (data.scope === order.scope && !order.busy) {
            const box = e.currentTarget.getBoundingClientRect()
            move(data.key, columnKey, e.clientX > box.x + box.width / 2)
          }
        } catch {
          /* Ignore unrelated browser drops. */
        }
      }}
    >
      <div className="column-heading-content">
        <span
          className="column-heading-label"
          draggable={!order.busy}
          title="Arraste para mudar a posição da coluna"
          onDragStart={(e) => {
            e.stopPropagation()
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData(
              'application/x-quadroos-column',
              JSON.stringify({ key: columnKey, scope: order.scope }),
            )
          }}
          onDragEnd={() => setDropSide(null)}
        >
          {icon}
          <span>{label}</span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="column-position-menu"
              aria-label={`Posição da coluna ${label}`}
              disabled={order.busy}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="column-order-menu">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{label}</DropdownMenuLabel>
              {onEdit && (
                <>
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil />
                    Editar coluna
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                disabled={index <= 0}
                onSelect={() => move(columnKey, visibleKeys[index - 1], false)}
              >
                <ArrowLeft />
                Mover para a esquerda
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index >= visibleKeys.length - 1}
                onSelect={() => move(columnKey, visibleKeys[index + 1], true)}
              >
                <ArrowRight />
                Mover para a direita
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {children}
    </th>
  )
}
