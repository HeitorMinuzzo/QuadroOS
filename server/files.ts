import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { MAX_CELL_FILES, MAX_FILE_SIZE, type Board } from '../shared/domain.ts'
import { camelRow, type Database } from './database.ts'
import { DomainError } from './errors.ts'
import { safeUrl } from '../shared/rich-values.ts'

export function registerFileRoutes(app: FastifyInstance, db: Database) {
  app.get<{ Params: { id: string } }>('/api/files/:id/preview', async (request, reply) => {
    const row = (
      await db.query<{ content: Uint8Array; external_url: string | null }>(
        'SELECT content,external_url FROM task_files WHERE id=$1',
        [request.params.id],
      )
    ).rows[0]
    if (!row || row.external_url) throw new DomainError('Prévia de imagem indisponível.', 404)
    const bytes = Buffer.from(row.content)
    const type = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'image/jpeg'
        : bytes.subarray(0, 3).toString() === 'GIF'
          ? 'image/gif'
          : bytes.subarray(0, 4).toString() === 'RIFF' &&
              bytes.subarray(8, 12).toString() === 'WEBP'
            ? 'image/webp'
            : null
    if (!type) throw new DomainError('Este arquivo não possui uma prévia de imagem segura.', 415)
    return reply
      .type(type)
      .header('Content-Disposition', 'inline')
      .header('Cache-Control', 'private, no-store')
      .send(bytes)
  })
  app.post<{ Params: { id: string; columnId: string } }>(
    '/api/tasks/:id/files/:columnId',
    async (request, reply) => {
      const part = await request.file({ limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 0 } })
      if (!part) throw new DomainError('Escolha um arquivo para anexar.')
      const content = await part.toBuffer()
      const name =
        (part.filename.split(/[\\/]/).pop() || 'arquivo')
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .slice(0, 200) || 'arquivo'
      const file = await db.transaction(async (tx) => {
        // Lock the board first, like task/column mutations, so deletion and uploads cannot race.
        const row = (
          await tx.query(
            'SELECT b.* FROM boards b JOIN tasks t ON t.board_id=b.id WHERE t.id=$1 FOR UPDATE OF b',
            [request.params.id],
          )
        ).rows[0]
        if (!row) throw new DomainError('Tarefa não encontrada.', 404)
        const board = camelRow<Board>(row)
        if (!board.columns.some((c) => c.id === request.params.columnId && c.type === 'files'))
          throw new DomainError('A coluna de arquivos não existe neste quadro.', 404)
        if (
          !(await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [request.params.id])).rows
            .length
        )
          throw new DomainError('Tarefa não encontrada.', 404)
        const count = (
          await tx.query<{ count: string }>(
            'SELECT COUNT(*) AS count FROM task_files WHERE task_id=$1 AND column_id=$2',
            [request.params.id, request.params.columnId],
          )
        ).rows[0]
        if (Number(count.count) >= MAX_CELL_FILES)
          throw new DomainError(`Cada célula permite até ${MAX_CELL_FILES} arquivos.`)
        const result = await tx.query(
          'INSERT INTO task_files (id,task_id,column_id,name,size,content,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,task_id,column_id,name,size,created_at',
          [
            randomUUID(),
            request.params.id,
            request.params.columnId,
            name,
            content.length,
            content,
            new Date().toISOString(),
          ],
        )
        return camelRow(result.rows[0])
      })
      return reply.status(201).send(file)
    },
  )
  app.get<{ Params: { id: string } }>('/api/files/:id', async (request, reply) => {
    const file = (
      await db.query<{ name: string; content: Uint8Array; external_url?: string | null }>(
        'SELECT name,content,external_url FROM task_files WHERE id=$1',
        [request.params.id],
      )
    ).rows[0]
    if (!file) throw new DomainError('Arquivo não encontrado.', 404)
    if (file.external_url) {
      const url = safeUrl(file.external_url)
      if (!url) throw new DomainError('O endereço do arquivo da origem é inválido.')
      return reply.redirect(url)
    }
    const encoded = encodeURIComponent(file.name).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    return reply
      .type('application/octet-stream')
      .header('Content-Disposition', `attachment; filename="arquivo"; filename*=UTF-8''${encoded}`)
      .header('Cache-Control', 'private, no-store')
      .send(Buffer.from(file.content))
  })
  app.delete<{ Params: { id: string } }>('/api/files/:id', async (request, reply) => {
    const result = await db.query('DELETE FROM task_files WHERE id=$1 RETURNING id', [
      request.params.id,
    ])
    if (!result.rows.length) throw new DomainError('Arquivo não encontrado.', 404)
    return reply.status(204).send()
  })
}
