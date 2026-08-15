/**
 * PetPicker: the pet chooser popover — one static idle-frame preview per
 * catalog entry. Pure presentation; selection and visibility ride the
 * overlay's store actions.
 */
import { clsx } from 'clsx'
import type { PetCatalogEntry } from './contract/types.ts'

/** PetPicker props. */
export interface PetPickerProps {
  /** Catalog entries to choose from. */
  pets: PetCatalogEntry[]
  /** Currently effective pet id. */
  selectedId: string
  /** Selection handler. */
  onSelect: (id: string) => void
  /** Close handler. */
  onClose: () => void
  /** Translate seat of the pet namespace. */
  t: (key: 'picker.title' | 'picker.close' | 'picker.empty') => string
  /** Preview cell width in px (height follows the cell aspect). */
  previewWidthPx?: number
  /** Class map from the overlay's CSS module. */
  classes: {
    /** Popover root. */
    root: string | undefined
    /** Title row. */
    title: string | undefined
    /** Close button. */
    close: string | undefined
    /** Pet grid. */
    grid: string | undefined
    /** One pet option. */
    option: string | undefined
    /** Selected option modifier. */
    optionSelected: string | undefined
    /** Preview frame box. */
    preview: string | undefined
    /** Pet display name. */
    name: string | undefined
    /** Empty hint. */
    empty: string | undefined
  }
}

/** 契约单元格宽高比（高/宽）。 */
const CELL_ASPECT = 208 / 192

/**
 * Render the pet picker popover.
 * @param props - catalog, selection, handlers, copy, and classes.
 * @returns the picker element.
 */
export function PetPicker(props: PetPickerProps): React.JSX.Element {
  const { pets, selectedId, onSelect, onClose, t, classes } = props
  const previewWidth = props.previewWidthPx ?? 56
  return (
    <div className={classes.root} role="dialog" aria-label={t('picker.title')}>
      <div className={classes.title}>
        <span>{t('picker.title')}</span>
        <button type="button" className={classes.close} aria-label={t('picker.close')} onClick={onClose}>
          {t('picker.close')}
        </button>
      </div>
      {pets.length === 0 ? <div className={classes.empty}>{t('picker.empty')}</div> : (
        <ul className={classes.grid}>
          {pets.map(pet => (
            <li key={pet.id}>
              <button
                type="button"
                className={clsx(classes.option, pet.id === selectedId && classes.optionSelected)}
                aria-pressed={pet.id === selectedId}
                onClick={() => { onSelect(pet.id) }}
              >
                <span
                  className={classes.preview}
                  style={{
                    width: previewWidth,
                    height: Math.round(previewWidth * CELL_ASPECT),
                    backgroundImage: 'url(' + pet.spriteUrl + '?v=' + String(pet.mtimeMs) + ')',
                    backgroundSize: String(pet.frame.columns * 100) + '% ' + String(pet.frame.rows * 100) + '%',
                    backgroundPosition: '0% 0%',
                    imageRendering: 'pixelated',
                    backgroundRepeat: 'no-repeat',
                  }}
                />
                <span className={classes.name}>{pet.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
