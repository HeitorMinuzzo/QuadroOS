export const STATUSES = [
  'Feito',
  'Em andamento',
  'Parado',
  'Não iniciado',
  'Aguardando',
  'Contínuo',
] as const
export const PRIORITIES = [
  'Crítico',
  'Alta',
  'Média',
  'Baixa',
  'Sem prioridade',
  'Urgente',
] as const
export type Status = (typeof STATUSES)[number] | (string & {})
export const STATUS_META: Record<string, { tone: string; color: string; label: string }> = {
  Feito: { tone: 'green', color: '#00c875', label: 'Feito' },
  'Em andamento': { tone: 'amber', color: '#fdab3d', label: 'Em andamento' },
  Parado: { tone: 'red', color: '#e2445c', label: 'Parado' },
  'Não iniciado': { tone: 'neutral', color: '#798099', label: 'Não iniciado' },
  Aguardando: { tone: 'cyan', color: '#00a0e9', label: 'Aguardando' },
  Contínuo: { tone: 'purple', color: '#a25ddc', label: 'Contínuo' },
}
export function taskAncestorIds(tasks: Task[], ids: string[]) {
  const byId = new Map(tasks.map((task) => [task.id, task])),
    result = new Set<string>()
  for (const id of ids) {
    let current = byId.get(id)
    const visited = new Set<string>()
    while (current?.parentId && !visited.has(current.parentId)) {
      visited.add(current.parentId)
      result.add(current.parentId)
      current = byId.get(current.parentId)
    }
  }
  return [...result]
}

export interface LabelOption {
  id: string
  label: string
  color: string
  hasWarning?: boolean
  isDone?: boolean
}
export interface BoardSettings {
  statusOptions?: LabelOption[]
  priorityOptions?: LabelOption[]
  columnWidths?: Record<string, number>
  subitemColumns?: string[]
  columnOrder?: string[]
  subitemColumnOrder?: string[]
  columnNames?: Record<string, string>
  hiddenColumns?: string[]
  deletedColumnIds?: string[]
  subitemStatusOptions?: LabelOption[]
  subitemPriorityOptions?: LabelOption[]
  subitemColumnNames?: Record<string, string>
  subitemColumnWidths?: Record<string, number>
  monday?: { boardId: string; importedAt: string; reportId: string }
  mondayFolderPath?: MondayFolder[]
  mondayAutomationIds?: Record<string, string>
}
export const DEFAULT_STATUS_OPTIONS: LabelOption[] = [
  { id: 'status-done', label: 'Feito', color: '#00c875', isDone: true },
  { id: 'status-progress', label: 'Em andamento', color: '#fdab3d' },
  { id: 'status-stopped', label: 'Parado', color: '#e2445c' },
  { id: 'status-not-started', label: 'Não iniciado', color: '#798099' },
  { id: 'status-waiting', label: 'Aguardando', color: '#00a0e9' },
  { id: 'status-continuous', label: 'Contínuo', color: '#a25ddc' },
]
export const DEFAULT_PRIORITY_OPTIONS: LabelOption[] = [
  { id: 'priority-critical', label: 'Crítico', color: '#555953', hasWarning: true },
  { id: 'priority-high', label: 'Alta', color: '#553c9e' },
  { id: 'priority-medium', label: 'Média', color: '#6c7be8' },
  { id: 'priority-low', label: 'Baixa', color: '#579bfc' },
  { id: 'priority-none', label: 'Sem prioridade', color: '#798099' },
]
export interface PriorityMeta {
  tone: string
  color: string
  label: string
  hasWarning?: boolean
}
export const PRIORITY_OPTIONS = ['Crítico', 'Alta', 'Média', 'Baixa', 'Sem prioridade'] as const
export const PRIORITY_META: Record<string, PriorityMeta> = {
  Crítico: { tone: 'critical', color: '#555953', label: 'Crítico', hasWarning: true },
  Urgente: { tone: 'critical', color: '#555953', label: 'Crítico', hasWarning: true },
  Alta: { tone: 'high', color: '#553c9e', label: 'Alta' },
  Média: { tone: 'medium', color: '#6c7be8', label: 'Média' },
  Baixa: { tone: 'low', color: '#579bfc', label: 'Baixa' },
  'Sem prioridade': { tone: 'none', color: '#798099', label: 'Sem prioridade' },
  '': { tone: 'none', color: '#798099', label: 'Sem prioridade' },
}
export type Priority = (typeof PRIORITIES)[number] | (string & {})
export interface Person {
  id: string
  name: string
  initials: string
  color: string
  email: string
}
export const COLUMN_TYPES = [
  'status',
  'text',
  'people',
  'files',
  'dropdown',
  'date',
  'number',
  'formula',
  'timeline',
  'checkbox',
  'time_tracking',
  'last_updated',
  'external',
] as const
export type ColumnType = (typeof COLUMN_TYPES)[number]
export interface CustomColumn {
  id: string
  name: string
  type: ColumnType
  options?: LabelOption[]
  formula?: string
  source?: {
    provider: 'monday'
    boardId: string
    columnId: string
    type?: string
    settings?: Record<string, unknown>
    readOnly?: boolean
    formula?: string
    scope?: 'tasks' | 'subitems'
  }
}
export interface FileAttachment {
  id: string
  taskId: string
  columnId: string
  name: string
  size: number
  createdAt: string
  source?: string | null
  externalId?: string | null
  commentId?: string | null
  externalUrl?: string | null
}
export const MAX_FILE_SIZE = 5 * 1024 * 1024
export const MAX_CELL_FILES = 20
export interface Board {
  id: string
  name: string
  description: string
  color: string
  icon: string
  favorite: boolean
  columns: CustomColumn[]
  settings?: BoardSettings
}
export interface Group {
  id: string
  boardId: string
  name: string
  color: string
  position: number
  isCompleted: boolean
  source?: string | null
  externalId?: string | null
}
export interface BoardAutomation {
  id: string
  boardId: string
  columnId: string
  optionId: string
  groupId: string
  description: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}
export interface AutomationRun {
  id: string
  boardId: string
  automationId: string | null
  taskId: string | null
  taskTitle: string
  ruleDescription: string
  fromGroup: string
  toGroup: string
  createdAt: string
}
export interface Task {
  id: string
  boardId: string
  groupId: string
  title: string
  description: string
  status: Status
  priority: Priority
  dueDate: string | null
  dueAt?: string | null
  ownerId: string | null
  ownerIds: string[]
  position: number
  createdAt: string
  updatedAt: string
  version: number
  source: string | null
  externalId: string | null
  customValues: Record<string, string>
  parentId: string | null
  previousGroupId: string | null
}
export interface Comment {
  id: string
  taskId: string
  authorId: string
  body: string
  createdAt: string
  parentId?: string | null
  source?: string | null
  externalId?: string | null
  metadata?: Record<string, unknown>
}
export type TaskPanelTab = 'details' | 'updates' | 'files'
export function taskUpdateCounts(comments: Comment[]) {
  const byId = new Map(comments.map((comment) => [comment.id, comment])),
    counts = new Map<string, number>()
  for (const comment of comments)
    if (!comment.parentId || byId.get(comment.parentId)?.taskId !== comment.taskId)
      counts.set(comment.taskId, (counts.get(comment.taskId) || 0) + 1)
  return counts
}
export function taskUpdateCount(comments: Comment[], taskId: string) {
  const own = comments.filter((comment) => comment.taskId === taskId),
    ids = new Set(own.map((comment) => comment.id))
  return own.filter((comment) => !comment.parentId || !ids.has(comment.parentId)).length
}
export function taskOwnerIds(task: { ownerIds?: string[]; ownerId?: string | null }) {
  return task.ownerIds?.length ? task.ownerIds : task.ownerId ? [task.ownerId] : []
}
export interface ImportRun {
  id: string
  boardId: string
  source: string
  name: string
  imported: number
  skipped: number
  createdAt: string
  reportId?: string | null
}
export interface Workspace {
  boards: Board[]
  groups: Group[]
  tasks: Task[]
  people: Person[]
  comments: Comment[]
  imports: ImportRun[]
  database: string
  attachments?: FileAttachment[]
}
export const EMPTY_WORKSPACE: Workspace = {
  boards: [],
  groups: [],
  tasks: [],
  people: [],
  comments: [],
  imports: [],
  database: '',
  attachments: [],
}
export interface MondayFolder {
  id: string
  name: string
}

export interface MondayBatchResult {
  sourceBoardId: string
  name: string
  boardId?: string
  reportId?: string
  imported?: number
  skipped?: number
  warnings?: string[]
  error?: string
}

export interface MondayBatch {
  id: string
  status: 'running' | 'complete' | 'failed' | 'interrupted'
  total: number | null
  currentBoard: string | null
  results: MondayBatchResult[]
  error?: string
}

export interface ImportPreview {
  headers: string[]
  rows: string[][]
  name: string
  source: 'file' | 'monday'
  sourceBoardId?: string
  mondayFolderPath?: MondayFolder[]
  warnings: string[]
  columns?: ImportSourceColumn[]
  groups?: { name: string; color: string; sourceId?: string }[]
  people?: { sourceId: string; name: string; email: string }[]
  description?: string
  sessionId?: string
  subitemColumns?: ImportSourceColumn[]
  items?: ImportSourceItem[]
  updates?: ImportSourceUpdate[]
  assets?: ImportSourceAsset[]
  automations?: Record<string, unknown>[]
  sourceMetadata?: Record<string, unknown>
  coverage?: ImportCoverage[]
  counts?: { tasks: number; subitems: number; comments: number; files: number; bytes: number }
}
export interface ImportSourceColumn {
  header: string
  sourceId: string
  name: string
  sourceType: string
  type: ColumnType
  options?: LabelOption[]
  sourceBoardId?: string
  settings?: Record<string, unknown>
  width?: number
  archived?: boolean
  formula?: string
}
export interface ImportSourceItem {
  externalId: string
  parentExternalId: string | null
  sourceBoardId: string
  title: string
  groupSourceId: string | null
  groupName: string
  createdAt: string | null
  updatedAt: string | null
  values: Record<string, string>
  sourceValues: Record<string, unknown>
}
export interface ImportSourceUpdate {
  externalId: string
  itemExternalId: string | null
  parentExternalId: string | null
  authorSourceId: string | null
  body: string
  createdAt: string | null
  metadata?: Record<string, unknown>
}
export interface ImportSourceAsset {
  externalId: string
  itemExternalId: string
  sourceColumnId: string | null
  updateExternalId: string | null
  name: string
  size: number
  createdAt: string | null
  externalUrl?: string
  failure?: string
}
export interface ImportCoverage {
  name: string
  sourceType: string
  mode: 'native' | 'converted' | 'snapshot' | 'unavailable'
  detail: string
  count?: number
}
export type ImportField =
  | 'title'
  | 'status'
  | 'priority'
  | 'dueDate'
  | 'owner'
  | 'group'
  | 'description'
  | 'externalId'
  | 'custom'
  | 'ignore'
export type ImportMapping = Record<string, ImportField>
export function statusClass(status: string) {
  return STATUS_META[status as Status]?.tone || 'neutral'
}
export function priorityClass(priority: string) {
  return (
    (
      {
        Crítico: 'critical',
        Urgente: 'critical',
        Alta: 'high',
        Média: 'medium',
        Baixa: 'low',
        'Sem prioridade': 'none',
        '': 'none',
      } as Record<string, string>
    )[priority] || 'low'
  )
}
export function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((v) => v[0])
      .join('')
      .toUpperCase() || '?'
  )
}
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function isTaskDone(task: Pick<Task, 'status' | 'parentId'>, board?: Board) {
  const options = task.parentId
    ? board?.settings?.subitemStatusOptions || board?.settings?.statusOptions
    : board?.settings?.statusOptions
  return options?.find((option) => option.label === task.status)?.isDone ?? task.status === 'Feito'
}
export function isOverdue(task: Task, board?: Board) {
  if (task.dueAt) return Date.parse(task.dueAt) < Date.now() && !isTaskDone(task, board)
  return !!task.dueDate && task.dueDate < localDate() && !isTaskDone(task, board)
}
