import { randomUUID } from 'node:crypto'
import type { MondayBatch } from '../shared/domain.ts'
import { guessImportMapping } from '../shared/imports.ts'
import type { Database } from './database.ts'
import { DomainError } from './errors.ts'
import { applyImport } from './imports.ts'
import { listMondayBoards, prepareMondayPreview, type MondayFetch } from './monday.ts'
import type { createMondaySessions } from './monday-sessions.ts'

export async function createMondayBatch(
  db: Database,
  sessions: ReturnType<typeof createMondaySessions>,
  fetcher?: MondayFetch,
) {
  let latest =
    (
      await db.query<{ snapshot: MondayBatch }>(
        'SELECT snapshot FROM monday_batch_checkpoint WHERE id=1',
      )
    ).rows[0]?.snapshot ?? null
  let worker: Promise<void> | undefined
  let closing = false

  async function checkpoint(job: MondayBatch) {
    await db.query(
      'INSERT INTO monday_batch_checkpoint (id,snapshot) VALUES (1,$1::jsonb) ON CONFLICT (id) DO UPDATE SET snapshot=EXCLUDED.snapshot',
      [JSON.stringify(job)],
    )
  }

  if (latest?.status === 'running') {
    latest.status = 'interrupted'
    latest.currentBoard = null
    latest.error =
      'O servidor foi reiniciado. Informe a chave novamente para retomar os quadros pendentes.'
    await checkpoint(latest)
  }

  async function run(job: MondayBatch, token: string) {
    let status: MondayBatch['status'] = 'complete'
    let error: string | undefined
    try {
      const boards = await listMondayBoards(token, fetcher)
      job.total = boards.length
      const accessible = new Set(boards.map((board) => board.id))
      job.results = job.results.filter((item) => accessible.has(item.sourceBoardId))
      if (job.results.length) {
        const { rows } = await db.query<{ id: string }>(
          'SELECT id FROM boards WHERE id=ANY($1::text[])',
          [job.results.map((item) => item.boardId)],
        )
        const existing = new Set(rows.map((row) => row.id))
        job.results = job.results.filter((item) => item.boardId && existing.has(item.boardId))
      }
      const completed = new Set(job.results.map((item) => item.sourceBoardId))
      await checkpoint(job)
      for (const board of boards) {
        if (closing) break
        if (completed.has(board.id)) continue
        job.currentBoard = board.name
        const entry = { sourceBoardId: board.id, name: board.name }
        try {
          const { rows } = await db.query<{ id: string; source_board_id: string | null }>(
            `SELECT b.id, b.settings->'monday'->>'boardId' AS source_board_id FROM boards b
             WHERE b.settings->'monday'->>'boardId'=$1
                OR EXISTS (SELECT 1 FROM tasks t WHERE t.board_id=b.id AND t.source=$2)
             LIMIT 2`,
            [board.id, `monday:${board.id}`],
          )
          const destination = rows[0]
          if (
            rows.length > 1 ||
            (destination?.source_board_id && destination.source_board_id !== board.id)
          )
            throw new DomainError(
              'Este quadro está associado a destinos múltiplos ou compartilhados. Use a importação individual para escolher qual atualizar.',
            )
          const bundle = await prepareMondayPreview(token, board.id, fetcher)
          if (!bundle.preview.items)
            throw new DomainError('O Monday não retornou a estrutura completa deste quadro.')
          const staged = await sessions.stage(bundle)
          const session = await sessions.lease(staged.sessionId!)
          try {
            const result = await applyImport(
              db,
              session.preview,
              guessImportMapping(session.preview),
              {
                boardId: destination?.id,
                importPeople: true,
                importAutomations: true,
                readAsset: (asset) => sessions.read(session, asset),
              },
            )
            const { boardId, imported, skipped, warnings } = result
            job.results.push({
              ...entry,
              boardId,
              imported,
              skipped,
              warnings,
              reportId:
                'reportId' in result && typeof result.reportId === 'string'
                  ? result.reportId
                  : undefined,
            })
          } finally {
            await sessions.finish(session, true).catch(() => undefined)
          }
        } catch (error) {
          job.results.push({
            ...entry,
            error:
              error instanceof DomainError
                ? error.message
                : 'Não foi possível preparar ou salvar este quadro. Tente a importação individual para ver os detalhes.',
          })
        }
        await checkpoint(job)
      }
      if (closing) {
        status = 'interrupted'
        error =
          'O servidor foi desligado. Informe a chave novamente para retomar os quadros pendentes.'
      }
    } catch {
      status = job.total === null && !job.results.length ? 'failed' : 'interrupted'
      error =
        job.total === null
          ? 'Não foi possível listar os quadros do Monday. Confira a chave e tente novamente.'
          : 'Não foi possível registrar o progresso. Os quadros já gravados poderão ser reaproveitados.'
    } finally {
      const finished: MondayBatch = { ...job, status, error, currentBoard: null }
      try {
        await checkpoint(finished)
      } catch {
        finished.status = 'interrupted'
        finished.error =
          'Não foi possível registrar o progresso. Os quadros já gravados poderão ser reaproveitados.'
      }
      latest = finished
    }
  }

  return {
    latest: () => latest,
    running: () => latest?.status === 'running' || !!worker,
    async start(token: string, resumeId?: string) {
      if (closing || worker || latest?.status === 'running')
        throw new DomainError('Já existe uma importação em lote em andamento.', 409)
      const previous = latest
      if (resumeId && (previous?.id !== resumeId || previous.status !== 'interrupted'))
        throw new DomainError('Este lote não está disponível para retomada.', 409)
      const job: MondayBatch = {
        id: randomUUID(),
        status: 'running',
        total: null,
        currentBoard: null,
        results: resumeId ? previous!.results.filter((item) => item.boardId && !item.error) : [],
      }
      latest = job
      try {
        await checkpoint(job)
      } catch (error) {
        latest = previous
        throw error
      }
      worker = run(job, token).finally(() => {
        worker = undefined
      })
      return job
    },
    async close() {
      closing = true
      await worker
    },
  }
}
