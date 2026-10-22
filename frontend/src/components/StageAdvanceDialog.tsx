import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { stageLabel } from '../services/houses'
import type { ConstructionStage } from '../services/houses'
import styles from './StageAdvanceDialog.module.css'

export function StageAdvanceDialog({ fromStage, toStage, onCancel, onConfirm, returnFocus }: {
  fromStage: ConstructionStage
  toStage: ConstructionStage
  onCancel: () => void
  onConfirm: () => void
  returnFocus: HTMLElement | null
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const root = document.getElementById('root')
    const wasInert = root?.inert ?? false
    const previousOverflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    cancelRef.current?.focus()
    return () => {
      if (root) root.inert = wasInert
      document.body.style.overflow = previousOverflow
      if (returnFocus?.isConnected && !returnFocus.hasAttribute('disabled')) returnFocus.focus()
    }
  }, [returnFocus])

  return createPortal(<div className={styles.backdrop}>
    <div className={styles.dialog} ref={dialogRef} role="dialog" aria-modal="true"
      aria-labelledby="advance-heading" aria-describedby="advance-description" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); onCancel() }
        if (event.key === 'Tab') {
          const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
          const first = buttons[0]
          const last = buttons[buttons.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <p className={styles.eyebrow}>CONFIRM STAGE CHANGE</p>
      <h2 id="advance-heading">Advance construction stage?</h2>
      <p className={styles.transition}>{stageLabel(fromStage)} <span aria-label="to">→</span> {stageLabel(toStage)}</p>
      <p id="advance-description">This page cannot move a house back to an earlier stage. The backend will check the
        current stage, photo requirement and your permission again.</p>
      <div className={styles.actions}>
        <button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className={styles.confirm} onClick={onConfirm}>Confirm advance</button>
      </div>
    </div>
  </div>, document.body)
}
