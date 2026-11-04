import {
  mondayRequest,
  sourceColumn,
  columnValue,
  type MondayColumn,
  type MondayItem,
  type MondayValue,
  type MondayFetch,
} from './monday.ts'
import { MAX_ROWS } from './imports.ts'
import type {
  ImportPreview,
  ImportSourceItem,
  ImportSourceUpdate,
  ImportSourceAsset,
  ImportCoverage,
  ImportSourceColumn,
} from '../shared/domain.ts'
import { jsonObject, safeUrl, isoDate } from '../shared/rich-values.ts'
import { mondayCapability } from '../shared/monday-capabilities.ts'

export const MONDAY_COLUMN_FIELDS = 'id title type width archived description settings settings_str'
const ASSET_FIELDS = 'id name file_size created_at public_url'
const AUTHOR_FIELDS = 'id name email'
const UPDATE_FIELDS = `id text_body body created_at updated_at creator { ${AUTHOR_FIELDS} }
  likes { id } pinned_to_top { item_id }
  assets { ${ASSET_FIELDS} }
  replies { id text_body body created_at updated_at creator { ${AUTHOR_FIELDS} } assets { ${ASSET_FIELDS} } }`
export const MONDAY_ITEM_FIELDS = `id name state created_at updated_at creator_id url
  board { id } parent_item { id } group { id title } subitems { id }
  description { id blocks { id type content position parent_block_id } }
  column_values(capabilities:[CALCULATED]) {
    id type text value
    ... on StatusValue { label index is_done label_style { color } }
    ... on DropdownValue { values { id label } }
    ... on FormulaValue { display_value }
    ... on MirrorValue { display_value }
    ... on BoardRelationValue { display_value linked_item_ids }
    ... on DependencyValue { linked_item_ids }
    ... on TimelineValue { from to }
    ... on DateValue { date time is_leaf }
    ... on TimeTrackingValue { duration running started_at history { id started_at ended_at started_user_id ended_user_id status } }
    ... on LastUpdatedValue { updated_at updater_id }
    ... on CreationLogValue { created_at creator_id }
    ... on FileValue { files { __typename
      ... on FileAssetValue { name asset { ${ASSET_FIELDS} } }
      ... on FileLinkValue { file_id name url created_at }
      ... on FileDocValue { file_id url object_id created_at }
      ... on FileAssetInvalidValue { asset_id invalid_name:name error }
    } }
    ... on TagsValue { tags { id name color } }
    ... on VoteValue { vote_count voter_ids }
    ... on BatteryValue { battery_value { key count } }
    ... on WeekValue { start_date end_date }
    ... on WorldClockValue { timezone }
  }
  updates_page(limit:100) { cursor updates { ${UPDATE_FIELDS} } }
`
interface SourceAsset {
  id: string
  name: string
  file_size: number
  created_at?: string
  public_url?: string
}
interface SourceUpdate {
  id: string
  text_body?: string
  body?: string
  created_at?: string
  updated_at?: string
  creator?: { id: string; name: string; email: string } | null
  assets?: SourceAsset[]
  replies?: SourceUpdate[]
  likes?: unknown[]
  pinned_to_top?: unknown[]
}
export interface RichMondayItem extends MondayItem {
  state?: string
  board?: { id: string }
  parent_item?: { id: string } | null
  subitems?: { id: string }[]
  created_at?: string
  updated_at?: string
  creator_id?: string
  url?: string
  description?: { blocks?: Record<string, unknown>[] } | null
  updates_page?: { cursor: string | null; updates: SourceUpdate[] }
}
export interface RichMondayBoard {
  id?: string
  name: string
  description?: string | null
  columns: MondayColumn[]
  groups?: { id?: string; title: string; color: string; position?: string }[]
  views?: Record<string, unknown>[]
  board_kind?: string
  hierarchy_type?: string
}
// Never archive credentials returned as part of automation/integration metadata.
export function publicSourceData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicSourceData)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/^(auth|authorization|token|api[_-]?key|secret|password|public_url|note)$/i.test(key),
        )
        .map(([key, entry]) => [key, publicSourceData(entry)]),
    )
  return value
}
function parsed(value: unknown) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return value
    }
  }
  return value
}
function date(value?: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
}
function plainText(html: string) {
  return html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
export function richColumnValue(
  column: ImportSourceColumn,
  cell: MondayValue | undefined,
  people: ImportPreview['people'],
) {
  if (!cell) return ''
  const details = cell as MondayValue & Record<string, unknown>
  const raw = jsonObject(cell.value)
  if (
    column.type === 'date' &&
    typeof raw.date === 'string' &&
    typeof raw.time === 'string' &&
    raw.time
  )
    return new Date(`${raw.date}T${raw.time}Z`).toISOString()
  if (column.type === 'checkbox')
    return raw.checked === true || raw.checked === 'true' ? 'true' : 'false'
  if (column.type === 'timeline')
    return JSON.stringify({
      from: timelineDay(details.from ?? raw.from),
      to: timelineDay(details.to ?? raw.to),
    })
  if (column.type === 'time_tracking') {
    const capturedAt = new Date().toISOString()
    const history = Array.isArray(details.history)
      ? details.history.map(jsonObject)
      : Array.isArray(raw.history)
        ? raw.history.map(jsonObject)
        : []
    return JSON.stringify({
      duration: Number(details.duration ?? raw.duration) || 0,
      startedAt: details.running ? capturedAt : null,
      sessions: history.map((session) =>
        details.running && !session.ended_at && session.started_at
          ? { ...session, ended_at: capturedAt, status: 'continued_locally', sourceRunning: true }
          : session,
      ),
      sourceStartedAt: details.started_at || null,
    })
  }
  if (column.type === 'last_updated' || column.type === 'external')
    return JSON.stringify({
      value: parsed(cell.value),
      text: details.display_value ?? cell.text ?? '',
      details: publicSourceData(details),
    })
  if (column.type === 'files') return ''
  if (column.type === 'formula') return String(details.display_value ?? cell.text ?? '')
  return columnValue(column, cell, people)
}

function timelineDay(value: unknown) {
  if (value == null || value === '') return null
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}(T|$)/.test(value) &&
    isoDate(value.slice(0, 10))
    ? value.slice(0, 10)
    : value
}
export async function enrichMondayPreview(
  token: string,
  boardId: string,
  board: RichMondayBoard,
  roots: RichMondayItem[],
  basic: ImportPreview,
  fetcher?: MondayFetch,
) {
  // Older integrations can still supply the simple matrix format; the real API always returns these fields.
  if (
    !board.id &&
    !roots.some(
      (item) =>
        item.subitems !== undefined ||
        item.updates_page !== undefined ||
        item.created_at !== undefined,
    )
  )
    return { preview: basic, downloads: new Map<string, string>() }
  const warnings = new Set<string>()
  const coverage: ImportCoverage[] = []
  const all = new Map(roots.map((item) => [item.id, item]))
  let pending = roots.flatMap((item) => item.subitems || []).map((item) => item.id)
  const missing = new Set<string>()
  for (let depth = 0; pending.length; depth++) {
    if (depth >= 5)
      throw new Error(
        'O quadro possui mais de cinco níveis de subitens. A importação foi interrompida para preservar a estrutura.',
      )
    const ids = [...new Set(pending)].filter((id) => !all.has(id) && !missing.has(id))
    pending = []
    for (let start = 0; start < ids.length; start += 25) {
      const chunk = ids.slice(start, start + 25)
      const result = await mondayRequest<{ items: RichMondayItem[] }>(
        token,
        `query ($ids:[ID!]!) { items(ids:$ids,limit:25) { ${MONDAY_ITEM_FIELDS} } }`,
        { ids: chunk },
        fetcher,
      )
      for (const id of chunk) if (!result.items.some((item) => item.id === id)) missing.add(id)
      for (const item of result.items) {
        all.set(item.id, item)
        pending.push(...(item.subitems || []).map((child) => child.id))
      }
      if (all.size > MAX_ROWS)
        throw new Error(`O quadro ultrapassa ${MAX_ROWS} tarefas e subitens nesta importação.`)
    }
  }
  if (missing.size)
    coverage.push({
      name: 'Subitens sem acesso',
      sourceType: 'subtasks',
      mode: 'unavailable',
      count: missing.size,
      detail:
        'A API informou o ID, mas não permitiu consultar o subitem. Os IDs estão no relatório.',
    })
  const configuredChildBoards = board.columns
    .filter((column) => column.type === 'subtasks')
    .flatMap((column) => {
      const settings = { ...jsonObject(column.settings_str), ...jsonObject(column.settings) }
      return Array.isArray(settings.boardIds) ? settings.boardIds.map(String) : []
    })
  const boardIds = [
    ...new Set(
      [...all.values()].map((item) => item.board?.id || boardId).concat(configuredChildBoards),
    ),
  ]
  const definitions = new Map<string, ImportSourceColumn[]>()
  definitions.set(boardId, basic.columns || [])
  const childBoards = boardIds.filter((id) => id !== boardId)
  let childMetadata: RichMondayBoard[] = []
  if (childBoards.length) {
    const result = await mondayRequest<{ boards: RichMondayBoard[] }>(
      token,
      `query ($ids:[ID!]!) { boards(ids:$ids,state:all) { id name columns { ${MONDAY_COLUMN_FIELDS} } } }`,
      { ids: childBoards },
      fetcher,
    )
    childMetadata = result.boards
    for (const source of result.boards)
      definitions.set(
        source.id!,
        source.columns
          .filter((column) => !['name', 'subtasks'].includes(column.type))
          .map((column) => ({
            ...sourceColumn(column, `${column.title} [${source.id}:${column.id}]`),
            sourceBoardId: source.id,
          })),
      )
  }
  for (const [id, columns] of definitions) for (const column of columns) column.sourceBoardId = id
  const people = new Map((basic.people || []).map((person) => [person.sourceId, person]))
  const personIds = new Set<string>()
  for (const item of all.values()) {
    for (const cell of item.column_values) {
      const members = jsonObject(cell.value).personsAndTeams
      if (Array.isArray(members))
        for (const member of members.map(jsonObject))
          if (member.kind === 'person') personIds.add(String(member.id))
    }
    const page = item.updates_page
    if (!page) continue
    const visited = new Set<string>()
    while (page.cursor) {
      if (visited.has(page.cursor))
        throw new Error('O monday repetiu uma página de comentários. Tente novamente.')
      visited.add(page.cursor)
      const result = await mondayRequest<{ items: { updates_page: typeof page }[] }>(
        token,
        `query ($ids:[ID!]!,$cursor:String!) { items(ids:$ids) { updates_page(limit:100,cursor:$cursor) { cursor updates { ${UPDATE_FIELDS} } } } }`,
        { ids: [item.id], cursor: page.cursor },
        fetcher,
      )
      if (!result.items[0]?.updates_page)
        throw new Error('Não foi possível ler todas as páginas de comentários.')
      page.updates.push(...result.items[0].updates_page.updates)
      page.cursor = result.items[0].updates_page.cursor
      if (page.updates.length > 20000)
        throw new Error(
          'O histórico desta tarefa ultrapassa 20.000 atualizações. A importação foi interrompida sem descartar comentários.',
        )
    }
    for (const update of page.updates.flatMap((update) => [update, ...(update.replies || [])])) {
      if (update.creator)
        people.set(update.creator.id, {
          sourceId: update.creator.id,
          name: update.creator.name,
          email: update.creator.email || '',
        })
    }
  }
  const ids = [...personIds].filter((id) => /^\d+$/.test(id) && !people.has(id))
  for (let start = 0; start < ids.length; start += 100) {
    try {
      const result = await mondayRequest<{ users: { id: string; name: string; email: string }[] }>(
        token,
        'query ($ids:[ID!]!) { users(ids:$ids,limit:100) { id name email } }',
        { ids: ids.slice(start, start + 100) },
        fetcher,
      )
      for (const person of result.users)
        people.set(person.id, { sourceId: person.id, name: person.name, email: person.email || '' })
    } catch {
      warnings.add(
        'Alguns responsáveis não puderam ser consultados. Os nomes e IDs disponíveis serão preservados no relatório.',
      )
    }
  }
  const items: ImportSourceItem[] = [],
    updates: ImportSourceUpdate[] = [],
    assets: ImportSourceAsset[] = []
  const downloads = new Map<string, string>()
  const addAsset = (
    asset: SourceAsset,
    itemId: string,
    columnId: string | null,
    updateId: string | null,
  ) => {
    const key = `${itemId}:${columnId || 'updates'}:${asset.id}:${updateId || ''}`
    if (
      assets.some(
        (file) =>
          `${file.itemExternalId}:${file.sourceColumnId || 'updates'}:${file.externalId}:${file.updateExternalId || ''}` ===
          key,
      )
    )
      return
    assets.push({
      externalId: asset.id,
      itemExternalId: itemId,
      sourceColumnId: columnId,
      updateExternalId: updateId,
      name: asset.name || 'Arquivo',
      size: asset.file_size || 0,
      createdAt: date(asset.created_at),
    })
    if (asset.public_url) downloads.set(key, asset.public_url)
  }
  const orderedItems: RichMondayItem[] = [],
    visitedItems = new Set<string>()
  const visit = (item: RichMondayItem, ancestors = new Set<string>()) => {
    if (ancestors.has(item.id))
      throw new Error('A origem retornou um ciclo na hierarquia de subitens.')
    if (visitedItems.has(item.id)) return
    visitedItems.add(item.id)
    orderedItems.push(item)
    for (const child of item.subitems || []) {
      const entry = all.get(child.id)
      if (entry) visit(entry, new Set([...ancestors, item.id]))
    }
  }
  for (const root of roots.filter((item) => !item.parent_item)) visit(root)
  for (const item of all.values()) visit(item)
  for (const item of orderedItems) {
    const sourceBoardId = item.board?.id || boardId
    const columns = definitions.get(sourceBoardId)
    if (!columns) throw new Error('Não foi possível consultar as colunas de um quadro de subitens.')
    items.push({
      externalId: item.id,
      parentExternalId: item.parent_item?.id || null,
      sourceBoardId,
      title: item.name,
      groupSourceId: item.group?.id || null,
      groupName: item.group?.title || '',
      createdAt: date(item.created_at),
      updatedAt: date(item.updated_at),
      values: Object.fromEntries(
        columns.map((column) => [
          column.header,
          richColumnValue(
            column,
            item.column_values.find((cell) => cell.id === column.sourceId),
            [...people.values()],
          ),
        ]),
      ),
      sourceValues: {
        columns: publicSourceData(item.column_values),
        description: publicSourceData(item.description),
        url: item.url,
        creatorId: item.creator_id,
        state: item.state,
      },
    })
    for (const cell of item.column_values as (MondayValue & Record<string, unknown>)[]) {
      if (!Array.isArray(cell.files)) continue
      for (const entry of cell.files.map(jsonObject)) {
        if (entry.asset) addAsset(entry.asset as unknown as SourceAsset, item.id, cell.id, null)
        else if (entry.__typename === 'FileLinkValue' || entry.__typename === 'FileDocValue') {
          const url = safeUrl(entry.url)
          assets.push({
            externalId: String(entry.file_id),
            itemExternalId: item.id,
            sourceColumnId: cell.id,
            updateExternalId: null,
            name: String(entry.name || 'Documento monday'),
            size: 0,
            createdAt: date(String(entry.created_at || '')),
            ...(url
              ? { externalUrl: url }
              : { failure: 'O documento não possui um endereço acessível pela API.' }),
          })
        } else
          assets.push({
            externalId: String(entry.asset_id || 'invalid'),
            itemExternalId: item.id,
            sourceColumnId: cell.id,
            updateExternalId: null,
            name: String(entry.name || entry.invalid_name || 'Arquivo indisponível'),
            size: 0,
            createdAt: null,
            failure: String(entry.error || 'Arquivo indisponível na origem.'),
          })
      }
    }
    for (const update of item.updates_page?.updates || []) {
      for (const [index, entry] of [update, ...(update.replies || [])].entries()) {
        updates.push({
          externalId: entry.id,
          itemExternalId: item.id,
          parentExternalId: index ? update.id : null,
          authorSourceId: entry.creator?.id || null,
          body: entry.text_body || plainText(entry.body || ''),
          createdAt: date(entry.created_at),
          metadata: publicSourceData({
            html: entry.body,
            updatedAt: entry.updated_at,
            likes: entry.likes,
            pinned: entry.pinned_to_top,
          }) as Record<string, unknown>,
        })
        for (const asset of entry.assets || []) addAsset(asset, item.id, null, entry.id)
      }
    }
  }
  const automations: Record<string, unknown>[] = []
  try {
    let cursor: string | null = null
    const visited = new Set<string>()
    do {
      const result: {
        board_automations: {
          cursor: string | null
          items: Record<string, unknown>[]
          legacy_automations?: unknown
        }
      } = await mondayRequest(
        token,
        'query ($ids:[ID!]!,$cursor:String) { board_automations(board_ids:$ids,limit:100,cursor:$cursor) { cursor items { id title description active workflow_blocks workflow_variables workflow_host_data template_reference_id } legacy_automations } }',
        { ids: [boardId], cursor },
        fetcher,
      )
      automations.push(
        ...result.board_automations.items.map(
          (rule) => publicSourceData(rule) as Record<string, unknown>,
        ),
      )
      const legacy = jsonObject(result.board_automations.legacy_automations)
      const recipes = jsonObject(legacy.recipes)
      const recipeList = Array.isArray(recipes.dynamicRecipes)
        ? recipes.dynamicRecipes.map(jsonObject)
        : []
      for (const rule of Array.isArray(legacy.automations)
        ? legacy.automations.map(jsonObject)
        : []) {
        if (automations.some((existing) => String(existing.id) === String(rule.id))) continue
        const recipe = recipeList.find((recipe) => String(recipe.id) === String(rule.recipeId))
        automations.push(
          publicSourceData({
            id: rule.id,
            active: rule.active,
            config: rule.config,
            title: recipe?.parsedSentence || rule.description || 'Automação da origem',
            recipe: recipe
              ? { nodes: jsonObject(recipe.rawNodes).nodes, sentence: recipe.sentence }
              : null,
          }) as Record<string, unknown>,
        )
      }
      cursor = result.board_automations.cursor
      if (cursor && visited.has(cursor)) throw new Error('Página de automações repetida.')
      if (cursor) visited.add(cursor)
    } while (cursor)
  } catch {
    coverage.push({
      name: 'Automações',
      sourceType: 'automations',
      mode: 'unavailable',
      detail: 'A API não permitiu consultar as receitas nesta versão ou com este acesso.',
    })
  }
  const childColumns = [...definitions.entries()]
    .filter(([id]) => id !== boardId)
    .flatMap(([, columns]) => columns)
  for (const column of [...(basic.columns || []), ...childColumns]) {
    const capability = mondayCapability(column.sourceType)
    coverage.push({
      name: column.name,
      sourceType: column.sourceType,
      mode:
        column.sourceType === 'formula' && column.type === 'external'
          ? 'snapshot'
          : capability.mode,
      detail: capability.detail,
    })
  }
  if (board.views?.length)
    coverage.push({
      name: 'Visualizações',
      sourceType: 'views',
      mode: 'converted',
      count: board.views.length,
      detail:
        'Tabela, Kanban e calendário usam as visualizações locais. Configurações específicas de apps e widgets são preservadas no relatório.',
    })
  const preview: ImportPreview = {
    ...basic,
    description: board.description || '',
    items,
    updates,
    assets,
    automations,
    people: [...people.values()],
    subitemColumns: childColumns,
    groups: board.groups?.map((group) => ({
      sourceId: group.id,
      name: group.title,
      color: group.color,
    })),
    rows: roots
      .filter((item) => !item.parent_item)
      .map((item) => {
        const normalized = items.find((entry) => entry.externalId === item.id)!
        return [
          item.name,
          item.group?.title || '',
          item.id,
          ...(basic.columns || []).map((column) => normalized.values[column.header] || ''),
        ]
      }),
    coverage,
    warnings: [...warnings],
    sourceMetadata: publicSourceData({
      views: board.views,
      boardKind: board.board_kind,
      hierarchy: board.hierarchy_type,
      columns: board.columns,
      subitemBoards: childMetadata,
      missingItemIds: [...missing],
    }) as Record<string, unknown>,
    counts: {
      tasks: items.filter((item) => !item.parentExternalId).length,
      subitems: items.filter((item) => !!item.parentExternalId).length,
      comments: updates.length,
      files: assets.length,
      bytes: assets.reduce((total, asset) => total + asset.size, 0),
    },
  }
  return { preview, downloads }
}
