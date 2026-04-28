import { useEffect, useState } from 'react'

import { AddCommentDialog } from './AddCommentDialog'
import { createThread } from './api'
import {
  THREAD_CREATED_EVENT,
  THREAD_CREATE_FAILED_EVENT,
  type ThreadCreateFailedDetail,
} from './commentExtension'
import { readActiveSelection, type EditorLike } from './editorSelection'
import type { CapturedSelection } from './selection'
import type { Thread } from './types'

export interface AddCommentControllerProps {
  /** BlockNote editor instance, or null when no editor is mounted yet. */
  editor: EditorLike | null
  /** Absolute path to the open vault (e.g. `~/Laputa`). */
  vaultPath: string
  /**
   * Path of the open note relative to the vault root, or `null`
   * when no note is active. The shortcut is a no-op when null.
   */
  noteRelPath: string | null
}

/**
 * Wires the slice 2.4 `AddCommentDialog` to the editor + Tauri IPC.
 * Listens for Cmd+Shift+M (or Ctrl+Shift+M on non-Mac); on
 * trigger, reads the active selection, opens the dialog with the
 * selected text as preview, and on submit calls `createThread`.
 *
 * On success, dispatches `tolaria:thread-created` with the new
 * `Thread` payload and closes the dialog. On failure, dispatches
 * `tolaria:thread-create-failed` with the error message and
 * leaves the dialog open so the user can retry without re-typing.
 *
 * Renders nothing of its own except the dialog (which is invisible
 * when closed) — safe to mount anywhere in the editor's tree.
 */
export function AddCommentController({
  editor,
  vaultPath,
  noteRelPath,
}: AddCommentControllerProps) {
  const [open, setOpen] = useState(false)
  const [captured, setCaptured] = useState<CapturedSelection | null>(null)

  useEffect(() => {
    if (!editor || !noteRelPath) return

    const handler = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const isMacChord = event.metaKey && event.shiftKey && key === 'm'
      const isPCChord = event.ctrlKey && event.shiftKey && key === 'm'
      if (!isMacChord && !isPCChord) return

      const selection = readActiveSelection(editor)
      if (!selection) return

      event.preventDefault()
      setCaptured(selection)
      setOpen(true)
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [editor, noteRelPath])

  const handleSubmit = async (body: string) => {
    if (!captured || !noteRelPath) return
    try {
      const thread = await createThread({
        vaultPath,
        noteRelPath,
        blockId: captured.blockId,
        blockText: captured.blockText,
        initialBody: body,
      })
      window.dispatchEvent(
        new CustomEvent<Thread>(THREAD_CREATED_EVENT, { detail: thread }),
      )
      setOpen(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      window.dispatchEvent(
        new CustomEvent<ThreadCreateFailedDetail>(THREAD_CREATE_FAILED_EVENT, {
          detail: { error: message },
        }),
      )
      // Dialog stays open so the user can retry without re-typing.
    }
  }

  return (
    <AddCommentDialog
      open={open}
      onOpenChange={setOpen}
      selectedTextPreview={captured?.selectedText ?? ''}
      onSubmit={handleSubmit}
    />
  )
}
