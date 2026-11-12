export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body != null && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    },
  })
  if (!response.ok) {
    // An expired or missing session sends the app back to sign-in (see src/lib/session.tsx).
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('quadroos:unauthorized'))
    const error = await response
      .json()
      .catch(() => ({ message: 'O servidor não respondeu. Tente novamente.' }))
    throw new ApiError(error.message || 'Não foi possível concluir a solicitação.', response.status)
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>)
}
export const json = (value: unknown) => JSON.stringify(value)
