<script lang="ts" setup>
// A chest-up character rig: a parented skeleton of joints driven by numeric
// channels, evaluated every frame in JS. Not a set of CSS animations — the
// whole point is that poses come from data, so the editor can author new emotes
// without touching this file, and any future skin plays every existing emote.
//
// Layering, evaluated in order (see README.md):
//   rest pose  →  base clip (idle / talking)  →  emote clip × weight  →  ambient
// An emote only overrides the channels it actually keyframes, so an arms-only
// emote keeps the face on the talk loop. That sparseness *is* the layer mask.

import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';

import type { ArmGeometry } from './arm';
import type { ChannelId, Clip, JointFrame, JointId, Pose, Skin } from './core';
import type { ArtStyle, StyleGradient, StyleLayer, StylePattern } from './styles';

import { armGeometry } from './arm';
import { BUILT_IN_CLIPS } from './clips';
import {
  applyPose,
  computeJointFrames,
  createRestPose,
  DEFAULT_SKIN,
  eyeLidInk,
  eyePath,
  JOINTS_BY_ID,
  jointTransform,
  mouthPath,
  sampleClip,
  SKELETON,
  withArmsAt,
} from './core';
import { DEFAULT_ART_STYLE } from './styles';

interface Props {
  /**
   * The drawing. Every style binds to the same channels, so all emotes work.
   * Named `art` rather than `style` because Vue reserves `style` for the inline
   * style attribute and would never deliver it as a prop.
   */
  art?: ArtStyle;
  /** Colour set. Orthogonal to the style: any skin recolours any art. */
  skin?: Skin;
  /** Clip library. Defaults to the built-ins; the editor passes its own. */
  clips?: Clip[];
  /** Steady-state loop underneath any emote. */
  base?: 'idle' | 'talking' | null;
  /** Manual pose override — the editor drives the rig through this. */
  pose?: Partial<Pose> | null;
  poseMode?: 'auto' | 'manual';
  /** Breathing, sway and autonomous blinking, on top of whatever is playing. */
  ambient?: boolean;
  /** `bust` crops to the portrait; `rig` pulls back so the arms stay in frame. */
  frame?: 'bust' | 'rig';
  /** Draws bones, pivots and drag targets over the art. */
  showRig?: boolean;
  /** Highlighted joint in the rig overlay. */
  selectedJoint?: JointId | null;
  speed?: number;
  name?: string;
}

const props = withDefaults(defineProps<Props>(), {
  art: () => DEFAULT_ART_STYLE,
  skin: () => DEFAULT_SKIN,
  clips: () => BUILT_IN_CLIPS,
  base: 'idle',
  pose: null,
  poseMode: 'auto',
  ambient: true,
  frame: 'bust',
  showRig: false,
  selectedJoint: null,
  speed: 1,
  name: 'Character',
});

const emit = defineEmits<{
  emoteStart: [clipId: string];
  emoteEnd: [clipId: string];
  jointPointerDown: [jointId: JointId, event: PointerEvent];
}>();

const FADE_IN_S = 0.12;
const FADE_OUT_S = 0.22;
const BLINK_S = 0.16;
const BLINK_CLOSE_FRACTION = 0.35;

const clipsById = computed(() => new Map(props.clips.map(clip => [clip.id, clip])));

const livePose = shallowRef<Pose>(createRestPose());
// Free-running clock for effects that should keep moving through a long hold.
const fxClock = shallowRef(0);

// --- playback state -------------------------------------------------------
let baseTime = 0;
let emoteClip: Clip | null = null;
let emoteTime = 0;
let emoteWeight = 0;
let emoteReleasing = false;
let ambientTime = 0;
let nextBlinkAt = 3;
let blinkStartedAt = -1;
let rafId: number | null = null;
let lastFrameAt = 0;
let reducedMotion = false;

const scheduleBlink = (from: number) => {
  nextBlinkAt = from + 2.2 + Math.random() * 3.4;
};

const play = (clipId: string) => {
  const clip = clipsById.value.get(clipId);
  if (!clip) {
    return;
  }
  emoteClip = clip;
  emoteTime = 0;
  emoteReleasing = false;
  // Retriggering mid-emote keeps the current weight so the blend never pops.
  emit('emoteStart', clip.id);
};

const stop = () => {
  if (emoteClip) {
    emoteReleasing = true;
  }
};

// --- ambient layer --------------------------------------------------------
// Applied last so the character is never completely still, whatever is playing.
// Additive rather than absolute, so it survives any pose the editor produces.
const applyAmbient = (pose: Pose, t: number) => {
  const breath = Math.sin((t / 4.4) * Math.PI * 2);
  pose['chest.sy'] = (pose['chest.sy'] ?? 1) + breath * 0.012;
  pose['chest.y'] = (pose['chest.y'] ?? 0) + breath * 1.2;
  pose['root.x'] = (pose['root.x'] ?? 0) + Math.sin(t * 0.37) * 1.2 + Math.sin(t * 0.23) * 0.8;
  pose['root.rot'] = (pose['root.rot'] ?? 0) + Math.sin(t * 0.29) * 0.35;

  if (t >= nextBlinkAt && blinkStartedAt < 0) {
    blinkStartedAt = t;
  }
  if (blinkStartedAt >= 0) {
    const progress = (t - blinkStartedAt) / BLINK_S;
    if (progress >= 1) {
      blinkStartedAt = -1;
      scheduleBlink(t);
    }
    else {
      // Lids snap shut and drift back open — a symmetric curve reads mechanical.
      const shape = progress < BLINK_CLOSE_FRACTION
        ? progress / BLINK_CLOSE_FRACTION
        : 1 - (progress - BLINK_CLOSE_FRACTION) / (1 - BLINK_CLOSE_FRACTION);
      // Multiplicative, so a blink reads over a squint or a wide-eyed pose
      // without ever fighting the clip that authored it.
      const lid = 1 - Math.sin(shape * (Math.PI / 2)) * 0.96;
      const openL = pose['face.eyeOpenL'] ?? 1;
      const openR = pose['face.eyeOpenR'] ?? 1;
      if (openL > 0.25) {
        pose['face.eyeOpenL'] = openL * lid;
      }
      if (openR > 0.25) {
        pose['face.eyeOpenR'] = openR * lid;
      }
    }
  }
};

const evaluate = (dt: number) => {
  const pose = createRestPose();

  if (props.poseMode === 'manual') {
    if (props.pose) {
      applyPose(pose, props.pose);
    }
  }
  else {
    baseTime += dt;
    const baseClip = props.base ? clipsById.value.get(props.base) : null;
    if (baseClip) {
      applyPose(pose, sampleClip(baseClip, reducedMotion ? 0 : baseTime));
    }

    if (emoteClip) {
      emoteTime += dt;
      const remaining = emoteClip.duration - emoteTime;
      if (emoteReleasing || (!emoteClip.loop && remaining <= FADE_OUT_S)) {
        emoteWeight = Math.max(0, emoteWeight - dt / FADE_OUT_S);
      }
      else {
        emoteWeight = Math.min(1, emoteWeight + dt / FADE_IN_S);
      }
      applyPose(pose, sampleClip(emoteClip, emoteTime), emoteWeight);
      if (emoteWeight <= 0 && (emoteReleasing || emoteTime >= emoteClip.duration)) {
        const finished = emoteClip.id;
        emoteClip = null;
        emoteReleasing = false;
        emit('emoteEnd', finished);
      }
    }
  }

  ambientTime += dt;
  if (props.ambient && !reducedMotion) {
    applyAmbient(pose, ambientTime);
  }

  fxClock.value = ambientTime;
  livePose.value = pose;
};

const tick = (now: number) => {
  const dt = Math.min((now - lastFrameAt) / 1000, 0.05) * props.speed;
  lastFrameAt = now;
  evaluate(dt);
  rafId = requestAnimationFrame(tick);
};

// In manual mode with ambient off there is nothing to animate, so re-evaluate
// only when the incoming pose changes rather than burning a frame loop.
const isStatic = computed(() => props.poseMode === 'manual' && (!props.ambient || reducedMotion));

watch(
  () => [props.pose, props.poseMode] as const,
  () => {
    if (isStatic.value) {
      evaluate(0);
    }
  },
  { deep: true, immediate: false },
);

onMounted(() => {
  reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  scheduleBlink(0);
  evaluate(0);
  if (!isStatic.value) {
    lastFrameAt = performance.now();
    rafId = requestAnimationFrame(tick);
  }
});

watch(isStatic, (nowStatic) => {
  if (nowStatic && rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
    evaluate(0);
    return;
  }
  if (!nowStatic && rafId === null) {
    lastFrameAt = performance.now();
    rafId = requestAnimationFrame(tick);
  }
});

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
});

// --- derived geometry -----------------------------------------------------
const pose = computed(() => livePose.value);

const transforms = computed(() => Object.fromEntries(
  SKELETON.map(joint => [joint.id, jointTransform(joint, pose.value)]),
) as Record<JointId, string>);

const value = (channel: ChannelId) => pose.value[channel] ?? 0;

const uid = useId();
const armLId = `rig-arm-l-${uid}`;
const armRId = `rig-arm-r-${uid}`;

const art = computed(() => props.art);
const face = computed(() => art.value.face);

const mouthD = computed(() => mouthPath(pose.value, face.value));
const eyeLD = computed(() => eyePath(pose.value, 'l', face.value));
const eyeRD = computed(() => eyePath(pose.value, 'r', face.value));

// The open eye (white disc, no outline) and the shut eye (a drawn lid line)
// crossfade across the same path — see `eyeLidInk`.
const lidInk = computed(() => ({
  l: eyeLidInk(pose.value, 'l'),
  r: eyeLidInk(pose.value, 'r'),
}));

const pupilOffset = computed(() => ({
  x: value('face.pupilX') * art.value.pupil.range.x,
  y: value('face.pupilY') * art.value.pupil.range.y,
}));

const armFront = computed(() => ({
  l: value('armL.front') >= 0.5,
  r: value('armR.front') >= 0.5,
}));

// Procedural limbs. The geometry comes out in chest space, so these paths drop
// into the same group the stroked bones used to live in — depth ordering, the
// shirt clip and the arm shadow all keep working untouched.
const armRig = computed(() => art.value.arm.rig ?? null);

/**
 * The skeleton this drawing hangs off. A style may place its arms (see
 * `arm.shoulder` / `arm.pull`), and every consumer of a pivot has to agree on
 * where they ended up — the limb geometry *and* the editor's drag handles, or
 * the handles float beside the arm they are supposed to be holding.
 */
const skeleton = computed(() => {
  const { shoulder = null, pull = 0 } = art.value.arm;
  return shoulder || pull ? withArmsAt({ shoulder, pull }) : JOINTS_BY_ID;
});

/** Every joint's pivot and rotation in view-box space, for the editor's handles. */
const frames = (): Record<JointId, JointFrame> =>
  computeJointFrames({ pose: livePose.value, joints: skeleton.value });

defineExpose({ play, stop, frames, pose: livePose });

const armInstances = computed(() => {
  const rig = armRig.value;
  if (!rig) {
    return [];
  }
  const shoulder = art.value.arm.shoulder ?? null;
  const pull = art.value.arm.pull ?? 0;
  return [
    { side: 'l' as const, id: armLId, geometry: armGeometry({ pose: pose.value, side: 'l', rig, shoulder, pull }) },
    { side: 'r' as const, id: armRId, geometry: armGeometry({ pose: pose.value, side: 'r', rig, shoulder, pull }) },
  ];
});

/** Every shape in a limb, for the mask and the shading overlay. */
const limbShapes = (geometry: ArmGeometry) => geometry.groups.flat();

// Tears run down the cheek from wherever this style put the eye, on their own
// clock so a long hold keeps dripping instead of freezing a droplet mid-cheek.
const tearDrop = computed(() => (fxClock.value * 46) % 64);
const tearOrigin = computed(() => ({
  x: face.value.eye.l.cx - 15,
  y: face.value.eye.l.cy + 28,
}));

const overlayFrames = computed(() =>
  (props.showRig ? computeJointFrames({ pose: pose.value, joints: skeleton.value }) : null));

// `rough` is a displacement filter defined below — the only way to get a line
// that wobbles like a drawn one out of paths that are mathematically perfect.
const svgFilter = computed(() => [
  art.value.rough ? `url(#rough-${uid})` : null,
  art.value.filter ?? null,
].filter(Boolean).join(' '));

// Skin first, style over the top. Most styles only add colours the skin doesn't
// know about (a cap, a hood lining, a hair mass), so the skin still drives them.
// A style that pins a colour outright is overriding on purpose: Neon and Riso
// *are* their palettes, and a skin recolouring them would just be a bug.
const skinStyle = computed(() => ({
  ...props.skin.colours,
  ...art.value.palette,
  '--ink-silhouette': `${art.value.ink.silhouette}px`,
  '--ink-feature': `${art.value.ink.feature}px`,
  '--ink-detail': `${art.value.ink.detail}px`,
  '--arm-edge': `${art.value.arm.edgeWidth}px`,
  '--arm-fill': `${art.value.arm.fillWidth}px`,
  // Doubled: the ink pass strokes the silhouette itself, so half the width falls
  // inside the shape and is painted over by the fill.
  '--limb-ink': `${(armRig.value?.ink ?? 0) * 2}px`,
  '--sleeve-width': `${art.value.arm.sleeve?.width ?? 0}px`,
  '--limb-upper': art.value.arm.upperFill === 'shirt' ? 'var(--rig-shirt)' : 'var(--rig-skin)',
  '--limb-lower': art.value.arm.lowerFill === 'shirt' ? 'var(--rig-shirt)' : 'var(--rig-skin)',
  // Round caps keep a joint gap-free at any rotation; a square cap does the same
  // while letting a hard-edged style stay hard-edged.
  '--limb-cap': art.value.arm.cap ?? 'round',
  ...(svgFilter.value ? { filter: svgFilter.value } : {}),
}));

// Gradient ids have to be unique per instance, so a style names them plainly
// (`url(#skinLight)`) and every reference is rewritten to this rig's copy.
const scopeUrl = (paint?: string) => paint?.replace(/url\(#([\w-]+)\)/g, `url(#$1-${uid})`);

// A sleeve painted flat while the shirt carries a gradient reads as a patch
// stuck on the shoulder, so a shaded style hands the sleeve the same paint.
const sleevePaint = computed(() => scopeUrl(art.value.shading?.sleeve));

const gradients = computed<StyleGradient[]>(() => art.value.shading?.gradients ?? []);
const patterns = computed<StylePattern[]>(() => art.value.shading?.patterns ?? []);

// Free-form style art (caps, hoods, zips, shadows) carries its own paint,
// falling back to the style's interior ink weight.
const layerStyle = (layer: StyleLayer) => ({
  fill: scopeUrl(layer.fill) ?? 'none',
  stroke: scopeUrl(layer.stroke) ?? 'none',
  strokeWidth: `${layer.width ?? art.value.ink.detail}px`,
  ...(layer.opacity === undefined ? {} : { opacity: layer.opacity }),
  ...(layer.filter ? { filter: layer.filter } : {}),
});

// Cast shadows are filters on the *group*, so they follow the pose: a raised
// arm's shadow travels up the chest with the arm, which no painted-on shape can.
const castHead = computed(() => art.value.shading?.cast?.head);
const headShadow = computed(() => art.value.shading?.headShadow);
const armShadow = computed(() => art.value.shading?.armShadow);
const castArms = computed(() => art.value.shading?.cast?.arms);
const limbShade = computed(() => art.value.shading?.limb);

// Left-side art authored once, reflected for the right. Reflection is applied
// inside the joint group, so only the *drawing* mirrors — a joint's rotation
// still means what the clips say it means.
const MIRROR = 'translate(400 0) scale(-1 1)';

// The bones themselves are the skeleton's, not the style's: a style may change
// how thick an arm is drawn, never where it is.
const LIMBS = {
  upperL: 'M 122 312 L 100 396',
  upperR: 'M 278 312 L 300 396',
  lowerL: 'M 100 396 L 90 484',
  lowerR: 'M 300 396 L 310 484',
} as const;

const mirroredLayers = (layers?: StyleLayer[]) => (layers ?? []).filter(layer => layer.mirrored);
</script>

<template>
  <svg
    class="rig"
    :class="{ 'rig--overlay': showRig }"
    :style="skinStyle"
    :viewBox="art.viewBox[frame]"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="name"
  >
    <defs>
      <filter
        v-if="art.rough"
        :id="`rough-${uid}`"
        x="-15%"
        y="-15%"
        width="130%"
        height="130%"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.028"
          numOctaves="3"
          seed="9"
          result="noise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="9"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
      <linearGradient
        v-for="gradient in gradients.filter(g => g.kind === 'linear')"
        :id="`${gradient.id}-${uid}`"
        :key="gradient.id"
        gradientUnits="userSpaceOnUse"
        :x1="gradient.from.x"
        :y1="gradient.from.y"
        :x2="gradient.to?.x ?? gradient.from.x"
        :y2="gradient.to?.y ?? gradient.from.y"
      >
        <stop
          v-for="(step, i) in gradient.stops"
          :key="i"
          :offset="step.at"
          :stop-color="step.colour"
          :stop-opacity="step.opacity ?? 1"
        />
      </linearGradient>
      <radialGradient
        v-for="gradient in gradients.filter(g => g.kind === 'radial')"
        :id="`${gradient.id}-${uid}`"
        :key="`r-${gradient.id}`"
        gradientUnits="userSpaceOnUse"
        :cx="gradient.from.x"
        :cy="gradient.from.y"
        :r="gradient.r ?? 100"
      >
        <stop
          v-for="(step, i) in gradient.stops"
          :key="i"
          :offset="step.at"
          :stop-color="step.colour"
          :stop-opacity="step.opacity ?? 1"
        />
      </radialGradient>

      <pattern
        v-for="pattern in patterns"
        :id="`${pattern.id}-${uid}`"
        :key="pattern.id"
        patternUnits="userSpaceOnUse"
        :width="pattern.size"
        :height="pattern.size"
        :patternTransform="`rotate(${pattern.angle ?? 0})`"
      >
        <circle
          v-if="pattern.kind === 'dots'"
          :cx="pattern.size / 2"
          :cy="pattern.size / 2"
          :r="pattern.weight"
          :fill="pattern.colour"
          :fill-opacity="pattern.opacity ?? 1"
        />
        <line
          v-else
          x1="0"
          :y1="pattern.size / 2"
          :x2="pattern.size"
          :y2="pattern.size / 2"
          :stroke="pattern.colour"
          :stroke-width="pattern.weight"
          :stroke-opacity="pattern.opacity ?? 1"
        />
      </pattern>

      <!-- Shading is clipped to the mass it sits on: a shadow that spills past
           the silhouette stops reading as shadow immediately. -->
      <clipPath :id="`head-clip-${uid}`"><path :d="art.head.path" /></clipPath>
      <clipPath :id="`shirt-clip-${uid}`"><path :d="art.torso.shirt" /></clipPath>

      <clipPath :id="`eye-l-${uid}`"><path :d="eyeLD" /></clipPath>
      <clipPath :id="`eye-r-${uid}`"><path :d="eyeRD" /></clipPath>
      <clipPath :id="`mouth-${uid}`"><path :d="mouthD" /></clipPath>

      <!-- Procedural arms: one tapered silhouette per limb rather than a stack
           of stroked bones. Every shape in a group is inked *first* and filled
           *second*, so the only line that survives is the outside of the union —
           which is the entire trick. An elbow becomes a bend in one outline
           instead of two capsules butted together, and the fingers can overlap
           the palm without drawing a seam where they meet it. -->
      <template v-if="armRig">
        <!-- Shows the limb and hides the palm. A digit is a closed tube, so its
             root cap would otherwise draw an arc across the middle of the palm,
             and the hand would read as a bundle of sticks. It also stops a soft
             separation running along the silhouette and lightening the outline
             it sits on. -->
        <mask
          v-for="arm in armInstances"
          :id="`limb-mask-${arm.side}-${uid}`"
          :key="`mask-${arm.side}`"
        >
          <path
            v-for="(shape, i) in limbShapes(arm.geometry)"
            :key="i"
            fill="#fff"
            :d="shape"
          />
          <path fill="#000" :d="arm.geometry.palm" />
        </mask>
        <g
          v-for="arm in armInstances"
          :id="arm.id"
          :key="arm.side"
        >
          <template v-for="(group, g) in arm.geometry.groups" :key="`g-${g}`">
            <g v-if="armRig.ink > 0" class="limb-ink">
              <path
                v-for="(shape, i) in group"
                :key="i"
                :d="shape"
              />
            </g>
            <g class="limb-fill">
              <path
                v-for="(shape, i) in group"
                :key="i"
                :d="shape"
              />
            </g>
          </template>

          <g v-if="limbShade" class="limb-tone">
            <path
              v-for="(shape, i) in limbShapes(arm.geometry)"
              :key="i"
              :d="shape"
              :style="{ fill: scopeUrl(limbShade.stroke) }"
            />
          </g>

          <!-- Painted on, never outlined: the sleeve is a change of material on
               the same limb, not another mass bolted to it. The shading paint is
               a *second* pass over the shirt colour, because it is a translucent
               tone — used as the fill it would tint the bare arm instead of
               covering it, and the sleeve would read as a smudge on the bicep. -->
          <template v-if="arm.geometry.sleeve">
            <path class="limb-sleeve" :d="arm.geometry.sleeve" />
            <path
              v-if="sleevePaint"
              :d="arm.geometry.sleeve"
              :style="{ fill: sleevePaint }"
            />
          </template>

          <g :mask="`url(#limb-mask-${arm.side}-${uid})`">
            <path
              v-for="(line, i) in arm.geometry.lines"
              :key="`line-${i}`"
              class="limb-line"
              :class="`limb-line--${armRig.creases}`"
              :d="line.d"
            />
          </g>

          <path
            v-if="arm.geometry.hem"
            class="limb-hem"
            :d="arm.geometry.hem"
          />
        </g>
      </template>

      <!-- Arms are authored once and instanced twice, so the same bone chain can
           draw behind the body or in front of the face depending on armX.front. -->
      <!-- Each segment draws a dark edge under its fill, parent before child, so
           an arm crossing the face still reads instead of melting into the skin.
           The overlap at each joint becomes an elbow or wrist crease. -->
      <!-- A short sleeve is a wider capsule of shirt colour laid over the top of
           the bare arm. Round caps are load-bearing — they keep a joint gap-free
           at any rotation the rig can reach.
           The sleeve is filled but *not* outlined, and a separate open path inks
           only its outer seam and hem. A closed outline would ring the shoulder
           in black inside the shirt and read as a shoulder pad; the shirt's own
           silhouette is what should carry the shoulder, and the sleeve only has
           to say where it ends.
           A style with full sleeves (`sleeve: null`) instead fills the whole
           bone in shirt colour and inks a cuff where it ends. -->
      <g v-if="!armRig" :id="armLId">
        <g :transform="transforms.armLUp">
          <path class="limb-edge" :d="LIMBS.upperL" />
          <path class="limb limb--upper" :d="LIMBS.upperL" />
          <path
            v-if="limbShade"
            class="limb-shade"
            :d="LIMBS.upperL"
            :style="{ stroke: scopeUrl(limbShade.stroke), strokeWidth: `${limbShade.width}px` }"
          />
          <template v-if="art.arm.sleeve">
            <path class="sleeve" :d="art.arm.sleeve.d" />
            <path class="sleeve-seam" :d="art.arm.sleeve.seam" />
          </template>
          <g :transform="transforms.armLLow">
            <path class="limb-edge" :d="LIMBS.lowerL" />
            <path class="limb limb--lower" :d="LIMBS.lowerL" />
            <path
              v-if="limbShade"
              class="limb-shade"
              :d="LIMBS.lowerL"
              :style="{ stroke: scopeUrl(limbShade.stroke), strokeWidth: `${limbShade.width}px` }"
            />
            <g :transform="transforms.armLHand">
              <path class="hand-edge" :d="art.arm.hand" />
              <path class="hand" :d="art.arm.hand" />
              <path
                v-if="art.arm.cuff"
                class="cuff"
                :d="art.arm.cuff"
              />
              <path
                v-if="art.arm.crease"
                class="crease"
                :d="art.arm.crease"
              />
            </g>
          </g>
        </g>
      </g>
      <!-- The right arm is the same art reflected about x=200; only the bones,
           which the skeleton owns, are authored per side. -->
      <g v-if="!armRig" :id="armRId">
        <g :transform="transforms.armRUp">
          <path class="limb-edge" :d="LIMBS.upperR" />
          <path class="limb limb--upper" :d="LIMBS.upperR" />
          <path
            v-if="limbShade"
            class="limb-shade"
            :d="LIMBS.upperR"
            :style="{ stroke: scopeUrl(limbShade.stroke), strokeWidth: `${limbShade.width}px` }"
          />
          <g v-if="art.arm.sleeve" :transform="MIRROR">
            <path class="sleeve" :d="art.arm.sleeve.d" />
            <path class="sleeve-seam" :d="art.arm.sleeve.seam" />
          </g>
          <g :transform="transforms.armRLow">
            <path class="limb-edge" :d="LIMBS.lowerR" />
            <path class="limb limb--lower" :d="LIMBS.lowerR" />
            <path
              v-if="limbShade"
              class="limb-shade"
              :d="LIMBS.lowerR"
              :style="{ stroke: scopeUrl(limbShade.stroke), strokeWidth: `${limbShade.width}px` }"
            />
            <g :transform="transforms.armRHand">
              <g :transform="MIRROR">
                <path class="hand-edge" :d="art.arm.hand" />
                <path class="hand" :d="art.arm.hand" />
                <path
                  v-if="art.arm.cuff"
                  class="cuff"
                  :d="art.arm.cuff"
                />
                <path
                  v-if="art.arm.crease"
                  class="crease"
                  :d="art.arm.crease"
                />
              </g>
            </g>
          </g>
        </g>
      </g>
    </defs>

    <g :transform="transforms.root">
      <g :transform="transforms.torso">
        <g :transform="transforms.chest">
          <use v-show="!armFront.l" :href="`#${armLId}`" />
          <use v-show="!armFront.r" :href="`#${armRId}`" />

          <!-- Outlined, but only its two sides ever show: the head caps it and
               the neckline covers its foot. Styles with no neck at all sit the
               head straight on the shoulders. -->
          <rect
            v-if="art.torso.neck"
            class="neck"
            :x="art.torso.neck.x"
            :y="art.torso.neck.y"
            :width="art.torso.neck.width"
            :height="art.torso.neck.height"
            :rx="art.torso.neck.rx"
          />

          <!-- Behind the shirt: a mis-registered spot-colour plate, a shadow. -->
          <path
            v-for="(layer, i) in art.torso.behind"
            :key="`behind-torso-${i}`"
            class="layer"
            :d="layer.d"
            :style="layerStyle(layer)"
          />

          <path class="shirt" :d="art.torso.shirt" />
          <!-- Exactly one shade tone per material: a hem band, nothing else. A
               second tone starts reading as rendering, and the style is flat
               fills inside one ink line. Inset from the outline so it tints the
               fill without eating into the stroke. -->
          <path
            v-if="art.torso.shade"
            class="shirt-shade"
            :d="art.torso.shade"
          />

          <g v-if="art.shading?.shirt" :clip-path="`url(#shirt-clip-${uid})`">
            <path
              v-for="(layer, i) in art.shading.shirt"
              :key="`shirt-shade-${i}`"
              class="layer"
              :d="layer.d"
              :style="layerStyle(layer)"
            />
            <g :transform="MIRROR">
              <path
                v-for="(layer, i) in mirroredLayers(art.shading.shirt)"
                :key="`shirt-shade-m-${i}`"
                class="layer"
                :d="layer.d"
                :style="layerStyle(layer)"
              />
            </g>
          </g>

          <!-- Garment detail — hood, zip, pockets. Under the head, so the jaw
               crops a collar instead of the collar cutting the chin. -->
          <path
            v-for="(layer, i) in art.torso.detail"
            :key="`torso-${i}`"
            class="layer"
            :d="layer.d"
            :style="layerStyle(layer)"
          />
          <g :transform="MIRROR">
            <path
              v-for="(layer, i) in mirroredLayers(art.torso.detail)"
              :key="`torso-m-${i}`"
              class="layer"
              :d="layer.d"
              :style="layerStyle(layer)"
            />
          </g>

          <!-- The arms' shadow on the body: the same chain instanced again,
               knocked to black by `brightness(0)`, offset and clipped. It costs
               one more <use> and it is the only version of this that can't leak
               onto the page behind him. -->
          <g
            v-if="armShadow"
            :clip-path="`url(#shirt-clip-${uid})`"
            :style="{
              opacity: armShadow.opacity,
              filter: `brightness(0)${armShadow.blur ? ` blur(${armShadow.blur}px)` : ''}`,
            }"
          >
            <use :href="`#${armLId}`" :transform="`translate(${armShadow.dx} ${armShadow.dy})`" />
            <use :href="`#${armRId}`" :transform="`translate(${armShadow.dx} ${armShadow.dy})`" />
          </g>

          <!-- The head's shadow on the chest. Inside the transform tree, so it
               tracks every tilt, and clipped to the shirt, so it can only ever
               fall on the body — which is the difference between a shadow and a
               filter that has no idea what is behind him. -->
          <g v-if="headShadow" :clip-path="`url(#shirt-clip-${uid})`">
            <g :transform="transforms.neck">
              <g :transform="transforms.head">
                <g
                  :transform="`translate(${headShadow.dx} ${headShadow.dy})`"
                  :style="{
                    opacity: headShadow.opacity,
                    filter: headShadow.blur ? `blur(${headShadow.blur}px)` : undefined,
                  }"
                >
                  <rect
                    v-if="art.torso.neck"
                    class="cast-shape"
                    :x="art.torso.neck.x"
                    :y="art.torso.neck.y"
                    :width="art.torso.neck.width"
                    :height="art.torso.neck.height"
                    :rx="art.torso.neck.rx"
                  />
                  <path class="cast-shape" :d="art.head.path" />
                </g>
              </g>
            </g>
          </g>

          <g :transform="transforms.neck" :style="castHead ? { filter: castHead } : undefined">
            <g :transform="transforms.head">
              <path
                v-for="(layer, i) in art.head.behind"
                :key="`behind-${i}`"
                class="layer"
                :d="layer.d"
                :style="layerStyle(layer)"
              />

              <template v-if="art.head.ear">
                <path class="ear" :d="art.head.ear.path" />
                <g :transform="MIRROR"><path class="ear" :d="art.head.ear.path" /></g>
                <template v-if="art.head.ear.fold">
                  <path class="ear-line" :d="art.head.ear.fold" />
                  <g :transform="MIRROR"><path class="ear-line" :d="art.head.ear.fold" /></g>
                </template>
              </template>

              <path class="skin" :d="art.head.path" />

              <g v-if="art.shading?.head" :clip-path="`url(#head-clip-${uid})`">
                <path
                  v-for="(layer, i) in art.shading.head"
                  :key="`head-shade-${i}`"
                  class="layer"
                  :d="layer.d"
                  :style="layerStyle(layer)"
                />
                <g :transform="MIRROR">
                  <path
                    v-for="(layer, i) in mirroredLayers(art.shading.head)"
                    :key="`head-shade-m-${i}`"
                    class="layer"
                    :d="layer.d"
                    :style="layerStyle(layer)"
                  />
                </g>
              </g>

              <template v-if="art.head.blush">
                <ellipse
                  class="blush"
                  :style="{ opacity: value('face.blush') }"
                  :cx="art.head.blush.cx"
                  :cy="art.head.blush.cy"
                  :rx="art.head.blush.rx"
                  :ry="art.head.blush.ry"
                />
                <ellipse
                  class="blush"
                  :style="{ opacity: value('face.blush') }"
                  :cx="400 - art.head.blush.cx"
                  :cy="art.head.blush.cy"
                  :rx="art.head.blush.rx"
                  :ry="art.head.blush.ry"
                />
              </template>

              <g :transform="transforms.eyeL">
                <path class="eye-white" :d="eyeLD" />
                <g :clip-path="`url(#eye-l-${uid})`">
                  <circle
                    v-if="!art.pupil.square"
                    class="pupil"
                    :cx="face.eye.l.cx + pupilOffset.x"
                    :cy="face.eye.l.cy + pupilOffset.y"
                    :r="art.pupil.r"
                  />
                  <rect
                    v-else
                    class="pupil"
                    :x="face.eye.l.cx + pupilOffset.x - art.pupil.r"
                    :y="face.eye.l.cy + pupilOffset.y - art.pupil.r"
                    :width="art.pupil.r * 2"
                    :height="art.pupil.r * 2"
                  />
                  <circle
                    class="glint"
                    :cx="face.eye.l.cx + pupilOffset.x + art.pupil.glintAt.x"
                    :cy="face.eye.l.cy + pupilOffset.y + art.pupil.glintAt.y"
                    :r="art.pupil.glint"
                  />
                </g>
                <path
                  class="eye-lid"
                  :d="eyeLD"
                  :style="{ opacity: lidInk.l }"
                />
              </g>
              <g :transform="transforms.eyeR">
                <path class="eye-white" :d="eyeRD" />
                <g :clip-path="`url(#eye-r-${uid})`">
                  <circle
                    v-if="!art.pupil.square"
                    class="pupil"
                    :cx="face.eye.r.cx + pupilOffset.x"
                    :cy="face.eye.r.cy + pupilOffset.y"
                    :r="art.pupil.r"
                  />
                  <rect
                    v-else
                    class="pupil"
                    :x="face.eye.r.cx + pupilOffset.x - art.pupil.r"
                    :y="face.eye.r.cy + pupilOffset.y - art.pupil.r"
                    :width="art.pupil.r * 2"
                    :height="art.pupil.r * 2"
                  />
                  <circle
                    class="glint"
                    :cx="face.eye.r.cx + pupilOffset.x + art.pupil.glintAt.x"
                    :cy="face.eye.r.cy + pupilOffset.y + art.pupil.glintAt.y"
                    :r="art.pupil.glint"
                  />
                </g>
                <path
                  class="eye-lid"
                  :d="eyeRD"
                  :style="{ opacity: lidInk.r }"
                />
              </g>

              <g class="tears" :style="{ opacity: value('face.tear') }">
                <ellipse
                  class="tear"
                  :cx="tearOrigin.x"
                  :cy="tearOrigin.y + tearDrop"
                  rx="6"
                  ry="9"
                />
                <ellipse
                  class="tear"
                  :cx="400 - tearOrigin.x"
                  :cy="tearOrigin.y + 8 + ((tearDrop + 28) % 64)"
                  rx="6"
                  ry="9"
                />
              </g>

              <!-- A stroked slash, not a shape. Tilted so the outer end sits
                   lower: that tilt is what reads as relaxed, level brows read as
                   a stare and inner-end-down reads as a scowl. It is baked into
                   the art so `browL.rot` still means pure expression on top. -->
              <g :transform="transforms.browL">
                <path
                  class="brow"
                  :d="art.head.brow.d"
                  :style="{ strokeWidth: `${art.head.brow.width}px`, strokeLinecap: art.head.brow.cap ?? 'round' }"
                />
              </g>
              <g :transform="transforms.browR">
                <g :transform="MIRROR">
                  <path
                    class="brow"
                    :d="art.head.brow.d"
                    :style="{ strokeWidth: `${art.head.brow.width}px`, strokeLinecap: art.head.brow.cap ?? 'round' }"
                  />
                </g>
              </g>

              <path
                v-if="art.head.nose"
                class="nose"
                :d="art.head.nose"
              />

              <g :transform="transforms.jaw">
                <path class="mouth" :d="mouthD" />
                <g :clip-path="`url(#mouth-${uid})`">
                  <rect
                    class="teeth"
                    :x="face.mouth.cx - 32"
                    :y="face.mouth.cy - 28"
                    width="64"
                    height="16"
                    rx="4"
                  />
                  <ellipse
                    class="tongue"
                    :cx="face.mouth.cx"
                    :cy="face.mouth.cy + 30"
                    rx="24"
                    ry="18"
                  />
                </g>
                <path class="mouth-line" :d="mouthD" />
              </g>

              <!-- Headwear last: a cap sits over the brow line, not under it. -->
              <path
                v-for="(layer, i) in art.head.over"
                :key="`over-${i}`"
                class="layer"
                :d="layer.d"
                :style="layerStyle(layer)"
              />
              <g :transform="MIRROR">
                <path
                  v-for="(layer, i) in mirroredLayers(art.head.over)"
                  :key="`over-m-${i}`"
                  class="layer"
                  :d="layer.d"
                  :style="layerStyle(layer)"
                />
              </g>
            </g>
          </g>

          <use
            v-show="armFront.l"
            :href="`#${armLId}`"
            :style="castArms ? { filter: castArms } : undefined"
          />
          <use
            v-show="armFront.r"
            :href="`#${armRId}`"
            :style="castArms ? { filter: castArms } : undefined"
          />
        </g>
      </g>
    </g>

    <!-- Rig overlay: bones live in view-box space already, so it sits outside
         the transform tree and can never drift from the art. -->
    <g v-if="overlayFrames" class="overlay">
      <g v-for="joint in SKELETON" :key="joint.id">
        <line
          class="bone"
          :x1="overlayFrames[joint.id].x"
          :y1="overlayFrames[joint.id].y"
          :x2="overlayFrames[joint.id].tipX"
          :y2="overlayFrames[joint.id].tipY"
        />
      </g>
      <g
        v-for="joint in SKELETON"
        :key="`pivot-${joint.id}`"
        class="pivot"
        :class="{ 'pivot--selected': joint.id === selectedJoint }"
        :data-joint="joint.id"
        @pointerdown.stop.prevent="emit('jointPointerDown', joint.id, $event)"
      >
        <circle
          class="pivot-hit"
          :cx="overlayFrames[joint.id].x"
          :cy="overlayFrames[joint.id].y"
          :r="joint.group === 'hands' ? 8 : 15"
        />
        <circle
          class="pivot-dot"
          :cx="overlayFrames[joint.id].x"
          :cy="overlayFrames[joint.id].y"
          :r="joint.group === 'body' || joint.group === 'arms' ? 7 : 4.5"
        />
      </g>
      <g v-if="selectedJoint" class="handle">
        <circle
          class="handle-dot"
          :cx="overlayFrames[selectedJoint].tipX"
          :cy="overlayFrames[selectedJoint].tipY"
          r="9"
        />
        <text
          class="handle-label"
          :x="overlayFrames[selectedJoint].x + 14"
          :y="overlayFrames[selectedJoint].y - 12"
        >{{ JOINTS_BY_ID[selectedJoint].label }}</text>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.rig {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

/* Line weights are the style's, not this file's: a graded set (heavier on the
   silhouette than on interior detail) reads as drawn, a uniform set reads as
   vector clip-art, and both are directions a style may want. */
.skin { fill: var(--rig-skin); stroke: var(--rig-line); stroke-width: var(--ink-feature); }
.hand { fill: var(--rig-hand, var(--rig-skin)); }
.neck { fill: var(--rig-skin); stroke: var(--rig-line); stroke-width: var(--ink-feature); }
.ear { fill: var(--rig-skin); stroke: var(--rig-line); stroke-width: var(--ink-feature); }
.ear-line { fill: none; stroke: var(--rig-skin-deep); stroke-width: var(--ink-detail); stroke-linecap: round; }
.shirt { fill: var(--rig-shirt); stroke: var(--rig-line); stroke-width: var(--ink-silhouette); }
.shirt-shade { fill: var(--rig-shirt-shade); }
.brow { fill: none; stroke: var(--rig-brow); stroke-linecap: round; }
/* No outline on the eye. The white-on-skin contrast carries the shape, and a
   rim around it fights the pupil for the same job while making the whole face
   read as heavier than it is. */
.eye-white { fill: var(--rig-eye-white); }
/* Only inked once the eye is nearly shut, at the same weight as the brow above
   it — a shut eye has no white left to read, so it has to be a drawn line. */
.eye-lid {
  fill: none;
  stroke: var(--rig-line);
  stroke-width: var(--ink-feature);
  stroke-linecap: round;
}
.pupil { fill: var(--rig-pupil); }
.glint { fill: var(--rig-glint, #fff); opacity: 0.9; }
.mouth { fill: var(--rig-mouth); }
.mouth-line { fill: none; stroke: var(--rig-line); stroke-width: var(--ink-feature); stroke-linejoin: round; }
.teeth { fill: var(--rig-teeth); }
.tongue { fill: var(--rig-tongue); }
.blush { fill: var(--rig-blush); opacity: 0; }
.tear { fill: var(--rig-tear); opacity: 0.85; }
.tears { opacity: 0; }
.nose { fill: none; stroke: var(--rig-line); stroke-width: var(--ink-detail); stroke-linecap: round; stroke-linejoin: round; }
.layer { stroke-linecap: round; stroke-linejoin: round; }
.cast-shape { fill: #000; }

.limb-shade { fill: none; }
.sleeve, .sleeve-seam, .limb, .limb-edge, .limb-shade {
  fill: none;
  stroke-linecap: var(--limb-cap, round);
}
/* The sleeve has to be wide enough to bury the arm's own outline and narrow
   enough to stay inside the shirt's — a few px either way and it either leaks a
   black arc onto the chest or eats a bite out of the shoulder. */
.sleeve { stroke: var(--rig-shirt); stroke-width: var(--sleeve-width); }
.sleeve-seam { stroke: var(--rig-line); stroke-width: var(--ink-silhouette); stroke-linejoin: round; }
.limb-edge { stroke: var(--rig-line); stroke-width: var(--arm-edge); }
.limb { stroke-width: var(--arm-fill); }
.limb--upper { stroke: var(--limb-upper); }
.limb--lower { stroke: var(--limb-lower); }
.hand-edge { fill: none; stroke: var(--rig-line); stroke-width: 8; stroke-linejoin: round; }

/* The procedural limbs. The ink pass is the silhouette *dilated* — filled and
   stroked in the line colour — and the fill pass then paints the shape itself
   back over the inner half of that stroke. What is left is a uniform outline
   around the union of every shape in the group and nothing in between them. */
.limb-ink path {
  fill: var(--rig-line);
  stroke: var(--rig-line);
  stroke-width: var(--limb-ink);
  stroke-linejoin: round;
}
.limb-fill path { fill: var(--limb-lower); }
.limb-sleeve { fill: var(--rig-shirt); }
.limb-tone path { stroke: none; }
.limb-line { fill: none; stroke-linejoin: round; }
.limb-line--inked { stroke: var(--rig-line); stroke-width: var(--ink-detail); }
.limb-line--soft { stroke: var(--rig-skin-shade); stroke-width: var(--ink-detail); }
.limb-line--none { display: none; }
/* Only the sleeve's own edge, never a ring round the shoulder — the shirt's
   silhouette carries that, and a closed outline here reads as a shoulder pad. */
.limb-hem {
  fill: none;
  stroke: var(--rig-line);
  stroke-width: var(--ink-silhouette);
  stroke-linecap: round;
}
.cuff {
  fill: none;
  stroke: var(--rig-line);
  stroke-width: var(--ink-silhouette);
  stroke-linecap: round;
}
.crease {
  fill: none;
  stroke: var(--rig-skin-deep);
  stroke-width: var(--ink-detail);
  stroke-linecap: round;
}

.overlay { pointer-events: none; }
.bone {
  stroke: rgb(56 189 248 / 55%);
  stroke-width: 2.5;
  stroke-linecap: round;
}
.pivot { pointer-events: auto; cursor: grab; }
.pivot-hit { fill: transparent; }
.pivot-dot {
  fill: rgb(14 165 233 / 90%);
  stroke: #fff;
  stroke-width: 2.5;
}
.pivot--selected .pivot-dot {
  fill: #f59e0b;
  stroke-width: 3.5;
}
.handle-dot {
  fill: none;
  stroke: #f59e0b;
  stroke-width: 3;
  stroke-dasharray: 5 4;
}
.handle-label {
  fill: #f59e0b;
  font-family: ui-monospace, monospace;
  font-size: 15px;
  font-weight: 700;
}
</style>
