import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { addComment, updateThreadStatus } from './api'
import {
  FOCUS_THREAD_EVENT,
  THREAD_CREATED_EVENT,
  THREAD_UPDATED_EVENT,
  type FocusThreadDetail,
} from './commentExtension'
import type { Comment, Thread, ThreadStatus } from './types'
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
 * Per-note thread browser with master/detail navigation.
 *
 * **List mode** (default): three filter tabs (Open / Resolved /
 * Orphaned) with per-status counts; tapping a card opens that
 * thread's detail view.
 *
 * **Detail mode** (slice 3.2): full comment chain for the active
 * thread with a back button. Selection-driven: triggered by clicking
 * a card or by the `tolaria:focus-thread` event (Alt+click on an
 * anchored block, see `CommentAnchors`). Currently read-only — the
 * reply composer arrives in slice 3.3 and status actions in 3.4.
 *
 * `tolaria:thread-created` returns the panel to list mode so a fresh
 * thread doesn't trap the user in the previous detail view.
 *
 * Returns `null` when the active note has no threads so we don't
 * occupy editor real estate before there's anything to show.
 */
export function CommentsPanel({ vaultPath, noteRelPath }: CommentsPanelProps) {
  const threads = useThreadsForNote({ vaultPath, noteRelPath })
  const [activeStatus, setActiveStatus] = useState<ThreadStatus>('open')
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)

  const counts = useMemo(() => groupCountsByStatus(threads), [threads])
  const visibleThreads = useMemo(
    () => threads.filter((t) => t.status === activeStatus),
    [threads, activeStatus],
  )
  const activeThread = useMemo(
    () =>
      activeThreadId === null
        ? null
        : threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  )

  // External focus request → switch to the target thread's status
  // tab and open its detail view. Unknown thread ids are ignored so
  // a stale event doesn't blank out the panel.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<FocusThreadDetail>).detail
      if (!detail?.threadId) return
      const target = threads.find((t) => t.id === detail.threadId)
      if (!target) return
      setActiveStatus(target.status)
      setActiveThreadId(target.id)
    }
    window.addEventListener(FOCUS_THREAD_EVENT, handler)
    return () => window.removeEventListener(FOCUS_THREAD_EVENT, handler)
  }, [threads])

  // Pop back to the list when a fresh thread lands so the user sees
  // the new state instead of a now-stale detail view.
  useEffect(() => {
    const handler = () => setActiveThreadId(null)
    window.addEventListener(THREAD_CREATED_EVENT, handler)
    return () => window.removeEventListener(THREAD_CREATED_EVENT, handler)
  }, [])

  if (threads.length === 0) return null

  if (activeThread) {
    return (
      <ThreadDetailLayout
        thread={activeThread}
        vaultPath={vaultPath}
        onBack={() => setActiveThreadId(null)}
      />
    )
  }

  return (
    <aside
      data-testid="comments-panel"
      data-mode="list"
      className="flex w-80 shrink-0 flex-col border-l border-border bg-background"
    >
      <PanelTitleBar
        subtitle={`${threads.length} ${threads.length === 1 ? 'thread' : 'threads'}`}
      />
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
                    onSelect={() => setActiveThreadId(thread.id)}
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
  onSelect: () => void
}

function ThreadCard({ thread, onSelect }: ThreadCardProps) {
  const first = thread.comments[0]
  const replyCount = Math.max(0, thread.comments.length - 1)
  return (
    <li className="contents">
      <button
        type="button"
        data-testid="comments-panel-thread"
        data-thread-id={thread.id}
        onClick={onSelect}
        className={cn(
          'flex w-full flex-col gap-1 rounded-md border border-transparent px-3 py-2 text-left text-xs transition-colors',
          'hover:border-border hover:bg-secondary/40',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
      </button>
    </li>
  )
}

interface ThreadDetailLayoutProps {
  thread: Thread
  vaultPath: string
  onBack: () => void
}

function ThreadDetailLayout({ thread, vaultPath, onBack }: ThreadDetailLayoutProps) {
  return (
    <aside
      data-testid="comments-panel"
      data-mode="detail"
      data-thread-id={thread.id}
      className="flex w-80 shrink-0 flex-col border-l border-border bg-background"
    >
      <PanelTitleBar subtitle={`Thread · ${STATUS_LABELS[thread.status].toLowerCase()}`} />
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
        <button
          type="button"
          data-testid="comments-panel-back"
          onClick={onBack}
          aria-label="Back to threads"
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors',
            'hover:bg-secondary/60 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <span aria-hidden="true">←</span>
          <span>Threads</span>
        </button>
        <Badge
          data-testid="comments-panel-status-badge"
          variant={thread.status === 'open' ? 'default' : 'secondary'}
          className="text-[10px]"
        >
          {STATUS_LABELS[thread.status]}
        </Badge>
        <StatusActions thread={thread} vaultPath={vaultPath} />
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <ol className="flex flex-col gap-3">
          {thread.comments.map((comment) => (
            <CommentBubble key={comment.id} comment={comment} />
          ))}
        </ol>
      </div>

      {thread.status === 'open' && (
        <ReplyComposer vaultPath={vaultPath} threadId={thread.id} />
      )}
    </aside>
  )
}

interface StatusActionsProps {
  thread: Thread
  vaultPath: string
}

interface StatusTransition {
  label: string
  next: ThreadStatus
  variant: 'default' | 'secondary' | 'ghost' | 'outline'
}

function transitionsFor(status: ThreadStatus): StatusTransition[] {
  if (status === 'open') {
    return [
      { label: 'Resolve', next: 'resolved', variant: 'secondary' },
      { label: 'Orphan', next: 'orphaned', variant: 'ghost' },
    ]
  }
  return [{ label: 'Reopen', next: 'open', variant: 'secondary' }]
}

/**
 * Inline action buttons for moving a thread between statuses.
 * Lives in the detail header next to the status badge so the user
 * can resolve, orphan, or reopen without leaving the view they are
 * already reading.
 *
 * Each click calls `updateThreadStatus` over Tauri IPC, then
 * dispatches `tolaria:thread-updated` so the panel hook re-fetches.
 * The active thread keeps its id, so the panel stays in detail mode
 * with the new status reflected in the badge and the available
 * action set. Failures surface inline next to the actions and are
 * cleared on the next attempt.
 */
function StatusActions({ thread, vaultPath }: StatusActionsProps) {
  const [pending, setPending] = useState<ThreadStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const transitions = transitionsFor(thread.status)

  const apply = async (next: ThreadStatus) => {
    if (pending) return
    setPending(next)
    setError(null)
    try {
      await updateThreadStatus({
        vaultPath,
        threadId: thread.id,
        newStatus: next,
      })
      window.dispatchEvent(new CustomEvent(THREAD_UPDATED_EVENT, { detail: {} }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="ml-auto flex items-center gap-1">
      {transitions.map((t) => (
        <Button
          key={t.next}
          type="button"
          size="xs"
          variant={t.variant}
          disabled={pending !== null}
          onClick={() => void apply(t.next)}
          data-testid={`comments-panel-status-${t.next}`}
        >
          {pending === t.next ? '…' : t.label}
        </Button>
      ))}
      {error && (
        <span
          data-testid="comments-panel-status-error"
          role="alert"
          className="text-[10px] text-destructive"
        >
          {error}
        </span>
      )}
    </div>
  )
}

interface ReplyComposerProps {
  vaultPath: string
  threadId: string
}

/**
 * Bottom-of-detail-view composer for adding a reply to an open
 * thread. Closed/orphaned threads don't render a composer (status
 * actions in slice 3.4 will provide a "reopen" affordance).
 *
 * Submit is disabled while the textarea is empty/whitespace-only or
 * while a write is in flight. On success we clear the textarea and
 * dispatch `tolaria:thread-updated` so the panel hook re-fetches
 * (the user stays in detail view). On failure we surface a small
 * inline error and keep the draft so the user can retry.
 */
function ReplyComposer({ vaultPath, threadId }: ReplyComposerProps) {
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = draft.trim()
  const canSubmit = trimmed.length > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await addComment({ vaultPath, threadId, body: trimmed })
      setDraft('')
      window.dispatchEvent(new CustomEvent(THREAD_UPDATED_EVENT, { detail: {} }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      data-testid="comments-panel-composer"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSubmit()
      }}
      className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-2"
    >
      <Textarea
        data-testid="comments-panel-composer-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Reply…"
        disabled={submitting}
        rows={3}
        className="min-h-16 resize-none text-xs"
      />
      {error && (
        <p
          data-testid="comments-panel-composer-error"
          role="alert"
          className="text-[11px] text-destructive"
        >
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit}
          data-testid="comments-panel-composer-submit"
        >
          {submitting ? 'Sending…' : 'Reply'}
        </Button>
      </div>
    </form>
  )
}

interface CommentBubbleProps {
  comment: Comment
}

function CommentBubble({ comment }: CommentBubbleProps) {
  return (
    <li
      data-testid="comments-panel-comment"
      data-comment-id={comment.id}
      className="flex flex-col gap-1 text-xs"
    >
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate font-medium text-foreground">
          {comment.author}
        </span>
        <time dateTime={comment.created_at}>
          {formatRelative(comment.created_at)}
        </time>
      </div>
      <p className="whitespace-pre-wrap rounded-md bg-secondary/40 px-2 py-1.5 text-foreground">
        {comment.body}
      </p>
    </li>
  )
}

interface PanelTitleBarProps {
  subtitle: string
}

/**
 * Visual sibling of the Inspector's panel title bar so the comments
 * column reads as part of the same right-hand workspace, not a
 * floating panel. Mirrors Inspector's `text-[13px] font-medium`
 * styling and uses the same border-bottom rhythm.
 */
function PanelTitleBar({ subtitle }: PanelTitleBarProps) {
  return (
    <div
      data-testid="comments-panel-title"
      className="flex shrink-0 items-baseline justify-between border-b border-border px-3 py-2"
    >
      <span className="text-[13px] font-medium text-foreground">Comments</span>
      <span className="text-[11px] text-muted-foreground">{subtitle}</span>
    </div>
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
