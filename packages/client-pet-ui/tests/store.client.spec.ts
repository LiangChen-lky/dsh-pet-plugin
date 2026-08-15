// @vitest-environment jsdom
/**
 * Pet overlay store: action semantics plus framework-run persistence
 * (a fresh instance seeds from the persisted value).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPetStore } from '../src/client/store.ts'

beforeEach(() => {
  window.localStorage.clear()
})

describe('createPetStore', () => {
  it('seeds the contract defaults', () => {
    const snapshot = createPetStore().create().getSnapshot()
    expect(snapshot).toEqual({
      selectedPetId: null,
      right: 24,
      bottom: 24,
      pickerOpen: false,
      bubbleDismissedKey: null,
    })
  })

  it('writes through the declared actions only', () => {
    const instance = createPetStore().create()
    instance.actions.selectPet('takagi')
    instance.actions.setPickerOpen(true)
    instance.actions.dismissBubble('waiting:approval')
    const snapshot = instance.getSnapshot()
    expect(snapshot.selectedPetId).toBe('takagi')
    expect(snapshot.pickerOpen).toBe(true)
    expect(snapshot.bubbleDismissedKey).toBe('waiting:approval')
  })

  it('clamps and rounds the settled position', () => {
    const instance = createPetStore().create()
    instance.actions.setPosition(-5, 12.6)
    expect(instance.getSnapshot().right).toBe(0)
    expect(instance.getSnapshot().bottom).toBe(13)
  })

  it('persists across instances (root-scope persist key)', () => {
    const first = createPetStore().create()
    first.actions.selectPet('rikka')
    first.actions.setPosition(40, 60)
    const second = createPetStore().create()
    expect(second.getSnapshot().selectedPetId).toBe('rikka')
    expect(second.getSnapshot().right).toBe(40)
    expect(second.getSnapshot().bottom).toBe(60)
  })
})
