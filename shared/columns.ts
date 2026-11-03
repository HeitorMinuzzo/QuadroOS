import {
  type Board,
  type CustomColumn,
  type ColumnType,
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_PRIORITY_OPTIONS,
} from './domain.ts'

export const COLUMN_TYPE_NAMES: Record<ColumnType, string> = {
  status: 'Status',
  text: 'Texto',
  people: 'Pessoas',
  dropdown: 'Lista suspensa',
  date: 'Data',
  number: 'Números',
  files: 'Arquivos',
  formula: 'Fórmula',
  timeline: 'Cronograma',
  checkbox: 'Checkbox',
  time_tracking: 'Controle de horas',
  last_updated: 'Última atualização',
  external: 'Coluna da origem',
}
export const SYSTEM_COLUMN_IDS = ['owner', 'status', 'priority', 'date']
export function boardColumns(board: Board, scope: 'tasks' | 'subitems' = 'tasks'): CustomColumn[] {
  return [
    { id: 'owner', name: 'Responsável', type: 'people' as const },
    {
      id: 'status',
      name: 'Status',
      type: 'status' as const,
      options:
        (scope === 'subitems'
          ? board.settings?.subitemStatusOptions
          : board.settings?.statusOptions) || DEFAULT_STATUS_OPTIONS,
    },
    {
      id: 'priority',
      name: 'Prioridade',
      type: 'status' as const,
      options:
        (scope === 'subitems'
          ? board.settings?.subitemPriorityOptions
          : board.settings?.priorityOptions) || DEFAULT_PRIORITY_OPTIONS,
    },
    { id: 'date', name: 'Prazo', type: 'date' as const },
    ...board.columns,
  ].map((column) => ({
    ...column,
    name:
      (scope === 'subitems' ? board.settings?.subitemColumnNames : board.settings?.columnNames)?.[
        column.id
      ] || column.name,
  }))
}
export function columnList(value: string): string[] {
  if (!value) return []
  try {
    const list: unknown = JSON.parse(value)
    if (Array.isArray(list) && list.every((item) => typeof item === 'string'))
      return [...new Set(list)]
  } catch {
    /* Text columns may predate the list format. */
  }
  return [value]
}
