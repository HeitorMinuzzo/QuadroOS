import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import type { Comment, Task } from '../../shared/domain'

const tags = [
  'p',
  'div',
  'span',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
]
export function ImportedCommentBody({
  comment,
  tasks,
  onOpenTask,
}: {
  comment: Comment
  tasks: Task[]
  onOpenTask: (id: string) => void
}) {
  const html = typeof comment.metadata?.html === 'string' ? comment.metadata.html : null
  const safe = useMemo(() => {
    if (!html) return null
    const fragment = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: tags,
      ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan'],
      ALLOW_DATA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    })
    for (const anchor of fragment.querySelectorAll('a')) {
      const href = anchor.getAttribute('href') || ''
      let sourceId: string | undefined
      try {
        const url = new URL(href)
        if (
          url.protocol === 'https:' &&
          (url.hostname === 'monday.com' || url.hostname.endsWith('.monday.com'))
        )
          sourceId = url.pathname.match(/\/pulses\/(\d+)/)?.[1]
      } catch {
        /* Relative and invalid links cannot identify an imported item. */
      }
      const currentBoard = tasks.find((task) => task.id === comment.taskId)?.boardId
      const candidates = sourceId
        ? tasks.filter((task) => task.source?.startsWith('monday') && task.externalId === sourceId)
        : []
      const local = candidates.find((task) => task.boardId === currentBoard) || candidates[0]
      if (local) {
        anchor.setAttribute('href', `#/board/${local.boardId}/table`)
        anchor.setAttribute('data-local-task', local.id)
      } else if (href) {
        anchor.setAttribute('target', '_blank')
        anchor.setAttribute('rel', 'noopener noreferrer')
      }
    }
    const container = document.createElement('div')
    container.append(fragment)
    return DOMPurify.sanitize(container.innerHTML, {
      ALLOWED_TAGS: tags,
      ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan', 'target', 'rel', 'data-local-task'],
      ALLOW_DATA_ATTR: false,
    })
  }, [html, tasks, comment.taskId])
  return safe ? (
    <div
      className="imported-comment-body"
      dangerouslySetInnerHTML={{ __html: safe }}
      onClick={(event) => {
        const anchor = (event.target as Element).closest?.('a[data-local-task]'),
          id = anchor?.getAttribute('data-local-task')
        if (id && tasks.some((task) => task.id === id)) {
          event.preventDefault()
          onOpenTask(id)
        }
      }}
    />
  ) : (
    <p>{comment.body}</p>
  )
}
