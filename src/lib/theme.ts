import { useCallback, useEffect, useState } from 'react'

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

/** Mirrors public/theme-init.js, which applies the theme before the first paint. */
export function applyTheme(theme: 'light' | 'dark') {
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
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
  const choose = useCallback((next: ThemePreference) => {
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
