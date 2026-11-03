import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Bot,
  Check,
  Clock3,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Workflow,
  Layers3,
  CircleCheck,
  Zap,
} from 'lucide-react'
import type { AutomationRun, Board, BoardAutomation, Group } from '../../shared/domain'
import { boardColumns } from '../../shared/columns'
import { api, json } from '../api'
import { EmptyState, Loading, Modal, SubmitButton } from './ui'
import { Button } from './ui/button'
import { FieldSelect } from './FieldSelect'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

function dateText(value: string) {
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function AutomationsPanel({ board, groups }: { board: Board; groups: Group[] }) {
  const [rules, setRules] = useState<BoardAutomation[]>([])
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'rules' | 'history'>('rules')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState<BoardAutomation | 'new' | null>(null)
  const [removing, setRemoving] = useState<BoardAutomation | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const path = `/boards/${board.id}/automations`
  const columns = boardColumns(board).filter((column) => column.type === 'status')
  const activeCount = rules.filter((rule) => rule.enabled).length
  useEffect(() => {
    let active = true
    Promise.all([api<BoardAutomation[]>(path), api<AutomationRun[]>(`${path}/runs`)])
      .then(([rules, runs]) => {
        if (active) {
          setRules(rules)
          setRuns(runs)
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : 'Não foi possível carregar as automações.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [path])
  async function toggle(rule: BoardAutomation) {
    setBusy(rule.id)
    setError('')
    try {
      const saved = await api<BoardAutomation>(`${path}/${rule.id}`, {
        method: 'PATCH',
        body: json({ enabled: !rule.enabled }),
      })
      setRules((previous) => previous.map((item) => (item.id === saved.id ? saved : item)))
      setNotice(saved.enabled ? 'Automação ativada.' : 'Automação pausada.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível alterar a automação.')
    } finally {
      setBusy(null)
    }
  }
  async function remove() {
    if (!removing) return
    setBusy(removing.id)
    setError('')
    try {
      await api(`${path}/${removing.id}`, { method: 'DELETE' })
      setRules((previous) => previous.filter((rule) => rule.id !== removing.id))
      setRemoving(null)
      setNotice('Automação excluída.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível excluir a automação.')
    } finally {
      setBusy(null)
    }
  }
  const details = (rule: BoardAutomation) => {
    const column = columns.find((column) => column.id === rule.columnId)
    return {
      column,
      option: column?.options?.find((option) => option.id === rule.optionId),
      group: groups.find((group) => group.id === rule.groupId),
    }
  }
  const shown = rules.filter((rule) => {
    const { column, option, group } = details(rule)
    return (
      (filter === 'all' || (filter === 'active' ? rule.enabled : !rule.enabled)) &&
      `${column?.name} ${option?.label} ${group?.name} ${rule.description}`
        .toLocaleLowerCase('pt-BR')
        .includes(search.toLocaleLowerCase('pt-BR'))
    )
  })
  return (
    <section className="automations-page" aria-label="Automações do quadro">
      <header className="automations-heading">
        <div>
          <span className="automation-eyebrow">
            <Workflow size={15} /> FLUXOS DE TRABALHO
          </span>
          <h2>Automações do quadro</h2>
          <p>Conecte uma mudança de status ao próximo passo do trabalho.</p>
        </div>
        <Button onClick={() => setEditing('new')} disabled={loading}>
          <Plus />
          Criar automação
        </Button>
      </header>
      <div className="automation-stats" aria-label="Resumo das automações">
        <div>
          <span className="automation-stat-icon">
            <Layers3 size={18} />
          </span>
          <div>
            <strong>{rules.length}</strong>
            <span>Regras criadas</span>
          </div>
        </div>
        <div>
          <span className="automation-stat-icon is-green">
            <CircleCheck size={18} />
          </span>
          <div>
            <strong>{activeCount}</strong>
            <span>Ativas no quadro</span>
          </div>
        </div>
        <div>
          <span className="automation-stat-icon is-blue">
            <Zap size={18} />
          </span>
          <div>
            <strong>{runs.length}</strong>
            <span>Execuções recentes</span>
          </div>
        </div>
      </div>
      <div className="automation-tabs view-tabs" role="tablist" aria-label="Gerenciar automações">
        <button
          role="tab"
          aria-selected={tab === 'rules'}
          onClick={() => setTab('rules')}
          className={tab === 'rules' ? 'active' : ''}
        >
          <Bot size={16} />
          Automações <span>{rules.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'history'}
          onClick={() => setTab('history')}
          className={tab === 'history' ? 'active' : ''}
        >
          <Clock3 size={16} />
          Histórico de execuções
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <span className="sr-only" role="status">
        {notice}
      </span>
      {loading ? (
        <Loading text="Carregando automações…" />
      ) : tab === 'rules' ? (
        <>
          <div className="automations-toolbar">
            <label className="automation-search">
              <Search size={16} />
              <input
                aria-label="Pesquisar automações"
                placeholder="Pesquisar automações"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <FieldSelect
              label="Filtrar automações"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Todas as automações' },
                { value: 'active', label: 'Ativas', color: '#00a871' },
                { value: 'paused', label: 'Pausadas', color: '#a0a6b7' },
              ]}
            />
            <span>
              {activeCount} {activeCount === 1 ? 'ativa' : 'ativas'}
            </span>
          </div>
          {!rules.length ? (
            <EmptyState
              icon={<Bot size={36} />}
              title="Seu quadro, suas regras."
              description="Nenhuma automação cadastrada. As tarefas permanecem no grupo escolhido até você definir uma regra."
              action={
                <Button onClick={() => setEditing('new')}>
                  <Plus />
                  Criar minha primeira automação
                </Button>
              }
            />
          ) : !shown.length ? (
            <EmptyState
              icon={<Search size={28} />}
              title="Nenhuma automação encontrada."
              description="Tente outra busca ou ajuste o filtro."
            />
          ) : (
            <div className="automation-list">
              {shown.map((rule) => {
                const { column, option, group } = details(rule)
                const valid = !!column && !!option && !!group
                return (
                  <article
                    className={`automation-card ${rule.enabled ? '' : 'is-paused'}`}
                    key={rule.id}
                  >
                    <header className="automation-card-header">
                      <span className="automation-rule-icon">
                        <Workflow size={18} />
                      </span>
                      <strong>Movimentar tarefa</strong>
                      <span
                        className={`automation-state ${rule.enabled ? 'automation-active' : ''}`}
                      >
                        <i />
                        {rule.enabled ? 'Ativa' : 'Pausada'}
                      </span>
                      <div className="automation-actions">
                        <button
                          type="button"
                          role="switch"
                          className="automation-switch"
                          aria-label={`Ativar automação: ${option?.label || rule.optionId} para ${group?.name || 'grupo removido'}`}
                          aria-checked={rule.enabled}
                          disabled={busy !== null}
                          onClick={() => void toggle(rule)}
                        >
                          <span />
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={busy !== null}
                              aria-label={`Opções da automação: ${option?.label || rule.optionId}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(rule)}>
                              <Pencil />
                              Editar automação
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setRemoving(rule)}>
                              <Trash2 />
                              Excluir automação
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </header>
                    <div className="automation-sentence">
                      <div className="automation-flow-step">
                        <span className="automation-step-caption">
                          <Zap size={14} />
                          QUANDO
                        </span>
                        <p>
                          <strong>{column?.name || 'Coluna removida'}</strong> mudar para
                        </p>
                        <span
                          className="automation-label"
                          style={{ backgroundColor: option?.color || '#798099' }}
                        >
                          {option?.label || 'Etiqueta removida'}
                        </span>
                      </div>
                      <span className="automation-flow-arrow">
                        <ArrowRight size={18} />
                      </span>
                      <div className="automation-flow-step">
                        <span className="automation-step-caption">
                          <Layers3 size={14} />
                          ENTÃO
                        </span>
                        <p>Mover item para o grupo</p>
                        <strong className="automation-destination">
                          <i style={{ backgroundColor: group?.color || '#798099' }} />
                          {group?.name || 'Grupo removido'}
                        </strong>
                      </div>
                    </div>
                    <footer className="automation-meta">
                      <span>{rule.description || 'Regra de movimentação por etiqueta'}</span>
                      <span>
                        <Clock3 size={12} />
                        Atualizada em {dateText(rule.updatedAt)}
                      </span>
                      {!valid && (
                        <span className="form-error">
                          Revise a coluna, a etiqueta ou o grupo desta regra.
                        </span>
                      )}
                    </footer>
                  </article>
                )
              })}
            </div>
          )}
          {!!rules.length && (
            <p className="automation-footnote">
              As regras são executadas quando uma etiqueta muda nas tarefas principais. Os subitens
              acompanham a tarefa ao mudar de grupo.
            </p>
          )}
        </>
      ) : (
        <div className="automation-history">
          {!runs.length ? (
            <EmptyState
              icon={<Clock3 size={32} />}
              title="Ainda não houve execuções."
              description="Quando uma regra mover uma tarefa, a execução aparecerá aqui."
            />
          ) : (
            <>
              <p className="automation-footnote">
                Últimas 100 execuções. O histórico é preservado mesmo ao excluir uma automação.
              </p>
              {runs.map((run) => (
                <article className="automation-run" key={run.id}>
                  <span className="automation-run-check">
                    <Check size={16} />
                  </span>
                  <div>
                    <strong>{run.taskTitle}</strong>
                    <p>{run.ruleDescription}</p>
                    <small>
                      {run.fromGroup} <ArrowRight size={12} /> {run.toGroup}
                    </small>
                  </div>
                  <time dateTime={run.createdAt}>{dateText(run.createdAt)}</time>
                </article>
              ))}
            </>
          )}
        </div>
      )}
      {editing && (
        <AutomationEditor
          board={board}
          groups={groups}
          rule={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setRules((previous) =>
              previous.some((rule) => rule.id === saved.id)
                ? previous.map((rule) => (rule.id === saved.id ? saved : rule))
                : [...previous, saved],
            )
            setEditing(null)
            setNotice('Automação salva.')
          }}
        />
      )}
      {removing && (
        <Modal
          title="Excluir automação?"
          subtitle="As tarefas e o histórico de execuções serão mantidos."
          onClose={() => {
            if (!busy) setRemoving(null)
          }}
        >
          <div className="automation-delete">
            <p>Esta regra deixará de executar novas movimentações.</p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div>
              <Button variant="outline" disabled={!!busy} onClick={() => setRemoving(null)}>
                Cancelar
              </Button>
              <Button variant="destructive" disabled={!!busy} onClick={() => void remove()}>
                Excluir automação
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}

function AutomationEditor({
  board,
  groups,
  rule,
  onClose,
  onSaved,
}: {
  board: Board
  groups: Group[]
  rule?: BoardAutomation
  onClose: () => void
  onSaved: (rule: BoardAutomation) => void
}) {
  const columns = boardColumns(board).filter((column) => column.type === 'status')
  const [columnId, setColumnId] = useState(rule?.columnId || 'status')
  const [optionId, setOptionId] = useState(rule?.optionId || '')
  const [groupId, setGroupId] = useState(rule?.groupId || '')
  const [description, setDescription] = useState(rule?.description || '')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const column = columns.find((column) => column.id === columnId)
  const option = column?.options?.find((option) => option.id === optionId)
  const group = groups.find((group) => group.id === groupId)
  async function submit() {
    setBusy(true)
    setError('')
    try {
      onSaved(
        await api<BoardAutomation>(`/boards/${board.id}/automations${rule ? `/${rule.id}` : ''}`, {
          method: rule ? 'PATCH' : 'POST',
          body: json({ columnId, optionId, groupId, description, enabled }),
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar a automação.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={rule ? 'Editar automação' : 'Criar automação'}
      subtitle="Quando uma etiqueta mudar, mova a tarefa para o grupo escolhido."
      onClose={() => {
        if (!busy) onClose()
      }}
      className="automation-editor"
    >
      <form
        className="standard-form automation-form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <section className="automation-editor-step">
          <header>
            <span>1</span>
            <div>
              <strong>Quando isso acontecer</strong>
              <p>Escolha a mudança que inicia a regra.</p>
            </div>
            <Zap size={18} />
          </header>
          <label>
            Coluna de gatilho
            <FieldSelect
              label="Coluna de gatilho"
              value={columnId}
              onChange={(value) => {
                setColumnId(value)
                setOptionId('')
              }}
              disabled={busy}
              required
              placeholder="Escolha uma coluna"
              options={columns.map((column) => ({
                value: column.id,
                label: column.name,
                icon: <Layers3 size={15} />,
              }))}
            />
          </label>
          <label>
            Quando mudar para
            <FieldSelect
              label="Quando mudar para"
              value={optionId}
              onChange={setOptionId}
              disabled={busy}
              required
              placeholder="Escolha uma etiqueta"
              options={
                column?.options?.map((option) => ({
                  value: option.id,
                  label: option.label,
                  color: option.color,
                })) || []
              }
            />
          </label>
        </section>
        <section className="automation-editor-step">
          <header>
            <span>2</span>
            <div>
              <strong>Faça isso</strong>
              <p>Defina o destino da tarefa.</p>
            </div>
            <Layers3 size={18} />
          </header>
          <label>
            Mover para o grupo
            <FieldSelect
              label="Mover para o grupo"
              value={groupId}
              onChange={setGroupId}
              disabled={busy}
              required
              placeholder="Escolha um grupo"
              heading="Grupos do quadro"
              options={groups.map((group) => ({
                value: group.id,
                label: group.name,
                color: group.color,
              }))}
            />
          </label>
        </section>
        <div className="automation-preview">
          <Bot size={20} />
          <p>
            Quando <strong>{column?.name || 'a coluna'}</strong> mudar para{' '}
            <strong>{option?.label || 'uma etiqueta'}</strong>, mover item para{' '}
            <strong>{group?.name || 'um grupo'}</strong>.
          </p>
        </div>
        <label>
          Descrição (opcional)
          <textarea
            value={description}
            maxLength={1000}
            rows={2}
            disabled={busy}
            placeholder="Para que serve esta automação?"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="automation-enable">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Ativar esta automação ao salvar
        </label>
        <p className="automation-footnote">
          A regra vale para as próximas mudanças de etiqueta. As tarefas existentes permanecem como
          estão.
        </p>
        <footer className="modal-footer form-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <SubmitButton busy={busy} disabled={!column || !option || !group}>
            {rule ? 'Salvar alterações' : 'Criar automação'}
          </SubmitButton>
        </footer>
      </form>
    </Modal>
  )
}
