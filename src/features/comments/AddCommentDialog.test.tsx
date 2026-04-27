import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AddCommentDialog } from './AddCommentDialog'

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof AddCommentDialog>> = {},
) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    selectedTextPreview: 'the original block content',
    onSubmit: vi.fn(),
    ...overrides,
  }
  render(<AddCommentDialog {...props} />)
  return props
}

describe('AddCommentDialog', () => {
  it('renders the selected text as a preview when open', () => {
    renderDialog()
    expect(screen.getByTestId('add-comment-selection-preview')).toHaveTextContent(
      'the original block content',
    )
  })

  it('omits the preview block when there is no selected text', () => {
    renderDialog({ selectedTextPreview: '' })
    expect(screen.queryByTestId('add-comment-selection-preview')).toBeNull()
  })

  it('disables Submit while the body is empty', () => {
    renderDialog()
    const submit = screen.getByRole('button', { name: /file thread/i })
    expect(submit).toBeDisabled()
  })

  it('disables Submit when the body is whitespace-only', () => {
    renderDialog()
    const textarea = screen.getByLabelText(/comment body/i)
    fireEvent.change(textarea, { target: { value: '   \n  ' } })
    const submit = screen.getByRole('button', { name: /file thread/i })
    expect(submit).toBeDisabled()
  })

  it('calls onSubmit with the trimmed body on click', () => {
    const props = renderDialog()
    const textarea = screen.getByLabelText(/comment body/i)
    fireEvent.change(textarea, { target: { value: '  needs review  ' } })
    const submit = screen.getByRole('button', { name: /file thread/i })
    fireEvent.click(submit)
    expect(props.onSubmit).toHaveBeenCalledWith('needs review')
  })

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    const props = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not auto-close on submit (caller decides)', () => {
    const props = renderDialog()
    fireEvent.change(screen.getByLabelText(/comment body/i), {
      target: { value: 'review please' },
    })
    fireEvent.click(screen.getByRole('button', { name: /file thread/i }))
    expect(props.onOpenChange).not.toHaveBeenCalled()
  })

  it('clears the body when reopened (no leak between selections)', () => {
    const props = {
      open: false,
      onOpenChange: vi.fn(),
      selectedTextPreview: 'first',
      onSubmit: vi.fn(),
    }
    const { rerender } = render(<AddCommentDialog {...props} />)
    rerender(<AddCommentDialog {...props} open={true} />)
    fireEvent.change(screen.getByLabelText(/comment body/i), {
      target: { value: 'leaked draft' },
    })
    rerender(<AddCommentDialog {...props} open={false} />)
    rerender(<AddCommentDialog {...props} open={true} selectedTextPreview="second" />)
    expect(screen.getByLabelText(/comment body/i)).toHaveValue('')
  })
})
