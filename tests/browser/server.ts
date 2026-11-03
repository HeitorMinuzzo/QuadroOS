// Browser fixtures run in a separate database and never call monday or use real credentials.
import { createDatabase } from '../../server/database.ts'
import { buildApp } from '../../server/app.ts'
import { richMondayFetch, richDownloadFetch } from '../fixtures/monday-rich.ts'
const db = await createDatabase({ path: 'memory://' })
const app = await buildApp(db, {
  demo: true,
  mondayFetch: richMondayFetch,
  mondayDownload: richDownloadFetch,
})
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT || 3002) })
let closing = false
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    if (closing) return
    closing = true
    await app.close()
    await db.close()
    process.exit(0)
  })
