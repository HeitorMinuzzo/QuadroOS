import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A group's table, which scrolls sideways, with its own scrollbar kept at the bottom of the
 * screen while the group is in view (as in monday), instead of only at the end of the group.
 * The bar and the table move together; the task column stays put (see the CSS).
 */
export function GroupScroller({ children }: { children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  /** How far the table scrolls sideways; the bar gets exactly the same range. */
  const [range, setRange] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const element = wrap.current
    if (!element) return
    const measure = () => setRange(Math.max(0, element.scrollWidth - element.clientWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    const table = element.querySelector('table')
    if (table) observer.observe(table)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  // Each side copies the other's position only when they differ, so the echo stops by itself.
  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from) return
    setScrolled(from.scrollLeft > 0)
    if (to && Math.abs(to.scrollLeft - from.scrollLeft) >= 1) to.scrollLeft = from.scrollLeft
  }
  const overflowing = range > 1
  return (
    <>
      <div
        ref={wrap}
        className={`group-table-wrap ${overflowing ? 'has-group-scrollbar' : ''} ${scrolled ? 'is-scrolled-x' : ''}`}
        onScroll={() => follow(wrap.current, bar.current)}
      >
        {children}
      </div>
      {overflowing && (
        <div
          ref={bar}
          className="group-scrollbar"
          aria-hidden="true"
          onScroll={() => follow(bar.current, wrap.current)}
        >
          <div style={{ width: `calc(100% + ${range}px)` }} />
        </div>
      )}
    </>
  )
}
