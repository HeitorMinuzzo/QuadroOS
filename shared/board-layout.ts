import type { Board, Task, Group } from './domain.ts'

export function columnLayout(key: string) {
  const definitions: Record<string, { width: number; min: number; max: number }> = {
    title: { width: 360, min: 220, max: 1200 },
    owner: { width: 121, min: 95, max: 600 },
    status: { width: 145, min: 110, max: 600 },
    priority: { width: 125, min: 100, max: 600 },
    date: { width: 137, min: 110, max: 600 },
  }
  return definitions[key] || { width: 135, min: 90, max: 800 }
}

export function boardColumnKeys(board: Board) {
  return ['title', 'owner', 'status', 'priority', 'date', ...board.columns.map((c) => c.id)]
}

export function orderedColumnKeys(keys: string[], saved: string[] = []) {
  return [...new Set([...saved.filter((key) => keys.includes(key)), ...keys])]
}

export type TaskPlacement = 'before' | 'after'
export function moveGroupOrder(
  groups: Group[],
  id: string,
  targetId: string,
  placement: TaskPlacement,
) {
  const group = groups.find((group) => group.id === id)
  const target = groups.find((group) => group.id === targetId)
  if (!group || !target || group.boardId !== target.boardId) return []
  const siblings = groups
    .filter((item) => item.boardId === group.boardId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  if (id === targetId) return siblings
  const rest = siblings.filter((item) => item.id !== id)
  rest.splice(
    rest.findIndex((item) => item.id === targetId) + Number(placement === 'after'),
    0,
    group,
  )
  return rest.map((item, position) => ({ ...item, position }))
}
export function moveAmongSiblings(
  tasks: Task[],
  task: Task,
  targetId: string,
  placement: TaskPlacement,
) {
  const siblings = tasks
    .filter(
      (t) =>
        t.boardId === task.boardId && t.groupId === task.groupId && t.parentId === task.parentId,
    )
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  const rest = siblings.filter((t) => t.id !== task.id)
  const target = rest.findIndex((t) => t.id === targetId)
  if (target < 0) return siblings
  rest.splice(target + Number(placement === 'after'), 0, task)
  return rest.map((t, position) => ({ ...t, position }))
}
