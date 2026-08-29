import { describe, expect, it } from 'vitest'
import {
  cleanPromptOverrides,
  cleanPromptText,
  coercePromptMode,
  mergePromptOverrides,
  PROMPT_KINDS,
  PROMPT_TEXT_CAP,
  type PromptOverrides,
} from './prompts'

// Overrides are a sparse map on purpose: an absent kind is what makes the
// layering work (ticket → project → global default → code default), so the
// difference between "not set" and "set to empty" is the whole contract.

describe('mergePromptOverrides', () => {
  const base: PromptOverrides = { 'standard:local': 'do the thing', merge: 'land them all' }

  it('leaves kinds the patch does not name alone', () => {
    expect(mergePromptOverrides(base, { wayfinder: 'ask around' })).toEqual({
      'standard:local': 'do the thing',
      merge: 'land them all',
      wayfinder: 'ask around',
    })
  })

  it('sets a kind the patch names', () => {
    expect(mergePromptOverrides(base, { 'standard:local': 'do it differently' })['standard:local']).toBe(
      'do it differently',
    )
  })

  it('clears a kind patched with an empty string', () => {
    const next = mergePromptOverrides(base, { 'standard:local': '' })
    expect('standard:local' in next).toBe(false)
    expect(next.merge).toBe('land them all')
  })

  it('clears a kind patched with whitespace only', () => {
    expect('merge' in mergePromptOverrides(base, { merge: '   \n ' })).toBe(false)
  })

  it('drops unknown kinds rather than storing them', () => {
    expect(mergePromptOverrides({}, { 'standard:elsewhere': 'nope', nonsense: 'no' })).toEqual({})
  })

  it('does not mutate what it was given', () => {
    const current: PromptOverrides = { wayfinder: 'ask around' }
    mergePromptOverrides(current, { wayfinder: '', merge: 'land them' })
    expect(current).toEqual({ wayfinder: 'ask around' })
  })

  it('ignores a patch that is not an object', () => {
    expect(mergePromptOverrides(base, 'nope')).toEqual(base)
    expect(mergePromptOverrides(base, null)).toEqual(base)
  })

  it('accepts every kind it publishes', () => {
    const all = Object.fromEntries(PROMPT_KINDS.map((k) => [k, `text for ${k}`]))
    expect(Object.keys(mergePromptOverrides({}, all)).sort()).toEqual([...PROMPT_KINDS].sort())
  })
})

describe('cleanPromptOverrides', () => {
  it('keeps only non-empty known kinds', () => {
    expect(cleanPromptOverrides({ todo: ' grill me ', wayfinder: '', bogus: 'x' })).toEqual({ todo: 'grill me' })
  })

  it('survives a store field that is not an object', () => {
    expect(cleanPromptOverrides(undefined)).toEqual({})
    expect(cleanPromptOverrides('nope')).toEqual({})
  })
})

describe('cleanPromptText', () => {
  it('trims and caps', () => {
    expect(cleanPromptText('  hi  ')).toBe('hi')
    expect(cleanPromptText('x'.repeat(PROMPT_TEXT_CAP + 500))).toHaveLength(PROMPT_TEXT_CAP)
  })

  it('is empty for anything that is not a string', () => {
    expect(cleanPromptText(null)).toBe('')
    expect(cleanPromptText(42)).toBe('')
  })
})

describe('coercePromptMode', () => {
  it('takes only the two live modes', () => {
    expect(coercePromptMode('append')).toBe('append')
    expect(coercePromptMode('replace')).toBe('replace')
    expect(coercePromptMode('')).toBe('')
    expect(coercePromptMode('shout')).toBe('')
    expect(coercePromptMode(undefined)).toBe('')
  })
})
