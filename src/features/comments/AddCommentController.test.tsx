import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  createThread: vi.fn(),
}))

import { createThread } from './api'

import { AddCommentController } from './AddCommentController'
import {
  THREAD_CREATED_EVENT,
  THREAD_CREATE_FAILED_EVENT,
} from './commentExtension'
import type { EditorLike } from './editorSelection'

const mockedCreateThread = vi.mocked(createThread)

function makeEditor(): EditorLike {
  return {
    _tiptapEditor: {
      view: {
        state: {
          selection: { from: 5, to: 13 },
          doc: { textBetween: () => 'original' },
        },
      },
    },
    getTextCursorPosition: () => ({
      block: {
        id: 'bn_block_abc',
        content: [{ type: 'text', text: 'the original block content' }],
      },
    }),
  }
}

const META_M = { key: 'M', metaKey: true, shiftKey: true } as const

beforeEach(() => {
  mockedCreateThread.mockReset()
})

describe('AddCommentController', () => {
  it('renders no visible dialog initially', () => {
    render(
      <AddCommentController
        editor={makeEditor()}
        vaultPath="/vault"
        noteRelPath="projects/example.md"
      />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Cmd+Shift+M opens the dialog with the selected-text preview', () => {
    render(
      <AddCommentController
        editor={makeEditor()}
        vaultPath="/vault"
        noteRelPath="projects/example.md"
      />,
    )
    fireEvent.keyDown(document, META_M)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('add-comment-selection-preview')).toHaveTextContent(
      'original',
    )
  })

  it('does not open the dialog when no selection is captured', () => {
    const editor: EditorLike = {
      ...makeEditor(),
      getTextCursorPosition: () => ({}),
    }
    render(
      <AddCommentController
        editor={editor}
        vaultPath="/vault"
        noteRelPath="projects/example.md"
      />,
    )
    fireEvent.keyDown(document, META_M)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not open the dialog when noteRelPath is null', () => {
    render(
      <AddCommentController
        editor={makeEditor()}
        vaultPath="/vault"
        noteRelPath={null}
      />,
    )
    fireEvent.keyDown(document, META_M)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('submit calls createThread with the captured selection + body', async () => {
    mockedCreateThread.mockResolvedValueOnce({} as never)
    render(
      <AddCommentController
        editor={makeEditor()}
        vaultPath="/vault"
        noteRelPath="projects/example.md"
      />,
    )
    fireEvent.keyDown(document, META_M)
    fireEvent.change(screen.getByLabelText(/comment body/i), {
      target: { value: 'review please' },
    })
    fireEvent.click(screen.getByRole('button', { name: /file thread/i }))
    await waitFor(() => {
      expect(mockedCreateThread).toHaveBeenCalledWith({
        vaultPath: '/vault',
        noteRelPath: 'projects/example.md',
        blockId: 'bn_block_abc',
        blockText: 'the original block content',
        initialBody: 'review please',
      })
    })
  })

  it('submit success dispatches tolaria:thread-created and closes the dialog', async () => {
    const thread = { id: 'thr_001', note_rel_path: 'projects/example.md' }
    mockedCreateThread.mockResolvedValueOnce(thread as never)
    const listener = vi.fn()
    window.addEventListener(THREAD_CREATED_EVENT, listener)
    try {
      render(
        <AddCommentController
          editor={makeEditor()}
          vaultPath="/vault"
          noteRelPath="projects/example.md"
        />,
      )
      fireEvent.keyDown(document, META_M)
      fireEvent.change(screen.getByLabelText(/comment body/i), {
        target: { value: 'looks fine' },
      })
      fireEvent.click(screen.getByRole('button', { name: /file thread/i }))
      await waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1)
      })
      const event = listener.mock.calls[0][0] as CustomEvent
      expect(event.detail).toEqual(thread)
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull()
      })
    } finally {
      window.removeEventListener(THREAD_CREATED_EVENT, listener)
    }
  })

  it('submit failure dispatches tolaria:thread-create-failed and keeps the dialog open', async () => {
    mockedCreateThread.mockRejectedValueOnce(new Error('Tauri said no'))
    const listener = vi.fn()
    window.addEventListener(THREAD_CREATE_FAILED_EVENT, listener)
    try {
      render(
        <AddCommentController
          editor={makeEditor()}
          vaultPath="/vault"
          noteRelPath="projects/example.md"
        />,
      )
      fireEvent.keyDown(document, META_M)
      fireEvent.change(screen.getByLabelText(/comment body/i), {
        target: { value: 'will fail' },
      })
      fireEvent.click(screen.getByRole('button', { name: /file thread/i }))
      await waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1)
      })
      const event = listener.mock.calls[0][0] as CustomEvent
      expect(event.detail).toEqual({ error: 'Tauri said no' })
      // Dialog should still be open
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    } finally {
      window.removeEventListener(THREAD_CREATE_FAILED_EVENT, listener)
    }
  })
})
