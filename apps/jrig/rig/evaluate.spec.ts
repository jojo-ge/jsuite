import { describe, expect, it } from 'vitest';

import type { Clip, Pose } from './core';

import { createRestPose, DEPTH_CHANNELS } from './core';
import { composePose, createAmbient, createEmoteFader } from './evaluate';

const clip = (id: string, tracks: Clip['tracks'], overrides: Partial<Clip> = {}): Clip => ({
  id,
  name: id,
  duration: 1,
  loop: false,
  layer: 'emote',
  tracks,
  ...overrides,
});

const constant = (v: number) => [{ t: 0, v }];

const REST = createRestPose();

describe('composePose', () => {
  it('returns the rest pose with no layers', () => {
    expect(composePose({})).toEqual(REST);
  });

  it('stacks rest → base → emote → overlay, later layers winning', () => {
    const base = clip('base', { 'head.rot': constant(10), 'chest.y': constant(4) }, { layer: 'base', loop: true });
    const emote = clip('emote', { 'chest.y': constant(-6) });
    const pose = composePose({
      base: { clip: base, time: 0.5 },
      emote: { clip: emote, time: 0.5, weight: 1 },
      overlay: { 'head.rot': 99 },
    });
    // Emote overrides only the channel it keyframes; the base survives elsewhere
    // until the overlay — applied last at full weight — wins outright.
    expect(pose['chest.y']).toBeCloseTo(-6);
    expect(pose['head.rot']).toBeCloseTo(99);
    expect(pose['root.x']).toBeCloseTo(REST['root.x'] ?? 0);
  });

  it('blends the emote layer by weight from the pose underneath', () => {
    const emote = clip('emote', { 'head.rot': constant(10) });
    const from = REST['head.rot'] ?? 0;
    const pose = composePose({ emote: { clip: emote, time: 0, weight: 0.5 } });
    expect(pose['head.rot']).toBeCloseTo(from + (10 - from) * 0.5);
  });

  it('snaps stepped channels at weight ≥ 0.5 instead of blending', () => {
    const channel = DEPTH_CHANNELS[0]!.id;
    const rest = REST[channel] ?? 0;
    const target = rest >= 0.5 ? 0 : 1;
    const emote = clip('emote', { [channel]: constant(target) });
    expect(composePose({ emote: { clip: emote, time: 0, weight: 0.4 } })[channel]).toBe(rest);
    expect(composePose({ emote: { clip: emote, time: 0, weight: 0.6 } })[channel]).toBe(target);
  });
});

describe('createEmoteFader', () => {
  const tracks = { 'head.rot': constant(10) };

  it('fades in over fadeIn seconds and holds at full weight', () => {
    const fader = createEmoteFader({ fadeIn: 0.12, fadeOut: 0.22 });
    fader.play(clip('wave', tracks, { duration: 10 }));
    fader.advance(0.06);
    expect(fader.active?.weight).toBeCloseTo(0.5);
    fader.advance(0.06);
    expect(fader.active?.weight).toBeCloseTo(1);
    fader.advance(1);
    expect(fader.active?.weight).toBeCloseTo(1);
  });

  it('release() fades out and reports the finished clip exactly once', () => {
    const fader = createEmoteFader({ fadeIn: 0.12, fadeOut: 0.22 });
    fader.play(clip('wave', tracks, { duration: 10, loop: true }));
    fader.advance(0.5);
    fader.release();
    expect(fader.advance(0.11)).toBeNull();
    expect(fader.active?.weight).toBeCloseTo(0.5);
    expect(fader.advance(0.2)).toBe('wave');
    expect(fader.active).toBeNull();
    expect(fader.advance(0.1)).toBeNull();
  });

  it('starts fading a non-looping clip out fadeOut seconds before its end', () => {
    const fader = createEmoteFader({ fadeIn: 0.12, fadeOut: 0.22 });
    fader.play(clip('nod', tracks, { duration: 1 }));
    fader.advance(0.12);
    expect(fader.active?.weight).toBeCloseTo(1);
    fader.advance(0.7);
    expect(fader.active!.weight).toBeLessThan(1);
    expect(fader.advance(0.3)).toBe('nod');
  });

  it('retriggering keeps the current weight so the blend never pops', () => {
    const fader = createEmoteFader({ fadeIn: 0.12, fadeOut: 0.22 });
    fader.play(clip('wave', tracks, { duration: 10 }));
    fader.advance(0.06);
    const weight = fader.active!.weight;
    fader.play(clip('nod', tracks, { duration: 10 }));
    expect(fader.active!.clip.id).toBe('nod');
    expect(fader.active!.time).toBe(0);
    expect(fader.active!.weight).toBeCloseTo(weight);
  });
});

describe('createAmbient', () => {
  it('adds breath and sway on top of whatever is in the pose', () => {
    const ambient = createAmbient({ random: () => 0 });
    ambient.advance(1);
    const pose: Pose = createRestPose();
    ambient.apply(pose);
    expect(pose['chest.sy']).not.toBe(REST['chest.sy']);
    expect(pose['root.x']).not.toBe(REST['root.x']);
    // Additive: a pose that already moved keeps its offset under the sway.
    const offset: Pose = { ...createRestPose(), 'root.x': 50 };
    ambient.apply(offset);
    expect(offset['root.x']).toBeCloseTo(50 + (pose['root.x'] ?? 0) - (REST['root.x'] ?? 0));
  });

  it('blinks on schedule, multiplicatively, and leaves near-shut eyes alone', () => {
    // random: () => 0 pins the first blink at t = 2.2.
    const ambient = createAmbient({ random: () => 0 });
    ambient.advance(2.1);
    const before: Pose = createRestPose();
    ambient.apply(before);
    expect(before['face.eyeOpenL']).toBeCloseTo(1);

    // First apply past the threshold arms the blink; mid-blink applies close the lids.
    ambient.advance(0.15);
    ambient.apply(createRestPose());
    ambient.advance(0.05);
    const mid: Pose = createRestPose();
    ambient.apply(mid);
    expect(mid['face.eyeOpenL']).toBeLessThan(1);
    expect(mid['face.eyeOpenR']).toBeLessThan(1);

    // A clip holding the eyes nearly shut is never fought by the blink.
    const squint: Pose = { ...createRestPose(), 'face.eyeOpenL': 0.2 };
    ambient.apply(squint);
    expect(squint['face.eyeOpenL']).toBe(0.2);
  });
});
