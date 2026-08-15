/**
 * PetBubble: the notification pill floating above the pet — the waiting /
 * failed / review facts with a dismiss button. Pure presentation; the overlay
 * owns when it shows.
 */

/** PetBubble props. */
export interface PetBubbleProps {
  /** Headline (e.g. the waiting/failed/done copy). */
  title: string | undefined
  /** Optional detail line (waiting kind or error excerpt). */
  detail?: string | null
  /** Dismiss-button accessible label. */
  dismissLabel: string | undefined
  /** Dismiss handler. */
  onDismiss: () => void
  /** Root className from the overlay's CSS module. */
  className: string | undefined
  /** Title element className. */
  titleClassName: string | undefined
  /** Detail element className. */
  detailClassName: string | undefined
  /** Dismiss button className. */
  dismissClassName: string | undefined
}

/**
 * Render the notification bubble.
 * @param props - copy, classes, and the dismiss handler.
 * @returns the bubble element.
 */
export function PetBubble(props: PetBubbleProps): React.JSX.Element {
  return (
    <div className={props.className} role="status">
      <span className={props.titleClassName}>{props.title}</span>
      {props.detail != null && props.detail !== '' ? <span className={props.detailClassName}>{props.detail}</span> : null}
      <button type="button" className={props.dismissClassName} aria-label={props.dismissLabel} onClick={props.onDismiss}>
        {props.dismissLabel}
      </button>
    </div>
  )
}
