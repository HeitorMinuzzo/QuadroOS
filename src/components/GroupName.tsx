import { useLayoutEffect, useRef, useState } from 'react'
import { api, json } from '../api'
import { Input } from './ui/input'

export function GroupName({
  id,
  name,
  editable,
  onRefresh,
}: {
  id: string
  name: string
  editable: boolean
  onRefresh: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const saving = useRef(false)
  const cancelled = useRef(false)
  const restoreFocus = useRef(false)
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    } else if (restoreFocus.current) {
      button.current?.focus()
      restoreFocus.current = false
    }
  }, [editing])
  async function save(fromKeyboard = false) {
    if (cancelled.current || saving.current) return
    const value = draft.trim()
    if (!value) {
      setError('Informe o nome do grupo.')
      return
    }
    if (value === name) {
      restoreFocus.current = fromKeyboard
      setEditing(false)
      setError('')
      return
    }
    saving.current = true
    setBusy(true)
    setError('')
    try {
      await api(`/groups/${id}`, { method: 'PATCH', body: json({ name: value }) })
      await onRefresh()
      restoreFocus.current = fromKeyboard
      setEditing(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível salvar o nome.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  if (!editable) return <span>{name}</span>
  return (
    <>
      {editing ? (
        <Input
          ref={input}
          className="group-name-input"
          value={draft}
          disabled={busy}
          aria-label={`Nome do grupo ${name}`}
          aria-invalid={!!error}
          aria-describedby={error ? `group-name-error-${id}` : undefined}
          maxLength={300}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void save(true)
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelled.current = true
              restoreFocus.current = true
              setEditing(false)
              setError('')
            }
          }}
        />
      ) : (
        <button
          ref={button}
          type="button"
          className="group-name-button"
          title="Clique para editar o nome"
          aria-label={`Editar nome do grupo ${name}`}
          onClick={() => {
            cancelled.current = false
            setDraft(name)
            setError('')
            setEditing(true)
          }}
        >
          {name}
        </button>
      )}
      {error && (
        <span id={`group-name-error-${id}`} className="group-name-error" role="alert">
          {error}
        </span>
      )}
    </>
  )
}
