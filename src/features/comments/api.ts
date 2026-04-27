/**
 * Typed Tauri IPC client for the async-collaboration feature.
 * One function per command registered in
 * `src-tauri/src/lib.rs`'s `app_invoke_handler!` macro.
 *
 * Tauri auto-converts camelCase JS keys to snake_case Rust args, so
 * `vaultPath` here lands as `vault_path` in the Rust handler.
 */
import { invoke } from '@tauri-apps/api/core'

import type { Comment, Decision, Thread, ThreadStatus } from './types'

export interface CreateThreadArgs {
  vaultPath: string
  noteRelPath: string
  blockId: string
  blockText: string
  initialBody: string
}

export function createThread(args: CreateThreadArgs): Promise<Thread> {
  return invoke('create_thread', args)
}

export interface AddCommentArgs {
  vaultPath: string
  threadId: string
  body: string
}

export function addComment(args: AddCommentArgs): Promise<Comment> {
  return invoke('add_comment', args)
}

export interface ListThreadsForNoteArgs {
  vaultPath: string
  noteRelPath: string
}

export function listThreadsForNote(args: ListThreadsForNoteArgs): Promise<Thread[]> {
  return invoke('list_threads_for_note', args)
}

export interface UpdateThreadStatusArgs {
  vaultPath: string
  threadId: string
  newStatus: ThreadStatus
}

export function updateThreadStatus(args: UpdateThreadStatusArgs): Promise<Thread> {
  return invoke('update_thread_status', args)
}

export interface PromoteToDecisionArgs {
  vaultPath: string
  threadId: string
  title: string
  rationale: string
  alternatives: string | null
}

export function promoteToDecision(args: PromoteToDecisionArgs): Promise<Decision> {
  return invoke('promote_to_decision', args)
}

export interface ListDecisionsArgs {
  vaultPath: string
  noteRelPath?: string | null
  owner?: string | null
}

export function listDecisions(args: ListDecisionsArgs): Promise<Decision[]> {
  return invoke('list_decisions', {
    vaultPath: args.vaultPath,
    noteRelPath: args.noteRelPath ?? null,
    owner: args.owner ?? null,
  })
}
