/**
 * BlockNote extension for the async-collaboration feature.
 *
 * The extension's only job in this slice is to be a single point of
 * contact between "user wants to add a comment on the current
 * selection" and the Tauri IPC client. Anyone (toolbar button,
 * keyboard shortcut, context menu, future LSP-style action) can
 * dispatch `tolaria:add-comment-on-selection` on `window`; the
 * extension reads the active selection, calls `createThread`, and
 * dispatches `tolaria:thread-created` (or
 * `tolaria:thread-create-failed`) with the resulting payload.
 *
 * Editor-DOM access (`_tiptapEditor.view`, `getTextCursorPosition`)
 * follows the pattern set by `arrowLigaturesExtension.ts`. The
 * pure handler is exported separately so tests don't need a real
 * editor.
 */
import { createExtension } from '@blocknote/core'

import { createThread } from './api'
import { captureSelection, type CapturedSelection } from './selection'
import type { Thread } from './types'

export const ADD_COMMENT_EVENT = 'tolaria:add-comment-on-selection'
export const THREAD_CREATED_EVENT = 'tolaria:thread-created'
export const THREAD_CREATE_FAILED_EVENT = 'tolaria:thread-create-failed'

export interface AddCommentEventDetail {
  vaultPath: string
  noteRelPath: string
  initialBody: string
}

export interface ThreadCreateFailedDetail {
  error: string
}

/**
 * Pure handler that decides what to do with a request given the
 * currently-captured selection. Returns the new thread on success,
 * `null` when no usable selection was captured (the extension
 * silently no-ops in that case rather than treating it as an
 * error). Errors from `createThread` propagate up to the caller.
 */
export async function handleAddCommentRequest(
  detail: AddCommentEventDetail,
  captured: CapturedSelection | null,
): Promise<Thread | null> {
  if (!captured) return null
  return createThread({
    vaultPath: detail.vaultPath,
    noteRelPath: detail.noteRelPath,
    blockId: captured.blockId,
    blockText: captured.blockText,
    initialBody: detail.initialBody,
  })
}

export const createCommentExtension = createExtension(({ editor }) => {
  return {
    key: 'comments',
    mount: ({ signal }) => {
      const handler = async (event: Event) => {
        const detail = (event as CustomEvent<AddCommentEventDetail>).detail
        if (!detail) return

        const view = editor._tiptapEditor?.view ?? editor.prosemirrorView
        const cursor = editor.getTextCursorPosition?.()
        if (!view || !cursor?.block) return

        const { from, to } = view.state.selection
        const selectedText = view.state.doc.textBetween(from, to, ' ', ' ')
        const captured = captureSelection(
          { from, to, selectedText },
          cursor.block,
        )

        try {
          const thread = await handleAddCommentRequest(detail, captured)
          if (thread) {
            window.dispatchEvent(
              new CustomEvent<Thread>(THREAD_CREATED_EVENT, { detail: thread }),
            )
          }
        } catch (err) {
          window.dispatchEvent(
            new CustomEvent<ThreadCreateFailedDetail>(THREAD_CREATE_FAILED_EVENT, {
              detail: { error: err instanceof Error ? err.message : String(err) },
            }),
          )
        }
      }

      window.addEventListener(ADD_COMMENT_EVENT, handler as EventListener, {
        signal,
      })
    },
  } as const
})
