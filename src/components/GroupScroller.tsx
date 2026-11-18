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

  // Whichever side the person scrolls leads until it stops; the other only follows. Copying
  // back and forth made both sides nudge each other on scaled screens (fractional pixels),
  // which felt like a stuck scroll.
  const leader = useRef<'wrap' | 'bar' | null>(null)
  const release = useRef<ReturnType<typeof setTimeout>>(undefined)
  const shadow = useRef(false)
  const follow = (side: 'wrap' | 'bar') => {
    if (leader.current && leader.current !== side) return
    leader.current = side
    clearTimeout(release.current)
    release.current = setTimeout(() => (leader.current = null), 120)
    const from = side === 'wrap' ? wrap.current : bar.current
    const to = side === 'wrap' ? bar.current : wrap.current
    if (!from) return
    if (to) to.scrollLeft = from.scrollLeft
    // The edge shadow is a class toggled straight on the element: no React render per frame.
    const scrolled = from.scrollLeft > 0
    if (scrolled !== shadow.current) {
      shadow.current = scrolled
      wrap.current?.classList.toggle('is-scrolled-x', scrolled)
    }
  }
  useEffect(() => () => clearTimeout(release.current), [])
  // React rewrites the class when the bar appears or goes; keep the shade in step.
  useEffect(() => {
    wrap.current?.classList.toggle('is-scrolled-x', shadow.current)
  })

  const overflowing = range > 1
  return (
    <>
      <div
        ref={wrap}
        className={`group-table-wrap ${overflowing ? 'has-group-scrollbar' : ''}`}
        onScroll={() => follow('wrap')}
      >
        {children}
      </div>
      {overflowing && (
        <div
          ref={bar}
          className="group-scrollbar"
          aria-hidden="true"
          onScroll={() => follow('bar')}
        >
          <div style={{ width: `calc(100% + ${range}px)` }} />
        </div>
      )}
    </>
  )
}
