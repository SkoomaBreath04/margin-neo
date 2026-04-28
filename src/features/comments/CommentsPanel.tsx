import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import {
  FOCUS_THREAD_EVENT,
  THREAD_CREATED_EVENT,
  type FocusThreadDetail,
} from './commentExtension'
import type { Thread, ThreadStatus } from './types'
import { useThreadsForNote } from './useThreadsForNote'

const STATUS_ORDER: ThreadStatus[] = ['open', 'resolved', 'orphaned']
const STATUS_LABELS: Record<ThreadStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  orphaned: 'Orphaned',
}

export interface CommentsPanelProps {
  vaultPath: string
  noteRelPath: string | null
}

/**
 * Read-only thread browser for the active note (slice 3.1).
 *
 * Lists threads from `useThreadsForNote`, grouped by status, with
 * filter tabs across the top showing per-status counts. Listens for
 * `tolaria:focus-thread` (dispatched by Alt+click on an anchored
 * block, see `CommentAnchors`) to auto-switch to the target thread's
 * status tab and highlight that card. Listens for
 * `tolaria:thread-created` to clear the highlight so a fresh thread
 * doesn't keep an unrelated card framed.
 *
 * Slice 3.1 is read-only: no reply composer, no status mutations,
 * no promote-to-decision. Those land in 3.3 and 3.4. The panel
 * mounts as a sibling of `EditorRightPanel` for now; slice 3.5
 * promotes it to a proper Inspector/AI-style tab.
 *
 * Returns `null` when the active note has no threads so we don't
 * occupy editor real estate before there's anything to show.
 */
export function CommentsPanel({ vaultPath, noteRelPath }: CommentsPanelProps) {
  const threads = useThreadsForNote({ vaultPath, noteRelPath })
  const [activeStatus, setActiveStatus] = useState<ThreadStatus>('open')
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null)

  const counts = useMemo(() => groupCountsByStatus(threads), [threads])
  const visibleThreads = useMemo(
    () => threads.filter((t) => t.status === activeStatus),
    [threads, activeStatus],
  )

  // External focus request → switch to the target's status tab and
  // highlight it. The target may be on a different tab than the user
  // is currently viewing.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<FocusThreadDetail>).detail
      if (!detail?.threadId) return
      const target = threads.find((t) => t.id === detail.threadId)
      if (target) setActiveStatus(target.status)
      setFocusedThreadId(detail.threadId)
    }
    window.addEventListener(FOCUS_THREAD_EVENT, handler)
    return () => window.removeEventListener(FOCUS_THREAD_EVENT, handler)
  }, [threads])

  // Drop the highlight when a new thread lands so the previous focus
  // doesn't visually contend with the freshly-created card.
  useEffect(() => {
    const handler = () => setFocusedThreadId(null)
    window.addEventListener(THREAD_CREATED_EVENT, handler)
    return () => window.removeEventListener(THREAD_CREATED_EVENT, handler)
  }, [])

  if (threads.length === 0) return null

  return (
    <aside
      data-testid="comments-panel"
      className="flex w-80 shrink-0 flex-col border-l border-border bg-background"
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2 text-sm font-medium">
        {STATUS_ORDER.map((status) => {
          const isActive = status === activeStatus
          return (
            <button
              key={status}
              type="button"
              data-testid={`comments-panel-tab-${status}`}
              data-active={isActive ? 'true' : 'false'}
              onClick={() => setActiveStatus(status)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                isActive
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60',
              )}
            >
              <span>{STATUS_LABELS[status]}</span>
              <Badge
                variant={isActive ? 'default' : 'secondary'}
                className="h-4 min-w-4 px-1 text-[10px] leading-none"
              >
                {counts[status]}
              </Badge>
            </button>
          )
        })}
      </header>

      <div className="flex-1 overflow-y-auto">
        {visibleThreads.length === 0
          ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                No {STATUS_LABELS[activeStatus].toLowerCase()} threads
              </p>
            )
          : (
              <ul className="flex flex-col gap-1 p-2">
                {visibleThreads.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    thread={thread}
                    focused={thread.id === focusedThreadId}
                  />
                ))}
              </ul>
            )}
      </div>
    </aside>
  )
}

interface ThreadCardProps {
  thread: Thread
  focused: boolean
}

function ThreadCard({ thread, focused }: ThreadCardProps) {
  const first = thread.comments[0]
  const replyCount = Math.max(0, thread.comments.length - 1)
  return (
    <li
      data-testid="comments-panel-thread"
      data-thread-id={thread.id}
      data-focused={focused ? 'true' : 'false'}
      className={cn(
        'flex flex-col gap-1 rounded-md border px-3 py-2 text-xs transition-colors',
        focused
          ? 'border-primary bg-secondary/60'
          : 'border-transparent hover:bg-secondary/40',
      )}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate font-medium text-foreground">
          {first?.author ?? 'Unknown'}
        </span>
        <time dateTime={thread.created_at}>{formatRelative(thread.created_at)}</time>
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap text-foreground">
        {first?.body ?? '(no comment body)'}
      </p>
      {replyCount > 0 && (
        <span className="text-[11px] text-muted-foreground">
          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </span>
      )}
    </li>
  )
}

function groupCountsByStatus(threads: Thread[]): Record<ThreadStatus, number> {
  const counts: Record<ThreadStatus, number> = {
    open: 0,
    resolved: 0,
    orphaned: 0,
  }
  for (const thread of threads) counts[thread.status] += 1
  return counts
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const diffSeconds = Math.round((Date.now() - then) / 1000)
  if (diffSeconds < 60) return 'just now'
  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(then).toLocaleDateString()
}
