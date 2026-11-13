import { useState, type FormEvent } from 'react'
import { ArrowLeft, FolderInput, Plus, Trash2, X } from 'lucide-react'
import { api, json } from '../api'
import type { Sector, Workspace } from '../../shared/domain'
import { Avatar, Modal } from './ui'
import { FieldSelect } from './FieldSelect'

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * Administrators organise people in sectors. A board that belongs to a sector gives everyone in
 * it the role chosen in the board's Share dialog.
 */
export function SectorsDialog({
  data,
  onClose,
  onChanged,
}: {
  data: Workspace
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const sectors = data.sectors ?? []
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const boardsIn = (sector: Sector) => data.boards.filter((b) => b.sectorId === sector.id).length
  const current = sectors.find((sector) => sector.id === editing)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setBusy(false)
    }
  }

  function create(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    void run(async () => {
      await api('/sectors', { method: 'POST', body: json({ name: name.trim() }) })
      setName('')
    })
  }

  function fromFolders() {
    void run(async () => {
      const result = await api<{ created: number; assigned: number; members: number }>(
        '/sectors/from-folders',
        { method: 'POST', body: json({ includeBoardMembers: true }) },
      )
      setNotice(
        result.assigned
          ? `${plural(result.created, 'setor criado', 'setores criados')}, ${plural(result.assigned, 'quadro ligado', 'quadros ligados')} e ${plural(result.members, 'pessoa incluída', 'pessoas incluídas')}.`
          : 'Todos os quadros com pasta do monday já estão em um setor.',
      )
    })
  }

  return (
    <Modal
      title={current ? current.name : 'Setores'}
      subtitle={
        current
          ? `${plural(current.memberIds.length, 'pessoa', 'pessoas')} · ${plural(boardsIn(current), 'quadro', 'quadros')}`
          : 'Equipes que recebem acesso aos quadros do setor.'
      }
      onClose={onClose}
      className="users-modal sectors-modal"
    >
      <div className="account-dialog-body">
        {current ? (
          <SectorEditor
            key={current.id}
            sector={current}
            data={data}
            busy={busy}
            onBack={() => setEditing(null)}
            onSave={(changes) =>
              run(async () => {
                await api(`/sectors/${current.id}`, { method: 'PATCH', body: json(changes) })
              })
            }
            onDelete={() =>
              run(async () => {
                await api(`/sectors/${current.id}`, { method: 'DELETE' })
                setEditing(null)
              })
            }
          />
        ) : (
          <>
            <form className="sector-create" onSubmit={create}>
              <label>
                Novo setor
                <input
                  value={name}
                  maxLength={80}
                  placeholder="Ex.: Manutenção"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <button className="button primary" type="submit" disabled={busy || !name.trim()}>
                <Plus size={16} />
                Criar setor
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={fromFolders}
                title="Cria um setor para cada pasta do monday e liga os quadros dela"
              >
                <FolderInput size={16} />
                Criar das pastas do monday
              </button>
            </form>
            {notice && (
              <p className="sector-notice" role="status">
                {notice}
              </p>
            )}
            <ul className="account-list sector-list" aria-label="Setores">
              {sectors.length === 0 && (
                <li className="share-empty">
                  Nenhum setor ainda. Crie um ou use as pastas do monday como ponto de partida.
                </li>
              )}
              {sectors.map((sector) => (
                <li key={sector.id}>
                  <button
                    type="button"
                    className="sector-row"
                    onClick={() => setEditing(sector.id)}
                    aria-label={`Editar setor ${sector.name}`}
                  >
                    <span className="sector-dot" style={{ background: sector.color }} />
                    <span className="account-list-who">
                      <strong>{sector.name}</strong>
                      <span>
                        {plural(sector.memberIds.length, 'pessoa', 'pessoas')} ·{' '}
                        {plural(boardsIn(sector), 'quadro', 'quadros')}
                        {sector.source === 'monday' && ' · pasta do monday'}
                      </span>
                    </span>
                    <span className="sector-avatars" aria-hidden="true">
                      {sector.memberIds.slice(0, 4).map((id) => (
                        <Avatar key={id} person={data.people.find((p) => p.id === id)} small />
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

function SectorEditor({
  sector,
  data,
  busy,
  onBack,
  onSave,
  onDelete,
}: {
  sector: Sector
  data: Workspace
  busy: boolean
  onBack: () => void
  onSave: (changes: { name: string; memberIds: string[] }) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name, setName] = useState(sector.name)
  const [memberIds, setMemberIds] = useState(sector.memberIds)
  const [confirming, setConfirming] = useState(false)
  const people = [...data.people].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const changed = name.trim() !== sector.name || memberIds.join() !== sector.memberIds.join()
  const boards = data.boards.filter((board) => board.sectorId === sector.id)

  return (
    <div className="sector-editor">
      <button type="button" className="text-button" onClick={onBack}>
        <ArrowLeft size={14} />
        Todos os setores
      </button>
      <label className="sector-name">
        Nome do setor
        <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      </label>
      <FieldSelect
        label="Adicionar pessoa ao setor"
        placeholder="Adicionar pessoa…"
        value=""
        onChange={(value) => setMemberIds((previous) => [...previous, value])}
        options={people
          .filter((person) => !memberIds.includes(person.id))
          .map((person) => ({ value: person.id, label: `${person.name} · ${person.email}` }))}
      />
      <ul className="account-list share-members" aria-label={`Pessoas do setor ${sector.name}`}>
        {memberIds.length === 0 && <li className="share-empty">Ninguém neste setor ainda.</li>}
        {memberIds.map((id) => {
          const person = data.people.find((p) => p.id === id)
          return (
            <li key={id} className="sector-member">
              <div className="share-member">
                <Avatar person={person} small />
                <div className="account-list-who">
                  <strong>{person?.name ?? 'Pessoa removida'}</strong>
                  <span>{person?.email}</span>
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remover ${person?.name ?? 'pessoa'} do setor`}
                onClick={() => setMemberIds((previous) => previous.filter((item) => item !== id))}
              >
                <X size={16} />
              </button>
            </li>
          )
        })}
      </ul>
      {boards.length > 0 && (
        <p className="sector-boards">
          <strong>Quadros do setor:</strong> {boards.map((board) => board.name).join(', ')}
        </p>
      )}
      <footer className="sector-editor-footer">
        {confirming ? (
          <span className="sector-confirm">
            Excluir o setor? Os quadros continuam, sem setor.
            <button
              type="button"
              className="button danger-button"
              disabled={busy}
              onClick={() => void onDelete()}
            >
              Excluir
            </button>
            <button type="button" className="button secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </span>
        ) : (
          <button type="button" className="text-button danger" onClick={() => setConfirming(true)}>
            <Trash2 size={14} />
            Excluir setor
          </button>
        )}
        <button
          type="button"
          className="button primary"
          disabled={busy || !changed || !name.trim()}
          onClick={() => void onSave({ name: name.trim(), memberIds })}
        >
          Salvar setor
        </button>
      </footer>
    </div>
  )
}
