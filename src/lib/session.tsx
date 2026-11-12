import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import type { SessionInfo } from '../../shared/domain'

/** Fired by the API client when the server answers 401, so the app returns to sign-in. */
export const UNAUTHORIZED_EVENT = 'quadroos:unauthorized'
const LOCAL_PROFILE = 'person-you'

interface SessionContext {
  session: SessionInfo
  /** The signed-in person; the local profile when sign-in is off. */
  personId: string
  refresh: () => Promise<void>
}
const Context = createContext<SessionContext>({
  session: { mode: 'none', needsSetup: false, account: null, personId: LOCAL_PROFILE },
  personId: LOCAL_PROFILE,
  refresh: async () => undefined,
})

export function useSession() {
  return useContext(Context)
}
/** The id of the person using the app, for "my tasks", authorship and likes. */
export function useMe() {
  return useContext(Context).personId
}

export function SessionProvider({
  children,
  fallback,
}: {
  children: (session: SessionInfo) => ReactNode
  fallback: ReactNode
}) {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      setSession(await api<SessionInfo>('/auth/session'))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível conectar ao QuadroOS.')
    }
  }, [])
  useEffect(() => {
    void refresh()
    const expired = () => void refresh()
    window.addEventListener(UNAUTHORIZED_EVENT, expired)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, expired)
  }, [refresh])
  if (!session)
    return error ? (
      <div className="auth-screen" role="alert">
        <p>{error}</p>
        <button className="button primary" onClick={() => void refresh()}>
          Tentar novamente
        </button>
      </div>
    ) : (
      fallback
    )
  return (
    <Context.Provider value={{ session, personId: session.personId ?? LOCAL_PROFILE, refresh }}>
      {children(session)}
    </Context.Provider>
  )
}
