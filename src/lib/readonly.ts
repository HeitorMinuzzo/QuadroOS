import { createContext, useContext } from 'react'

/**
 * True inside a board the signed-in person may see but not change. Editable areas become
 * `inert` (visible, not interactive) and creation controls are hidden; the server enforces the
 * same rule, so this only keeps the interface honest.
 */
export const ReadOnlyContext = createContext(false)
export const useReadOnly = () => useContext(ReadOnlyContext)
