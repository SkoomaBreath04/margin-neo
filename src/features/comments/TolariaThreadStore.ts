import {
  DefaultThreadStoreAuth,
  ThreadStore,
  type CommentBody,
  type CommentData,
  type ThreadData,
  type ThreadStoreAuth,
} from '@blocknote/core/comments'

import {
  addComment as ipcAddComment,
  createThread as ipcCreateThread,
  listThreadsForNote as ipcListThreadsForNote,
  updateThreadStatus as ipcUpdateThreadStatus,
} from './api'
import type { Comment, Thread } from './types'

/**
 * Minimal editor surface this store reads from. Injected after the
 * editor is constructed (chicken-and-egg: the store has to be passed
 * to `useCreateBlockNote` before the editor exists). We only need
 * the active selection's block to record `(block_id, block_text)` on
 * the Tolaria anchor; the visible highlight mark is rendered by
 * BlockNote's default `addThreadToDocument` and lives in the
 * TipTap doc.
 */
export interface TolariaEditorRef {
  getTextCursorPosition?: () =>
    | { block?: { id: string; content?: unknown } | null }
    | null
    | undefined
}

export interface TolariaThreadStoreOptions {
  vaultPath: string
  /** Stable userId for the active user. We use the email-or-name string git config emits. */
  userId: string
  /** Authorization rules. Defaults to `editor` role for the active user. */
  auth?: ThreadStoreAuth
}

const NOT_SUPPORTED = (op: string) =>
  new Error(
    `${op} is not supported by Tolaria yet — Phase 1 IPC only covers create / reply / status. Add the matching Tauri command, then enable here.`,
  )

/**
 * BlockNote `ThreadStore` implementation backed by Tolaria's
 * existing Tauri IPC and `.tolaria/threads/*.json` sidecars.
 *
 * Hydration: when the active note changes (`setActiveNote`), the
 * store calls `listThreadsForNote` and replaces its in-memory cache.
 * Subscribers (BlockNote's `useThreads` hook + the floating UI)
 * receive the new map and re-render.
 *
 * Mutations: `createThread`, `addComment`, `resolveThread`,
 * `unresolveThread` write through to Tauri IPC, then patch the cache
 * and notify subscribers. Mutations not yet supported by the Rust
 * backend (`updateComment`, `deleteComment`, `deleteThread`,
 * `addReaction`, `deleteReaction`) throw a clear error pointing at
 * the missing IPC command.
 *
 * Status mapping: Tolaria has three states (open / resolved /
 * orphaned); BlockNote has a binary `resolved` flag. We map
 * `resolved=true` to BlockNote-resolved for both Tolaria-resolved
 * and Tolaria-orphaned threads, and store the precise Tolaria status
 * in `metadata.tolariaStatus`. Phase 6 (staleness) can use the
 * metadata to render orphaned threads distinctly.
 *
 * Anchor capture: when `createThread` is called, the active editor
 * selection is read via `editorRef.getTextCursorPosition()` to
 * derive `block_id` and `block_text` for the Tolaria anchor. The
 * visible highlight is left to BlockNote's default mark behavior.
 */
export class TolariaThreadStore extends ThreadStore {
  readonly vaultPath: string
  readonly userId: string
  private noteRelPath: string | null = null
  private threads: Map<string, ThreadData> = new Map()
  private subscribers: Set<(threads: Map<string, ThreadData>) => void> =
    new Set()
  private editor: TolariaEditorRef | null = null

  /**
   * Optional in the abstract base — leaving it `undefined` keeps the
   * default TipTap mark behavior, which is exactly what we want.
   * Declared as a property so TypeScript stops asking us to override
   * it.
   */
  addThreadToDocument: undefined = undefined

  constructor(options: TolariaThreadStoreOptions) {
    super(options.auth ?? new DefaultThreadStoreAuth(options.userId, 'editor'))
    this.vaultPath = options.vaultPath
    this.userId = options.userId
  }

  /** Inject the editor reference once it exists (post-`useCreateBlockNote`). */
  setEditor(editor: TolariaEditorRef | null): void {
    this.editor = editor
  }

  /** Switch to a different note, refresh the cache, notify subscribers. */
  async setActiveNote(noteRelPath: string | null): Promise<void> {
    this.noteRelPath = noteRelPath
    await this.refresh()
  }

  /** Re-fetch threads for the active note from the Rust backend. */
  async refresh(): Promise<void> {
    if (!this.noteRelPath) {
      this.threads = new Map()
      this.notifySubscribers()
      return
    }
    const list = await ipcListThreadsForNote({
      vaultPath: this.vaultPath,
      noteRelPath: this.noteRelPath,
    })
    const next = new Map<string, ThreadData>()
    for (const t of Array.isArray(list) ? list : []) {
      next.set(t.id, tolariaThreadToBlockNote(t))
    }
    this.threads = next
    this.notifySubscribers()
  }

  // --- Read methods ------------------------------------------------

  getThread(threadId: string): ThreadData {
    const thread = this.threads.get(threadId)
    if (!thread) throw new Error(`Thread ${threadId} not found`)
    return thread
  }

  getThreads(): Map<string, ThreadData> {
    return this.threads
  }

  subscribe(cb: (threads: Map<string, ThreadData>) => void): () => void {
    this.subscribers.add(cb)
    return () => {
      this.subscribers.delete(cb)
    }
  }

  // --- Write methods -----------------------------------------------

  async createThread(options: {
    initialComment: { body: CommentBody; metadata?: unknown }
    metadata?: unknown
  }): Promise<ThreadData> {
    if (!this.noteRelPath) {
      throw new Error('Cannot create a thread when no note is active')
    }
    const cursor = this.editor?.getTextCursorPosition?.()
    const block = cursor?.block
    if (!block) {
      throw new Error(
        'Cannot create a thread: editor has no active selection. Re-select text and try again.',
      )
    }
    const blockText = blockPlainText(block)
    const initialBody = commentBodyToString(options.initialComment.body)

    const created = await ipcCreateThread({
      vaultPath: this.vaultPath,
      noteRelPath: this.noteRelPath,
      blockId: block.id,
      blockText,
      initialBody,
    })

    const blockNoteThread = tolariaThreadToBlockNote(created)
    this.threads = new Map(this.threads).set(blockNoteThread.id, blockNoteThread)
    this.notifySubscribers()
    return blockNoteThread
  }

  async addComment(options: {
    comment: { body: CommentBody; metadata?: unknown }
    threadId: string
  }): Promise<CommentData> {
    const body = commentBodyToString(options.comment.body)
    const created = await ipcAddComment({
      vaultPath: this.vaultPath,
      threadId: options.threadId,
      body,
    })
    const existing = this.threads.get(options.threadId)
    if (existing) {
      const next: ThreadData = {
        ...existing,
        comments: [...existing.comments, tolariaCommentToBlockNote(created)],
        updatedAt: new Date(),
      }
      this.threads = new Map(this.threads).set(options.threadId, next)
      this.notifySubscribers()
    }
    return tolariaCommentToBlockNote(created)
  }

  async resolveThread(options: { threadId: string }): Promise<void> {
    const updated = await ipcUpdateThreadStatus({
      vaultPath: this.vaultPath,
      threadId: options.threadId,
      newStatus: 'resolved',
    })
    this.threads = new Map(this.threads).set(
      updated.id,
      tolariaThreadToBlockNote(updated),
    )
    this.notifySubscribers()
  }

  async unresolveThread(options: { threadId: string }): Promise<void> {
    const updated = await ipcUpdateThreadStatus({
      vaultPath: this.vaultPath,
      threadId: options.threadId,
      newStatus: 'open',
    })
    this.threads = new Map(this.threads).set(
      updated.id,
      tolariaThreadToBlockNote(updated),
    )
    this.notifySubscribers()
  }

  // --- Phase-1-IPC-not-yet-covered. Throw clearly. ---------------

  async updateComment(options: {
    comment: { body: CommentBody; metadata?: unknown }
    threadId: string
    commentId: string
  }): Promise<void> {
    throw NOT_SUPPORTED(`updateComment(threadId=${options.threadId})`)
  }

  async deleteComment(options: {
    threadId: string
    commentId: string
  }): Promise<void> {
    throw NOT_SUPPORTED(`deleteComment(threadId=${options.threadId})`)
  }

  async deleteThread(options: { threadId: string }): Promise<void> {
    throw NOT_SUPPORTED(`deleteThread(threadId=${options.threadId})`)
  }

  async addReaction(options: {
    threadId: string
    commentId: string
    emoji: string
  }): Promise<void> {
    throw NOT_SUPPORTED(`addReaction(threadId=${options.threadId})`)
  }

  async deleteReaction(options: {
    threadId: string
    commentId: string
    emoji: string
  }): Promise<void> {
    throw NOT_SUPPORTED(`deleteReaction(threadId=${options.threadId})`)
  }

  // --- internal -----------------------------------------------------

  private notifySubscribers(): void {
    for (const cb of this.subscribers) cb(this.threads)
  }
}

// --- Type translation ---------------------------------------------

/**
 * Convert a Tolaria `Thread` (snake_case wire format from Rust) to
 * BlockNote's `ThreadData` (camelCase + Date objects + binary
 * resolved flag).
 */
function tolariaThreadToBlockNote(thread: Thread): ThreadData {
  return {
    type: 'thread',
    id: thread.id,
    createdAt: parseRfc3339(thread.created_at),
    updatedAt: parseRfc3339(thread.created_at),
    comments: thread.comments.map(tolariaCommentToBlockNote),
    resolved: thread.status !== 'open',
    metadata: {
      tolariaStatus: thread.status,
      noteRelPath: thread.note_rel_path,
      anchor: thread.anchor,
      createdAtSha: thread.created_at_sha,
    },
  }
}

function tolariaCommentToBlockNote(comment: Comment): CommentData {
  return {
    type: 'comment',
    id: comment.id,
    userId: deriveUserId(comment.author),
    createdAt: parseRfc3339(comment.created_at),
    updatedAt: parseRfc3339(comment.created_at),
    reactions: [],
    metadata: {
      author: comment.author,
      createdAtSha: comment.created_at_sha,
    },
    body: stringToCommentBody(comment.body),
  }
}

/**
 * Tolaria stores authorship as `"Name <email>"` from `git config`.
 * BlockNote needs a stable `userId`; we use the email if present,
 * else the whole string. `resolveUsers` (passed to
 * `CommentsExtension`) reverses this back to display name + avatar.
 */
function deriveUserId(author: string): string {
  const match = author.match(/<([^>]+)>/)
  if (match) return match[1].trim()
  return author.trim()
}

function parseRfc3339(input: string): Date {
  const ts = Date.parse(input)
  if (Number.isNaN(ts)) return new Date(0)
  return new Date(ts)
}

/**
 * BlockNote stores a comment body as a tree of inline content
 * (typed as `any` in their public types). For the first cut we
 * round-trip through plain text — the Rust backend stores strings,
 * and we wrap each line in a paragraph block on the way out. Future
 * polish: persist the full BlockNote document JSON so users get
 * formatted replies (bold/italic/links).
 */
function stringToCommentBody(text: string): CommentBody {
  const trimmed = text ?? ''
  return [
    {
      type: 'paragraph',
      content: trimmed.length === 0 ? [] : [{ type: 'text', text: trimmed }],
    },
  ]
}

function commentBodyToString(body: CommentBody): string {
  if (typeof body === 'string') return body
  if (!Array.isArray(body)) return ''
  const parts: string[] = []
  for (const block of body) parts.push(extractInline(block))
  return parts.join('\n').trim()
}

function extractInline(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractInline).join('')
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (obj.type === 'text' && typeof obj.text === 'string') return obj.text
    if ('content' in obj) return extractInline(obj.content)
  }
  return ''
}

/**
 * Mirror of `selection.ts#blockPlainText` so the store can compute
 * `blockText` (used for `Anchor.content_hash`) without taking a
 * dependency on the Phase-2 selection helpers (which are scheduled
 * for retirement in N3).
 */
function blockPlainText(block: { content?: unknown } | null | undefined): string {
  if (!block) return ''
  return extractInline(block.content)
}
