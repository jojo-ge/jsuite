import { describe, expect, it } from 'vitest'
import { defaultTicketType, isLegacyTicket, normalizeTicketKind } from './ticketTypes'

describe('normalizeTicketKind', () => {
  it('keeps a real type and adds the default afk tag', () => {
    expect(normalizeTicketKind({ type: 'bug', labels: ['ui'] }, 'task')).toEqual({ type: 'bug', labels: ['afk', 'ui'] })
  })

  it('turns a legacy HITL type into the hitl tag and takes the fallback type', () => {
    expect(normalizeTicketKind({ type: 'HITL', labels: [] }, 'decision')).toEqual({ type: 'decision', labels: ['hitl'] })
    expect(normalizeTicketKind({ type: 'AFK', labels: [] }, 'task')).toEqual({ type: 'task', labels: ['afk'] })
  })

  it('folds each legacy wayfinder sub-type into a type (and the prototype tag)', () => {
    const fold = (sub: string) => normalizeTicketKind({ type: 'AFK', labels: [`wayfinder:${sub}`] }, 'task')
    expect(fold('research')).toEqual({ type: 'research', labels: ['afk'] })
    expect(fold('prototype')).toEqual({ type: 'research', labels: ['afk', 'prototype'] })
    expect(fold('grilling')).toEqual({ type: 'decision', labels: ['afk'] })
    expect(fold('task')).toEqual({ type: 'task', labels: ['afk'] })
  })

  it('lets an explicit type win over a wayfinder label', () => {
    expect(normalizeTicketKind({ type: 'story', labels: ['wayfinder:grilling'] }, 'task').type).toBe('story')
  })

  it('leaves other wayfinder markers alone', () => {
    expect(normalizeTicketKind({ type: 'task', labels: ['wayfinder:out-of-scope'] }, 'task').labels).toEqual([
      'afk',
      'wayfinder:out-of-scope',
    ])
  })

  it('keeps exactly one agency tag, hitl winning', () => {
    expect(normalizeTicketKind({ type: 'task', labels: ['afk', 'hitl', 'afk'] }, 'task').labels).toEqual(['hitl'])
  })

  it('is idempotent', () => {
    const once = normalizeTicketKind({ type: 'HITL', labels: ['wayfinder:prototype', 'x'] }, 'task')
    expect(normalizeTicketKind(once, 'task')).toEqual(once)
    expect(isLegacyTicket(once)).toBe(false)
  })
})

describe('defaultTicketType', () => {
  it('reads mode labels first, then the project mode', () => {
    expect(defaultTicketType(['arch', 'arch:scan'], 'architect')).toBe('research')
    expect(defaultTicketType(['arch:candidate'], 'architect')).toBe('decision')
    expect(defaultTicketType(['jmap:domain'], null)).toBe('docs')
    expect(defaultTicketType(['review:finding'], 'standard')).toBe('bug')
    expect(defaultTicketType([], 'predeploy')).toBe('bug')
    expect(defaultTicketType([], 'wayfinder')).toBe('task')
  })
})

describe('isLegacyTicket', () => {
  it('flags the pre-types shapes', () => {
    expect(isLegacyTicket({ type: 'AFK', labels: [] })).toBe(true)
    expect(isLegacyTicket({ type: 'task', labels: [] })).toBe(true)
    expect(isLegacyTicket({ type: 'task', labels: ['afk', 'wayfinder:research'] })).toBe(true)
    expect(isLegacyTicket({ type: 'task', labels: ['afk'] })).toBe(false)
  })
})

