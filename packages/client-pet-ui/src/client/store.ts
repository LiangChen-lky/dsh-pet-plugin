/**
 * Pet overlay store seat: selection, position, picker visibility, and the
 * dismissed-bubble marker. Framework-run persistence (the persist key) keeps
 * the pet and its placement across reloads; position is stored as viewport
 * right/bottom offsets so window resizes never push the pet off-screen.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Overlay viewing state. */
export interface PetOverlayState {
  /** Chosen pet id; null follows the catalog's first entry. */
  selectedPetId: string | null
  /** Viewport-right offset in px. */
  right: number
  /** Viewport-bottom offset in px. */
  bottom: number
  /** Pet picker visibility. */
  pickerOpen: boolean
  /** Dismissed bubble identity (state+kind key); a new fact re-shows the bubble. */
  bubbleDismissedKey: string | null
}

/** Annotation twin of the actions literal (drift fails the defineStore call). */
export type PetOverlayActions = {
  /** Select a pet by id. */
  selectPet: (draft: PetOverlayState, id: string) => void
  /** Persist the settled viewport offsets. */
  setPosition: (draft: PetOverlayState, right: number, bottom: number) => void
  /** Toggle the pet picker. */
  setPickerOpen: (draft: PetOverlayState, open: boolean) => void
  /** Dismiss the bubble for one fact key. */
  dismissBubble: (draft: PetOverlayState, key: string) => void
}

/** 默认停靠：右下角留边。 */
const DEFAULT_RIGHT = 24
const DEFAULT_BOTTOM = 24

/**
 * Create the pet overlay store handle.
 * @returns the store handle (spec + factory, instantiated by the framework).
 */
export function createPetStore(): EngineStoreHandle<PetOverlayState, PetOverlayActions> {
  return defineStore({
    init: (): PetOverlayState => ({
      selectedPetId: null,
      right: DEFAULT_RIGHT,
      bottom: DEFAULT_BOTTOM,
      pickerOpen: false,
      bubbleDismissedKey: null,
    }),
    persist: 'dsh-ui-pet',
    actions: {
      selectPet: (d, id) => { d.selectedPetId = id },
      setPosition: (d, right, bottom) => {
        d.right = Math.max(0, Math.round(right))
        d.bottom = Math.max(0, Math.round(bottom))
      },
      setPickerOpen: (d, open) => { d.pickerOpen = open },
      dismissBubble: (d, key) => { d.bubbleDismissedKey = key },
    },
  })
}
