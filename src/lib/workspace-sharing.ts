import type { Workspace } from '../../shared/domain'

function shareRecords<T extends { id: string }>(
  previous: T[] | undefined,
  next: T[] | undefined,
): T[] | undefined {
  if (previous === next || !next) return next
  const byId = new Map<string, T>(previous?.map((row) => [row.id, row]))
  const shared = next.map((row) => {
    const old = byId.get(row.id)
    return old && (old === row || JSON.stringify(old) === JSON.stringify(row)) ? old : row
  })
  return previous?.length === shared.length && shared.every((row, index) => row === previous[index])
    ? previous
    : shared
}

// A refreshed DTO should not invalidate every task/control when only one conversation changed.
export function shareWorkspace(previous: Workspace, next: Workspace): Workspace {
  const shared: Workspace = {
    ...next,
    boards: shareRecords(previous.boards, next.boards)!,
    groups: shareRecords(previous.groups, next.groups)!,
    tasks: shareRecords(previous.tasks, next.tasks)!,
    people: shareRecords(previous.people, next.people)!,
    comments: shareRecords(previous.comments, next.comments)!,
    imports: shareRecords(previous.imports, next.imports)!,
    ...(next.attachments
      ? { attachments: shareRecords(previous.attachments, next.attachments) }
      : {}),
  }
  return (
    [...new Set([...Object.keys(previous), ...Object.keys(shared)])] as (keyof Workspace)[]
  ).every((key) => Object.is(previous[key], shared[key]))
    ? previous
    : shared
}
