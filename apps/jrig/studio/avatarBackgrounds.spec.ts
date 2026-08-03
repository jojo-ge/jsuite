// The preview palette. Mostly data, but two things about it are load-bearing:
// the story treatment must not tint the circle, and a character's tone must not
// move between renders or every avatar screenshot diff is noise.

import { describe, expect, it } from 'vitest';

import {
  CAST_TONES,
  lookFor,
  NARRATOR_TONE,
  PROFILE_TONES,
  STORY_FILL,
  toneFor,
  TONES,
} from './avatarBackgrounds';

describe('avatar backgrounds', () => {
  it('leaves a story-asset circle unfilled and puts the colour on the ring', () => {
    for (const tone of CAST_TONES) {
      const look = lookFor(tone, 'story');
      expect(look.background).toBe(STORY_FILL);
      expect(look.ring).toBe(TONES[tone]);
    }
  });

  it('puts the colour behind the character in the filled treatment', () => {
    for (const tone of PROFILE_TONES) {
      expect(lookFor(tone, 'filled').background).toBe(TONES[tone]);
    }
  });

  it('keeps lime out of the cast rotation — it is the narrator’s', () => {
    expect(CAST_TONES).not.toContain(NARRATOR_TONE);
    expect(TONES[NARRATOR_TONE]).toBeDefined();
  });

  it('gives a character the same tone every time', () => {
    for (const id of ['hoodieGuy', 'house', 'hoodie', 'bodySlab', '']) {
      expect(toneFor(id)).toBe(toneFor(id));
      expect(CAST_TONES).toContain(toneFor(id));
    }
  });

  it('spreads across whichever palette it is handed', () => {
    const ids = Array.from({ length: 60 }, (_, index) => `character${index}`);
    for (const palette of [CAST_TONES, PROFILE_TONES]) {
      const used = new Set(ids.map(id => toneFor(id, palette)));
      expect(used.size).toBe(palette.length);
    }
  });
});
