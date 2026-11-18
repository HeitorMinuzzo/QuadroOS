import { useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react'

const INTERACTIVE =
  'button, a, input, textarea, select, label, [role="button"], [role="menu"], [role="option"], [contenteditable="true"], .kanban-card'

/**
 * Lets the user pan a horizontally scrollable area by holding the mouse on an
 * empty spot and dragging, instead of hunting for the scrollbar at the bottom.
 */
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const cleanup = useRef<(() => void) | null>(null)

  const onMouseDown = useCallback((event: ReactMouseEvent<T>) => {
    const el = ref.current
    if (!el || event.button !== 0) return
    if ((event.target as Element).closest(INTERACTIVE)) return
    if (el.scrollWidth <= el.clientWidth) return

    event.preventDefault()
    cleanup.current?.()
    const startX = event.clientX
    const startLeft = el.scrollLeft
    el.classList.add('is-drag-scrolling')

    const move = (e: MouseEvent) => {
      el.scrollLeft = startLeft - (e.clientX - startX)
    }
    const stop = () => {
      el.classList.remove('is-drag-scrolling')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
      window.removeEventListener('blur', stop)
      cleanup.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
    window.addEventListener('blur', stop)
    cleanup.current = stop
  }, [])

  return { ref, onMouseDown }
}
