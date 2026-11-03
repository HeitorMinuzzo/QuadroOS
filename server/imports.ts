import { createHash } from 'node:crypto'
import { parse } from 'csv-parse/sync'
import { readSheet, type CellValue } from 'read-excel-file/node'
import { type Database, camelRow } from './database.ts'
import { id, createBoard, insertTask } from './repository.ts'
import { importColumnValue } from './columns.ts'
import { prepareImportColumns } from './import-columns.ts'
import { prepareImportPeople } from './import-people.ts'
import { STATUS_ALIASES, PRIORITY_ALIASES } from '../shared/imports.ts'
import { columnList } from '../shared/columns.ts'
import { applyMondayImport, type MondayImportOptions } from './monday-import.ts'
import {
  STATUSES,
  PRIORITIES,
  type ImportPreview,
  type ImportMapping,
  type Group,
} from '../shared/domain.ts'

export const MAX_ROWS = 2000
export function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}
export function parseDate(value: string): string | null {
  if (!value.trim()) return null
  let match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/)
  if (!match) {
    const br = value.trim().match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/)
    if (!br) return null
    match = [br[0], br[3], br[2].padStart(2, '0'), br[1].padStart(2, '0')]
  }
  const iso = `${match[1]}-${match[2]}-${match[3]}`
  const date = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso ? null : iso
}
function cellString(value: CellValue | null): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}
export async function parseFile(buffer: Buffer, filename: string): Promise<ImportPreview> {
  let matrix: string[][]
  const warnings: string[] = []
  if (/\.xlsx$/i.test(filename)) {
    let sheet
    try {
      sheet = await readSheet(buffer)
    } catch {
      throw new Error(
        'Não foi possível ler o Excel. Confira se o arquivo é um .xlsx válido e não está protegido por senha.',
      )
    }
    if (sheet.length > MAX_ROWS + 30 || sheet.some((row) => row.length > 60))
      throw new Error(`Use arquivos com até ${MAX_ROWS} linhas e 60 colunas.`)
    matrix = sheet.map((row) => row.map(cellString))
    warnings.push(
      'Apenas a primeira aba será importada. Comentários e outras abas precisam ser migrados separadamente.',
    )
  } else if (/\.csv$/i.test(filename)) {
    let csv = buffer.toString('utf8')
    if (csv.includes('\uFFFD')) csv = new TextDecoder('windows-1252').decode(buffer)
    const line =
      csv
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .find((v) => v.trim()) || ''
    const unquoted = line.replace(/"(?:[^"]|"")*"/g, '')
    const delimiter = [',', ';', '\t'].sort(
      (a, b) => unquoted.split(b).length - unquoted.split(a).length,
    )[0]
    try {
      matrix = parse(csv, {
        bom: true,
        delimiter,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
        max_record_size: 100_000,
      }) as string[][]
    } catch {
      throw new Error(
        'Não foi possível ler o CSV. Confira as aspas, o separador e a codificação do arquivo.',
      )
    }
  } else throw new Error('Escolha um arquivo CSV ou Excel (.xlsx).')
  matrix = matrix.filter((row) => row.some((cell) => cell.trim()))
  if (matrix.length < 2)
    throw new Error('O arquivo precisa ter um cabeçalho e pelo menos uma linha de dados.')
  // Native monday Excel exports may place the board title before the actual header.
  const headerIndex = matrix
    .slice(0, 15)
    .findIndex(
      (row) =>
        row.some((cell) => /^(name|item|item name|nome|tarefa|elemento)$/i.test(cell.trim())) &&
        row.filter((cell) => cell.trim()).length >= 2,
    )
  if (headerIndex > 0) {
    matrix = matrix.slice(headerIndex)
    warnings.push('As linhas anteriores ao cabeçalho foram desconsideradas.')
  }
  const seen = new Map<string, number>()
  const headers = matrix[0].map((cell, i) => {
    const label = cell.trim() || `Coluna ${i + 1}`
    const count = (seen.get(label) || 0) + 1
    seen.set(label, count)
    return count === 1 ? label : `${label} (${count})`
  })
  const rows = matrix
    .slice(1)
    .filter(
      (row) =>
        !row[0]?.includes('Powered by monday.com') &&
        !row[0]?.includes('Desenvolvido pela monday.com'),
    )
    .map((row) => headers.map((_, i) => (row[i] || '').slice(0, 5000)))
  if (headers.length > 60 || rows.length > MAX_ROWS)
    throw new Error(`Nesta versão, importe até ${MAX_ROWS} linhas e 60 colunas por vez.`)
  return { headers, rows, name: filename, source: 'file', warnings }
}

export async function applyImport(
  db: Database,
  preview: ImportPreview,
  mapping: ImportMapping,
  options: MondayImportOptions,
) {
  if (preview.source === 'monday' && preview.items)
    return applyMondayImport(db, preview, mapping, options)
  if (!Object.values(mapping).includes('title'))
    throw new Error('Relacione uma coluna ao título da tarefa.')
  const warnings = new Set(preview.warnings)
  return db.transaction(async (tx) => {
    let boardId = options.boardId
    if (!boardId)
      boardId = (
        await createBoard(
          tx,
          options.boardName?.trim() || preview.name.replace(/\.[^.]+$/, ''),
          'Importado para um novo começo.',
        )
      ).id
    const { board, customColumns } = await prepareImportColumns(
      tx,
      boardId,
      preview,
      mapping,
      !options.boardId,
      warnings,
    )
    if (
      !options.boardId &&
      preview.source === 'monday' &&
      preview.groups?.length &&
      Object.values(mapping).includes('group')
    ) {
      await tx.query('DELETE FROM groups WHERE board_id=$1', [boardId])
      for (const [position, group] of preview.groups.entries()) {
        await tx.query(
          'INSERT INTO groups (id,board_id,name,color,position) VALUES ($1,$2,$3,$4,$5)',
          [id(), boardId, group.name, group.color, position],
        )
      }
    }
    const groups = (
      await tx.query('SELECT * FROM groups WHERE board_id=$1 ORDER BY position', [boardId])
    ).rows.map((row) => camelRow<Group>(row))
    const { people, references } = await prepareImportPeople(
      tx,
      preview,
      mapping,
      options.importPeople !== false,
    )
    const source = preview.source === 'monday' ? `monday:${preview.sourceBoardId}` : 'file'
    let imported = 0
    let skipped = 0
    const statusOptions = board.settings?.statusOptions
    const priorityOptions = board.settings?.priorityOptions
    for (const [index, row] of preview.rows.entries()) {
      const value = (field: string) =>
        (row[preview.headers.findIndex((header) => mapping[header] === field)] || '').trim()
      const title = value('title')
      if (!title) {
        skipped++
        warnings.add('Linhas sem título foram ignoradas.')
        continue
      }
      const externalId =
        value('externalId') ||
        (preview.source === 'monday'
          ? row[preview.headers.indexOf('ID monday')] || null
          : createHash('sha256')
              .update(
                JSON.stringify(
                  preview.headers.map((h, i) => (mapping[h] === 'ignore' ? '' : row[i])),
                ),
              )
              .digest('hex'))
      if (preview.source === 'monday' && !externalId)
        throw new Error(
          'O identificador de uma tarefa monday está ausente. Prepare a importação novamente.',
        )
      if (
        externalId &&
        (
          await tx.query(
            'SELECT id FROM tasks WHERE board_id=$1 AND source=$2 AND external_id=$3',
            [boardId, source, externalId],
          )
        ).rows.length
      ) {
        skipped++
        continue
      }
      const groupName = value('group')
      let group = groupName
        ? groups.find((g) => normalized(g.name) === normalized(groupName))
        : groups[0]
      if (!group) {
        group = {
          id: id(),
          boardId,
          name: groupName || 'Importados',
          color:
            preview.groups?.find((g) => normalized(g.name) === normalized(groupName))?.color ||
            '#4f8b74',
          position: groups.length,
          isCompleted: false,
        }
        await tx.query(
          'INSERT INTO groups (id,board_id,name,color,position) VALUES ($1,$2,$3,$4,$5)',
          [group.id, boardId, group.name, group.color, group.position],
        )
        groups.push(group)
      }
      const rawStatus = value('status')
      const rawPriority = value('priority')
      const owner = value('owner')
      const sourceOwners = (owner.startsWith('[') ? columnList(owner) : owner.split(/[,;\n|]+/))
        .map((name) => name.trim())
        .filter(Boolean)
      const matchedOwners = sourceOwners.map((name) =>
        people.find(
          (p) =>
            p.id === (references.get(name)?.value || name) ||
            normalized(p.email) === normalized(name) ||
            normalized(p.name) === normalized(name),
        ),
      )
      const dueDate = parseDate(value('dueDate'))
      const status =
        STATUSES.find((s) => normalized(s) === normalized(rawStatus)) ||
        STATUS_ALIASES[normalized(rawStatus)] ||
        statusOptions?.find((o) => normalized(o.label) === normalized(rawStatus))?.label ||
        'Não iniciado'
      const priority =
        PRIORITIES.find((p) => normalized(p) === normalized(rawPriority)) ||
        PRIORITY_ALIASES[normalized(rawPriority)] ||
        priorityOptions?.find((o) => normalized(o.label) === normalized(rawPriority))?.label ||
        'Média'
      let description = value('description')
      const unmatchedOwners = sourceOwners.filter((_, index) => !matchedOwners[index])
      if (unmatchedOwners.length) {
        description += `\nResponsável na origem: ${unmatchedOwners.map((name) => references.get(name)?.original || name).join(', ')}`
        warnings.add('Pessoas sem correspondência foram mantidas na descrição, sem criar usuários.')
      }
      if (
        rawStatus &&
        !(STATUSES as readonly string[]).includes(rawStatus) &&
        !STATUS_ALIASES[normalized(rawStatus)] &&
        !statusOptions?.some((o) => normalized(o.label) === normalized(rawStatus))
      ) {
        description += `\nStatus na origem: ${rawStatus}`
        warnings.add(
          'Status desconhecidos viraram “Não iniciado”; o original foi mantido na descrição.',
        )
      }
      if (
        rawPriority &&
        !(PRIORITIES as readonly string[]).includes(rawPriority) &&
        !PRIORITY_ALIASES[normalized(rawPriority)] &&
        !priorityOptions?.some((o) => normalized(o.label) === normalized(rawPriority))
      ) {
        description += `\nPrioridade na origem: ${rawPriority}`
        warnings.add(
          'Prioridades desconhecidas viraram “Média”; o original foi mantido na descrição.',
        )
      }
      if (value('dueDate') && !dueDate) {
        description += `\nData na origem: ${value('dueDate')}`
        warnings.add('Datas inválidas foram mantidas na descrição.')
      }
      const customValues = Object.fromEntries(
        Object.entries(customColumns).map(([header, columnId]) => {
          let raw = row[preview.headers.indexOf(header)] || ''
          const column = board.columns.find((candidate) => candidate.id === columnId)!
          const sourceColumn = preview.columns?.find((source) => source.header === header)
          if (sourceColumn?.options && column.options) {
            const destinationLabel = (value: string) => {
              const sourceOption = sourceColumn.options?.find((option) => option.label === value)
              return (
                column.options?.find((option) => option.id === sourceOption?.id)?.label || value
              )
            }
            if (column.type === 'status') raw = destinationLabel(raw)
            if (column.type === 'dropdown')
              raw = JSON.stringify(columnList(raw).map(destinationLabel))
          }
          if (column.type === 'people' && raw.startsWith('['))
            raw = JSON.stringify(
              columnList(raw).map((value) => references.get(value)?.value || value),
            )
          try {
            return [columnId, importColumnValue(column, raw, people)]
          } catch {
            const original =
              column.type === 'people'
                ? columnList(row[preview.headers.indexOf(header)] || '')
                    .map((value) => references.get(value)?.original || value)
                    .join(', ')
                : raw
            description += '\n' + header + ' na origem: ' + original
            warnings.add('Valores incompatíveis com o tipo da coluna foram mantidos na descrição.')
            return [columnId, '']
          }
        }),
      )
      for (const column of board.columns)
        if (column.type === 'last_updated' || column.source?.readOnly)
          delete customValues[column.id]
      await insertTask(tx, {
        boardId,
        groupId: group.id,
        title: title.slice(0, 300),
        description: description.trim(),
        status,
        priority,
        dueDate,
        dueAt:
          /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value('dueDate')) &&
          Number.isFinite(Date.parse(value('dueDate')))
            ? new Date(value('dueDate')).toISOString()
            : null,
        ownerIds: [...new Set(matchedOwners.flatMap((person) => (person ? [person.id] : [])))],
        source,
        externalId,
        customValues,
      })
      imported++
      if (index >= MAX_ROWS) throw new Error('Limite de linhas excedido.')
    }
    await tx.query('INSERT INTO import_runs VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      id(),
      boardId,
      preview.source,
      preview.name,
      imported,
      skipped,
      new Date().toISOString(),
    ])
    return { boardId, imported, skipped, warnings: [...warnings] }
  })
}
