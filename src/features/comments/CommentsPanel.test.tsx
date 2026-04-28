import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  listThreadsForNote: vi.fn(),
  addComment: vi.fn(),
  updateThreadStatus: vi.fn(),
}))

import { addComment, listThreadsForNote, updateThreadStatus } from './api'

import { CommentsPanel } from './CommentsPanel'
import {
  FOCUS_THREAD_EVENT,
  THREAD_CREATED_EVENT,
  THREAD_UPDATED_EVENT,
} from './commentExtension'
import type { Comment, Thread, ThreadStatus } from './types'

const mockedList = vi.mocked(listThreadsForNote)
const mockedAddComment = vi.mocked(addComment)
const mockedUpdateStatus = vi.mocked(updateThreadStatus)

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
  mockedAddComment.mockReset()
  mockedUpdateStatus.mockReset()
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

describe('CommentsPanel — reply composer', () => {
  it('renders a composer in the open-thread detail view', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'open' }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    fireEvent.click(await screen.findByTestId('comments-panel-thread'))

    expect(
      await screen.findByTestId('comments-panel-composer'),
    ).toBeInTheDocument()
    const submit = screen.getByTestId(
      'comments-panel-composer-submit',
    ) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('does not render a composer for resolved threads', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'resolved' }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    fireEvent.click(
      await screen.findByTestId('comments-panel-tab-resolved'),
    )
    fireEvent.click(await screen.findByTestId('comments-panel-thread'))

    expect(screen.queryByTestId('comments-panel-composer')).toBeNull()
  })

  it('enables the submit button once the textarea has non-whitespace content', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'open' }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    fireEvent.click(await screen.findByTestId('comments-panel-thread'))

    const input = await screen.findByTestId(
      'comments-panel-composer-input',
    )
    const submit = screen.getByTestId(
      'comments-panel-composer-submit',
    ) as HTMLButtonElement

    fireEvent.change(input, { target: { value: '   ' } })
    expect(submit.disabled).toBe(true)

    fireEvent.change(input, { target: { value: '  hello world  ' } })
    expect(submit.disabled).toBe(false)
  })

  it('sends the trimmed body via addComment, clears the textarea, and dispatches THREAD_UPDATED_EVENT', async () => {
    mockedList.mockResolvedValue([
      thread({ id: 't1', status: 'open' }),
    ] as never)
    mockedAddComment.mockResolvedValueOnce({
      id: 'cmt_new',
      author: 'Tester',
      body: 'reply body',
      created_at: '2026-04-28T15:00:00Z',
      created_at_sha: '0',
    } as never)

    const updatedListener = vi.fn()
    window.addEventListener(THREAD_UPDATED_EVENT, updatedListener)

    try {
      render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
      fireEvent.click(await screen.findByTestId('comments-panel-thread'))

      const input = (await screen.findByTestId(
        'comments-panel-composer-input',
      )) as HTMLTextAreaElement
      fireEvent.change(input, { target: { value: '  reply body  ' } })
      fireEvent.click(screen.getByTestId('comments-panel-composer-submit'))

      await waitFor(() => {
        expect(mockedAddComment).toHaveBeenCalledWith({
          vaultPath: '/v',
          threadId: 't1',
          body: 'reply body',
        })
      })
      await waitFor(() => {
        expect(input.value).toBe('')
      })
      expect(updatedListener).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(THREAD_UPDATED_EVENT, updatedListener)
    }
  })

  it('shows an inline error and preserves the draft when addComment fails', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'open' }),
    ] as never)
    mockedAddComment.mockRejectedValueOnce(new Error('disk full'))

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    fireEvent.click(await screen.findByTestId('comments-panel-thread'))

    const input = (await screen.findByTestId(
      'comments-panel-composer-input',
    )) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'first try' } })
    fireEvent.click(screen.getByTestId('comments-panel-composer-submit'))

    expect(
      (await screen.findByTestId('comments-panel-composer-error')).textContent,
    ).toMatch(/disk full/)
    expect(input.value).toBe('first try')
  })
})

describe('CommentsPanel — status actions', () => {
  it('open thread shows Resolve and Orphan; resolved thread shows Reopen', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'open' }),
      thread({ id: 't2', status: 'resolved' }),
    ] as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    fireEvent.click(await screen.findByTestId('comments-panel-thread'))

    expect(screen.getByTestId('comments-panel-status-resolved')).toBeInTheDocument()
    expect(screen.getByTestId('comments-panel-status-orphaned')).toBeInTheDocument()
    expect(screen.queryByTestId('comments-panel-status-open')).toBeNull()

    // Back to list, switch tab, open the resolved thread.
    fireEvent.click(screen.getByTestId('comments-panel-back'))
    fireEvent.click(await screen.findByTestId('comments-panel-tab-resolved'))
    fireEvent.click(await screen.findByTestId('comments-panel-thread'))

    expect(screen.getByTestId('comments-panel-status-open')).toBeInTheDocument()
    expect(screen.queryByTestId('comments-panel-status-resolved')).toBeNull()
  })

  it('clicking Resolve calls updateThreadStatus with resolved and dispatches THREAD_UPDATED_EVENT', async () => {
    mockedList.mockResolvedValue([
      thread({ id: 't1', status: 'open' }),
    ] as never)
    mockedUpdateStatus.mockResolvedValueOnce({} as never)

    const updatedListener = vi.fn()
    window.addEventListener(THREAD_UPDATED_EVENT, updatedListener)

    try {
      render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
      fireEvent.click(await screen.findByTestId('comments-panel-thread'))
      fireEvent.click(screen.getByTestId('comments-panel-status-resolved'))

      await waitFor(() => {
        expect(mockedUpdateStatus).toHaveBeenCalledWith({
          vaultPath: '/v',
          threadId: 't1',
          newStatus: 'resolved',
        })
      })
      expect(updatedListener).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(THREAD_UPDATED_EVENT, updatedListener)
    }
  })

  it('clicking Orphan calls updateThreadStatus with orphaned', async () => {
    mockedList.mockResolvedValue([
      thread({ id: 't1', status: 'open' }),
    ] as never)
    mockedUpdateStatus.mockResolvedValueOnce({} as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    fireEvent.click(await screen.findByTestId('comments-panel-thread'))
    fireEvent.click(screen.getByTestId('comments-panel-status-orphaned'))

    await waitFor(() => {
      expect(mockedUpdateStatus).toHaveBeenCalledWith({
        vaultPath: '/v',
        threadId: 't1',
        newStatus: 'orphaned',
      })
    })
  })

  it('clicking Reopen on a resolved thread calls updateThreadStatus with open', async () => {
    mockedList.mockResolvedValue([
      thread({ id: 't1', status: 'resolved' }),
    ] as never)
    mockedUpdateStatus.mockResolvedValueOnce({} as never)

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    fireEvent.click(await screen.findByTestId('comments-panel-tab-resolved'))
    fireEvent.click(await screen.findByTestId('comments-panel-thread'))
    fireEvent.click(screen.getByTestId('comments-panel-status-open'))

    await waitFor(() => {
      expect(mockedUpdateStatus).toHaveBeenCalledWith({
        vaultPath: '/v',
        threadId: 't1',
        newStatus: 'open',
      })
    })
  })

  it('shows an inline error when updateThreadStatus fails', async () => {
    mockedList.mockResolvedValueOnce([
      thread({ id: 't1', status: 'open' }),
    ] as never)
    mockedUpdateStatus.mockRejectedValueOnce(new Error('write conflict'))

    render(<CommentsPanel vaultPath="/v" noteRelPath="a.md" />)
    fireEvent.click(await screen.findByTestId('comments-panel-thread'))
    fireEvent.click(screen.getByTestId('comments-panel-status-resolved'))

    expect(
      (await screen.findByTestId('comments-panel-status-error')).textContent,
    ).toMatch(/write conflict/)
  })
})
