import type { Database } from './database.ts'
import { camelRow } from './database.ts'
import { id } from './repository.ts'
import { editColumn } from './columns.ts'
import { boardColumns, columnList, SYSTEM_COLUMN_IDS } from '../shared/columns.ts'
import { importKey, importLabel } from '../shared/imports.ts'
import { columnLayout } from '../shared/board-layout.ts'
import {
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_PRIORITY_OPTIONS,
  type Board,
  type CustomColumn,
  type ImportMapping,
  type ImportPreview,
  type LabelOption,
} from '../shared/domain.ts'

export async function prepareImportColumns(
  db: Database,
  boardId: string,
  preview: ImportPreview,
  mapping: ImportMapping,
  fresh: boolean,
  warnings: Set<string>,
  scope: 'tasks' | 'subitems' = 'tasks',
) {
  const row = (await db.query('SELECT * FROM boards WHERE id=$1 FOR UPDATE', [boardId])).rows[0]
  if (!row) throw new Error('O quadro de destino não existe.')
  let board = camelRow<Board>(row)
  const settings = { ...board.settings }
  const customColumns: Record<string, string> = Object.create(null)
  const populateSourceColumns: string[] = []
  const ordered: string[] = []
  const mappedSystem = { owner: 'owner', status: 'status', priority: 'priority', dueDate: 'date' }
  for (const header of preview.headers) {
    const field = mapping[header]
    const source =
      preview.source === 'monday' ? preview.columns?.find((c) => c.header === header) : undefined
    if (field && field in mappedSystem) {
      const key = mappedSystem[field as keyof typeof mappedSystem]
      ordered.push(key)
      const namesKey = scope === 'tasks' ? 'columnNames' : 'subitemColumnNames'
      const widthsKey = scope === 'tasks' ? 'columnWidths' : 'subitemColumnWidths'
      if (source && fresh) settings[namesKey] = { ...settings[namesKey], [key]: source.name }
      if (source?.width && fresh)
        settings[widthsKey] = {
          ...settings[widthsKey],
          [key]: Math.max(columnLayout(key).min, Math.min(columnLayout(key).max, source.width)),
        }
      if (source?.type === 'status' && (field === 'status' || field === 'priority')) {
        const settingsKey =
          scope === 'subitems'
            ? field === 'status'
              ? 'subitemStatusOptions'
              : 'subitemPriorityOptions'
            : field === 'status'
              ? 'statusOptions'
              : 'priorityOptions'
        const defaults = field === 'status' ? DEFAULT_STATUS_OPTIONS : DEFAULT_PRIORITY_OPTIONS
        const current = fresh ? [] : settings[settingsKey] || defaults
        const options: LabelOption[] = [...current]
        for (const option of source.options || []) {
          const label = preview.items ? option.label : importLabel(option.label, field)
          if (
            !options.some(
              (o) =>
                o.id === `${preview.sourceBoardId}-${source.sourceId}-${option.id}` ||
                importKey(o.label) === importKey(label),
            )
          )
            options.push({
              ...option,
              id: `${preview.sourceBoardId}-${source.sourceId}-${option.id}`,
              label,
            })
        }
        const fallback = defaults.find(
          (o) => o.label === (field === 'status' ? 'Não iniciado' : 'Média'),
        )!
        if (!preview.items && !options.some((o) => o.label === fallback.label))
          options.push(fallback)
        if (options.length > 200)
          throw new Error(
            'A coluna de destino ultrapassaria 200 etiquetas. Importe para um novo quadro.',
          )
        settings[settingsKey] = options
      }
    }
    if (field !== 'custom') continue
    const lineage = source && {
      provider: 'monday' as const,
      boardId: source.sourceBoardId || preview.sourceBoardId!,
      columnId: source.sourceId,
      type: source.sourceType,
      settings: source.settings,
      formula: source.formula,
      scope,
      readOnly:
        source.type === 'last_updated' ||
        (source.type === 'external' &&
          ![
            'link',
            'email',
            'phone',
            'country',
            'location',
            'rating',
            'tags',
            'hour',
            'week',
            'world_clock',
            'color_picker',
            'board_relation',
            'dependency',
          ].includes(source.sourceType)),
    }
    let old = board.columns.find((column) =>
      lineage
        ? (column.source?.boardId === lineage.boardId &&
            column.source.columnId === lineage.columnId) ||
          column.name === header
        : column.name === header,
    )
    const column: CustomColumn = {
      id: old?.id || id(),
      name: old?.source ? old.name : source?.name || header,
      type: old?.source?.type ? old.type : source?.type || old?.type || 'text',
      ...(lineage ? { source: lineage } : {}),
      ...(old?.formula ? { formula: old.formula } : {}),
    }
    if (column.source && old?.source?.type && old.type === 'external')
      column.source.readOnly = old.source.readOnly
    if (column.source && old?.source?.scope) column.source.scope = old.source.scope
    if (column.type === 'status' || column.type === 'dropdown') {
      column.options = [
        ...(old?.source ? old.options || [] : source?.options || old?.options || []),
      ]
      for (const option of old?.source ? source?.options || [] : old?.options || [])
        if (
          !column.options.some(
            (o) => o.id === option.id || importKey(o.label) === importKey(option.label),
          )
        )
          column.options.push(option)
      if (old) {
        const values = (
          await db.query<{ value: string }>(
            'SELECT DISTINCT custom_values->>$1 AS value FROM tasks WHERE board_id=$2 AND custom_values ? $1',
            [old.id, boardId],
          )
        ).rows.flatMap(({ value }) =>
          old!.type === 'dropdown' || (column.type === 'dropdown' && value?.trim().startsWith('['))
            ? columnList(value)
            : value
              ? [value]
              : [],
        )
        for (const value of values) {
          if (!column.options.some((o) => o.label === value)) {
            column.options.push({ id: id(), label: value, color: '#798099' })
            warnings.add(
              'Etiquetas já utilizadas no destino foram preservadas ao atualizar as colunas.',
            )
          }
        }
      }
      if (!column.options.length)
        column.options.push({ id: id(), label: 'Sem etiqueta', color: '#798099' })
      if (column.options.length > 200)
        throw new Error(
          'A coluna de destino ultrapassaria 200 etiquetas. Importe para um novo quadro.',
        )
    }
    if (!old && board.columns.length >= 100)
      throw new Error(
        'O quadro permite até 100 colunas personalizadas. Ignore algumas colunas ou escolha outro destino.',
      )
    if (
      old &&
      source &&
      [
        'files',
        'last_updated',
        'external',
        'time_tracking',
        'timeline',
        'checkbox',
        'formula',
      ].includes(column.type) &&
      old.type === 'text'
    ) {
      // Rich import retains the previous text in the report and replaces it with structured source data.
      await db.query(
        'UPDATE tasks SET custom_values=custom_values-$1::text WHERE board_id=$2 AND custom_values ? $1',
        [old.id, boardId],
      )
      populateSourceColumns.push(column.id)
      board.columns = board.columns.map((c) => (c.id === old!.id ? column : c))
    } else if (old && source && (old.type !== column.type || column.options)) {
      // Convert legacy text columns atomically, including values on previously imported tasks.
      await editColumn(db, boardId, old.id, {
        name: column.name,
        type: column.type,
        options: column.options,
      })
      board.columns = board.columns.map((c) => (c.id === old!.id ? column : c))
    } else if (!old) {
      board.columns.push(column)
      if (source) populateSourceColumns.push(column.id)
    } else if (source) board.columns = board.columns.map((c) => (c.id === old!.id ? column : c))
    customColumns[header] = column.id
    ordered.push(column.id)
    const widthsKey = scope === 'tasks' ? 'columnWidths' : 'subitemColumnWidths'
    if (source?.width && fresh)
      settings[widthsKey] = {
        ...settings[widthsKey],
        [column.id]: Math.max(
          columnLayout(column.id).min,
          Math.min(columnLayout(column.id).max, source.width),
        ),
      }
    // Persist each definition before a later conversion or task validation reads it.
    await db.query('UPDATE boards SET columns=$1::jsonb WHERE id=$2', [
      JSON.stringify(board.columns),
      boardId,
    ])
  }
  if (fresh && preview.source === 'monday' && preview.columns && scope === 'tasks') {
    settings.columnOrder = ['title', ...ordered]
    settings.hiddenColumns = SYSTEM_COLUMN_IDS.filter((key) => !ordered.includes(key))
  }
  if (fresh && preview.source === 'monday' && scope === 'subitems') {
    settings.subitemColumnOrder = ordered
    settings.subitemColumns = ordered
    settings.hiddenColumns = [
      ...new Set([
        ...(settings.hiddenColumns || []),
        ...board.columns
          .filter((column) => column.source?.scope === 'subitems')
          .map((column) => column.id),
      ]),
    ]
  }
  await db.query('UPDATE boards SET settings=$1::jsonb WHERE id=$2', [
    JSON.stringify(settings),
    boardId,
  ])
  board = { ...board, settings }
  return { board, customColumns, columns: boardColumns(board, scope), populateSourceColumns }
}
