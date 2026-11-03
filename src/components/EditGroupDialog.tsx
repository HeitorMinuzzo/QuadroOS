import { useState } from 'react'
import { Check, Layers3, LoaderCircle } from 'lucide-react'
import { type Group } from '../../shared/domain'
import { api, json } from '../api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'

const colors = [
  ['Verde', '#377f68'],
  ['Azul', '#6f80be'],
  ['Roxo', '#8b79bd'],
  ['Rosa', '#bf6e91'],
  ['Laranja', '#c2884e'],
  ['Vermelho', '#b75a5a'],
]
export function EditGroupDialog({
  group,
  onClose,
  onSaved,
}: {
  group: Group
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState(group.name)
  const [color, setColor] = useState(group.color)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    setBusy(true)
    setError('')
    try {
      await api(`/groups/${group.id}`, {
        method: 'PATCH',
        body: json({ name: name.trim(), color }),
      })
      await onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar o grupo.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="group-editor sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          document.getElementById(`group-menu-${group.id}`)?.focus()
        }}
      >
        <DialogHeader>
          <span
            className="group-editor-icon"
            style={{ color, background: `color-mix(in srgb, ${color} 12%, white)` }}
          >
            <Layers3 size={22} />
          </span>
          <DialogTitle>Editar grupo</DialogTitle>
          <DialogDescription>Um nome e uma cor para organizar suas entregas.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          className="grid gap-5"
        >
          <div className="grid gap-2">
            <label htmlFor="group-name">Nome do grupo</label>
            <Input
              id="group-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={300}
              disabled={busy}
            />
          </div>
          <fieldset className="grid gap-3">
            <legend>Cor do grupo</legend>
            <div className="group-color-options">
              {colors.map(([label, value]) => (
                <button
                  type="button"
                  key={value}
                  aria-label={label}
                  aria-pressed={color === value}
                  style={{ background: value }}
                  onClick={() => setColor(value)}
                  disabled={busy}
                >
                  {color === value && <Check size={17} />}
                </button>
              ))}
              <label className="custom-group-color" title="Escolher outra cor">
                <input
                  aria-label="Cor personalizada"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  disabled={busy}
                />
              </label>
            </div>
          </fieldset>
          <div className="group-preview">
            <i style={{ background: color }} />
            <strong>{name.trim() || 'Nome do grupo'}</strong>
            <span>Prévia</span>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <LoaderCircle className="spin" /> : <Check />}Salvar alterações
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
