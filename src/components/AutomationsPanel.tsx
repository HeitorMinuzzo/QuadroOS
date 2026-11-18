import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  CircleCheck,
  Clock3,
  FolderInput,
  Layers3,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Repeat,
  Search,
  SquarePlus,
  Trash2,
  Workflow,
  X,
  Zap,
} from 'lucide-react'
import type {
  AutomationAction,
  AutomationActionType,
  AutomationRun,
  AutomationTrigger,
  AutomationTriggerType,
  Board,
  BoardAutomation,
  Group,
  Person,
} from '../../shared/domain'
import { boardColumns } from '../../shared/columns'
import {
  ACTION_LABELS,
  TRIGGER_LABELS,
  WEEKDAYS,
  describeAction,
  describeRule,
  describeTrigger,
} from '../../shared/automation-text'
import { api, json } from '../api'
import { EmptyState, Loading, Modal, SubmitButton } from './ui'
import { Button } from './ui/button'
import { FieldSelect } from './FieldSelect'
import { AssigneePicker } from './AssigneePicker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

function dateText(value: string) {
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
const TRIGGER_ICONS: Record<AutomationTriggerType, ReactNode> = {
  status_changed: <Zap size={18} />,
  item_created: <SquarePlus size={18} />,
  moved_to_group: <FolderInput size={18} />,
  subitems_done: <ListChecks size={18} />,
  date_arrives: <CalendarClock size={18} />,
  recurring: <Repeat size={18} />,
}
const ANY = '__any__'
const CLEAR = '__clear__'

export function AutomationsPanel({
  board,
  groups,
  people,
}: {
  board: Board
  groups: Group[]
  people: Person[]
}) {
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
  const names = { board, groups, people }
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
  /** The name screen readers use for a rule: its label for status rules, else its trigger. */
  const ruleName = (rule: BoardAutomation) => {
    const t = rule.trigger
    if (t.type === 'status_changed' && t.optionId)
      return (
        boardColumns(board)
          .find((c) => c.id === t.columnId)
          ?.options?.find((o) => o.id === t.optionId)?.label || 'etiqueta removida'
      )
    return TRIGGER_LABELS[t.type]
  }
  const shown = rules.filter(
    (rule) =>
      (filter === 'all' || (filter === 'active' ? rule.enabled : !rule.enabled)) &&
      `${describeRule(rule, names)} ${rule.description}`
        .toLocaleLowerCase('pt-BR')
        .includes(search.toLocaleLowerCase('pt-BR')),
  )
  return (
    <section className="automations-page" aria-label="Automações do quadro">
      <header className="automations-heading">
        <div>
          <span className="automation-eyebrow">
            <Workflow size={15} /> FLUXOS DE TRABALHO
          </span>
          <h2>Automações do quadro</h2>
          <p>Escolha quando a regra começa e o que ela faz em seguida.</p>
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
              description="Nenhuma automação cadastrada. Crie regras para mover itens, mudar status, definir prazos, atribuir pessoas, avisar a equipe ou criar itens repetidos."
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
              {shown.map((rule) => (
                <article
                  className={`automation-card ${rule.enabled ? '' : 'is-paused'}`}
                  key={rule.id}
                >
                  <header className="automation-card-header">
                    <span className="automation-rule-icon">{TRIGGER_ICONS[rule.trigger.type]}</span>
                    <strong>{TRIGGER_LABELS[rule.trigger.type]}</strong>
                    <span className={`automation-state ${rule.enabled ? 'automation-active' : ''}`}>
                      <i />
                      {rule.enabled ? 'Ativa' : 'Pausada'}
                    </span>
                    <div className="automation-actions">
                      <button
                        type="button"
                        role="switch"
                        className="automation-switch"
                        aria-label={`Ativar automação: ${ruleName(rule)}`}
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
                            aria-label={`Opções da automação: ${ruleName(rule)}`}
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
                        {capitalize(describeTrigger(rule.trigger, names).replace(/^Quando /, ''))}
                      </p>
                    </div>
                    <span className="automation-flow-arrow">
                      <ArrowRight size={18} />
                    </span>
                    <div className="automation-flow-step">
                      <span className="automation-step-caption">
                        <Layers3 size={14} />
                        ENTÃO
                      </span>
                      <ul className="automation-action-list">
                        {rule.actions.map((action, index) => (
                          <li key={index}>{capitalize(describeAction(action, names))}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <footer className="automation-meta">
                    <span>{rule.description || describeRule(rule, names)}</span>
                    <span>
                      <Clock3 size={12} />
                      Atualizada em {dateText(rule.updatedAt)}
                    </span>
                    {/removid/.test(describeRule(rule, names)) && (
                      <span className="form-error">
                        Revise esta regra: uma coluna, etiqueta ou grupo foi removido.
                      </span>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          )}
          {!!rules.length && (
            <p className="automation-footnote">
              As regras de mudança valem para as tarefas principais (os subitens acompanham a tarefa
              ao mudar de grupo). Regras de data e repetição são verificadas a cada poucos minutos e
              ignoram tarefas já concluídas.
            </p>
          )}
        </>
      ) : (
        <div className="automation-history">
          {!runs.length ? (
            <EmptyState
              icon={<Clock3 size={32} />}
              title="Ainda não houve execuções."
              description="Quando uma regra for executada, ela aparecerá aqui."
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
                    {run.fromGroup && run.toGroup && (
                      <small>
                        {run.fromGroup} <ArrowRight size={12} /> {run.toGroup}
                      </small>
                    )}
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
          people={people}
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
            <p>Esta regra deixará de ser executada.</p>
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

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function defaultTrigger(type: AutomationTriggerType): AutomationTrigger {
  if (type === 'status_changed') return { type, columnId: 'status', optionId: '' }
  if (type === 'moved_to_group') return { type, groupId: '' }
  if (type === 'date_arrives') return { type, columnId: 'date', offsetDays: 0 }
  if (type === 'recurring') return { type, every: 'week', weekday: 1 }
  return { type }
}
function defaultAction(type: AutomationActionType, groups: Group[]): AutomationAction {
  if (type === 'move_group') return { type, groupId: '' }
  if (type === 'set_status') return { type, columnId: 'status', optionId: '' }
  if (type === 'set_date') return { type, columnId: 'date', mode: 'today' }
  if (type === 'assign') return { type, mode: 'set', personIds: [] }
  if (type === 'notify') return { type, to: 'owners', personIds: [], message: '' }
  return { type: 'create_item', groupId: groups[0]?.id || '', title: '' }
}
function triggerReady(t: AutomationTrigger) {
  if (t.type === 'status_changed') return !!t.columnId && t.optionId !== ''
  if (t.type === 'moved_to_group') return !!t.groupId
  if (t.type === 'date_arrives') return !!t.columnId
  if (t.type === 'recurring')
    return t.every === 'day' || (t.every === 'week' ? t.weekday !== undefined : !!t.monthDay)
  return true
}
function actionReady(a: AutomationAction) {
  if (a.type === 'move_group') return !!a.groupId
  if (a.type === 'set_status') return !!a.columnId && a.optionId !== ''
  if (a.type === 'set_date') return !!a.columnId
  if (a.type === 'assign') return a.mode === 'clear' || a.personIds.length > 0
  if (a.type === 'notify') return a.to === 'owners' || a.personIds.length > 0
  return !!a.groupId && !!a.title.trim()
}

function AutomationEditor({
  board,
  groups,
  people,
  rule,
  onClose,
  onSaved,
}: {
  board: Board
  groups: Group[]
  people: Person[]
  rule?: BoardAutomation
  onClose: () => void
  onSaved: (rule: BoardAutomation) => void
}) {
  const columns = boardColumns(board)
  const statusColumns = columns.filter((column) => column.type === 'status')
  const dateColumns = [
    { value: 'date', label: 'Prazo' },
    ...columns
      .filter((column) => column.type === 'date')
      .map((column) => ({ value: column.id, label: column.name })),
  ]
  const groupOptions = groups.map((group) => ({
    value: group.id,
    label: group.name,
    color: group.color,
  }))
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    rule?.trigger ?? defaultTrigger('status_changed'),
  )
  const [actions, setActions] = useState<AutomationAction[]>(
    rule?.actions ?? [defaultAction('move_group', groups)],
  )
  const [description, setDescription] = useState(rule?.description || '')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const recurring = trigger.type === 'recurring'
  const actionTypes: AutomationActionType[] = recurring
    ? ['create_item', 'notify']
    : ['move_group', 'set_status', 'set_date', 'assign', 'notify']
  const ready = triggerReady(trigger) && actions.length > 0 && actions.every(actionReady)
  function changeTrigger(type: AutomationTriggerType) {
    const next = defaultTrigger(type)
    setTrigger(next)
    // Recurring rules create items; every other rule changes the item that started it.
    if ((type === 'recurring') !== recurring)
      setActions([defaultAction(type === 'recurring' ? 'create_item' : 'move_group', groups)])
  }
  const setAction = (index: number, action: AutomationAction) =>
    setActions((previous) => previous.map((item, i) => (i === index ? action : item)))
  async function submit() {
    setBusy(true)
    setError('')
    try {
      onSaved(
        await api<BoardAutomation>(`/boards/${board.id}/automations${rule ? `/${rule.id}` : ''}`, {
          method: rule ? 'PATCH' : 'POST',
          body: json({ trigger, actions, description, enabled }),
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar a automação.')
    } finally {
      setBusy(false)
    }
  }
  const statusOptions = (columnId: string, any: string) => [
    {
      value: any === ANY ? ANY : CLEAR,
      label: any === ANY ? 'Qualquer etiqueta' : 'Vazio (limpar)',
    },
    ...(columns
      .find((column) => column.id === columnId)
      ?.options?.map((option) => ({
        value: option.id,
        label: option.label,
        color: option.color,
      })) || []),
  ]
  const optionValue = (optionId: string | null, any: string) => (optionId === null ? any : optionId)
  const optionFrom = (value: string) => (value === ANY || value === CLEAR ? null : value)
  const t = trigger
  const offsetWhen =
    t.type === 'date_arrives'
      ? t.offsetDays < 0
        ? 'before'
        : t.offsetDays > 0
          ? 'after'
          : 'on'
      : 'on'
  return (
    <Modal
      title={rule ? 'Editar automação' : 'Criar automação'}
      subtitle="Quando algo acontecer no quadro, faça uma ou mais ações."
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
              <p>Escolha o que inicia a regra.</p>
            </div>
            <Zap size={18} />
          </header>
          <label>
            Gatilho
            <FieldSelect
              label="Gatilho"
              value={t.type}
              onChange={(value) => changeTrigger(value as AutomationTriggerType)}
              disabled={busy}
              options={(Object.keys(TRIGGER_LABELS) as AutomationTriggerType[]).map((type) => ({
                value: type,
                label: TRIGGER_LABELS[type],
                icon: TRIGGER_ICONS[type],
              }))}
            />
          </label>
          {t.type === 'status_changed' && (
            <div className="automation-field-row">
              <label>
                Coluna de gatilho
                <FieldSelect
                  label="Coluna de gatilho"
                  value={t.columnId}
                  onChange={(value) => setTrigger({ ...t, columnId: value, optionId: '' })}
                  disabled={busy}
                  required
                  placeholder="Escolha uma coluna"
                  options={statusColumns.map((column) => ({
                    value: column.id,
                    label: column.name,
                  }))}
                />
              </label>
              <label>
                Quando mudar para
                <FieldSelect
                  label="Quando mudar para"
                  value={t.optionId === '' ? '' : optionValue(t.optionId, ANY)}
                  onChange={(value) => setTrigger({ ...t, optionId: optionFrom(value) })}
                  disabled={busy}
                  required
                  placeholder="Escolha uma etiqueta"
                  options={statusOptions(t.columnId, ANY)}
                />
              </label>
            </div>
          )}
          {t.type === 'moved_to_group' && (
            <label>
              Grupo de destino
              <FieldSelect
                label="Grupo de destino"
                value={t.groupId}
                onChange={(value) => setTrigger({ ...t, groupId: value })}
                disabled={busy}
                required
                placeholder="Escolha um grupo"
                options={groupOptions}
              />
            </label>
          )}
          {t.type === 'date_arrives' && (
            <div className="automation-field-row is-three">
              <label>
                Coluna de data
                <FieldSelect
                  label="Coluna de data"
                  value={t.columnId}
                  onChange={(value) => setTrigger({ ...t, columnId: value })}
                  disabled={busy}
                  options={dateColumns}
                />
              </label>
              <label>
                Momento
                <FieldSelect
                  label="Momento"
                  value={offsetWhen}
                  onChange={(value) =>
                    setTrigger({
                      ...t,
                      offsetDays:
                        value === 'on'
                          ? 0
                          : (value === 'before' ? -1 : 1) * Math.max(1, Math.abs(t.offsetDays)),
                    })
                  }
                  disabled={busy}
                  options={[
                    { value: 'on', label: 'No dia' },
                    { value: 'before', label: 'Dias antes' },
                    { value: 'after', label: 'Dias depois' },
                  ]}
                />
              </label>
              {offsetWhen !== 'on' && (
                <label>
                  Dias
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={Math.abs(t.offsetDays)}
                    disabled={busy}
                    onChange={(event) =>
                      setTrigger({
                        ...t,
                        offsetDays:
                          (offsetWhen === 'before' ? -1 : 1) *
                          Math.min(365, Math.max(1, Number(event.target.value) || 1)),
                      })
                    }
                  />
                </label>
              )}
            </div>
          )}
          {t.type === 'recurring' && (
            <div className="automation-field-row">
              <label>
                Frequência
                <FieldSelect
                  label="Frequência"
                  value={t.every}
                  onChange={(value) =>
                    setTrigger(
                      value === 'day'
                        ? { type: 'recurring', every: 'day' }
                        : value === 'week'
                          ? { type: 'recurring', every: 'week', weekday: 1 }
                          : { type: 'recurring', every: 'month', monthDay: 1 },
                    )
                  }
                  disabled={busy}
                  options={[
                    { value: 'day', label: 'Todo dia' },
                    { value: 'week', label: 'Toda semana' },
                    { value: 'month', label: 'Todo mês' },
                  ]}
                />
              </label>
              {t.every === 'week' && (
                <label>
                  Dia da semana
                  <FieldSelect
                    label="Dia da semana"
                    value={String(t.weekday ?? 1)}
                    onChange={(value) => setTrigger({ ...t, weekday: Number(value) })}
                    disabled={busy}
                    options={WEEKDAYS.map((day, index) => ({
                      value: String(index),
                      label: capitalize(day),
                    }))}
                  />
                </label>
              )}
              {t.every === 'month' && (
                <label>
                  Dia do mês
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={t.monthDay ?? 1}
                    disabled={busy}
                    onChange={(event) =>
                      setTrigger({
                        ...t,
                        monthDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                      })
                    }
                  />
                </label>
              )}
            </div>
          )}
          {(t.type === 'date_arrives' || t.type === 'recurring') && (
            <p className="automation-footnote">
              {t.type === 'date_arrives'
                ? 'Verificado a cada poucos minutos, uma vez por item e data. Itens concluídos são ignorados.'
                : 'O item é criado uma vez no dia escolhido (no dia 29, 30 ou 31, meses mais curtos usam o último dia).'}
            </p>
          )}
        </section>
        <section className="automation-editor-step">
          <header>
            <span>2</span>
            <div>
              <strong>Faça isso</strong>
              <p>Uma ou mais ações, na ordem.</p>
            </div>
            <Layers3 size={18} />
          </header>
          <ol className="automation-action-editor">
            {actions.map((action, index) => (
              <li key={index}>
                <div className="automation-action-head">
                  <FieldSelect
                    label={`Ação ${index + 1}`}
                    value={action.type}
                    onChange={(value) =>
                      setAction(index, defaultAction(value as AutomationActionType, groups))
                    }
                    disabled={busy}
                    options={actionTypes.map((type) => ({
                      value: type,
                      label: ACTION_LABELS[type],
                    }))}
                  />
                  {actions.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remover ação ${index + 1}`}
                      disabled={busy}
                      onClick={() => setActions(actions.filter((_, i) => i !== index))}
                    >
                      <X />
                    </Button>
                  )}
                </div>
                {action.type === 'move_group' && (
                  <label>
                    Mover para o grupo
                    <FieldSelect
                      label="Mover para o grupo"
                      value={action.groupId}
                      onChange={(value) => setAction(index, { ...action, groupId: value })}
                      disabled={busy}
                      required
                      placeholder="Escolha um grupo"
                      heading="Grupos do quadro"
                      options={groupOptions}
                    />
                  </label>
                )}
                {action.type === 'set_status' && (
                  <div className="automation-field-row">
                    <label>
                      Coluna
                      <FieldSelect
                        label={`Coluna da ação ${index + 1}`}
                        value={action.columnId}
                        onChange={(value) =>
                          setAction(index, { ...action, columnId: value, optionId: '' })
                        }
                        disabled={busy}
                        options={statusColumns.map((column) => ({
                          value: column.id,
                          label: column.name,
                        }))}
                      />
                    </label>
                    <label>
                      Mudar para
                      <FieldSelect
                        label={`Mudar para (ação ${index + 1})`}
                        value={action.optionId === '' ? '' : optionValue(action.optionId, CLEAR)}
                        onChange={(value) =>
                          setAction(index, { ...action, optionId: optionFrom(value) })
                        }
                        disabled={busy}
                        required
                        placeholder="Escolha uma etiqueta"
                        options={statusOptions(action.columnId, CLEAR)}
                      />
                    </label>
                  </div>
                )}
                {action.type === 'set_date' && (
                  <div className="automation-field-row is-three">
                    <label>
                      Coluna de data
                      <FieldSelect
                        label={`Coluna de data da ação ${index + 1}`}
                        value={action.columnId}
                        onChange={(value) => setAction(index, { ...action, columnId: value })}
                        disabled={busy}
                        options={dateColumns}
                      />
                    </label>
                    <label>
                      Para
                      <FieldSelect
                        label={`Data da ação ${index + 1}`}
                        value={action.mode}
                        onChange={(value) =>
                          setAction(index, {
                            ...action,
                            mode: value as 'today' | 'offset' | 'clear',
                            days: value === 'offset' ? (action.days ?? 1) : undefined,
                          })
                        }
                        disabled={busy}
                        options={[
                          { value: 'today', label: 'Hoje' },
                          { value: 'offset', label: 'Daqui a alguns dias' },
                          { value: 'clear', label: 'Limpar a data' },
                        ]}
                      />
                    </label>
                    {action.mode === 'offset' && (
                      <label>
                        Dias
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={action.days ?? 1}
                          disabled={busy}
                          onChange={(event) =>
                            setAction(index, {
                              ...action,
                              days: Math.min(365, Math.max(1, Number(event.target.value) || 1)),
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                )}
                {action.type === 'assign' && (
                  <div className="automation-field-row">
                    <label>
                      Como
                      <FieldSelect
                        label={`Atribuição da ação ${index + 1}`}
                        value={action.mode}
                        onChange={(value) =>
                          setAction(index, {
                            ...action,
                            mode: value as 'set' | 'add' | 'clear',
                            personIds: value === 'clear' ? [] : action.personIds,
                          })
                        }
                        disabled={busy}
                        options={[
                          { value: 'set', label: 'Substituir pelos escolhidos' },
                          { value: 'add', label: 'Adicionar aos atuais' },
                          { value: 'clear', label: 'Remover todos' },
                        ]}
                      />
                    </label>
                    {action.mode !== 'clear' && (
                      <div className="automation-people">
                        <span>Pessoas</span>
                        <AssigneePicker
                          people={people}
                          value={action.personIds}
                          label={`Pessoas da ação ${index + 1}`}
                          onChange={(ids) => setAction(index, { ...action, personIds: ids })}
                        />
                      </div>
                    )}
                  </div>
                )}
                {action.type === 'notify' && (
                  <>
                    <div className="automation-field-row">
                      <label>
                        Quem
                        <FieldSelect
                          label={`Quem notificar (ação ${index + 1})`}
                          value={action.to}
                          onChange={(value) =>
                            setAction(index, { ...action, to: value as 'owners' | 'people' })
                          }
                          disabled={busy}
                          options={[
                            { value: 'owners', label: 'Responsáveis do item' },
                            { value: 'people', label: 'Pessoas escolhidas' },
                          ]}
                        />
                      </label>
                      {action.to === 'people' && (
                        <div className="automation-people">
                          <span>Pessoas</span>
                          <AssigneePicker
                            people={people}
                            value={action.personIds}
                            label={`Pessoas notificadas na ação ${index + 1}`}
                            onChange={(ids) => setAction(index, { ...action, personIds: ids })}
                          />
                        </div>
                      )}
                    </div>
                    <label>
                      Mensagem
                      <input
                        value={action.message}
                        maxLength={300}
                        disabled={busy}
                        placeholder="Ex.: O prazo deste item é amanhã"
                        onChange={(event) =>
                          setAction(index, { ...action, message: event.target.value })
                        }
                      />
                    </label>
                  </>
                )}
                {action.type === 'create_item' && (
                  <div className="automation-field-row">
                    <label>
                      Nome do item
                      <input
                        value={action.title}
                        maxLength={300}
                        disabled={busy}
                        placeholder="Ex.: Reunião semanal {data}"
                        onChange={(event) =>
                          setAction(index, { ...action, title: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      No grupo
                      <FieldSelect
                        label={`Grupo do novo item (ação ${index + 1})`}
                        value={action.groupId}
                        onChange={(value) => setAction(index, { ...action, groupId: value })}
                        disabled={busy}
                        required
                        placeholder="Escolha um grupo"
                        options={groupOptions}
                      />
                    </label>
                  </div>
                )}
                {action.type === 'create_item' && (
                  <p className="automation-footnote">
                    Use {'{data}'} no nome para incluir o dia, como “Reunião semanal 23/11/2026”.
                  </p>
                )}
              </li>
            ))}
          </ol>
          {actions.length < 5 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                setActions([...actions, defaultAction(recurring ? 'notify' : 'set_status', groups)])
              }
            >
              <Plus />
              Adicionar ação
            </Button>
          )}
        </section>
        <div className="automation-preview">
          <Bot size={20} />
          <p>
            {ready
              ? describeRule({ trigger, actions }, { board, groups, people })
              : 'Complete os campos para ver a regra.'}
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
        <footer className="modal-footer form-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <SubmitButton busy={busy} disabled={!ready}>
            {rule ? 'Salvar alterações' : 'Criar automação'}
          </SubmitButton>
        </footer>
      </form>
    </Modal>
  )
}
