import { createHash } from 'node:crypto'
import type { Database } from './database.ts'
import { camelRow } from './database.ts'
import type { ImportPreview, ImportMapping, Person } from '../shared/domain.ts'
import { initials } from '../shared/domain.ts'
import { columnList } from '../shared/columns.ts'
import { importKey } from '../shared/imports.ts'

export async function prepareImportPeople(
  db: Database,
  preview: ImportPreview,
  mapping: ImportMapping,
  create: boolean,
) {
  const people = (await db.query('SELECT * FROM people')).rows.map((row) => camelRow<Person>(row))
  const references = new Map<string, { value: string; original: string }>()
  if (preview.source !== 'monday') return { people, references }
  const used = new Set(
    preview.columns
      ?.filter(
        (column) =>
          column.type === 'people' && ['owner', 'custom'].includes(mapping[column.header]),
      )
      .flatMap((column) =>
        preview.rows.flatMap((row) =>
          columnList(row[preview.headers.indexOf(column.header)] || ''),
        ),
      ),
  )
  for (const item of preview.items || [])
    for (const value of Object.values(item.values)) {
      if (value.includes('monday-person:')) for (const ref of columnList(value)) used.add(ref)
    }
  if (create)
    for (const update of preview.updates || [])
      if (update.authorSourceId) used.add(`monday-person:${update.authorSourceId}`)
  for (const source of preview.people || []) {
    const ref = `monday-person:${source.sourceId}`
    if (!used.has(ref)) continue
    let person = source.email
      ? people.find((p) => importKey(p.email) === importKey(source.email))
      : undefined
    const exactNames = people.filter((p) => importKey(p.name) === importKey(source.name))
    if (!person && exactNames.length === 1) person = exactNames[0]
    const localId = `monday-person-${source.sourceId}`
    person ??= people.find((p) => p.id === localId)
    if (!person && create) {
      const colorIndex =
        parseInt(createHash('sha256').update(source.sourceId).digest('hex').slice(0, 4), 16) % 5
      person = {
        id: localId,
        name: source.name,
        initials: initials(source.name),
        email: source.email || `${localId}@imported.quadro.local`,
        color: ['#0073ea', '#9d50dd', '#037f4c', '#bd653c', '#647ac1'][colorIndex],
      }
      await db.query(
        'INSERT INTO people (id,name,initials,color,email) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [person.id, person.name, person.initials, person.color, person.email],
      )
      const stored = (
        await db.query('SELECT * FROM people WHERE id=$1 OR lower(email)=lower($2)', [
          person.id,
          person.email,
        ])
      ).rows[0]
      person = camelRow<Person>(stored)
      people.push(person)
    }
    references.set(ref, {
      value: person?.id || source.email || source.name,
      original: source.email ? `${source.name} (${source.email})` : source.name,
    })
  }
  return { people, references }
}
