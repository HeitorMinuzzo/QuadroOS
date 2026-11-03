import { randomUUID } from 'node:crypto'
import { camelRow, type Database } from './database.ts'
import { createBoard, insertTask } from './repository.ts'
import { prepareImportColumns } from './import-columns.ts'
import { prepareImportPeople } from './import-people.ts'
import { importColumnValue } from './columns.ts'
import { saveAutomation } from './automations.ts'
import { DomainError } from './errors.ts'
import { boardColumns, columnList } from '../shared/columns.ts'
import {
  compileFormula,
  evaluateFormula,
  formulaText,
  validateFormulaCycles,
} from '../shared/formulas.ts'
import { guessImportMapping, importKey } from '../shared/imports.ts'
import { jsonObject, isoDate } from '../shared/rich-values.ts'
import type {
  Board,
  Group,
  Task,
  ImportPreview,
  ImportMapping,
  ImportSourceAsset,
  ImportSourceColumn,
} from '../shared/domain.ts'

export interface MondayImportOptions {
  boardId?: string
  boardName?: string
  importPeople?: boolean
  importAutomations?: boolean
  readAsset?: (asset: ImportSourceAsset) => Promise<Buffer | null>
}
function metadataText(value: unknown): string {
  if (Array.isArray(value)) return value.map(metadataText).filter(Boolean).join('\n')
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (typeof object.text === 'string') return object.text
    return Object.entries(object)
      .filter(([key]) => ['blocks', 'text', 'content', 'delta', 'ops', 'insert'].includes(key))
      .map(([, entry]) => metadataText(entry))
      .filter(Boolean)
      .join('')
  }
  return typeof value === 'string' ? value : ''
}
function plainValue(value: string, column?: ImportSourceColumn) {
  if (column && ['people', 'dropdown'].includes(column.type)) return columnList(value).join(', ')
  if (column && ['external', 'time_tracking', 'timeline', 'last_updated'].includes(column.type)) {
    const raw = jsonObject(value)
    return String(raw.text || (raw.from ? `${raw.from} → ${raw.to || ''}` : value))
  }
  return value
}
export async function applyMondayImport(
  db: Database,
  preview: ImportPreview,
  mapping: ImportMapping,
  options: MondayImportOptions,
) {
  const items = preview.items!
  const coverage = (preview.coverage || []).map((entry) => ({ ...entry }))
  const warnings = new Set(preview.warnings)
  if (!Object.values(mapping).includes('title'))
    throw new DomainError('Relacione uma coluna ao título da tarefa.')
  return db.transaction(async (tx) => {
    const fresh = !options.boardId
    const boardId =
      options.boardId ||
      (await createBoard(tx, options.boardName?.trim() || preview.name, preview.description || ''))
        .id
    const previous = (
      await tx.query(
        'SELECT id,title,custom_values,updated_at,version,source FROM tasks WHERE board_id=$1',
        [boardId],
      )
    ).rows
    const root = await prepareImportColumns(tx, boardId, preview, mapping, fresh, warnings)
    const allPrepared = new Map<
      string,
      {
        board: Board
        customColumns: Record<string, string>
        mapping: ImportMapping
        columns: ImportSourceColumn[]
        populateSourceColumns: string[]
      }
    >()
    allPrepared.set(`tasks:${preview.sourceBoardId}`, {
      ...root,
      mapping,
      columns: preview.columns || [],
    })
    const childSources = new Map<string, ImportSourceColumn[]>()
    for (const column of preview.subitemColumns || []) {
      const sourceId = column.sourceBoardId || preview.sourceBoardId!
      childSources.set(sourceId, [...(childSources.get(sourceId) || []), column])
    }
    if (
      items.some((item) => item.parentExternalId && item.sourceBoardId === preview.sourceBoardId) &&
      !childSources.has(preview.sourceBoardId!)
    )
      childSources.set(preview.sourceBoardId!, preview.columns || [])
    let childScopeFresh = fresh || !root.board.settings?.subitemColumns
    const childKeys: string[] = []
    for (const [sourceId, columns] of childSources) {
      const childPreview = {
        ...preview,
        headers: ['Tarefa', 'Grupo', 'ID monday', ...columns.map((column) => column.header)],
        columns,
        rows: items
          .filter((item) => item.parentExternalId && item.sourceBoardId === sourceId)
          .map((item) => [
            item.title,
            item.groupName,
            item.externalId,
            ...columns.map((column) => item.values[column.header] || ''),
          ]),
      }
      const childMapping = guessImportMapping(childPreview)
      const prepared = await prepareImportColumns(
        tx,
        boardId,
        childPreview,
        childMapping,
        childScopeFresh,
        warnings,
        'subitems',
      )
      allPrepared.set(`subitems:${sourceId}`, { ...prepared, mapping: childMapping, columns })
      childKeys.push(
        ...Object.entries(childMapping).flatMap(([header, field]) =>
          field === 'custom'
            ? [prepared.customColumns[header]]
            : field === 'dueDate'
              ? ['date']
              : ['owner', 'status', 'priority'].includes(field)
                ? [field]
                : [],
        ),
      )
      childScopeFresh = false
    }
    let board = camelRow<Board>(
      (await tx.query('SELECT * FROM boards WHERE id=$1', [boardId])).rows[0],
    )
    if (fresh) {
      const sourceColumns = preview.sourceMetadata?.columns
      const title = Array.isArray(sourceColumns)
        ? sourceColumns.map(jsonObject).find((column) => column.type === 'name')
        : undefined
      if (title) {
        board.settings = {
          ...board.settings,
          columnWidths: {
            ...board.settings?.columnWidths,
            title: Math.max(220, Math.min(1200, Number(title.width) || 360)),
          },
          ...(typeof title.title === 'string' && !/^(name|nome)$/i.test(title.title)
            ? { columnNames: { ...board.settings?.columnNames, title: title.title } }
            : {}),
        }
        await tx.query('UPDATE boards SET settings=$1::jsonb WHERE id=$2', [
          JSON.stringify(board.settings),
          boardId,
        ])
      }
    }
    if (fresh && childKeys.length) {
      board.settings = {
        ...board.settings,
        subitemColumns: [...new Set(childKeys)],
        subitemColumnOrder: [...new Set(childKeys)],
      }
      await tx.query('UPDATE boards SET settings=$1::jsonb WHERE id=$2', [
        JSON.stringify(board.settings),
        boardId,
      ])
    }
    const groups = (
      await tx.query('SELECT * FROM groups WHERE board_id=$1 ORDER BY position', [boardId])
    ).rows.map((row) => camelRow<Group>(row))
    if (fresh && preview.groups?.length) {
      await tx.query('DELETE FROM groups WHERE board_id=$1', [boardId])
      groups.length = 0
    }
    const source = `monday:${preview.sourceBoardId}`
    const groupMap = new Map<string, Group>()
    for (const definition of preview.groups || []) {
      let group = groups.find(
        (group) => group.source === source && group.externalId === definition.sourceId,
      )
      if (!group)
        group = groups.find(
          (group) => !group.externalId && importKey(group.name) === importKey(definition.name),
        )
      if (group) {
        if (definition.sourceId)
          await tx.query('UPDATE groups SET source=$1,external_id=$2 WHERE id=$3', [
            source,
            definition.sourceId,
            group.id,
          ])
        group.source = source
        group.externalId = definition.sourceId
      } else {
        group = {
          id: randomUUID(),
          boardId,
          name: definition.name,
          color: definition.color,
          position: groups.length,
          isCompleted: false,
          source,
          externalId: definition.sourceId,
        }
        await tx.query(
          'INSERT INTO groups (id,board_id,name,color,position,source,external_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [
            group.id,
            boardId,
            group.name,
            group.color,
            group.position,
            source,
            definition.sourceId || null,
          ],
        )
        groups.push(group)
      }
      groupMap.set(definition.sourceId || definition.name, group)
    }
    const { people, references } = await prepareImportPeople(
      tx,
      preview,
      mapping,
      options.importPeople !== false,
    )
    const personFor = (value: string) =>
      people.find(
        (person) =>
          person.id === (references.get(value)?.value || value) ||
          importKey(person.email) === importKey(value) ||
          importKey(person.name) === importKey(value),
      )
    const taskMap = new Map(
      (
        await tx.query('SELECT * FROM tasks WHERE board_id=$1 AND source=$2', [boardId, source])
      ).rows.map((row) => {
        const task = camelRow<Task>(row)
        return [task.externalId!, task] as const
      }),
    )
    const formulasToVerify = new Set<string>()
    // Compile after every source column has a destination ID. Incompatible expressions stay as explicit snapshots.
    for (const prepared of allPrepared.values()) {
      const scope = [...allPrepared.entries()]
        .find(([, candidate]) => candidate === prepared)![0]
        .startsWith('subitems:')
        ? 'subitems'
        : 'tasks'
      for (const sourceColumn of prepared.columns.filter((column) => column.type === 'formula')) {
        const columnId = prepared.customColumns[sourceColumn.header]
        const column = board.columns.find((column) => column.id === columnId)
        if (!column || column.formula || column.type !== 'formula') continue
        try {
          const expression = (sourceColumn.formula || '').replace(
            /\{([^{}]+)\}/g,
            (_full, key: string) => {
              const candidates = prepared.columns.filter(
                (candidate) => candidate.sourceId === key || candidate.name === key,
              )
              if (candidates.length !== 1)
                throw new Error('Referência de coluna ambígua ou indisponível.')
              const referenced = candidates[0],
                field = prepared.mapping[referenced.header]
              const target =
                field === 'custom'
                  ? prepared.customColumns[referenced.header]
                  : field === 'dueDate'
                    ? 'date'
                    : field
              return `{#${target}}`
            },
          )
          column.formula = compileFormula(expression, boardColumns(board, scope))
          validateFormulaCycles(boardColumns(board, scope))
          formulasToVerify.add(column.id)
        } catch (error) {
          column.type = 'external'
          column.formula = undefined
          column.source = { ...column.source!, readOnly: true }
          coverage.push({
            name: column.name,
            sourceType: 'formula',
            mode: 'snapshot',
            detail: `Resultado e expressão preservados. Conversão indisponível: ${error instanceof Error ? error.message : 'fórmula incompatível'}`,
          })
        }
      }
    }
    await tx.query('UPDATE boards SET columns=$1::jsonb WHERE id=$2', [
      JSON.stringify(board.columns),
      boardId,
    ])
    let imported = 0,
      skipped = 0,
      subitemsImported = 0
    const remaining = [...items]
    const readOnlyValues = new Map<string, Record<string, string>>()
    while (remaining.length) {
      let progress = false
      for (let index = 0; index < remaining.length;) {
        const item = remaining[index]
        if (item.parentExternalId && !taskMap.has(item.parentExternalId)) {
          index++
          continue
        }
        const existing = taskMap.get(item.externalId)
        const prepared = allPrepared.get(
          `${item.parentExternalId ? 'subitems' : 'tasks'}:${item.sourceBoardId}`,
        )
        if (existing && !prepared?.populateSourceColumns.length) {
          skipped++
          remaining.splice(index, 1)
          progress = true
          continue
        }
        if (!prepared)
          throw new DomainError(
            'As colunas de um subitem não estão disponíveis. Nenhum dado foi gravado.',
          )
        const fieldValue = (field: string) => {
          const entry = Object.entries(prepared.mapping).find(([, value]) => value === field)
          return entry ? item.values[entry[0]] || '' : ''
        }
        const parent = item.parentExternalId ? taskMap.get(item.parentExternalId) : undefined
        let group = parent
          ? groups.find((group) => group.id === parent.groupId)
          : groupMap.get(item.groupSourceId || item.groupName)
        if (!group)
          group =
            groups.find((group) => importKey(group.name) === importKey(item.groupName)) || groups[0]
        if (!group) throw new DomainError('O grupo de uma tarefa não está disponível na origem.')
        const owners = fieldValue('owner'),
          ownerValues = owners.startsWith('[')
            ? columnList(owners)
            : owners
                .split(/[,;\n|]+/)
                .map((value) => value.trim())
                .filter(Boolean)
        const ownerIds = ownerValues.flatMap((value) =>
          personFor(value) ? [personFor(value)!.id] : [],
        )
        const missing = ownerValues.filter((value) => !personFor(value))
        let description =
          existing?.description ??
          [metadataText(item.sourceValues.description), fieldValue('description')]
            .filter(Boolean)
            .join('\n')
        if (missing.length && !existing) {
          description += `\nResponsáveis na origem: ${missing.map((value) => references.get(value)?.original || value).join(', ')}`
          warnings.add(
            'Contatos removidos ou sem acesso foram preservados na descrição e no relatório.',
          )
        }
        const customValues: Record<string, string> = {},
          preserved: Record<string, string> = {}
        for (const sourceColumn of prepared.columns) {
          if (prepared.mapping[sourceColumn.header] !== 'custom') continue
          const columnId = prepared.customColumns[sourceColumn.header],
            column = board.columns.find((column) => column.id === columnId)!
          if (existing && !prepared.populateSourceColumns.includes(columnId)) continue
          let raw = item.values[sourceColumn.header] || ''
          if (column.type === 'files') continue
          if (column.type === 'last_updated') {
            preserved[columnId] = raw
            continue
          }
          if (column.type === 'formula') {
            preserved[columnId] = raw
            continue
          }
          if (column.type === 'external' && sourceColumn.type === 'formula')
            raw = JSON.stringify({
              value: raw,
              text: raw,
              details: { formula: sourceColumn.formula },
            })
          if (column.type === 'external' && column.source?.readOnly) {
            preserved[columnId] = raw
            continue
          }
          if (column.type === 'people') {
            const selected = raw.startsWith('[')
              ? columnList(raw)
              : raw
                  .split(/[,;\n|]+/)
                  .map((value) => value.trim())
                  .filter(Boolean)
            const known = selected.flatMap((value) =>
              personFor(value) ? [personFor(value)!.id] : [],
            )
            const unknown = selected.filter((value) => !personFor(value))
            if (unknown.length) {
              description += `\n${sourceColumn.name} na origem: ${unknown.map((value) => references.get(value)?.original || value).join(', ')}`
              warnings.add(
                'Contatos removidos ou sem acesso foram preservados na descrição e no relatório.',
              )
            }
            raw = known.length ? JSON.stringify(known) : ''
          }
          if (column.options && sourceColumn.options) {
            const labelFor = (label: string) =>
              column.options?.find(
                (option) =>
                  option.id === sourceColumn.options?.find((option) => option.label === label)?.id,
              )?.label || label
            if (column.type === 'status') raw = labelFor(raw)
            if (column.type === 'dropdown') raw = JSON.stringify(columnList(raw).map(labelFor))
          }
          try {
            customValues[columnId] = importColumnValue(column, raw, people)
          } catch {
            description += `\n${sourceColumn.name} na origem: ${plainValue(raw, sourceColumn)}`
            warnings.add(
              'Um valor exigiu adaptação. O valor estruturado original foi preservado no relatório.',
            )
          }
        }
        if (existing) {
          const original = jsonObject(previous.find((row) => row.id === existing.id)?.custom_values)
          for (const columnId of prepared.populateSourceColumns) {
            const old = original[columnId],
              definition = prepared.columns.find(
                (column) => prepared.customColumns[column.header] === columnId,
              )
            if (
              typeof old === 'string' &&
              old &&
              definition &&
              old !== item.values[definition.header] &&
              old !== plainValue(item.values[definition.header] || '', definition)
            )
              description += `\n${definition.name} antes da conversão: ${old.slice(0, 5000)}`
          }
          const migrated = camelRow<Task>(
            (
              await tx.query(
                'UPDATE tasks SET custom_values=$1::jsonb,description=$2,version=version+1 WHERE id=$3 RETURNING *',
                [
                  JSON.stringify({ ...existing.customValues, ...customValues, ...preserved }),
                  description,
                  existing.id,
                ],
              )
            ).rows[0],
          )
          taskMap.set(item.externalId, migrated)
          skipped++
          remaining.splice(index, 1)
          progress = true
          continue
        }
        const statusField = Object.entries(prepared.mapping).find(
          ([, field]) => field === 'status',
        )?.[0]
        const priorityField = Object.entries(prepared.mapping).find(
          ([, field]) => field === 'priority',
        )?.[0]
        const statusOptions = item.parentExternalId
          ? board.settings?.subitemStatusOptions
          : board.settings?.statusOptions
        const priorityOptions = item.parentExternalId
          ? board.settings?.subitemPriorityOptions
          : board.settings?.priorityOptions
        const systemLabel = (header: string | undefined, options: typeof statusOptions) => {
          if (!header) return ''
          const label = item.values[header] || '',
            definition = prepared.columns.find((column) => column.header === header)
          const option = definition?.options?.find((option) => option.label === label)
          return (
            options?.find(
              (candidate) =>
                candidate.id === `${preview.sourceBoardId}-${definition?.sourceId}-${option?.id}`,
            )?.label || label
          )
        }
        const originalDate = fieldValue('dueDate'),
          datePart = originalDate.slice(0, 10)
        if (originalDate && !isoDate(datePart)) {
          description += `\nPrazo na origem: ${originalDate}`
          warnings.add(
            'Uma data calculada ou incompatível foi preservada na descrição e no relatório.',
          )
        }
        let task = await insertTask(tx, {
          boardId,
          groupId: group.id,
          parentId: parent?.id || null,
          title: fieldValue('title') || item.title,
          description: description.trim(),
          status: systemLabel(statusField, statusOptions),
          priority: systemLabel(priorityField, priorityOptions),
          dueDate: isoDate(datePart) ? datePart : null,
          dueAt:
            isoDate(datePart) &&
            originalDate.includes('T') &&
            Number.isFinite(Date.parse(originalDate))
              ? originalDate
              : null,
          ownerIds: [...new Set(ownerIds)],
          source,
          externalId: item.externalId,
          customValues,
        })
        const merged = { ...task.customValues, ...preserved }
        task = camelRow<Task>(
          (
            await tx.query(
              'UPDATE tasks SET created_at=$1,updated_at=$2,custom_values=$3::jsonb WHERE id=$4 RETURNING *',
              [
                item.createdAt || task.createdAt,
                item.updatedAt || task.updatedAt,
                JSON.stringify(merged),
                task.id,
              ],
            )
          ).rows[0],
        )
        taskMap.set(item.externalId, task)
        readOnlyValues.set(task.id, preserved)
        imported++
        if (parent) subitemsImported++
        remaining.splice(index, 1)
        progress = true
      }
      if (!progress)
        throw new DomainError(
          'A hierarquia contém referências ausentes ou um ciclo. Nenhuma tarefa foi importada.',
        )
    }
    // Verify converted formulas against the values returned by monday before presenting them as live calculations.
    for (const column of board.columns.filter(
      (column) =>
        column.type === 'formula' && column.source?.formula && formulasToVerify.has(column.id),
    )) {
      const prepared = [...allPrepared.values()].find((prepared) =>
        Object.values(prepared.customColumns).includes(column.id),
      )!
      const sourceColumn = prepared.columns.find(
        (source) => prepared.customColumns[source.header] === column.id,
      )!
      const comparable = items.filter(
        (item) =>
          item.values[sourceColumn.header] !== undefined && item.values[sourceColumn.header] !== '',
      )
      const differs = comparable.some((item) => {
        const task = taskMap.get(item.externalId)!,
          expected = item.values[sourceColumn.header],
          result = evaluateFormula(
            column,
            boardColumns(board, task.parentId ? 'subitems' : 'tasks'),
            task,
          )
        const actual = formulaText(result)
        return (
          result.error ||
          (Number.isFinite(Number(actual)) && Number.isFinite(Number(expected))
            ? Math.abs(Number(actual) - Number(expected)) > 1e-8
            : actual !== expected)
        )
      })
      if (differs) {
        column.type = 'external'
        column.formula = undefined
        column.source = { ...column.source!, readOnly: true }
        for (const item of comparable) {
          const task = taskMap.get(item.externalId)!,
            value = item.values[sourceColumn.header]
          task.customValues[column.id] = JSON.stringify({
            value,
            text: value,
            details: { formula: sourceColumn.formula },
          })
          await tx.query('UPDATE tasks SET custom_values=$1::jsonb WHERE id=$2', [
            JSON.stringify(task.customValues),
            task.id,
          ])
        }
        coverage.push({
          name: column.name,
          sourceType: 'formula',
          mode: 'snapshot',
          detail:
            'A expressão local não reproduziu os resultados da API. O resultado e a regra originais foram preservados, sem apresentar cálculos divergentes.',
        })
      }
    }
    const commentMap = new Map(
      (
        await tx.query(
          'SELECT c.* FROM comments c JOIN tasks t ON t.id=c.task_id WHERE t.board_id=$1 AND c.source=$2',
          [boardId, source],
        )
      ).rows.map((row) => [String(row.external_id), String(row.id)]),
    )
    let commentsImported = 0
    for (const update of preview.updates || []) {
      if (commentMap.has(update.externalId)) continue
      const task = update.itemExternalId ? taskMap.get(update.itemExternalId) : undefined
      if (!task) {
        coverage.push({
          name: 'Atualização sem tarefa acessível',
          sourceType: 'updates',
          mode: 'snapshot',
          detail: 'O conteúdo foi preservado no relatório.',
          count: 1,
        })
        continue
      }
      const sourceAuthor = preview.people?.find(
        (person) => person.sourceId === update.authorSourceId,
      )
      const person = update.authorSourceId
        ? personFor(`monday-person:${update.authorSourceId}`)
        : undefined
      const commentId = randomUUID()
      await tx.query(
        'INSERT INTO comments (id,task_id,author_id,body,created_at,parent_id,source,external_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
        [
          commentId,
          task.id,
          person?.id || 'person-you',
          update.body,
          update.createdAt || task.createdAt,
          update.parentExternalId ? commentMap.get(update.parentExternalId) || null : null,
          source,
          update.externalId,
          JSON.stringify({
            ...update.metadata,
            sourceAuthor: {
              id: update.authorSourceId,
              name: sourceAuthor?.name || 'Autor removido no monday',
            },
          }),
        ],
      )
      commentMap.set(update.externalId, commentId)
      commentsImported++
    }
    let filesImported = 0
    for (const asset of preview.assets || []) {
      if (asset.failure) continue
      const task = taskMap.get(asset.itemExternalId)
      if (!task) continue
      const item = items.find((item) => item.externalId === asset.itemExternalId)!,
        prepared = allPrepared.get(
          `${item.parentExternalId ? 'subitems' : 'tasks'}:${item.sourceBoardId}`,
        )!
      const sourceColumn = prepared.columns.find(
        (column) => column.sourceId === asset.sourceColumnId,
      )
      const columnId = sourceColumn
        ? prepared.customColumns[sourceColumn.header]
        : `monday-update-files`
      if (sourceColumn && !columnId) continue
      const duplicate = (
        await tx.query(
          'SELECT id FROM task_files WHERE task_id=$1 AND column_id=$2 AND source=$3 AND external_id=$4',
          [task.id, columnId, source, asset.externalId],
        )
      ).rows.length
      if (duplicate) continue
      const content = asset.externalUrl ? Buffer.alloc(0) : await options.readAsset?.(asset)
      if (!content) {
        coverage.push({
          name: asset.name,
          sourceType: 'file',
          mode: 'unavailable',
          detail:
            'O conteúdo binário não estava disponível nesta sessão. O nome e o ID foram preservados no relatório.',
        })
        continue
      }
      const name = (asset.name.split(/[\\/]/).pop() || 'Arquivo')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .slice(0, 200)
      await tx.query(
        'INSERT INTO task_files (id,task_id,column_id,name,size,content,created_at,source,external_id,comment_id,external_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          randomUUID(),
          task.id,
          columnId,
          name,
          content.length,
          content,
          asset.createdAt || task.createdAt,
          source,
          asset.externalId,
          asset.updateExternalId ? commentMap.get(asset.updateExternalId) || null : null,
          asset.externalUrl || null,
        ],
      )
      filesImported++
    }
    let automationsImported = 0
    const automationMap = { ...jsonObject(board.settings?.mondayAutomationIds) }
    for (const rule of preview.automations || []) {
      const nodes = jsonObject(rule.recipe).nodes
      const config = jsonObject(rule.config)
      const recipeNodes = Array.isArray(nodes) ? nodes.map(jsonObject) : []
      const trigger = recipeNodes.find((node) => Number(node.workflowBlockId) === 223025)
      const action = recipeNodes.find((node) => Number(node.workflowBlockId) === 40)
      const triggerConfig = jsonObject(config[String(trigger?.id)]),
        actionConfig = jsonObject(config[String(action?.id)])
      const sourceColumnId = String(jsonObject(triggerConfig.columnId).columnId || '')
      const sourceOptionId = `monday-${jsonObject(triggerConfig.statusColumnValue).index}`
      const sourceColumn = preview.columns?.find((column) => column.sourceId === sourceColumnId)
      const field = sourceColumn ? mapping[sourceColumn.header] : undefined
      const columnId =
        field === 'custom'
          ? root.customColumns[sourceColumn!.header]
          : field === 'status' || field === 'priority'
            ? field
            : undefined
      const column = boardColumns(board).find((column) => column.id === columnId)
      const option = column?.options?.find(
        (option) =>
          option.id === sourceOptionId ||
          option.id === `${preview.sourceBoardId}-${sourceColumnId}-${sourceOptionId}`,
      )
      const group = groupMap.get(String(actionConfig.groupId || ''))
      if (
        recipeNodes.length === 2 &&
        trigger &&
        action &&
        column &&
        option &&
        group &&
        options.importAutomations !== false
      ) {
        const savedId = automationMap[String(rule.id)]
        const existing = (
          await tx.query(
            'SELECT id FROM board_automations WHERE board_id=$1 AND column_id=$2 AND option_id=$3',
            [boardId, column.id, option.id],
          )
        ).rows[0]
        if (existing) {
          automationMap[String(rule.id)] = existing.id
          continue
        }
        if (savedId) continue
        const saved = await saveAutomation(tx, boardId, {
          columnId: column.id,
          optionId: option.id,
          groupId: group.id,
          description: String(rule.title || rule.description || 'Importada do monday').slice(
            0,
            1000,
          ),
          enabled: rule.active !== false,
        })
        automationMap[String(rule.id)] = saved.id
        automationsImported++
        coverage.push({
          name: String(rule.title || 'Automação'),
          sourceType: 'automation',
          mode: 'native',
          detail: 'Mudança de status → mover tarefa para grupo, com condição e estado preservados.',
        })
      } else
        coverage.push({
          name: String(rule.title || rule.description || `Automação ${rule.id}`),
          sourceType: 'automation',
          mode: 'snapshot',
          detail:
            options.importAutomations === false
              ? 'A criação de automações foi desativada nesta importação.'
              : 'A receita foi preservada para revisão. Ela usa um gatilho/ação ou configuração sem equivalente confirmado no motor local.',
        })
    }
    const reportId = randomUUID(),
      now = new Date().toISOString()
    await tx.query(
      'INSERT INTO import_runs (id,board_id,source,name,imported,skipped,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [reportId, boardId, 'monday', preview.name, imported, skipped, now],
    )
    const snapshot = { ...preview, sessionId: undefined, previousLocalValues: previous }
    await tx.query(
      'INSERT INTO import_reports (id,board_id,created_at,coverage,snapshot) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)',
      [reportId, boardId, now, JSON.stringify(coverage), JSON.stringify(snapshot)],
    )
    const previousSource = board.settings?.monday?.boardId
    const matchesLegacySource = !previousSource && previous.some((task) => task.source === source)
    board.settings = {
      ...board.settings,
      ...((fresh || previousSource === preview.sourceBoardId || matchesLegacySource) &&
      preview.mondayFolderPath !== undefined
        ? { mondayFolderPath: preview.mondayFolderPath }
        : {}),
      monday: { boardId: preview.sourceBoardId!, importedAt: now, reportId },
      mondayAutomationIds: automationMap,
    } as Board['settings']
    await tx.query('UPDATE boards SET columns=$1::jsonb,settings=$2::jsonb WHERE id=$3', [
      JSON.stringify(board.columns),
      JSON.stringify(board.settings),
      boardId,
    ])
    return {
      boardId,
      imported,
      skipped,
      warnings: [...warnings],
      reportId,
      subitemsImported,
      commentsImported,
      filesImported,
      automationsImported,
      coverage,
    }
  })
}
