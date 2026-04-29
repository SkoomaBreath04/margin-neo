import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  listThreadsForNote: vi.fn(),
  createThread: vi.fn(),
  addComment: vi.fn(),
  updateThreadStatus: vi.fn(),
}))

import {
  addComment,
  createThread,
  listThreadsForNote,
  updateThreadStatus,
} from './api'
import { TolariaThreadStore } from './TolariaThreadStore'
import type { Comment, Thread } from './types'

const mockedList = vi.mocked(listThreadsForNote)
const mockedCreate = vi.mocked(createThread)
const mockedAdd = vi.mocked(addComment)
const mockedStatus = vi.mocked(updateThreadStatus)

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thr_001',
    note_rel_path: 'projects/example.md',
    anchor: {
      block_id: 'bn_block_abc',
      created_at_sha: '0',
      content_hash: 'sha256:dead',
    },
    status: 'open',
    comments: [comment()],
    created_at: '2026-04-28T11:00:00Z',
    created_at_sha: '0',
    ...overrides,
  }
}

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'cmt_001',
    author: 'Ada Lovelace <ada@example.com>',
    body: 'first comment',
    created_at: '2026-04-28T11:00:00Z',
    created_at_sha: '0',
    ...overrides,
  }
}

beforeEach(() => {
  mockedList.mockReset()
  mockedCreate.mockReset()
  mockedAdd.mockReset()
  mockedStatus.mockReset()
})

describe('TolariaThreadStore — hydration', () => {
  it('starts empty until setActiveNote is called', async () => {
    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    expect(store.getThreads().size).toBe(0)
  })

  it('loads threads from listThreadsForNote on setActiveNote', async () => {
    mockedList.mockResolvedValueOnce([thread({ id: 't1' }), thread({ id: 't2' })])
    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    await store.setActiveNote('a.md')
    expect(mockedList).toHaveBeenCalledWith({
      vaultPath: '/v',
      noteRelPath: 'a.md',
    })
    expect(store.getThreads().size).toBe(2)
    expect(store.getThread('t1').type).toBe('thread')
  })

  it('clears the cache when setActiveNote is called with null', async () => {
    mockedList.mockResolvedValueOnce([thread({ id: 't1' })])
    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    await store.setActiveNote('a.md')
    expect(store.getThreads().size).toBe(1)
    await store.setActiveNote(null)
    expect(store.getThreads().size).toBe(0)
  })

  it('translates snake_case Tolaria fields into BlockNote camelCase + Date', async () => {
    mockedList.mockResolvedValueOnce([
      thread({
        id: 'thr_xyz',
        status: 'resolved',
        comments: [
          comment({
            id: 'c1',
            body: 'hello',
            author: 'Alan Turing <alan@example.com>',
          }),
        ],
      }),
    ])
    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    await store.setActiveNote('a.md')
    const t = store.getThread('thr_xyz')
    expect(t.id).toBe('thr_xyz')
    expect(t.resolved).toBe(true)
    expect(t.createdAt).toBeInstanceOf(Date)
    expect(t.metadata).toMatchObject({
      tolariaStatus: 'resolved',
      noteRelPath: 'projects/example.md',
    })
    expect(t.comments[0].userId).toBe('alan@example.com')
    expect(t.comments[0].body).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
    ])
  })

  it('orphaned threads are surfaced as resolved=true with metadata.tolariaStatus="orphaned"', async () => {
    mockedList.mockResolvedValueOnce([thread({ id: 't1', status: 'orphaned' })])
    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    await store.setActiveNote('a.md')
    const t = store.getThread('t1')
    expect(t.resolved).toBe(true)
    expect((t.metadata as { tolariaStatus: string }).tolariaStatus).toBe(
      'orphaned',
    )
  })
})

describe('TolariaThreadStore — subscriptions', () => {
  it('fires subscribers on hydration and on mutations', async () => {
    mockedList.mockResolvedValueOnce([thread({ id: 't1' })])
    mockedCreate.mockResolvedValueOnce(thread({ id: 't2' }))
    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    store.setEditor({
      getTextCursorPosition: () => ({
        block: { id: 'bn_block_abc', content: 'block text' },
      }),
    })
    const cb = vi.fn()
    const unsubscribe = store.subscribe(cb)

    await store.setActiveNote('a.md')
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0].size).toBe(1)

    await store.createThread({
      initialComment: {
        body: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
      },
    })
    expect(cb).toHaveBeenCalledTimes(2)
    expect(cb.mock.calls[1][0].size).toBe(2)

    unsubscribe()
    await store.refresh()
    expect(cb).toHaveBeenCalledTimes(2)
  })
})

describe('TolariaThreadStore — createThread', () => {
  it('reads block_id + block_text from the editor and calls IPC createThread', async () => {
    mockedList.mockResolvedValueOnce([])
    mockedCreate.mockResolvedValueOnce(
      thread({
        id: 'thr_new',
        anchor: {
          block_id: 'bn_block_xyz',
          created_at_sha: '0',
          content_hash: 'sha256:cafebabe',
        },
      }),
    )

    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    await store.setActiveNote('projects/example.md')
    store.setEditor({
      getTextCursorPosition: () => ({
        block: {
          id: 'bn_block_xyz',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      }),
    })

    const result = await store.createThread({
      initialComment: {
        body: [
          { type: 'paragraph', content: [{ type: 'text', text: 'wait what?' }] },
        ],
      },
    })

    expect(mockedCreate).toHaveBeenCalledWith({
      vaultPath: '/v',
      noteRelPath: 'projects/example.md',
      blockId: 'bn_block_xyz',
      blockText: 'Hello world',
      initialBody: 'wait what?',
    })
    expect(result.id).toBe('thr_new')
    expect(store.getThread('thr_new')).toBeDefined()
  })

  it('throws when no note is active', async () => {
    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    store.setEditor({
      getTextCursorPosition: () => ({
        block: { id: 'bn_x', content: 'x' },
      }),
    })
    await expect(
      store.createThread({
        initialComment: {
          body: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
        },
      }),
    ).rejects.toThrow(/no note is active/)
  })

  it('throws when the editor has no active selection block', async () => {
    mockedList.mockResolvedValueOnce([])
    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    await store.setActiveNote('a.md')
    store.setEditor({ getTextCursorPosition: () => null })
    await expect(
      store.createThread({
        initialComment: {
          body: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
        },
      }),
    ).rejects.toThrow(/no active selection/)
  })
})

describe('TolariaThreadStore — addComment', () => {
  it('calls IPC addComment and appends to the cached thread', async () => {
    mockedList.mockResolvedValueOnce([thread({ id: 't1', comments: [comment({ id: 'c1' })] })])
    mockedAdd.mockResolvedValueOnce(comment({ id: 'c2', body: 'reply!' }))

    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    await store.setActiveNote('a.md')

    const result = await store.addComment({
      threadId: 't1',
      comment: {
        body: [
          { type: 'paragraph', content: [{ type: 'text', text: 'reply!' }] },
        ],
      },
    })

    expect(mockedAdd).toHaveBeenCalledWith({
      vaultPath: '/v',
      threadId: 't1',
      body: 'reply!',
    })
    expect(result.id).toBe('c2')
    expect(store.getThread('t1').comments.length).toBe(2)
    expect(store.getThread('t1').comments[1].id).toBe('c2')
  })
})

describe('TolariaThreadStore — resolve / unresolve', () => {
  it('resolveThread calls IPC with resolved and updates cache', async () => {
    mockedList.mockResolvedValueOnce([thread({ id: 't1', status: 'open' })])
    mockedStatus.mockResolvedValueOnce(thread({ id: 't1', status: 'resolved' }))
    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    await store.setActiveNote('a.md')

    await store.resolveThread({ threadId: 't1' })
    expect(mockedStatus).toHaveBeenCalledWith({
      vaultPath: '/v',
      threadId: 't1',
      newStatus: 'resolved',
    })
    expect(store.getThread('t1').resolved).toBe(true)
  })

  it('unresolveThread calls IPC with open and updates cache', async () => {
    mockedList.mockResolvedValueOnce([thread({ id: 't1', status: 'resolved' })])
    mockedStatus.mockResolvedValueOnce(thread({ id: 't1', status: 'open' }))
    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    await store.setActiveNote('a.md')

    await store.unresolveThread({ threadId: 't1' })
    expect(mockedStatus).toHaveBeenCalledWith({
      vaultPath: '/v',
      threadId: 't1',
      newStatus: 'open',
    })
    expect(store.getThread('t1').resolved).toBe(false)
  })
})

describe('TolariaThreadStore — unsupported operations', () => {
  it('throws a clear error for updateComment / delete / reaction ops', async () => {
    const store = new TolariaThreadStore({ vaultPath: '/v', userId: 'me' })
    await expect(
      store.updateComment({
        threadId: 't1',
        commentId: 'c1',
        comment: { body: [] },
      }),
    ).rejects.toThrow(/updateComment\(threadId=t1\) is not supported/)
    await expect(
      store.deleteComment({ threadId: 't1', commentId: 'c1' }),
    ).rejects.toThrow(/deleteComment\(threadId=t1\) is not supported/)
    await expect(store.deleteThread({ threadId: 't1' })).rejects.toThrow(
      /deleteThread\(threadId=t1\) is not supported/,
    )
    await expect(
      store.addReaction({ threadId: 't1', commentId: 'c1', emoji: '👍' }),
    ).rejects.toThrow(/addReaction\(threadId=t1\) is not supported/)
    await expect(
      store.deleteReaction({ threadId: 't1', commentId: 'c1', emoji: '👍' }),
    ).rejects.toThrow(/deleteReaction\(threadId=t1\) is not supported/)
  })
})
