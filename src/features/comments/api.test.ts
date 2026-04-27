import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

import {
  addComment,
  createThread,
  listDecisions,
  listThreadsForNote,
  promoteToDecision,
  updateThreadStatus,
} from './api'

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockedInvoke.mockReset()
})

describe('createThread', () => {
  it('invokes create_thread with the camelCase args Tauri expects', async () => {
    mockedInvoke.mockResolvedValueOnce({} as never)
    await createThread({
      vaultPath: '/vault',
      noteRelPath: 'projects/example.md',
      blockId: 'bn_block_abc',
      blockText: 'block content',
      initialBody: 'First comment',
    })
    expect(mockedInvoke).toHaveBeenCalledWith('create_thread', {
      vaultPath: '/vault',
      noteRelPath: 'projects/example.md',
      blockId: 'bn_block_abc',
      blockText: 'block content',
      initialBody: 'First comment',
    })
  })

  it('returns the resolved Thread', async () => {
    const thread = { id: 'thr_001', note_rel_path: 'a.md' }
    mockedInvoke.mockResolvedValueOnce(thread as never)
    const result = await createThread({
      vaultPath: '/v',
      noteRelPath: 'a.md',
      blockId: 'b',
      blockText: 't',
      initialBody: 'x',
    })
    expect(result).toEqual(thread)
  })
})

describe('addComment', () => {
  it('invokes add_comment with the right args', async () => {
    mockedInvoke.mockResolvedValueOnce({} as never)
    await addComment({ vaultPath: '/v', threadId: 'thr_1', body: 'reply' })
    expect(mockedInvoke).toHaveBeenCalledWith('add_comment', {
      vaultPath: '/v',
      threadId: 'thr_1',
      body: 'reply',
    })
  })
})

describe('listThreadsForNote', () => {
  it('invokes list_threads_for_note with the right args', async () => {
    mockedInvoke.mockResolvedValueOnce([] as never)
    await listThreadsForNote({ vaultPath: '/v', noteRelPath: 'a.md' })
    expect(mockedInvoke).toHaveBeenCalledWith('list_threads_for_note', {
      vaultPath: '/v',
      noteRelPath: 'a.md',
    })
  })

  it('returns the array as-is', async () => {
    const threads = [{ id: 'thr_1' }, { id: 'thr_2' }]
    mockedInvoke.mockResolvedValueOnce(threads as never)
    const result = await listThreadsForNote({ vaultPath: '/v', noteRelPath: 'a.md' })
    expect(result).toEqual(threads)
  })
})

describe('updateThreadStatus', () => {
  it('forwards the new status verbatim (lowercase string union)', async () => {
    mockedInvoke.mockResolvedValueOnce({} as never)
    await updateThreadStatus({ vaultPath: '/v', threadId: 'thr_1', newStatus: 'resolved' })
    expect(mockedInvoke).toHaveBeenCalledWith('update_thread_status', {
      vaultPath: '/v',
      threadId: 'thr_1',
      newStatus: 'resolved',
    })
  })
})

describe('promoteToDecision', () => {
  it('passes through alternatives = null when no alternatives recorded', async () => {
    mockedInvoke.mockResolvedValueOnce({} as never)
    await promoteToDecision({
      vaultPath: '/v',
      threadId: 'thr_1',
      title: 'Adopt sidecar',
      rationale: 'because',
      alternatives: null,
    })
    expect(mockedInvoke).toHaveBeenCalledWith('promote_to_decision', {
      vaultPath: '/v',
      threadId: 'thr_1',
      title: 'Adopt sidecar',
      rationale: 'because',
      alternatives: null,
    })
  })

  it('passes alternatives string when recorded', async () => {
    mockedInvoke.mockResolvedValueOnce({} as never)
    await promoteToDecision({
      vaultPath: '/v',
      threadId: 'thr_1',
      title: 't',
      rationale: 'r',
      alternatives: 'Use a backend',
    })
    expect(mockedInvoke).toHaveBeenLastCalledWith(
      'promote_to_decision',
      expect.objectContaining({ alternatives: 'Use a backend' }),
    )
  })
})

describe('listDecisions', () => {
  it('normalizes missing filter fields to null over the wire', async () => {
    mockedInvoke.mockResolvedValueOnce([] as never)
    await listDecisions({ vaultPath: '/v' })
    expect(mockedInvoke).toHaveBeenCalledWith('list_decisions', {
      vaultPath: '/v',
      noteRelPath: null,
      owner: null,
    })
  })

  it('forwards filter values when provided', async () => {
    mockedInvoke.mockResolvedValueOnce([] as never)
    await listDecisions({
      vaultPath: '/v',
      noteRelPath: 'projects/a.md',
      owner: 'Alice',
    })
    expect(mockedInvoke).toHaveBeenCalledWith('list_decisions', {
      vaultPath: '/v',
      noteRelPath: 'projects/a.md',
      owner: 'Alice',
    })
  })
})
