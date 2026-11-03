import 'dotenv/config'
import { createDatabase } from './database.ts'
import { buildApp } from './app.ts'

const db = await createDatabase({ url: process.env.DATABASE_URL, path: process.env.DATA_DIR })
const app = await buildApp(db, { demo: process.env.SEED_DEMO !== 'false', logger: true })
await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3001) })
let closing = false
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    if (closing) return
    closing = true
    await app.close()
    await db.close()
    process.exit(0)
  })
