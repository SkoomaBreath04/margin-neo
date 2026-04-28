import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  listThreadsForNote: vi.fn(),
}))

import { listThreadsForNote } from './api'

import { CommentAnchors } from './CommentAnchors'
import { FOCUS_THREAD_EVENT } from './commentExtension'

const mockedList = vi.mocked(listThreadsForNote)

function makeBlock(id: string, text = 'block text'): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-id', id)
  el.textContent = text
  return el
}

function thread(
  overrides: {
    id?: string
    blockId?: string
    status?: 'open' | 'resolved' | 'orphaned'
  } = {},
) {
  return {
    id: overrides.id ?? 'thr_001',
    note_rel_path: 'projects/example.md',
    anchor: {
      block_id: overrides.blockId ?? 'bn_block_abc',
      created_at_sha: '0',
      content_hash: 'sha256:dead',
    },
    status: overrides.status ?? 'open',
    comments: [],
    created_at: '2026-04-28T11:00:00Z',
    created_at_sha: '0',
  }
}

beforeEach(() => {
  mockedList.mockReset()
})

afterEach(() => {
  // RTL auto-cleans rendered components; clean up the synthetic
  // blocks we appended so each test starts with a clean DOM.
  document.querySelectorAll('[data-id]').forEach((el) => el.remove())
})

describe('CommentAnchors', () => {
  it('renders nothing when there are no threads', async () => {
    mockedList.mockResolvedValueOnce([] as never)
    const { container } = render(
      <CommentAnchors vaultPath="/v" noteRelPath="a.md" />,
    )
    expect(container.innerHTML).toBe('')
    await waitFor(() => expect(mockedList).toHaveBeenCalled())
  })

  it('marks the matching block with class + thread-id attribute', async () => {
    const block = makeBlock('bn_block_abc')
    document.body.appendChild(block)
    mockedList.mockResolvedValueOnce([thread()] as never)
    render(<CommentAnchors vaultPath="/v" noteRelPath="a.md" />)
    await waitFor(() => {
      expect(block.classList.contains('tolaria-thread-anchor')).toBe(true)
    })
    expect(block.getAttribute('data-tolaria-thread-id')).toBe('thr_001')
  })

  it('does not mark blocks for orphaned threads', async () => {
    const block = makeBlock('bn_block_orphan')
    document.body.appendChild(block)
    mockedList.mockResolvedValueOnce([
      thread({ blockId: 'bn_block_orphan', status: 'orphaned' }),
    ] as never)
    render(<CommentAnchors vaultPath="/v" noteRelPath="a.md" />)
    // Wait long enough for the fetch + apply cycle to settle.
    await new Promise((r) => setTimeout(r, 10))
    expect(block.classList.contains('tolaria-thread-anchor')).toBe(false)
    expect(block.hasAttribute('data-tolaria-thread-id')).toBe(false)
  })

  it('de-duplicates: one marker per block even with multiple threads', async () => {
    const block = makeBlock('bn_block_abc')
    document.body.appendChild(block)
    mockedList.mockResolvedValueOnce([
      thread({ id: 'thr_001', blockId: 'bn_block_abc' }),
      thread({ id: 'thr_002', blockId: 'bn_block_abc' }),
    ] as never)
    render(<CommentAnchors vaultPath="/v" noteRelPath="a.md" />)
    await waitFor(() => {
      expect(block.classList.contains('tolaria-thread-anchor')).toBe(true)
    })
    // First thread wins as the click target.
    expect(block.getAttribute('data-tolaria-thread-id')).toBe('thr_001')
  })

  it('Alt+click on a marked block dispatches tolaria:focus-thread', async () => {
    const block = makeBlock('bn_block_abc')
    document.body.appendChild(block)
    mockedList.mockResolvedValueOnce([thread()] as never)
    render(<CommentAnchors vaultPath="/v" noteRelPath="a.md" />)
    await waitFor(() => {
      expect(block.classList.contains('tolaria-thread-anchor')).toBe(true)
    })
    const listener = vi.fn()
    window.addEventListener(FOCUS_THREAD_EVENT, listener)
    try {
      fireEvent.mouseDown(block, { altKey: true })
      expect(listener).toHaveBeenCalledTimes(1)
      const event = listener.mock.calls[0][0] as CustomEvent
      expect(event.detail).toEqual({ threadId: 'thr_001' })
    } finally {
      window.removeEventListener(FOCUS_THREAD_EVENT, listener)
    }
  })

  it('plain click on a marked block does NOT dispatch focus-thread', async () => {
    const block = makeBlock('bn_block_abc')
    document.body.appendChild(block)
    mockedList.mockResolvedValueOnce([thread()] as never)
    render(<CommentAnchors vaultPath="/v" noteRelPath="a.md" />)
    await waitFor(() => {
      expect(block.classList.contains('tolaria-thread-anchor')).toBe(true)
    })
    const listener = vi.fn()
    window.addEventListener(FOCUS_THREAD_EVENT, listener)
    try {
      fireEvent.mouseDown(block, { altKey: false })
      expect(listener).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(FOCUS_THREAD_EVENT, listener)
    }
  })

  it('removes markers on unmount', async () => {
    const block = makeBlock('bn_block_abc')
    document.body.appendChild(block)
    mockedList.mockResolvedValueOnce([thread()] as never)
    const { unmount } = render(
      <CommentAnchors vaultPath="/v" noteRelPath="a.md" />,
    )
    await waitFor(() => {
      expect(block.classList.contains('tolaria-thread-anchor')).toBe(true)
    })
    unmount()
    expect(block.classList.contains('tolaria-thread-anchor')).toBe(false)
    expect(block.hasAttribute('data-tolaria-thread-id')).toBe(false)
  })
})
