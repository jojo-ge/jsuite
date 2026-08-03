// The colours the round avatar preview puts behind (and around) a character.
//
// Taken from kraken, so the preview is showing you the real thing rather than a
// mood board:
//
//   - tones          packages/kui/assets/css/tailwind.css   (the `-500` tokens)
//   - CAST_TONES     packages/kui/components/KUI/Content/StoryAsset/utils/
//                      characterColors.ts  (`CharacterAssignedColor`)
//   - PROFILE_TONES  apps/phoenix/nuxt/constants/avatarCatalog.ts (`AVATAR_COLORS`)
//
// Worth knowing, because it is easy to assume otherwise: a story-asset
// character is NOT on a coloured circle in Phoenix. The circle is `bg-white`
// and the colour is the *ring* plus the matching name-tag pill — KUI pairs them
// deliberately ("the avatar border and the pill background always share a tone,
// so they're paired here and can never drift"). The only place Phoenix fills
// the circle is the user's own profile avatar, which has its own 7-colour set.
// Both treatments are here; `story` is the one the cast list actually uses.
//
// This is a preview concern, not a rig one — the document owns the drawing, the
// skin owns its colours, and what sits behind a cut-out belongs to whatever
// product is showing it. Pointing the preview at a different product is an edit
// to this file, not a schema version.

export type ToneId =
  | 'lime' | 'yellow' | 'blue' | 'coral' | 'purple' | 'orange' | 'pink';

export const TONES: Record<ToneId, string> = {
  lime: '#c4ff57',
  yellow: '#fffa5f',
  blue: '#98ebff',
  coral: '#ff8793',
  purple: '#a89cff',
  orange: '#ffac38',
  pink: '#ffbaf5',
};

/** What a story-asset circle is filled with. `off-white-500`. */
export const STORY_FILL = '#f3f4f0';

/** Cast colours, assigned round-robin by cast index. Lime is the narrator's. */
export const CAST_TONES: ToneId[] = ['yellow', 'blue', 'coral', 'purple'];
export const NARRATOR_TONE: ToneId = 'lime';

/** The profile-avatar set — the one place a Phoenix circle is actually filled. */
export const PROFILE_TONES: ToneId[] = ['lime', 'orange', 'pink', 'blue', 'purple', 'coral', 'yellow'];

/** `story` = white circle, coloured ring (Phoenix's cast list). `filled` = colour behind. */
export type AvatarTreatment = 'story' | 'filled';

export interface AvatarLook {
  tone: ToneId;
  /** Behind the character. */
  background: string;
  /** Around the circle, and the tone the name pill would take. */
  ring: string;
}

export const lookFor = (tone: ToneId, treatment: AvatarTreatment): AvatarLook => ({
  tone,
  background: treatment === 'filled' ? TONES[tone] : STORY_FILL,
  ring: TONES[tone],
});

/**
 * A stable tone per character. Phoenix assigns by cast index, which jRig has no
 * equivalent of — a gallery has no running order — so it hashes the document id
 * instead. Stable is the property that matters: a character keeps its colour, so
 * a screenshot diff is about the drawing and not about who loaded first.
 */
export const toneFor = (id: string, palette: ToneId[] = CAST_TONES): ToneId => {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 100003;
  }
  return palette[hash % palette.length]!;
};
