import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  listThreadsForNote: vi.fn(),
}))

import { listThreadsForNote } from './api'

import { THREAD_CREATED_EVENT } from './commentExtension'
import { useThreadsForNote } from './useThreadsForNote'

const mockedList = vi.mocked(listThreadsForNote)

beforeEach(() => {
  mockedList.mockReset()
})

describe('useThreadsForNote', () => {
  it('returns empty array when noteRelPath is null', () => {
    mockedList.mockResolvedValue([])
    const { result } = renderHook(() =>
      useThreadsForNote({ vaultPath: '/v', noteRelPath: null }),
    )
    expect(result.current).toEqual([])
    expect(mockedList).not.toHaveBeenCalled()
  })

  it('fetches threads on mount when noteRelPath is set', async () => {
    const threads = [
      { id: 'thr_001', anchor: { block_id: 'a' } },
      { id: 'thr_002', anchor: { block_id: 'b' } },
    ]
    mockedList.mockResolvedValueOnce(threads as never)
    const { result } = renderHook(() =>
      useThreadsForNote({ vaultPath: '/v', noteRelPath: 'a.md' }),
    )
    await waitFor(() => {
      expect(result.current).toEqual(threads)
    })
    expect(mockedList).toHaveBeenCalledWith({ vaultPath: '/v', noteRelPath: 'a.md' })
  })

  it('refetches when tolaria:thread-created fires', async () => {
    const initial = [{ id: 'thr_001' }]
    const updated = [{ id: 'thr_001' }, { id: 'thr_002' }]
    mockedList
      .mockResolvedValueOnce(initial as never)
      .mockResolvedValueOnce(updated as never)
    const { result } = renderHook(() =>
      useThreadsForNote({ vaultPath: '/v', noteRelPath: 'a.md' }),
    )
    await waitFor(() => {
      expect(result.current).toEqual(initial)
    })
    act(() => {
      window.dispatchEvent(new CustomEvent(THREAD_CREATED_EVENT, { detail: {} }))
    })
    await waitFor(() => {
      expect(result.current).toEqual(updated)
    })
    expect(mockedList).toHaveBeenCalledTimes(2)
  })

  it('swallows errors and keeps the prior threads', async () => {
    const initial = [{ id: 'thr_001' }]
    mockedList
      .mockResolvedValueOnce(initial as never)
      .mockRejectedValueOnce(new Error('Tauri said no'))
    const { result } = renderHook(() =>
      useThreadsForNote({ vaultPath: '/v', noteRelPath: 'a.md' }),
    )
    await waitFor(() => {
      expect(result.current).toEqual(initial)
    })
    act(() => {
      window.dispatchEvent(new CustomEvent(THREAD_CREATED_EVENT, { detail: {} }))
    })
    // Wait long enough for the failed fetch to settle.
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current).toEqual(initial)
  })

  it('removes the event listener on unmount', async () => {
    mockedList.mockResolvedValue([])
    const { unmount } = renderHook(() =>
      useThreadsForNote({ vaultPath: '/v', noteRelPath: 'a.md' }),
    )
    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledTimes(1)
    })
    unmount()
    act(() => {
      window.dispatchEvent(new CustomEvent(THREAD_CREATED_EVENT, { detail: {} }))
    })
    // Should still be 1 — listener was removed on unmount.
    expect(mockedList).toHaveBeenCalledTimes(1)
  })
})
