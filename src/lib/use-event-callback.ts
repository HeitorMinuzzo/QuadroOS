import { useCallback, useLayoutEffect, useRef } from 'react'

// Event handlers keep their identity without retaining an older board or task snapshot.
export function useEventCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
) {
  const latest = useRef(callback)
  useLayoutEffect(() => {
    latest.current = callback
  })
  return useCallback((...args: Args) => latest.current(...args), [])
}
