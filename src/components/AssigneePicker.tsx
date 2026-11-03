import { useState } from 'react'
import { Search, Users } from 'lucide-react'
import type { Person } from '../../shared/domain'
import { Avatar } from './ui'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { Input } from './ui/input'
import { Button } from './ui/button'

export function AssigneeAvatars({ people, ids }: { people: Person[]; ids: string[] }) {
  const assigned = ids.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p)
  return (
    <span
      className="assignee-avatars"
      title={assigned.map((p) => p.name).join(', ') || 'Sem responsável'}
    >
      {assigned.length ? (
        assigned.slice(0, 3).map((person) => <Avatar key={person.id} person={person} small />)
      ) : (
        <Avatar small />
      )}
      {assigned.length > 3 && <span className="avatar small extra">+{assigned.length - 3}</span>}
    </span>
  )
}

export function AssigneePicker({
  people,
  value,
  label,
  onChange,
  compact = false,
}: {
  people: Person[]
  value: string[]
  label: string
  onChange: (ids: string[]) => Promise<boolean> | void
  compact?: boolean
}) {
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<string[] | null>(null)
  const selected = draft ?? value
  const assigned = people.filter((p) => selected.includes(p.id))
  async function change(ids: string[]) {
    setDraft(ids)
    setBusy(true)
    setError('')
    try {
      if ((await onChange(ids)) === false)
        setError('Não foi possível salvar os responsáveis. Tente novamente.')
    } catch {
      setError('Não foi possível salvar os responsáveis. Tente novamente.')
    } finally {
      setDraft(null)
      setBusy(false)
    }
  }
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) {
          setSearch('')
          setError('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`assignee-trigger ${compact ? 'is-compact' : ''}`}
          aria-label={label}
        >
          <AssigneeAvatars people={people} ids={selected} />
          {!compact && (
            <span className="assignee-caption">
              {assigned.length > 1
                ? `${assigned.length} pessoas`
                : assigned[0]?.name.split(' ')[0] || 'Atribuir'}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="assignee-popover" aria-label={label}>
        <div className="picker-heading">
          <Users size={16} />
          <strong>Responsáveis</strong>
          <span>{selected.length}</span>
        </div>
        <label className="assignee-search">
          <Search size={15} />
          <Input
            aria-label="Buscar responsáveis"
            placeholder="Buscar pessoa…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div
          className="assignee-options"
          role="group"
          aria-label="Selecionar responsáveis"
          aria-busy={busy}
        >
          {people
            .filter((p) =>
              `${p.name} ${p.email}`
                .toLocaleLowerCase('pt-BR')
                .includes(search.toLocaleLowerCase('pt-BR')),
            )
            .map((person) => (
              <label
                key={person.id}
                className="assignee-option"
                data-checked={selected.includes(person.id)}
              >
                <Avatar person={person} small />
                <span>
                  {person.name}
                  <small>{person.email}</small>
                </span>
                <input
                  type="checkbox"
                  aria-label={person.name}
                  checked={selected.includes(person.id)}
                  disabled={busy}
                  onChange={(e) =>
                    void change(
                      e.target.checked
                        ? [...selected, person.id]
                        : selected.filter((id) => id !== person.id),
                    )
                  }
                />
              </label>
            ))}
          {!people.some((p) =>
            `${p.name} ${p.email}`
              .toLocaleLowerCase('pt-BR')
              .includes(search.toLocaleLowerCase('pt-BR')),
          ) && <p className="picker-empty">Nenhuma pessoa encontrada.</p>}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="picker-footer">
          <span>Selecione uma ou mais pessoas</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || !value.length}
            onClick={() => void change([])}
          >
            Limpar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
