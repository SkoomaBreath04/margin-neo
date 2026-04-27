/**
 * TypeScript mirrors of the Rust schema in
 * `src-tauri/src/comments/types.rs`. Field names are snake_case to
 * match the JSON wire format produced by Rust serde (no
 * `rename_all` directive on the Rust types). Timestamps are RFC
 * 3339 strings.
 *
 * Whenever the Rust schema changes, update these types in the same
 * commit so the contract stays in lock-step.
 */

export type ThreadStatus = 'open' | 'resolved' | 'orphaned'

export interface Anchor {
  block_id: string
  created_at_sha: string
  /** Format: `"sha256:<64-lowercase-hex>"`. */
  content_hash: string
}

export interface Comment {
  id: string
  /** Format: `"name <email>"` (assembled from `git config`). */
  author: string
  body: string
  /** RFC 3339 timestamp. */
  created_at: string
  created_at_sha: string
}

export interface Thread {
  id: string
  note_rel_path: string
  anchor: Anchor
  status: ThreadStatus
  comments: Comment[]
  created_at: string
  created_at_sha: string
}

export interface Decision {
  id: string
  source_thread_id: string
  note_rel_path: string
  title: string
  rationale: string
  /** Rust `Option<String>` → `string | null` over the wire. */
  alternatives: string | null
  owner: string
  created_at: string
  created_at_sha: string
}
