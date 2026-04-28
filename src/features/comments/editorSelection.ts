/**
 * Bridge between BlockNote/ProseMirror editor state and the
 * `CapturedSelection` shape `comments::lifecycle::create_thread`
 * needs over IPC. Lives in its own module so the BlockNote
 * extension and the renderer-side controller can share the same
 * editor-reading logic without depending on each other.
 *
 * The `EditorLike` structural type matches the subset of
 * BlockNote's editor surface this code needs without importing
 * `@blocknote/core`'s typed editor (which would pull schema
 * generics through the call chain). Same access pattern as
 * `arrowLigaturesExtension.ts` and the slice 2.3 extension's
 * inline editor read.
 */

import { captureSelection, type CapturedSelection } from './selection'

interface ProseMirrorViewLike {
  state: {
    selection: { from: number; to: number }
    doc: {
      textBetween(from: number, to: number, blockSep: string, leafText?: string): string
    }
  }
}

export interface EditorLike {
  _tiptapEditor?: { view?: ProseMirrorViewLike | null } | null
  prosemirrorView?: ProseMirrorViewLike | null
  getTextCursorPosition?: () =>
    | { block?: { id: string; content?: unknown } | null }
    | null
    | undefined
}

/**
 * Read the editor's active selection and the block containing the
 * cursor, then compose them into a `CapturedSelection`. Returns
 * `null` when:
 * - there is no usable view (`_tiptapEditor.view` and
 *   `prosemirrorView` are both missing)
 * - `getTextCursorPosition()` returns no block
 * - the selection is collapsed (`from === to`) or whitespace-only
 *   (delegated to slice 2.2's `captureSelection`)
 *
 * Callers are expected to surface a UI affordance (e.g. dialog
 * disabled, no-op) when this returns null, not to fail loudly.
 */
export function readActiveSelection(editor: EditorLike): CapturedSelection | null {
  const view = editor._tiptapEditor?.view ?? editor.prosemirrorView
  const cursor = editor.getTextCursorPosition?.()
  if (!view || !cursor?.block) return null

  const { from, to } = view.state.selection
  const selectedText = view.state.doc.textBetween(from, to, ' ', ' ')
  return captureSelection({ from, to, selectedText }, cursor.block)
}
