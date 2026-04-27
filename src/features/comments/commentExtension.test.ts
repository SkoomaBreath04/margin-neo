import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  createThread: vi.fn(),
}))

import { createThread } from './api'

import {
  ADD_COMMENT_EVENT,
  THREAD_CREATED_EVENT,
  THREAD_CREATE_FAILED_EVENT,
  handleAddCommentRequest,
  type AddCommentEventDetail,
} from './commentExtension'

const mockedCreateThread = vi.mocked(createThread)

beforeEach(() => {
  mockedCreateThread.mockReset()
})

describe('event-name constants', () => {
  // Slices 2.4 / 2.5 / Phase 3 listen to / dispatch these strings;
  // a rename here without grepping callers would silently break the
  // wiring. Pin them.
  it('exports stable event names', () => {
    expect(ADD_COMMENT_EVENT).toBe('tolaria:add-comment-on-selection')
    expect(THREAD_CREATED_EVENT).toBe('tolaria:thread-created')
    expect(THREAD_CREATE_FAILED_EVENT).toBe('tolaria:thread-create-failed')
  })
})

describe('handleAddCommentRequest', () => {
  const detail: AddCommentEventDetail = {
    vaultPath: '/vault',
    noteRelPath: 'projects/example.md',
    initialBody: 'First comment',
  }

  const captured = {
    blockId: 'bn_block_abc',
    blockText: 'the original block content',
    selectedText: 'original',
  }

  it('returns null when no selection was captured', async () => {
    const result = await handleAddCommentRequest(detail, null)
    expect(result).toBeNull()
    expect(mockedCreateThread).not.toHaveBeenCalled()
  })

  it('forwards the merged args to createThread', async () => {
    mockedCreateThread.mockResolvedValueOnce({} as never)
    await handleAddCommentRequest(detail, captured)
    expect(mockedCreateThread).toHaveBeenCalledWith({
      vaultPath: '/vault',
      noteRelPath: 'projects/example.md',
      blockId: 'bn_block_abc',
      blockText: 'the original block content',
      initialBody: 'First comment',
    })
  })

  it('resolves to the thread returned by createThread', async () => {
    const thread = {
      id: 'thr_001',
      note_rel_path: 'projects/example.md',
    }
    mockedCreateThread.mockResolvedValueOnce(thread as never)
    const result = await handleAddCommentRequest(detail, captured)
    expect(result).toEqual(thread)
  })

  it('lets createThread errors propagate', async () => {
    const err = new Error('Tauri said no')
    mockedCreateThread.mockRejectedValueOnce(err)
    await expect(handleAddCommentRequest(detail, captured)).rejects.toThrow(
      'Tauri said no',
    )
  })
})
