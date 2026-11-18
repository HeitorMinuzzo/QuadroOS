// Automations in words, for the rule cards, the editor preview and the run history.
import type {
  AutomationAction,
  AutomationActionType,
  AutomationTrigger,
  AutomationTriggerType,
  Board,
  Group,
  Person,
} from './domain.ts'
import { boardColumns } from './columns.ts'

export const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  status_changed: 'Um status mudar',
  item_created: 'Um item for criado',
  moved_to_group: 'Um item for movido para um grupo',
  subitems_done: 'Todos os subitens forem concluídos',
  date_arrives: 'Uma data chegar',
  recurring: 'Repetir em uma frequência',
}
export const ACTION_LABELS: Record<AutomationActionType, string> = {
  move_group: 'Mover para um grupo',
  set_status: 'Mudar um status',
  set_date: 'Definir uma data',
  assign: 'Atribuir responsáveis',
  notify: 'Notificar',
  create_item: 'Criar um item',
}
export const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

interface Names {
  board: Board
  groups: Pick<Group, 'id' | 'name'>[]
  people?: Pick<Person, 'id' | 'name'>[]
}
function namer({ board, groups, people = [] }: Names) {
  const columns = boardColumns(board)
  return {
    column: (id: string) =>
      id === 'date' ? 'Prazo' : columns.find((c) => c.id === id)?.name || 'coluna removida',
    option: (columnId: string, optionId: string | null) =>
      columns.find((c) => c.id === columnId)?.options?.find((o) => o.id === optionId)?.label ||
      'etiqueta removida',
    group: (id: string) => groups.find((g) => g.id === id)?.name || 'grupo removido',
    people: (ids: string[]) =>
      ids.map((id) => people.find((p) => p.id === id)?.name || 'pessoa').join(', ') || 'ninguém',
  }
}
function days(n: number) {
  return `${Math.abs(n)} dia${Math.abs(n) === 1 ? '' : 's'}`
}
export function describeTrigger(trigger: AutomationTrigger, names: Names) {
  const n = namer(names)
  const t = trigger
  if (t.type === 'status_changed')
    return t.optionId === null
      ? `Quando ${n.column(t.columnId)} mudar`
      : `Quando ${n.column(t.columnId)} mudar para ${n.option(t.columnId, t.optionId)}`
  if (t.type === 'item_created') return 'Quando um item for criado'
  if (t.type === 'moved_to_group') return `Quando um item for movido para ${n.group(t.groupId)}`
  if (t.type === 'subitems_done') return 'Quando todos os subitens forem concluídos'
  if (t.type === 'date_arrives')
    return t.offsetDays === 0
      ? `Quando ${n.column(t.columnId)} chegar`
      : `${days(t.offsetDays)} ${t.offsetDays < 0 ? 'antes' : 'depois'} de ${n.column(t.columnId)}`
  if (t.every === 'day') return 'Todo dia'
  if (t.every === 'week') return `Toda ${WEEKDAYS[t.weekday ?? 1]}`
  return `Todo dia ${t.monthDay ?? 1} do mês`
}
export function describeAction(action: AutomationAction, names: Names) {
  const n = namer(names)
  const a = action
  if (a.type === 'move_group') return `mover o item para ${n.group(a.groupId)}`
  if (a.type === 'set_status')
    return a.optionId === null
      ? `limpar ${n.column(a.columnId)}`
      : `mudar ${n.column(a.columnId)} para ${n.option(a.columnId, a.optionId)}`
  if (a.type === 'set_date')
    return a.mode === 'clear'
      ? `limpar ${n.column(a.columnId)}`
      : a.mode === 'today' || !a.days
        ? `definir ${n.column(a.columnId)} para hoje`
        : `definir ${n.column(a.columnId)} para ${days(a.days)} ${a.days < 0 ? 'antes de' : 'depois de'} hoje`
  if (a.type === 'assign')
    return a.mode === 'clear'
      ? 'remover os responsáveis'
      : `${a.mode === 'add' ? 'adicionar' : 'atribuir'} ${n.people(a.personIds)}`
  if (a.type === 'notify')
    return a.to === 'owners' ? 'notificar os responsáveis' : `notificar ${n.people(a.personIds)}`
  return `criar "${a.title}" em ${n.group(a.groupId)}`
}
/** "Quando Status mudar para Feito, mover o item para Concluídas e notificar os responsáveis." */
export function describeRule(
  rule: { trigger: AutomationTrigger; actions: AutomationAction[] },
  names: Names,
) {
  const actions = rule.actions.map((action) => describeAction(action, names))
  const list =
    actions.length > 1 ? `${actions.slice(0, -1).join(', ')} e ${actions.at(-1)}` : actions[0]
  return `${describeTrigger(rule.trigger, names)}, ${list}.`
}
