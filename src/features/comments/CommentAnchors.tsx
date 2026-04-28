import { useEffect, useRef } from 'react'

import {
  FOCUS_THREAD_EVENT,
  type FocusThreadDetail,
} from './commentExtension'
import { useThreadsForNote } from './useThreadsForNote'

const ANCHOR_CLASS = 'tolaria-thread-anchor'
const ANCHOR_ATTR = 'data-tolaria-thread-id'

export interface CommentAnchorsProps {
  vaultPath: string
  noteRelPath: string | null
}

/**
 * Visible-anchor rendering layer for the active note's open
 * threads.
 *
 * Subscribes to `useThreadsForNote` for the current note, then
 * walks each thread and finds its block in the rendered editor by
 * BlockNote's stable `data-id` attribute. Marked blocks get the
 * `tolaria-thread-anchor` CSS class (visual: left border, see
 * `src/index.css`) and a `data-tolaria-thread-id` attribute that
 * carries the thread id back to the click handler.
 *
 * Click affordance: **Alt+click** on a marked block dispatches
 * `tolaria:focus-thread` with `{ threadId }`. Plain clicks pass
 * through so cursor placement still works for editing. The
 * Alt-click disambiguation is a deliberate slice-2.6 choice that
 * avoids cluttering the editor with a per-thread gutter widget.
 * Phase 3's panel listens for the focus event to scroll the
 * matching thread into view.
 *
 * Renders `null` — all visual effect is via classes/attributes on
 * existing block DOM, so the component is safe to mount anywhere
 * in the editor's React tree.
 */
export function CommentAnchors({ vaultPath, noteRelPath }: CommentAnchorsProps) {
  const threads = useThreadsForNote({ vaultPath, noteRelPath })
  const markedRef = useRef<HTMLElement[]>([])

  // Apply / clean up DOM markers when the thread set changes.
  useEffect(() => {
    // Remove markers from any previously-marked elements.
    for (const el of markedRef.current) {
      el.classList.remove(ANCHOR_CLASS)
      el.removeAttribute(ANCHOR_ATTR)
    }
    markedRef.current = []

    // De-dup by block_id so a block with multiple threads still
    // gets exactly one marker; the click handler uses the first
    // open thread for that block as the focus target.
    const byBlock = new Map<string, string>()
    for (const thread of threads) {
      if (thread.status === 'orphaned') continue
      if (byBlock.has(thread.anchor.block_id)) continue
      byBlock.set(thread.anchor.block_id, thread.id)
    }

    const newlyMarked: HTMLElement[] = []
    for (const [blockId, threadId] of byBlock) {
      const selector = `[data-id="${CSS.escape(blockId)}"]`
      const el = document.querySelector<HTMLElement>(selector)
      if (!el) continue
      el.classList.add(ANCHOR_CLASS)
      el.setAttribute(ANCHOR_ATTR, threadId)
      newlyMarked.push(el)
    }
    markedRef.current = newlyMarked

    return () => {
      for (const el of newlyMarked) {
        el.classList.remove(ANCHOR_CLASS)
        el.removeAttribute(ANCHOR_ATTR)
      }
      markedRef.current = []
    }
  }, [threads])

  // Alt+click on a marked block dispatches the focus event.
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchored = target.closest(`[${ANCHOR_ATTR}]`)
      if (!(anchored instanceof HTMLElement)) return
      const threadId = anchored.getAttribute(ANCHOR_ATTR)
      if (!threadId) return
      event.preventDefault()
      window.dispatchEvent(
        new CustomEvent<FocusThreadDetail>(FOCUS_THREAD_EVENT, {
          detail: { threadId },
        }),
      )
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return null
}
