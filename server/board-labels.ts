import type { Database } from './database.ts'
import { camelRow } from './database.ts'
import { DomainError } from './errors.ts'
import {
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_PRIORITY_OPTIONS,
  type Board,
  type LabelOption,
} from '../shared/domain.ts'
export async function migrateBoardLabels(
  db: Database,
  boardId: string,
  settings: Record<string, unknown>,
) {
  const row = (await db.query('SELECT * FROM boards WHERE id=$1 FOR UPDATE', [boardId])).rows[0]
  if (!row) throw new DomainError('Quadro não encontrado.', 404)
  const board = camelRow<Board>(row)
  for (const key of [
    'statusOptions',
    'priorityOptions',
    'subitemStatusOptions',
    'subitemPriorityOptions',
  ] as const) {
    if (!(key in settings)) continue
    const input = settings[key]
    if (
      !Array.isArray(input) ||
      input.length < 1 ||
      input.length > 200 ||
      input.some(
        (option) =>
          !option ||
          typeof option.id !== 'string' ||
          typeof option.label !== 'string' ||
          !option.label.trim() ||
          option.label.length > 300 ||
          !/^#[0-9a-f]{6}$/i.test(option.color) ||
          (option.isDone !== undefined && typeof option.isDone !== 'boolean'),
      )
    )
      throw new DomainError('Informe etiquetas válidas para o quadro.')
    const next = input as LabelOption[]
    if (
      new Set(next.map((option) => option.id)).size !== next.length ||
      new Set(next.map((option) => option.label.toLocaleLowerCase('pt-BR'))).size !== next.length
    )
      throw new DomainError('As etiquetas precisam ter identificadores e nomes únicos.')
    const field = key.toLowerCase().includes('priority') ? 'priority' : 'status',
      subitems = key.startsWith('subitem')
    const inherited =
      field === 'status' ? board.settings?.statusOptions : board.settings?.priorityOptions
    const previous =
      board.settings?.[key] ||
      (subitems ? inherited : undefined) ||
      (field === 'status' ? DEFAULT_STATUS_OPTIONS : DEFAULT_PRIORITY_OPTIONS)
    const independent =
      field === 'status'
        ? board.settings?.subitemStatusOptions
        : board.settings?.subitemPriorityOptions
    const scope = subitems ? 'parent_id IS NOT NULL' : independent ? 'parent_id IS NULL' : 'TRUE'
    const updates: { before: string; after: string }[] = []
    for (const option of previous) {
      const replacement = next.find((entry) => entry.id === option.id)
      if (!replacement) {
        if (
          (
            await db.query(
              `SELECT id FROM tasks WHERE board_id=$1 AND ${scope} AND ${field}=$2 LIMIT 1`,
              [boardId, option.label],
            )
          ).rows.length
        )
          throw new DomainError(
            `A etiqueta “${option.label}” está em uso. Mantenha-a ou altere os itens antes de removê-la.`,
          )
      } else if (replacement.label !== option.label)
        updates.push({ before: option.label, after: replacement.label })
    }
    if (updates.length) {
      // One CASE avoids rename cycles such as swapping the names of two labels.
      const cases = updates
        .map((_, index) => `WHEN $${index * 2 + 2} THEN $${index * 2 + 3}`)
        .join(' ')
      const names = updates.flatMap((entry) => [entry.before, entry.after])
      await db.query(
        `UPDATE tasks SET ${field}=CASE ${field} ${cases} ELSE ${field} END,version=version+1,updated_at=$${names.length + 2} WHERE board_id=$1 AND ${scope} AND ${field}=ANY($${names.length + 3}::text[])`,
        [boardId, ...names, new Date().toISOString(), updates.map((entry) => entry.before)],
      )
    }
  }
}
