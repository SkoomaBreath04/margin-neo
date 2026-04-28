import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  listThreadsForNote: vi.fn(),
}))

import { listThreadsForNote } from './api'

import { CommentsPanel } from './CommentsPanel'
import {
  FOCUS_THREAD_EVENT,
  THREAD_CREATED_EVENT,
} from './commentExtension'
import type { Comment, Thread, ThreadStatus } from './types'

const mockedList = vi.mocked(listThreadsForNote)

interface ThreadOverrides {
  id?: string
  status?: ThreadStatus
  blockId?: string
  body?: string
  author?: string
  comments?: Comment[]
}

function thread(overrides: ThreadOverrides = {}): Thread {
  return {
    id: overrides.id ?? 'thr_001',
    note_rel_path: 'projects/example.md',
    anchor: {
      block_id: overrides.blockId ?? 'bn_block_abc',
      created_at_sha: '0',
      content_hash: 'sha256:dead',
    },
    status: overrides.status ?? 'open',
    comments: overrides.comments ?? [
      {
        id: 'cmt_001',
        author: overrides.author ?? 'Ada Lovelace <ada@example.com>',
        body: overrides.body ?? 'first comment',
        created_at: '2026-04-28T11:00:00Z',
        created_at_sha: '0',
      },
    ],
    created_at: '2026-04-28T11:00:00Z',
    created_at_sha: '0',
  }
}

beforeEach(() => {
  mockedList.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CommentsPanel — list mode', () => {
  it('renders nothing when no threads exist for the note', async () => {
    mockedList.mockResolvedValueOnce([] as never)
    const { container } = render(
      <CommentsPanel vaultPath="/v" noteRelPath="a.md" />,
    )
    await waitFor(() => expect(mockedList).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('shows per-status counts and defaults to the Open tab', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'open' }),
      thread({ id: 't2', status: 'open' }),
      thread({ id: 't3', status: 'resolved' }),
      thread({ id: 't4', status: 'orphaned' }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)

    const openTab = await screen.findByTestId('comments-panel-tab-open')
    const resolvedTab = screen.getByTestId('comments-panel-tab-resolved')
    const orphanedTab = screen.getByTestId('comments-panel-tab-orphaned')

    expect(openTab.textContent).toMatch(/Open/)
    expect(openTab.textContent).toMatch(/2/)
    expect(resolvedTab.textContent).toMatch(/1/)
    expect(orphanedTab.textContent).toMatch(/1/)
    expect(openTab.getAttribute('data-active')).toBe('true')

    const cards = await screen.findAllByTestId('comments-panel-thread')
    expect(cards.length).toBe(2)
    expect(cards.map((c) => c.getAttribute('data-thread-id'))).toEqual([
      't1',
      't2',
    ])
  })

  it('switches to the Resolved tab on click', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'open' }),
      thread({ id: 't2', status: 'resolved', body: 'wrapped up' }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    const resolvedTab = await screen.findByTestId('comments-panel-tab-resolved')
    fireEvent.click(resolvedTab)

    const cards = await screen.findAllByTestId('comments-panel-thread')
    expect(cards.length).toBe(1)
    expect(cards[0].getAttribute('data-thread-id')).toBe('t2')
    expect(cards[0].textContent).toMatch(/wrapped up/)
  })

  it('shows the empty hint when the active tab has no threads', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'open' }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    const orphanedTab = await screen.findByTestId('comments-panel-tab-orphaned')
    fireEvent.click(orphanedTab)

    expect(
      await screen.findByText(/no orphaned threads/i),
    ).toBeInTheDocument()
  })

  it('shows reply count when a thread has replies', async () => {
    mockedList.mockResolvedValueOnce([
      thread({
        id: 't1',
        comments: [
          {
            id: 'c1',
            author: 'A',
            body: 'first',
            created_at: '2026-04-28T11:00:00Z',
            created_at_sha: '0',
          },
          {
            id: 'c2',
            author: 'B',
            body: 'second',
            created_at: '2026-04-28T12:00:00Z',
            created_at_sha: '0',
          },
          {
            id: 'c3',
            author: 'A',
            body: 'third',
            created_at: '2026-04-28T13:00:00Z',
            created_at_sha: '0',
          },
        ],
      }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    expect(await screen.findByText(/2 replies/)).toBeInTheDocument()
  })
})

describe('CommentsPanel — detail mode', () => {
  it('clicking a thread card opens the detail view', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'open' }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    const card = await screen.findByTestId('comments-panel-thread')
    fireEvent.click(card)

    const panel = await screen.findByTestId('comments-panel')
    expect(panel.getAttribute('data-mode')).toBe('detail')
    expect(panel.getAttribute('data-thread-id')).toBe('t1')
  })

  it('renders every comment in the chain in order', async () => {
    mockedList.mockResolvedValueOnce([
      thread({
        id: 't1',
        comments: [
          {
            id: 'c1',
            author: 'A',
            body: 'first body',
            created_at: '2026-04-28T11:00:00Z',
            created_at_sha: '0',
          },
          {
            id: 'c2',
            author: 'B',
            body: 'second body',
            created_at: '2026-04-28T12:00:00Z',
            created_at_sha: '0',
          },
          {
            id: 'c3',
            author: 'C',
            body: 'third body',
            created_at: '2026-04-28T13:00:00Z',
            created_at_sha: '0',
          },
        ],
      }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    fireEvent.click(await screen.findByTestId('comments-panel-thread'))

    const bubbles = await screen.findAllByTestId('comments-panel-comment')
    expect(bubbles.map((b) => b.getAttribute('data-comment-id'))).toEqual([
      'c1',
      'c2',
      'c3',
    ])
    expect(bubbles[0].textContent).toMatch(/first body/)
    expect(bubbles[2].textContent).toMatch(/third body/)
  })

  it('back button returns to list mode', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'open' }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    fireEvent.click(await screen.findByTestId('comments-panel-thread'))
    fireEvent.click(await screen.findByTestId('comments-panel-back'))

    const panel = await screen.findByTestId('comments-panel')
    expect(panel.getAttribute('data-mode')).toBe('list')
    expect(screen.queryByTestId('comments-panel-back')).toBeNull()
  })

  it('focus event opens the matching thread directly in detail mode', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'open' }),
      thread({ id: 't2', status: 'resolved' }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    await screen.findByTestId('comments-panel-tab-open')

    window.dispatchEvent(
      new CustomEvent(FOCUS_THREAD_EVENT, { detail: { threadId: 't2' } }),
    )

    await waitFor(() => {
      const panel = screen.getByTestId('comments-panel')
      expect(panel.getAttribute('data-mode')).toBe('detail')
      expect(panel.getAttribute('data-thread-id')).toBe('t2')
    })
  })

  it('focus event with unknown threadId leaves the user in list mode', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'open' }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    await screen.findByTestId('comments-panel-tab-open')

    window.dispatchEvent(
      new CustomEvent(FOCUS_THREAD_EVENT, { detail: { threadId: 'nope' } }),
    )

    await Promise.resolve()
    expect(screen.getByTestId('comments-panel').getAttribute('data-mode')).toBe(
      'list',
    )
  })

  it('thread-created event pops the panel back to list mode', async () => {
    // The hook re-fetches on THREAD_CREATED_EVENT, so the mock must
    // resolve more than once.
    mockedList.mockResolvedValue([
      thread({ id: 't1', status: 'open' }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    fireEvent.click(await screen.findByTestId('comments-panel-thread'))
    await waitFor(() => {
      expect(
        screen.getByTestId('comments-panel').getAttribute('data-mode'),
      ).toBe('detail')
    })

    window.dispatchEvent(new CustomEvent(THREAD_CREATED_EVENT, { detail: {} }))

    await waitFor(() => {
      expect(
        screen.getByTestId('comments-panel').getAttribute('data-mode'),
      ).toBe('list')
    })
  })
})
