import { randomUUID } from 'node:crypto'
import { mkdtemp, open, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ImportPreview, ImportSourceAsset } from '../shared/domain.ts'
import { DomainError } from './errors.ts'

export function assetKey(asset: ImportSourceAsset) {
  return `${asset.itemExternalId}:${asset.sourceColumnId || 'updates'}:${asset.externalId}:${asset.updateExternalId || ''}`
}
export interface MondaySession {
  id: string
  preview: ImportPreview
  directory: string | null
  files: Map<string, string>
  expiresAt: number
  busy: boolean
}
function allowedDownload(url: string) {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      (!parsed.port || parsed.port === '443') &&
      [
        'monday.com',
        'mondayusercontent.com',
        'amazonaws.com',
        'storage.googleapis.com',
        'blob.core.windows.net',
      ].some((host) => parsed.hostname === host || parsed.hostname.endsWith('.' + host))
    )
  } catch {
    return false
  }
}
export function createMondaySessions(downloadFetcher: typeof fetch = fetch) {
  const sessions = new Map<string, MondaySession>()
  const fileLimit = Math.max(1, Number(process.env.MAX_MONDAY_FILE_BYTES) || 100 * 1024 * 1024)
  const totalLimit = Math.max(
    fileLimit,
    Number(process.env.MAX_MONDAY_IMPORT_BYTES) || 1024 * 1024 * 1024,
  )
  const lifetime = 30 * 60 * 1000
  async function dispose(session: MondaySession) {
    sessions.delete(session.id)
    if (!session.directory) return
    const directory = resolve(session.directory)
    const parent = resolve(tmpdir())
    if (
      directory.startsWith(parent + (process.platform === 'win32' ? '\\' : '/')) &&
      directory.split(/[\\/]/).pop()?.startsWith('quadroos-monday-')
    )
      await rm(directory, { recursive: true, force: true })
  }
  async function purge() {
    for (const session of sessions.values())
      if (!session.busy && session.expiresAt < Date.now()) await dispose(session)
  }
  const interval = setInterval(() => void purge().catch(() => undefined), 60_000)
  interval.unref()
  return {
    async stage(bundle: { preview: ImportPreview; downloads: Map<string, string> }) {
      await purge()
      if (sessions.size >= 3)
        throw new DomainError(
          'Há três prévias abertas. Conclua ou feche uma importação antes de preparar outra.',
        )
      const session: MondaySession = {
        id: randomUUID(),
        preview: bundle.preview,
        directory: null,
        files: new Map(),
        expiresAt: Date.now() + lifetime,
        busy: true,
      }
      sessions.set(session.id, session)
      try {
        let reservedBytes = 0
        for (const asset of bundle.preview.assets || []) {
          if (asset.failure || asset.externalUrl) continue
          if (asset.size > fileLimit || reservedBytes + asset.size > totalLimit) {
            asset.failure = `O arquivo ultrapassa os limites configurados da importação (${Math.round(fileLimit / 1024 / 1024)} MB por arquivo).`
            continue
          }
          const downloadUrl = bundle.downloads.get(assetKey(asset))
          if (!downloadUrl || !allowedDownload(downloadUrl)) {
            asset.failure =
              'A API não forneceu um endereço de download reconhecido para este arquivo.'
            continue
          }
          reservedBytes += asset.size
          session.directory ??= await mkdtemp(join(tmpdir(), 'quadroos-monday-'))
          const destination = join(session.directory, randomUUID())
          let handle: Awaited<ReturnType<typeof open>> | undefined
          try {
            let response: Response | undefined
            let url = downloadUrl
            for (let redirect = 0; redirect < 5; redirect++) {
              if (!allowedDownload(url))
                throw new Error('O arquivo redirecionou para um endereço não reconhecido.')
              response = await downloadFetcher(url, {
                redirect: 'manual',
                signal: AbortSignal.timeout(60_000),
              })
              if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location')
                await response.body?.cancel()
                if (!location) throw new Error('Redirecionamento de arquivo sem endereço.')
                url = new URL(location, url).href
                continue
              }
              break
            }
            if (!response?.ok || !response.body)
              throw new Error('O arquivo não pôde ser baixado com o acesso disponível.')
            const advertised = Number(response.headers.get('content-length') || 0)
            if (advertised > fileLimit)
              throw new Error('O arquivo é maior que o limite configurado.')
            // Drain the socket without awaiting disk writes between chunks: a paused body that the
            // storage host closes (it recycles keep-alive connections) crashes Node's fetch
            // (undici assertion in Parser.finish) instead of rejecting. Files are capped by fileLimit.
            const reader = response.body.getReader()
            const chunks: Uint8Array[] = []
            let bytes = 0
            try {
              while (true) {
                const chunk = await reader.read()
                if (chunk.done) break
                bytes += chunk.value.byteLength
                if (bytes > fileLimit || reservedBytes - asset.size + bytes > totalLimit)
                  throw new Error('O download ultrapassou o limite configurado.')
                chunks.push(chunk.value)
              }
            } finally {
              await reader.cancel().catch(() => undefined)
            }
            handle = await open(destination, 'wx')
            await handle.writeFile(Buffer.concat(chunks, bytes))
            if (asset.size && asset.size !== bytes)
              throw new Error('O download terminou com tamanho diferente do informado pela origem.')
            reservedBytes += bytes - asset.size
            asset.size = bytes
            session.files.set(assetKey(asset), destination)
          } catch (error) {
            await handle?.close()
            handle = undefined
            reservedBytes -= asset.size
            asset.failure =
              error instanceof Error && !/fetch|network|timeout|aborted/i.test(error.message)
                ? error.message
                : 'Falha de rede durante o download. Prepare uma nova prévia para tentar novamente.'
            await rm(destination, { force: true }).catch(() => undefined)
          } finally {
            await handle?.close()
          }
        }
        const failed = bundle.preview.assets?.filter((asset) => asset.failure) || []
        if (failed.length)
          bundle.preview.coverage?.push({
            name: 'Arquivos não copiados',
            sourceType: 'file',
            mode: 'unavailable',
            count: failed.length,
            detail:
              'Os nomes, IDs e motivos estão no relatório. Esses arquivos não serão apresentados como anexos copiados.',
          })
        session.busy = false
        session.expiresAt = Date.now() + lifetime
        sessions.set(session.id, session)
        return this.publicPreview(session)
      } catch (error) {
        await dispose(session)
        throw error
      }
    },
    publicPreview(session: MondaySession): ImportPreview {
      const {
        items: _items,
        updates: _updates,
        assets: _assets,
        automations: _automations,
        sourceMetadata: _metadata,
        ...preview
      } = session.preview
      return { ...preview, sessionId: session.id }
    },
    async lease(id: string) {
      await purge()
      const session = sessions.get(id)
      if (!session)
        throw new DomainError(
          'A prévia expirou. Prepare a importação novamente; nenhuma tarefa foi alterada.',
        )
      if (session.busy)
        throw new DomainError('Esta importação já está sendo gravada. Aguarde a conclusão.', 409)
      session.busy = true
      return session
    },
    async read(session: MondaySession, asset: ImportSourceAsset) {
      const path = session.files.get(assetKey(asset))
      return path ? readFile(path) : null
    },
    async finish(session: MondaySession, success: boolean) {
      session.busy = false
      if (success) await dispose(session)
      else session.expiresAt = Date.now() + lifetime
    },
    async cancel(id: string) {
      const session = sessions.get(id)
      if (session && !session.busy) await dispose(session)
    },
    async close() {
      clearInterval(interval)
      for (const session of sessions.values()) await dispose(session)
    },
  }
}
