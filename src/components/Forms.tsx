import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { api, json } from '../api'
import { type Board, type Workspace, type Status, STATUSES, PRIORITIES } from '../../shared/domain'
import { Modal, SubmitButton, PillSelect } from './ui'
import { AssigneePicker } from './AssigneePicker'
import { DatePicker } from './DatePicker'
import { FieldSelect } from './FieldSelect'

export function CreateTask({
  board,
  data,
  groupId,
  initialStatus,
  onClose,
  onCreated,
}: {
  board: Board
  data: Workspace
  groupId?: string
  initialStatus?: Status
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const groups = data.groups.filter((g) => g.boardId === board.id)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [group, setGroup] = useState(groupId || groups[0]?.id || '')
  const [status, setStatus] = useState<string>(
    initialStatus ?? (board.settings?.monday ? '' : 'Não iniciado'),
  )
  const [priority, setPriority] = useState(board.settings?.monday ? '' : 'Média')
  const [ownerIds, setOwnerIds] = useState<string[]>(['person-you'])
  const [dueDate, setDueDate] = useState('')
  const [dueAt, setDueAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit() {
    setBusy(true)
    setError('')
    try {
      await api('/tasks', {
        method: 'POST',
        body: json({
          boardId: board.id,
          groupId: group,
          title,
          description,
          status,
          priority,
          ownerIds,
          dueDate: dueDate || null,
          dueAt,
        }),
      })
      await onCreated()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível criar a tarefa.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Nova tarefa" subtitle={`Nova tarefa em ${board.name}`} onClose={onClose}>
      <form
        className="standard-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {error && (
          <p className="form-error" role="alert">
            <AlertCircle size={16} />
            {error}
          </p>
        )}
        <label htmlFor="task-title">O que precisa acontecer?</label>
        <input
          id="task-title"
          placeholder="Dê um nome para sua tarefa"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={300}
          autoFocus
        />
        <div className="form-grid">
          <label>
            Grupo
            <FieldSelect
              label="Grupo da nova tarefa"
              value={group}
              onChange={setGroup}
              required
              heading="Grupos do quadro"
              options={groups.map((g) => ({ value: g.id, label: g.name, color: g.color }))}
            />
          </label>
          <div className="grid gap-2">
            <span>Responsáveis</span>
            <AssigneePicker
              people={data.people}
              value={ownerIds}
              label="Responsáveis da nova tarefa"
              onChange={setOwnerIds}
            />
          </div>
          <div className="grid gap-2">
            <span>Status</span>
            <PillSelect
              label="Status da nova tarefa"
              value={status}
              options={STATUSES}
              customOptions={board.settings?.statusOptions}
              onChange={setStatus}
            />
          </div>
          <div className="grid gap-2">
            <span>Prioridade</span>
            <PillSelect
              label="Prioridade da nova tarefa"
              value={priority}
              options={PRIORITIES}
              customOptions={board.settings?.priorityOptions}
              onChange={setPriority}
            />
          </div>
        </div>
        <span>
          Prazo <span className="optional">opcional</span>
        </span>
        <DatePicker
          value={dueDate || null}
          dateTime={dueAt}
          onChangeDateTime={(date, instant) => {
            setDueDate(date || '')
            setDueAt(instant)
          }}
          label="Prazo da nova tarefa"
          onChange={(date) => setDueDate(date || '')}
        />
        <label htmlFor="task-description">
          Contexto <span className="optional">opcional</span>
        </label>
        <textarea
          id="task-description"
          placeholder="O que mais precisamos saber?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={20000}
        />
        <footer className="modal-footer">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancelar
          </button>
          <SubmitButton busy={busy} disabled={busy || !title.trim() || !group}>
            Criar tarefa
          </SubmitButton>
        </footer>
      </form>
    </Modal>
  )
}
export function CreateEntity({
  kind,
  board,
  onClose,
  onCreated,
}: {
  kind: 'board' | 'group'
  board?: Board
  onClose: () => void
  onCreated: (boardId?: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const titles = {
    board: 'Novo quadro',
    group: 'Novo grupo',
  }
  const subtitles = {
    board: 'Crie um quadro e comece a construir.',
    group: 'Um novo grupo para os próximos passos.',
  }
  async function submit() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ id: string }>(
        kind === 'board' ? '/boards' : `/boards/${board!.id}/groups`,
        {
          method: 'POST',
          body: json(kind === 'board' ? { name, description } : { name }),
        },
      )
      await onCreated(kind === 'board' ? result.id : undefined)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={titles[kind]} subtitle={subtitles[kind]} onClose={onClose}>
      <form
        className="standard-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <label htmlFor="entity-name">{kind === 'board' ? 'Nome do quadro' : 'Nome do grupo'}</label>
        <input
          id="entity-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === 'board' ? 'Ex.: Planejamento da equipe' : 'Ex.: Próximo mês'}
          maxLength={300}
          required
          autoFocus
        />
        {kind === 'board' && (
          <>
            <label htmlFor="board-description">
              Uma breve descrição <span className="optional">opcional</span>
            </label>
            <textarea
              id="board-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Qual é o propósito deste espaço?"
            />
          </>
        )}
        <footer className="modal-footer">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancelar
          </button>
          <SubmitButton busy={busy} disabled={busy || !name.trim()}>
            Criar {kind === 'board' ? 'quadro' : 'grupo'}
          </SubmitButton>
        </footer>
      </form>
    </Modal>
  )
}
