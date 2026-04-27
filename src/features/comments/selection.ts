/**
 * Pure transformation helpers for capturing a comment-anchor
 * selection out of BlockNote / ProseMirror state. The editor-
 * touching glue (reading `editor._tiptapEditor.view`,
 * `editor.getTextCursorPosition()`) lives in the extension that
 * consumes these helpers, so this module stays unit-testable
 * without a real editor.
 */

export interface SelectionPositions {
  /** ProseMirror absolute position where the selection begins. */
  from: number
  /** ProseMirror absolute position where the selection ends. */
  to: number
  /** The user-selected text, already extracted by the caller. */
  selectedText: string
}

export interface BlockShape {
  /** BlockNote block id — stable across edits within the same block. */
  id: string
  /** BlockNote inline content array — opaque shape, walked recursively. */
  content: unknown
}

export interface CapturedSelection {
  blockId: string
  /**
   * Plain text of the entire block (not just the selected range).
   * The Rust side hashes this for `Anchor.content_hash` so the
   * staleness check fires when the block's text drifts.
   */
  blockText: string
  selectedText: string
}

/**
 * Recursively extract plain text from a BlockNote block's content
 * array. Walks nested inline content (e.g. links wrap their inner
 * text in a nested array), concatenates every `text` node, and
 * returns the result. Returns `''` for malformed or empty input
 * rather than throwing — callers can decide whether an empty hash
 * is meaningful.
 */
export function blockPlainText(block: { content?: unknown } | null | undefined): string {
  if (!block) return ''
  return inlineNodeText(block.content)
}

function inlineNodeText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) {
    return node.map(inlineNodeText).join('')
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (obj.type === 'text' && typeof obj.text === 'string') {
      return obj.text
    }
    if ('content' in obj) {
      return inlineNodeText(obj.content)
    }
  }
  return ''
}

/**
 * Build a `CapturedSelection` from a `(positions, block)` pair, or
 * return `null` when the selection is empty or whitespace-only.
 * The caller is responsible for reading the selection and the
 * containing block out of the editor.
 */
export function captureSelection(
  positions: SelectionPositions,
  block: BlockShape,
): CapturedSelection | null {
  if (positions.from === positions.to) return null
  if (!positions.selectedText.trim()) return null
  return {
    blockId: block.id,
    blockText: blockPlainText(block),
    selectedText: positions.selectedText,
  }
}
