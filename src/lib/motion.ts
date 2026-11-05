// Small, interruptible animations through the Web Animations API. Every helper is a no-op when
// the person asked the system to reduce motion, so callers never need to check it themselves.
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'

export function prefersMotion() {
  return (
    typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function play(
  element: Element | null | undefined,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) {
  if (!element || !prefersMotion() || typeof element.animate !== 'function') return
  element.animate(keyframes, options)
}

/** A screen or panel coming into view: fade in while rising a few pixels. */
export function enter(element: Element | null | undefined, distance = 6) {
  play(
    element,
    [
      { opacity: 0, transform: `translateY(${distance}px)` },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 220, easing: EASE_OUT },
  )
}

/** A label that just changed: a short pop with a ring in its new colour. */
export function pop(element: Element | null | undefined, color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) color = '#0073ea'
  play(
    element,
    [
      { transform: 'scale(0.92)', boxShadow: `0 0 0 0 ${color}99` },
      { transform: 'scale(1.05)', boxShadow: `0 0 0 5px ${color}40`, offset: 0.45 },
      { transform: 'scale(1)', boxShadow: `0 0 0 8px ${color}00` },
    ],
    { duration: 420, easing: EASE_OUT },
  )
}

/** True for records created in the last few seconds, which get an arrival highlight. */
export function justCreated(createdAt: string | undefined) {
  const time = createdAt ? Date.parse(createdAt) : NaN
  return Number.isFinite(time) && Date.now() - time < 5000
}
