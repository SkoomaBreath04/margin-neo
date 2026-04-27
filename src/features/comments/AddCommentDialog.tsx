import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

export interface AddCommentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The text the user selected; shown as a read-only preview so they remember what they're commenting on. */
  selectedTextPreview: string
  /** Called with the trimmed body when the user submits. The dialog does not close itself — the caller decides. */
  onSubmit: (body: string) => void
}

/**
 * Pure UI for filing a new comment thread on a selection. Has no
 * editor, IPC, or vault context coupling — the caller (slice 2.5
 * `AddCommentController`) is responsible for capturing selection,
 * passing the preview in, and reacting to `onSubmit` by dispatching
 * the appropriate event or calling `createThread` directly.
 *
 * Body state lives in the inner `DialogBody` component so it
 * remounts (and resets to `''`) on every open transition — Radix
 * unmounts `DialogContent` when closed, which takes the inner
 * component down with it. No `useEffect` reset needed.
 */
export function AddCommentDialog({
  open,
  onOpenChange,
  selectedTextPreview,
  onSubmit,
}: AddCommentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogBody
          selectedTextPreview={selectedTextPreview}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

interface DialogBodyProps {
  selectedTextPreview: string
  onSubmit: (body: string) => void
  onCancel: () => void
}

function DialogBody({ selectedTextPreview, onSubmit, onCancel }: DialogBodyProps) {
  const [body, setBody] = useState('')
  const trimmed = body.trim()
  const canSubmit = trimmed.length > 0

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit(trimmed)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a comment</DialogTitle>
        <DialogDescription>
          Anchored to the selected text. Replies stay attached to this
          anchor; the thread auto-resolves when promoted to a decision.
        </DialogDescription>
      </DialogHeader>

      {selectedTextPreview && (
        <blockquote
          data-testid="add-comment-selection-preview"
          className="border-l-2 border-muted-foreground/40 pl-3 text-sm text-muted-foreground"
        >
          {selectedTextPreview}
        </blockquote>
      )}

      <Textarea
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="What's the concern, suggestion, or question?"
        rows={5}
        aria-label="Comment body"
      />

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          File thread
        </Button>
      </DialogFooter>
    </>
  )
}
