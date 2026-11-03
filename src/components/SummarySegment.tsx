import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from './ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

export function SummarySegment({
  label,
  color,
  count,
  total,
  columnName,
}: {
  label: string
  color: string
  count: number
  total: number
  columnName: string
}) {
  const [touchMode, setTouchMode] = useState(() => window.matchMedia('(hover: none)').matches)
  useEffect(() => {
    const media = window.matchMedia('(hover: none)')
    const sync = () => setTouchMode(media.matches)
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  const percentage = (count / total) * 100
  const trigger = (
    <button
      type="button"
      className="monday-summary-segment"
      style={{ width: `${percentage}%`, backgroundColor: color }}
      aria-label={`${label}: ${count} ${count === 1 ? 'item' : 'itens'} (${Math.round(percentage)}%)`}
    />
  )
  const content = (
    <>
      <span className="summary-tooltip-caption">{columnName}</span>
      <div className="summary-tooltip-label">
        <i style={{ background: color }} aria-hidden="true" />
        <strong>{label}</strong>
        <span>{Math.round(percentage)}%</span>
      </div>
      <div className="summary-tooltip-count">
        <strong>{count}</strong>
        <span>
          {count === 1 ? 'item' : 'itens'} de {total} no grupo
        </span>
      </div>
      <div className="summary-tooltip-track">
        <i style={{ width: `${percentage}%`, background: color }} />
      </div>
    </>
  )
  if (touchMode)
    return (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          className="summary-tooltip"
          side="top"
          sideOffset={12}
          collisionPadding={12}
          aria-label={`${columnName}: ${label}`}
        >
          {content}
        </PopoverContent>
      </Popover>
    )
  return (
    // Keep each segment's hover corridor independent so a fast move can open its neighbor.
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent
          className="summary-tooltip"
          side="top"
          sideOffset={12}
          collisionPadding={12}
          showArrow={false}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
