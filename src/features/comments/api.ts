/**
 * Typed Tauri IPC client for the async-collaboration feature.
 * One function per command registered in
 * `src-tauri/src/lib.rs`'s `app_invoke_handler!` macro.
 *
 * Tauri auto-converts camelCase JS keys to snake_case Rust args, so
 * `vaultPath` here lands as `vault_path` in the Rust handler.
 *
 * Routes through `mockInvoke` when the renderer isn't running
 * inside Tauri (Playwright smoke / `pnpm dev` browser preview), so
 * the editor doesn't crash on `invoke` being undefined when it
 * reads threads for a freshly-created note.
 */
import { invoke } from '@tauri-apps/api/core'

import { isTauri, mockInvoke } from '../../mock-tauri'
import type { Comment, Decision, Thread, ThreadStatus } from './types'

function callIpc<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(cmd, args) : mockInvoke<T>(cmd, args)
}

export interface CreateThreadArgs {
  vaultPath: string
  noteRelPath: string
  blockId: string
  blockText: string
  initialBody: string
  /** Required so the interface satisfies Tauri's `InvokeArgs = Record<string, unknown>`. */
  [key: string]: unknown
}

export function createThread(args: CreateThreadArgs): Promise<Thread> {
  return callIpc('create_thread', args)
}

export interface AddCommentArgs {
  vaultPath: string
  threadId: string
  body: string
  [key: string]: unknown
}

export function addComment(args: AddCommentArgs): Promise<Comment> {
  return callIpc('add_comment', args)
}

export interface ListThreadsForNoteArgs {
  vaultPath: string
  noteRelPath: string
  [key: string]: unknown
}

export function listThreadsForNote(args: ListThreadsForNoteArgs): Promise<Thread[]> {
  return callIpc('list_threads_for_note', args)
}

export interface UpdateThreadStatusArgs {
  vaultPath: string
  threadId: string
  newStatus: ThreadStatus
  [key: string]: unknown
}

export function updateThreadStatus(args: UpdateThreadStatusArgs): Promise<Thread> {
  return callIpc('update_thread_status', args)
}

export interface PromoteToDecisionArgs {
  vaultPath: string
  threadId: string
  title: string
  rationale: string
  alternatives: string | null
  [key: string]: unknown
}

export function promoteToDecision(args: PromoteToDecisionArgs): Promise<Decision> {
  return callIpc('promote_to_decision', args)
}

export interface ListDecisionsArgs {
  vaultPath: string
  noteRelPath?: string | null
  owner?: string | null
}

export function listDecisions(args: ListDecisionsArgs): Promise<Decision[]> {
  return callIpc('list_decisions', {
    vaultPath: args.vaultPath,
    noteRelPath: args.noteRelPath ?? null,
    owner: args.owner ?? null,
  })
}
