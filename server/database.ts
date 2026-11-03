import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface Database {
  kind: string
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>
  close(): Promise<void>
}
export async function createDatabase(
  options: { url?: string; path?: string } = {},
): Promise<Database> {
  if (options.url) {
    const pool = new pg.Pool({ connectionString: options.url, max: 8 })
    const db: Database = {
      kind: 'PostgreSQL',
      async query(sql, params) {
        const result = await pool.query(sql, params)
        return { rows: result.rows }
      },
      async transaction(fn) {
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const result = await fn({
            ...db,
            query: async (sql, params) => ({ rows: (await client.query(sql, params)).rows }),
          })
          await client.query('COMMIT')
          return result
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
      },
      async close() {
        await pool.end()
      },
    }
    return db
  }
  const path = options.path ?? resolve('data/postgres')
  if (path !== 'memory://') await mkdir(path, { recursive: true })
  const engine = new PGlite(path)
  await engine.waitReady
  const db: Database = {
    kind: 'PostgreSQL embarcado',
    async query<T>(sql: string, params?: unknown[]) {
      return engine.query<T>(sql, params)
    },
    async transaction(fn) {
      return engine.transaction((tx) =>
        fn({ ...db, query: (sql, params) => tx.query(sql, params) }),
      )
    },
    async close() {
      await engine.close()
    },
  }
  return db
}

export async function migrate(db: Database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT NOT NULL, initials TEXT NOT NULL, color TEXT NOT NULL, email TEXT NOT NULL UNIQUE)`,
    `CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'board', favorite BOOLEAN NOT NULL DEFAULT false, columns JSONB NOT NULL DEFAULT '[]')`,
    `CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, name TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, UNIQUE(id, board_id))`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Não iniciado', priority TEXT NOT NULL DEFAULT 'Média', due_date TEXT,
      owner_id TEXT REFERENCES people(id) ON DELETE SET NULL, position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      source TEXT, external_id TEXT, custom_values JSONB NOT NULL DEFAULT '{}',
      FOREIGN KEY (group_id, board_id) REFERENCES groups(id, board_id) ON DELETE CASCADE)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS tasks_external_key ON tasks(board_id, source, external_id) WHERE external_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS tasks_board_idx ON tasks(board_id, group_id, position)`,
    `CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES people(id), body TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS import_runs (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, source TEXT NOT NULL, name TEXT NOT NULL, imported INTEGER NOT NULL, skipped INTEGER NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS previous_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL`,
    `ALTER TABLE boards ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS owner_ids JSONB NOT NULL DEFAULT '[]'`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_at TEXT`,
    `CREATE INDEX IF NOT EXISTS tasks_parent_idx ON tasks(parent_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS groups_completed_idx ON groups(board_id) WHERE is_completed=true`,
    `CREATE TABLE IF NOT EXISTS board_automations (
      id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      column_id TEXT NOT NULL, option_id TEXT NOT NULL, group_id TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(board_id,column_id,option_id),
      FOREIGN KEY(group_id,board_id) REFERENCES groups(id,board_id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      automation_id TEXT REFERENCES board_automations(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, task_title TEXT NOT NULL,
      rule_description TEXT NOT NULL, from_group TEXT NOT NULL, to_group TEXT NOT NULL,
      created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS automation_runs_board_idx ON automation_runs(board_id,created_at)`,
    `CREATE TABLE IF NOT EXISTS task_files (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      column_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL,
      content BYTEA NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS task_files_cell_idx ON task_files(task_id,column_id)`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS source TEXT`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS external_id TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS groups_source_idx ON groups(board_id,source,external_id) WHERE external_id IS NOT NULL`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS source TEXT`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS external_id TEXT`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS comments_source_idx ON comments(task_id,source,external_id) WHERE external_id IS NOT NULL`,
    `ALTER TABLE task_files ADD COLUMN IF NOT EXISTS source TEXT`,
    `ALTER TABLE task_files ADD COLUMN IF NOT EXISTS external_id TEXT`,
    `ALTER TABLE task_files ADD COLUMN IF NOT EXISTS comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE`,
    `ALTER TABLE task_files ADD COLUMN IF NOT EXISTS external_url TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS task_files_source_idx ON task_files(task_id,column_id,source,external_id) WHERE external_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS import_reports (
      id TEXT PRIMARY KEY REFERENCES import_runs(id) ON DELETE CASCADE,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, coverage JSONB NOT NULL, snapshot JSONB NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS monday_batch_checkpoint (
      id INTEGER PRIMARY KEY CHECK (id = 1), snapshot JSONB NOT NULL)`,
  ]
  await db.transaction(async (tx) => {
    for (const sql of statements) await tx.query(sql)
    const now = new Date().toISOString()
    const owners = await tx.query(
      `INSERT INTO schema_migrations (id,applied_at) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id`,
      ['20261022_multiple_owners', now],
    )
    if (owners.rows.length)
      await tx.query(
        `UPDATE tasks SET owner_ids=jsonb_build_array(owner_id) WHERE owner_id IS NOT NULL AND owner_ids='[]'::jsonb`,
      )
    const migration = await tx.query(
      `INSERT INTO schema_migrations (id,applied_at) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id`,
      ['20261021_monday_statuses', now],
    )
    if (migration.rows.length) {
      await tx.query(
        `UPDATE tasks SET status=CASE status WHEN 'Concluído' THEN 'Feito' WHEN 'Em revisão' THEN 'Aguardando' END, version=version+1, updated_at=$1 WHERE status IN ('Concluído','Em revisão')`,
        [now],
      )
    }
    // Retire the old automatic completion workflow without moving existing data.
    await tx.query(
      `INSERT INTO schema_migrations (id,applied_at) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id`,
      ['20261021_subitems_completion_groups', now],
    )
  })
}
export function camelRow<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value,
    ]),
  ) as T
}
