import { describe, expect, it } from 'vitest'

import { blockPlainText, captureSelection } from './selection'

describe('blockPlainText', () => {
  it('concatenates text nodes from a paragraph block', () => {
    const block = {
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
      ],
    }
    expect(blockPlainText(block)).toBe('Hello world')
  })

  it('walks nested content (e.g. link wraps inner text)', () => {
    const block = {
      content: [
        { type: 'text', text: 'Click ' },
        {
          type: 'link',
          href: 'https://example.com',
          content: [{ type: 'text', text: 'here' }],
        },
        { type: 'text', text: ' to continue' },
      ],
    }
    expect(blockPlainText(block)).toBe('Click here to continue')
  })

  it('returns empty string for empty content array', () => {
    expect(blockPlainText({ content: [] })).toBe('')
  })

  it('returns empty string when content is missing', () => {
    expect(blockPlainText({})).toBe('')
  })

  it('returns empty string for null/undefined block', () => {
    expect(blockPlainText(null)).toBe('')
    expect(blockPlainText(undefined)).toBe('')
  })

  it('skips unknown node types without throwing', () => {
    const block = {
      content: [
        { type: 'text', text: 'before ' },
        { type: 'image', src: 'x.png' },
        { type: 'text', text: 'after' },
      ],
    }
    expect(blockPlainText(block)).toBe('before after')
  })

  it('treats whitespace-only text as significant', () => {
    const block = {
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: '   ' },
        { type: 'text', text: 'b' },
      ],
    }
    expect(blockPlainText(block)).toBe('a   b')
  })
})

describe('captureSelection', () => {
  const block = {
    id: 'bn_block_abc',
    content: [{ type: 'text', text: 'the original block content' }],
  }

  it('returns null when from equals to (collapsed cursor)', () => {
    const result = captureSelection({ from: 5, to: 5, selectedText: '' }, block)
    expect(result).toBeNull()
  })

  it('returns null when selected text is whitespace-only', () => {
    const result = captureSelection({ from: 5, to: 8, selectedText: '   ' }, block)
    expect(result).toBeNull()
  })

  it('returns the captured shape when selection is non-empty', () => {
    const result = captureSelection({ from: 5, to: 13, selectedText: 'original' }, block)
    expect(result).toEqual({
      blockId: 'bn_block_abc',
      blockText: 'the original block content',
      selectedText: 'original',
    })
  })

  it('captures the full block text, not just the selected range', () => {
    // The whole block hash needs to cover all the text so the staleness
    // check fires on any text drift, not just edits inside the selection.
    const longBlock = {
      id: 'bn_block_xyz',
      content: [
        { type: 'text', text: 'left of selection ' },
        { type: 'text', text: 'SELECTED' },
        { type: 'text', text: ' right of selection' },
      ],
    }
    const result = captureSelection(
      { from: 100, to: 108, selectedText: 'SELECTED' },
      longBlock,
    )
    expect(result?.blockText).toBe('left of selection SELECTED right of selection')
    expect(result?.selectedText).toBe('SELECTED')
  })
})
