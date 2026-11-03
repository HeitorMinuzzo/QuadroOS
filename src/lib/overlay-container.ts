import { createContext } from 'react'

// Native dialogs live in the browser's top layer. Their popovers must portal inside them.
export const OverlayContainer = createContext<HTMLElement | null>(null)
