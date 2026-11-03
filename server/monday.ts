import { MAX_ROWS } from './imports.ts'
import type {
  ImportPreview,
  ImportSourceColumn,
  LabelOption,
  MondayFolder,
} from '../shared/domain.ts'
import {
  enrichMondayPreview,
  MONDAY_ITEM_FIELDS,
  MONDAY_COLUMN_FIELDS,
  type RichMondayBoard,
  type RichMondayItem,
} from './monday-data.ts'
import { mondayCapability } from '../shared/monday-capabilities.ts'

export type MondayFetch = typeof fetch
export async function mondayRequest<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  fetcher: MondayFetch = fetch,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response
    try {
      response = await fetcher('https://api.monday.com/v2', {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
          'API-Version': process.env.MONDAY_API_VERSION || '2026-10',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(25_000),
        redirect: 'error',
      })
    } catch {
      throw new Error('Não foi possível conectar ao monday. Confira a conexão e tente novamente.')
    }
    if (response.status === 401 || response.status === 403)
      throw new Error('Token inválido ou sem permissão para acessar este quadro.')
    const json = (await response.json().catch(() => {
      throw new Error('O monday retornou uma resposta inválida. Tente novamente mais tarde.')
    })) as {
      data?: T
      errors?: { message: string; extensions?: { code?: string } }[]
    }
    const limited =
      response.status === 429 || json.errors?.some((e) => /limit|complexity/i.test(e.message))
    if (limited && attempt < 2) {
      const seconds = Number(response.headers.get('retry-after') || 2)
      if (seconds > 5)
        throw new Error(
          'O monday atingiu o limite de consultas. Aguarde um pouco e tente novamente.',
        )
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, seconds) * 1000))
      continue
    }
    if (!response.ok || json.errors?.length || !json.data)
      throw new Error(
        limited
          ? 'O monday atingiu o limite de consultas. Tente novamente em alguns minutos.'
          : 'O monday não conseguiu retornar os dados. Confira o acesso e tente novamente.',
      )
    return json.data
  }
  throw new Error('Não foi possível consultar o monday.')
}
interface MondayBoard {
  id: string
  name: string
  description: string | null
}
export async function listMondayBoards(token: string, fetcher?: MondayFetch) {
  const boards: MondayBoard[] = []
  const seen = new Set<string>()
  for (let page = 1; ; page++) {
    const data = await mondayRequest<{ boards: MondayBoard[] }>(
      token,
      'query ($page:Int!) { boards(limit:50,page:$page,state:active) { id name description type } }',
      { page },
      fetcher,
    )
    const previousCount = seen.size
    for (const board of data.boards) {
      if (seen.has(board.id)) continue
      seen.add(board.id)
      if (!('type' in board) || board.type === 'board') boards.push(board)
    }
    if (data.boards.length < 50) break
    if (seen.size === previousCount)
      throw new Error('O Monday repetiu uma página da lista de quadros. Tente novamente.')
  }
  return boards
}
export interface MondayItem {
  id: string
  name: string
  group: { id?: string; title: string }
  column_values: MondayValue[]
}
export interface MondayValue {
  id: string
  text: string | null
  value: string | null
  label?: string | null
  index?: number | null
  label_style?: { color: string } | null
  values?: { id: string; label: string }[]
}
export interface MondayColumn {
  id: string
  title: string
  type: string
  settings?: unknown
  settings_str?: string
  width?: number | null
  archived?: boolean
}
interface MondayPage {
  cursor: string | null
  items: MondayItem[]
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return object(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function hex(value: unknown, fallback = '#798099') {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}
export function sourceColumn(column: MondayColumn, header: string): ImportSourceColumn {
  let type = mondayCapability(column.type).type || 'external'
  const settings = object(column.settings)
  const legacy = object(column.settings_str)
  const formula =
    typeof settings.formula === 'string'
      ? settings.formula
      : typeof legacy.formula === 'string'
        ? legacy.formula
        : undefined
  if (column.type === 'formula' && formula) type = 'formula'
  if (column.type === 'formula' && !formula) type = 'external'
  const labels = settings.labels || legacy.labels
  const colors = object(legacy.labels_colors)
  const positions = object(legacy.labels_positions_v2)
  const entries: Record<string, unknown>[] = Array.isArray(labels)
    ? labels.map((label) => object(label))
    : Object.entries(object(labels)).map(([id, label]) => ({
        id,
        label,
        hex: object(colors[id]).color,
        index: positions[id],
      }))
  const options: LabelOption[] = []
  entries.sort((a, b) => Number(a.index ?? a.id) - Number(b.index ?? b.id))
  for (const label of entries) {
    const name = String(label.label ?? label.name ?? '').trim()
    if (
      !name ||
      options.some((o) => o.label.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))
    )
      continue
    if (name.length > 300)
      throw new Error(`A coluna “${column.title}” contém uma etiqueta com mais de 300 caracteres.`)
    options.push({
      id: `monday-${label.id}`,
      label: name,
      color: hex(label.hex || object(colors[String(label.id)]).color),
      isDone: Array.isArray(legacy.done_colors)
        ? legacy.done_colors.includes(Number(label.id))
        : label.is_done === true,
    })
  }
  return {
    header,
    sourceId: column.id,
    name: column.title,
    sourceType: column.type,
    type,
    settings: { ...legacy, ...settings },
    ...(formula ? { formula } : {}),
    ...(column.width ? { width: column.width } : {}),
    archived: column.archived,
    ...(['status', 'dropdown'].includes(type) ? { options } : {}),
  }
}
export function columnValue(
  column: ImportSourceColumn,
  cell?: MondayValue,
  people: ImportPreview['people'] = [],
): string {
  if (!cell) return ''
  const raw = object(cell.value)
  if (column.type === 'people' && Array.isArray(raw.personsAndTeams)) {
    const entries = raw.personsAndTeams.map(object)
    if (
      entries.every(
        (entry) => entry.kind === 'person' && people.some((p) => p.sourceId === String(entry.id)),
      )
    )
      return entries.length
        ? JSON.stringify(entries.map((entry) => `monday-person:${entry.id}`))
        : ''
  }
  if (column.type === 'status') {
    const label =
      cell.label ??
      cell.text ??
      column.options?.find((o) => o.id === `monday-${raw.index}`)?.label ??
      ''
    if (label && !column.options?.some((o) => o.label === label))
      column.options?.push({
        id: `monday-value-${raw.index ?? label}`,
        label,
        color: hex(cell.label_style?.color),
      })
    return label
  }
  if (column.type === 'dropdown') {
    const labels =
      cell.values?.map((v) => v.label) ||
      (Array.isArray(raw.ids)
        ? raw.ids
            .map((id) => column.options?.find((o) => o.id === `monday-${id}`)?.label)
            .filter((v): v is string => !!v)
        : cell.text
          ? [cell.text]
          : [])
    for (const label of labels) {
      if (!column.options?.some((o) => o.label === label))
        column.options?.push({ id: `monday-value-${label}`, label, color: '#798099' })
    }
    return labels.length ? JSON.stringify(labels) : ''
  }
  if (column.type === 'date') return typeof raw.date === 'string' ? raw.date : cell.text || ''
  if (column.type === 'number' && cell.value) {
    try {
      const value: unknown = JSON.parse(cell.value)
      if (
        (typeof value === 'number' || typeof value === 'string') &&
        value !== '' &&
        Number.isFinite(Number(value))
      )
        return String(value)
    } catch {
      /* Use the API's text representation when raw data is absent. */
    }
  }
  return cell.text || ''
}
export async function previewMonday(
  token: string,
  boardId: string,
  fetcher?: MondayFetch,
): Promise<ImportPreview> {
  return (await prepareMondayPreview(token, boardId, fetcher)).preview
}

async function mondayFolderPath(token: string, folderId: string | null, fetcher?: MondayFetch) {
  const path: MondayFolder[] = []
  const visited = new Set<string>()
  while (folderId !== null) {
    if (visited.has(folderId) || path.length >= 24) throw new Error('Caminho de pastas inválido.')
    visited.add(folderId)
    const { folders } = await mondayRequest<{
      folders: (MondayFolder & { parent: { id: string } | null })[]
    }>(
      token,
      'query ($ids:[ID!]) { folders(ids:$ids) { id name parent { id } } }',
      {
        ids: [folderId],
      },
      fetcher,
    )
    const folder = folders?.find((item) => item.id === folderId)
    if (!folder?.name?.trim() || (folder.parent !== null && !folder.parent?.id))
      throw new Error('Pasta não encontrada.')
    path.unshift({ id: folder.id, name: folder.name })
    folderId = folder.parent?.id ?? null
  }
  return path
}

export async function prepareMondayPreview(token: string, boardId: string, fetcher?: MondayFetch) {
  const fields = MONDAY_ITEM_FIELDS
  const data = await mondayRequest<{
    boards: {
      name: string
      board_folder_id?: string | null
      columns: MondayColumn[]
      groups?: { id?: string; title: string; color: string }[]
      items_page: MondayPage
    }[]
  }>(
    token,
    `query ($ids:[ID!]!) { boards(ids:$ids) { id name description board_kind board_folder_id hierarchy_type views { id name type settings settings_str filter sort } groups { id title color position } columns { ${MONDAY_COLUMN_FIELDS} } items_page(limit:100) { cursor items { ${fields} } } } }`,
    { ids: [boardId] },
    fetcher,
  )
  const board = data.boards[0]
  if (!board) throw new Error('Quadro não encontrado ou sem acesso.')
  const items = [...board.items_page.items]
  let cursor = board.items_page.cursor
  const visited = new Set<string>()
  while (cursor) {
    if (visited.has(cursor))
      throw new Error('O monday repetiu uma página. Tente novamente mais tarde.')
    visited.add(cursor)
    if (items.length >= MAX_ROWS)
      throw new Error(
        `Este quadro ultrapassa ${MAX_ROWS} tarefas. Divida a migração em arquivos menores.`,
      )
    const next = await mondayRequest<{ next_items_page: MondayPage }>(
      token,
      `query ($cursor:String!) { next_items_page(limit:100,cursor:$cursor) { cursor items { ${fields} } } }`,
      { cursor },
      fetcher,
    )
    if (next.next_items_page.cursor === cursor)
      throw new Error('O monday repetiu uma página. Tente novamente mais tarde.')
    items.push(...next.next_items_page.items)
    cursor = next.next_items_page.cursor
  }
  if (items.length > MAX_ROWS)
    throw new Error(`Nesta versão, importe até ${MAX_ROWS} tarefas por vez.`)
  const columns = board.columns.filter((c) => c.type !== 'name' && c.type !== 'subtasks')
  const headers = ['Tarefa', 'Grupo', 'ID monday', ...columns.map((c) => `${c.title} [${c.id}]`)]
  const metadata = columns.map((column, i) => sourceColumn(column, headers[i + 3]))
  const warnings = [
    'Esta versão importa tarefas ativas e valores das colunas. Subitens, comentários, arquivos, automações e vínculos entre quadros ainda não são migrados.',
  ]
  if (columns.some((c) => ['formula', 'mirror', 'board_relation'].includes(c.type)))
    warnings.push(
      'Colunas calculadas ou vinculadas podem vir vazias pela API e não manterão suas regras de cálculo.',
    )
  const unsupported = columns.filter(
    (c) =>
      !['status', 'dropdown', 'date', 'numbers', 'people', 'text', 'long_text'].includes(c.type),
  )
  if (unsupported.length)
    warnings.push(
      `Colunas sem equivalente nesta importação serão preservadas como texto quando a API retornar um valor: ${unsupported
        .slice(0, 8)
        .map((c) => c.title)
        .join(', ')}${unsupported.length > 8 ? ` e mais ${unsupported.length - 8}` : ''}.`,
    )
  const peopleIds = [
    ...new Set(
      items.flatMap((item) =>
        item.column_values
          .filter((v) => columns.some((c) => c.id === v.id && c.type === 'people'))
          .flatMap((v) => {
            const entries = object(v.value).personsAndTeams
            return Array.isArray(entries)
              ? entries
                  .map(object)
                  .filter((p) => p.kind === 'person')
                  .map((p) => String(p.id))
              : []
          }),
      ),
    ),
  ].filter((id) => /^\d+$/.test(id))
  const people: NonNullable<ImportPreview['people']> = []
  if (peopleIds.length) {
    try {
      for (let i = 0; i < peopleIds.length; i += 100) {
        const result = await mondayRequest<{
          users: { id: string; name: string; email: string }[]
        }>(
          token,
          'query ($ids:[ID!]!) { users(ids:$ids,limit:100) { id name email } }',
          { ids: peopleIds.slice(i, i + 100) },
          fetcher,
        )
        for (const person of result.users)
          people.push({ sourceId: person.id, name: person.name, email: person.email || '' })
      }
    } catch {
      warnings.push(
        'Não foi possível consultar os contatos do monday. Responsáveis serão relacionados pelos nomes disponíveis; confira os avisos após importar.',
      )
    }
  }
  const rows = items.map((item) => [
    item.name,
    item.group?.title || '',
    item.id,
    ...metadata.map((column) =>
      columnValue(
        column,
        item.column_values.find((v) => v.id === column.sourceId),
        people,
      ),
    ),
  ])
  if (headers.length > 120 || rows.some((row) => row.some((cell) => cell.length > 1_000_000)))
    throw new Error(
      'Este quadro ultrapassa o limite de 120 colunas ou 1.000.000 de caracteres por célula.',
    )
  if (metadata.some((c) => (c.options?.length || 0) > 200))
    throw new Error('A importação aceita até 200 etiquetas por coluna nesta versão.')
  const basic: ImportPreview = {
    name: board.name,
    source: 'monday',
    sourceBoardId: boardId,
    headers,
    warnings,
    columns: metadata,
    groups: board.groups?.map((group) => ({ name: group.title, color: hex(group.color) })),
    people,
    rows,
  }
  const bundle = await enrichMondayPreview(
    token,
    boardId,
    board as RichMondayBoard,
    items as RichMondayItem[],
    basic,
    fetcher,
  )
  if (board.board_folder_id !== undefined) {
    try {
      bundle.preview.mondayFolderPath = await mondayFolderPath(
        token,
        board.board_folder_id,
        fetcher,
      )
    } catch {
      bundle.preview.warnings.push(
        'O Monday não retornou o caminho completo da pasta. Confira se a chave tem acesso às pastas do quadro.',
      )
    }
  }
  return bundle
}
