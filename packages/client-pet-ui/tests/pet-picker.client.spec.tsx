// @vitest-environment jsdom
/**
 * PetPicker presentation: grid with selection mark, empty hint, and the
 * select/close callbacks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { PetPicker, type PetPickerProps } from '../src/client/PetPicker.tsx'
import type { PetCatalogEntry } from '../src/client/contract/types.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

/** 目录条目夹具。 */
function pet(id: string): PetCatalogEntry {
  return {
    id,
    displayName: 'Pet ' + id,
    description: '',
    spriteUrl: '/pet-assets/sprites/' + id + '/spritesheet.webp',
    spriteVersion: 1,
    frame: { width: 192, height: 208, columns: 8, rows: 9 },
    animations: {},
    mtimeMs: 7,
  }
}

/** 固定类名桩。 */
function classes(): PetPickerProps['classes'] {
  return {
    root: 'root', title: 'title', close: 'close', grid: 'grid', option: 'option',
    optionSelected: 'optionSelected', preview: 'preview', name: 'name', empty: 'empty',
  }
}

describe('PetPicker', () => {
  it('lists the catalog with the current selection marked', () => {
    const view = render(<PetPicker
      pets={[pet('a'), pet('b')]}
      selectedId="b"
      onSelect={() => {}}
      onClose={() => {}}
      t={t}
      classes={classes()}
    />)
    expect(view.getByRole('button', { name: /Pet a/ }).getAttribute('aria-pressed')).toBe('false')
    expect(view.getByRole('button', { name: /Pet b/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('renders the empty hint without a grid', () => {
    const view = render(<PetPicker pets={[]} selectedId="" onSelect={() => {}} onClose={() => {}} t={t} classes={classes()} />)
    expect(view.getByText('宠物目录是空的')).toBeDefined()
  })

  it('forwards select and close', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const view = render(<PetPicker pets={[pet('a')]} selectedId="" onSelect={onSelect} onClose={onClose} t={t} classes={classes()} />)
    fireEvent.click(view.getByRole('button', { name: /Pet a/ }))
    expect(onSelect).toHaveBeenCalledWith('a')
    fireEvent.click(view.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalled()
  })
})
