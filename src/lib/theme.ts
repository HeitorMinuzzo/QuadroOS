import { useCallback, useEffect, useState } from 'react'
import { prefersMotion } from './motion'

export type ThemePreference = 'light' | 'dark' | 'system'
const KEY = 'quadroos:theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'dark' || value === 'system' ? value : 'light'
  } catch {
    return 'light'
  }
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  return preference === 'dark' || (preference === 'system' && media().matches) ? 'dark' : 'light'
}

// The theme most recently asked for. A skipped view transition still runs its update late, so
// updates apply this instead of the theme captured when they started.
let wanted: 'light' | 'dark' | null = null

/** Mirrors public/theme-init.js, which applies the theme before the first paint. */
export function applyTheme(theme: 'light' | 'dark') {
  wanted = theme
  paint(theme)
}
function paint(theme: 'light' | 'dark') {
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> }
}
let switching: ReturnType<typeof setTimeout> | undefined
/**
 * Switches theme with the new one spreading in a circle from `origin` (the button that was
 * clicked). Falls back to an instant switch without View Transitions, with reduced motion or
 * in a hidden tab.
 */
function applyThemeFrom(theme: 'light' | 'dark', origin?: { x: number; y: number }) {
  const doc = document as TransitionDocument
  const root = document.documentElement
  wanted = theme
  if (
    root.dataset.theme === theme ||
    !doc.startViewTransition ||
    !prefersMotion() ||
    document.visibilityState !== 'visible'
  ) {
    paint(theme)
    return
  }
  root.style.setProperty('--theme-x', `${origin?.x ?? window.innerWidth}px`)
  root.style.setProperty('--theme-y', `${origin?.y ?? 0}px`)
  root.classList.add('theme-switching')
  const done = () => {
    clearTimeout(switching)
    root.classList.remove('theme-switching')
    if (wanted) paint(wanted)
  }
  // The class also turns off the rows' own transitions, so it never outlives the reveal.
  clearTimeout(switching)
  switching = setTimeout(done, 1000)
  doc
    .startViewTransition(() => paint(wanted ?? theme))
    .finished.catch(() => undefined)
    .finally(done)
}

export function useTheme() {
  const [preference, setPreference] = useState(readThemePreference)
  const [resolved, setResolved] = useState(() => resolveTheme(preference))
  useEffect(() => {
    const update = () => {
      const next = resolveTheme(preference)
      setResolved(next)
      applyTheme(next)
    }
    update()
    if (preference !== 'system') return
    const query = media()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [preference])
  const choose = useCallback((next: ThemePreference, origin?: { x: number; y: number }) => {
    applyThemeFrom(resolveTheme(next), origin)
    setPreference(next)
    try {
      if (next === 'light') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch {
      // The theme still applies to this visit.
    }
  }, [])
  return { preference, resolved, choose }
}
