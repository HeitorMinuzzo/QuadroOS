import { useMemo, useState } from 'react'
import { Globe, Lock, X } from 'lucide-react'
import { api, json } from '../api'
import type { Board, BoardMember, BoardRole, BoardVisibility, Person } from '../../shared/domain'
import { Avatar, Modal } from './ui'
import { FieldSelect } from './FieldSelect'
import { useSession } from '../lib/session'

const ROLES: { value: BoardRole; label: string }[] = [
  { value: 'owner', label: 'Dono' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Leitor' },
]

/** Visibility and members of one board, for its owners and administrators. */
export function ShareDialog({
  board,
  people,
  onClose,
  onSaved,
}: {
  board: Board
  people: Person[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { personId, session } = useSession()
  const [visibility, setVisibility] = useState<BoardVisibility>(board.visibility ?? 'public')
  const [members, setMembers] = useState<BoardMember[]>(board.members ?? [])
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])
  const candidates = people
    .filter((person) => !members.some((member) => member.personId === person.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((person) => ({ value: person.id, label: `${person.name} · ${person.email}` }))

  async function save() {
    setBusy(true)
    setError('')
    try {
      await api(`/boards/${board.id}/access`, {
        method: 'PUT',
        body: json({ visibility, members }),
      })
      await onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar o acesso.')
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Compartilhar “${board.name}”`}
      subtitle="Quem pode ver e editar este quadro."
      onClose={onClose}
      className="share-modal"
    >
      <div className="account-dialog-body">
        <div className="share-visibility" role="radiogroup" aria-label="Visibilidade">
          {(
            [
              [
                'public',
                Globe,
                'Público',
                'Todas as contas veem; membros e administradores editam.',
              ],
              ['private', Lock, 'Privado', 'Somente os membros abaixo (e administradores) veem.'],
            ] as const
          ).map(([value, Icon, title, detail]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={visibility === value}
              className={visibility === value ? 'active' : ''}
              onClick={() => setVisibility(value)}
            >
              <Icon size={18} />
              <span>
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="share-add">
          <FieldSelect
            label="Adicionar pessoa ao quadro"
            placeholder="Adicionar pessoa…"
            value={adding}
            onChange={(value) => {
              setMembers((previous) => [...previous, { personId: value, role: 'editor' }])
              setAdding('')
            }}
            options={candidates}
          />
        </div>

        <ul className="account-list share-members" aria-label="Membros do quadro">
          {members.length === 0 && (
            <li className="share-empty">
              {visibility === 'public'
                ? 'Sem membros: o quadro segue aberto para todas as contas.'
                : 'Adicione ao menos um dono.'}
            </li>
          )}
          {members.map((member) => {
            const person = byId.get(member.personId)
            return (
              <li key={member.personId}>
                <div className="share-member">
                  <Avatar person={person} small />
                  <div className="account-list-who">
                    <strong>
                      {person?.name ?? 'Pessoa removida'}
                      {member.personId === personId && session.account && <small> (você)</small>}
                    </strong>
                    <span>{person?.email}</span>
                  </div>
                </div>
                <FieldSelect
                  label={`Papel de ${person?.name ?? 'membro'} no quadro`}
                  value={member.role}
                  onChange={(value) =>
                    setMembers((previous) =>
                      previous.map((item) =>
                        item.personId === member.personId
                          ? { ...item, role: value as BoardRole }
                          : item,
                      ),
                    )
                  }
                  options={ROLES}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remover ${person?.name ?? 'membro'} do quadro`}
                  onClick={() =>
                    setMembers((previous) =>
                      previous.filter((item) => item.personId !== member.personId),
                    )
                  }
                >
                  <X size={16} />
                </button>
              </li>
            )
          })}
        </ul>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="modal-footer">
        <button className="button secondary" type="button" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="button primary"
          type="button"
          disabled={busy}
          onClick={() => void save()}
        >
          Salvar acesso
        </button>
      </footer>
    </Modal>
  )
}
