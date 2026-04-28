import { describe, expect, it } from 'vitest'

import { readActiveSelection, type EditorLike } from './editorSelection'

function makeEditor(overrides: Partial<EditorLike> = {}): EditorLike {
  return {
    _tiptapEditor: {
      view: {
        state: {
          selection: { from: 5, to: 13 },
          doc: { textBetween: () => 'original' },
        },
      },
    },
    getTextCursorPosition: () => ({
      block: {
        id: 'bn_block_abc',
        content: [{ type: 'text', text: 'the original block content' }],
      },
    }),
    ...overrides,
  }
}

describe('readActiveSelection', () => {
  it('returns null when no view is reachable', () => {
    const editor: EditorLike = {
      _tiptapEditor: { view: null },
      prosemirrorView: null,
      getTextCursorPosition: () => ({
        block: { id: 'bn_block_abc', content: [] },
      }),
    }
    expect(readActiveSelection(editor)).toBeNull()
  })

  it('returns null when getTextCursorPosition returns no block', () => {
    const editor = makeEditor({
      getTextCursorPosition: () => ({}),
    })
    expect(readActiveSelection(editor)).toBeNull()
  })

  it('returns null when getTextCursorPosition is missing entirely', () => {
    const editor = makeEditor({
      getTextCursorPosition: undefined,
    })
    expect(readActiveSelection(editor)).toBeNull()
  })

  it('returns null when selection is collapsed (from === to)', () => {
    const editor = makeEditor({
      _tiptapEditor: {
        view: {
          state: {
            selection: { from: 5, to: 5 },
            doc: { textBetween: () => '' },
          },
        },
      },
    })
    expect(readActiveSelection(editor)).toBeNull()
  })

  it('returns the captured shape for a valid selection', () => {
    const editor = makeEditor()
    const result = readActiveSelection(editor)
    expect(result).toEqual({
      blockId: 'bn_block_abc',
      blockText: 'the original block content',
      selectedText: 'original',
    })
  })

  it('falls back from _tiptapEditor.view to prosemirrorView', () => {
    const editor: EditorLike = {
      _tiptapEditor: { view: null },
      prosemirrorView: {
        state: {
          selection: { from: 5, to: 13 },
          doc: { textBetween: () => 'original' },
        },
      },
      getTextCursorPosition: () => ({
        block: {
          id: 'bn_block_abc',
          content: [{ type: 'text', text: 'the original block content' }],
        },
      }),
    }
    const result = readActiveSelection(editor)
    expect(result?.blockId).toBe('bn_block_abc')
    expect(result?.selectedText).toBe('original')
  })
})
