import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'

/** Boards with more visible tasks than this mount only the rows near the viewport. */
export const WINDOWED_FROM = 120
/** Rows mounted above and below the viewport, in pixels. */
const OVERSCAN = 900
// Row height before any row is measured; updated from the first rows that render.
let estimate = 41

/**
 * Renders a group's task rows (one `<tbody>` each). Small boards render every row; large ones
 * render only the rows near the viewport and fill the rest with spacer sections of the same
 * height, so scrolling, menus and dialogs stay fast with thousands of tasks. The row that last
 * received focus or a pointer press stays mounted, so editing, menus and dragging keep their row.
 */
export function WindowedRows<T extends { id: string }>({
  items,
  windowed,
  limit,
  colSpan,
  render,
}: {
  items: T[]
  windowed: boolean
  /** Rows to render when the board is not windowed. */
  limit: number
  colSpan: number
  render: (item: T) => ReactNode
}) {
  const topRef = useRef<HTMLTableSectionElement>(null)
  const heights = useRef(new Map<string, number>())
  const [range, setRange] = useState<[number, number]>([0, 0])
  const [pinned, setPinned] = useState<string | null>(null)
  const [, setMeasured] = useState(0)
  const count = items.length
  const tops = new Array<number>(count + 1)
  tops[0] = 0
  for (let index = 0; index < count; index++)
    tops[index + 1] = tops[index] + (heights.current.get(items[index].id) ?? estimate)
  const latest = useRef({ tops, count })
  latest.current = { tops, count }

  const requested = useRef<[number, number]>([0, 0])
  const update = useCallback((urgent = false) => {
    const top = topRef.current
    if (!top) return
    const { tops, count } = latest.current
    const offset = top.getBoundingClientRect().top
    const find = (y: number) => {
      // First row whose bottom edge is below y.
      let low = 0,
        high = count
      while (low < high) {
        const middle = (low + high) >> 1
        if (tops[middle + 1] <= y) low = middle + 1
        else high = middle
      }
      return low
    }
    const span = (margin: number): [number, number] => [
      find(-offset - margin),
      Math.min(count, find(window.innerHeight - offset + margin) + 1),
    ]
    const [visibleStart, visibleEnd] = span(0)
    const [needStart, needEnd] = span(OVERSCAN / 2)
    const [start, end] = span(OVERSCAN)
    const current = requested.current
    const covers = (from: number, to: number) => current[0] <= from && current[1] >= to
    if (covers(needStart, needEnd) && current[0] >= start - 10 && current[1] <= end + 10) return
    const next: [number, number] = [start, end]
    requested.current = next
    // Rows about to scroll into view mount in a transition, without holding up the scroll;
    // only rows already in view (a fast fling, a jump) are mounted right away.
    if (urgent || !covers(visibleStart, visibleEnd)) setRange(next)
    else startTransition(() => setRange(next))
  }, [])

  // Row heights come from a ResizeObserver, so measuring never forces an extra layout.
  const observer = useRef<ResizeObserver | null>(null)
  const observed = useRef(new Set<Element>())
  const placed = useRef<{ count: number } | null>(null)
  const schedule = useRef(() => {})
  useLayoutEffect(() => {
    if (!windowed) {
      observer.current?.disconnect()
      observed.current.clear()
      placed.current = null
      return
    }
    const table = topRef.current?.parentElement
    if (!table) return
    observer.current ??= new ResizeObserver((entries) => {
      let changed = false
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).querySelector<HTMLElement>(
          ':scope > tr[data-task-id]',
        )?.dataset.taskId
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        if (!id || !entry.target.isConnected) continue
        if (Math.abs((heights.current.get(id) ?? estimate) - height) > 0.5) changed = true
        heights.current.set(id, height)
      }
      if (heights.current.size && heights.current.size <= 60) {
        const sorted = [...heights.current.values()].sort((a, b) => a - b)
        estimate = sorted[sorted.length >> 1]
      }
      if (changed) setMeasured((value) => value + 1)
    })
    const present = new Set(table.querySelectorAll(':scope > tbody.sortable-task'))
    for (const section of observed.current)
      if (!present.has(section)) {
        observer.current.unobserve(section)
        observed.current.delete(section)
      }
    for (const section of present)
      if (!observed.current.has(section)) {
        observer.current.observe(section)
        observed.current.add(section)
      }
    // Place the window before the first paint and whenever the rows change; otherwise wait for
    // the next frame, when reading positions does not force a layout.
    if (placed.current?.count !== count) {
      placed.current = { count }
      update(true)
    } else schedule.current()
  })
  useEffect(
    () => () => {
      observer.current?.disconnect()
      observer.current = null
      observed.current.clear()
    },
    [],
  )

  useEffect(() => {
    if (!windowed) return
    const table = topRef.current?.parentElement
    let frame = 0
    const scheduleUpdate = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          update()
        })
    }
    schedule.current = scheduleUpdate
    // Scroll events already arrive once per frame; reacting at once avoids waiting for an
    // animation frame, which background tabs and some previews pause.
    const onScroll = () => update()
    const pin = (event: Event) => {
      let section = (event.target as Element | null)?.closest?.('tbody') ?? null
      while (section && section.parentElement !== table)
        section = section.parentElement?.closest('tbody') ?? null
      const id = section?.querySelector<HTMLElement>(':scope > tr[data-task-id]')?.dataset.taskId
      if (id) setPinned(id)
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onScroll)
    table?.addEventListener('focusin', pin)
    table?.addEventListener('pointerdown', pin)
    return () => {
      cancelAnimationFrame(frame)
      schedule.current = () => {}
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
      table?.removeEventListener('focusin', pin)
      table?.removeEventListener('pointerdown', pin)
    }
  }, [windowed, update])

  if (!windowed) return <>{items.slice(0, limit).map(render)}</>
  const start = Math.min(range[0], count),
    end = Math.min(Math.max(range[1], start), count)
  const indexes: number[] = []
  const pinnedIndex = pinned ? items.findIndex((item) => item.id === pinned) : -1
  if (pinnedIndex >= 0 && pinnedIndex < start) indexes.push(pinnedIndex)
  for (let index = start; index < end; index++) indexes.push(index)
  if (pinnedIndex >= end) indexes.push(pinnedIndex)
  // The first spacer is always present: its position tells where the group's rows begin.
  let cursor = indexes[0] ?? count
  const output: ReactNode[] = [spacer('top', tops[cursor], colSpan, topRef)]
  for (const index of indexes) {
    if (index > cursor) output.push(spacer(`gap-${cursor}`, tops[index] - tops[cursor], colSpan))
    output.push(render(items[index]))
    cursor = index + 1
  }
  if (cursor < count) output.push(spacer('end', tops[count] - tops[cursor], colSpan))
  return <>{output}</>
}

function spacer(key: string, height: number, colSpan: number, ref?: Ref<HTMLTableSectionElement>) {
  return (
    <tbody key={key} ref={ref} className="virtual-rows-spacer" aria-hidden="true">
      <tr>
        <td colSpan={colSpan} style={{ height }} />
      </tr>
    </tbody>
  )
}
