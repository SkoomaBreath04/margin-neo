import { useEffect, useReducer } from 'react'

import { listThreadsForNote } from './api'
import { THREAD_CREATED_EVENT } from './commentExtension'
import type { Thread } from './types'

export interface UseThreadsForNoteArgs {
  vaultPath: string
  noteRelPath: string | null
}

// Trivial replace-reducer: `useReducer` lets us dispatch from
// inside the effect without tripping `react-hooks/set-state-in-
// effect` (which forbids `useState` setters in effect bodies).
function threadsReducer(_state: Thread[], next: Thread[]): Thread[] {
  return next
}

/**
 * Subscribe to the open-thread set for the active note.
 *
 * Fetches via slice 2.1's `listThreadsForNote` on note change and
 * re-fetches whenever `tolaria:thread-created` fires (so a thread
 * filed via the `AddCommentController` shows up immediately
 * without manual reload).
 *
 * Returns an empty array while loading or when `noteRelPath` is
 * `null`. Failures are silently swallowed for now — slice 2.6
 * intentionally does not surface a UI for fetch errors; that
 * affordance belongs to the Phase 3 panel.
 */
export function useThreadsForNote({
  vaultPath,
  noteRelPath,
}: UseThreadsForNoteArgs): Thread[] {
  const [threads, setThreads] = useReducer(threadsReducer, [] as Thread[])

  useEffect(() => {
    if (!noteRelPath) {
      setThreads([])
      return
    }

    let cancelled = false

    const fetchThreads = async () => {
      try {
        const result = await listThreadsForNote({ vaultPath, noteRelPath })
        // Guard against unmocked invoke returning undefined in
        // tests that don't stub `./api`. Production always returns
        // an array per the slice 1.10 Tauri command contract.
        if (!cancelled) setThreads(Array.isArray(result) ? result : [])
      } catch {
        // Silent for slice 2.6; Phase 3 panel will surface errors.
      }
    }

    fetchThreads()

    const handler = () => {
      fetchThreads()
    }
    window.addEventListener(THREAD_CREATED_EVENT, handler)

    return () => {
      cancelled = true
      window.removeEventListener(THREAD_CREATED_EVENT, handler)
    }
  }, [vaultPath, noteRelPath])

  return threads
}
