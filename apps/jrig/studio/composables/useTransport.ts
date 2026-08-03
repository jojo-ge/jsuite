// Playhead + play/pause/scrub, lifted from the ported RigEditor. Owns the rAF
// loop; the clip being played is late-bound through the deps so the transport
// always follows the active clip.

import { onScopeDispose, ref } from 'vue';

export const roundTime = (t: number) => Math.round(t * 1000) / 1000;

export interface TransportDeps {
  duration: () => number;
  loop: () => boolean;
  speed: () => number;
  /** Fired when playback starts or the user scrubs — the editor clears its pose scratch here. */
  onJump?: () => void;
}

export function useTransport(deps: TransportDeps) {
  const playhead = ref(0);
  const playing = ref(false);
  let rafId: number | null = null;
  let lastFrameAt = 0;

  const stopRaf = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const tick = (now: number) => {
    const dt = Math.min((now - lastFrameAt) / 1000, 0.05) * deps.speed();
    lastFrameAt = now;
    const next = playhead.value + dt;
    const duration = deps.duration();
    playhead.value = next > duration ? (deps.loop() ? next % duration : duration) : next;
    if (!deps.loop() && playhead.value >= duration) {
      playing.value = false;
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  const setPlaying = (next: boolean) => {
    playing.value = next;
    if (next) {
      deps.onJump?.();
      if (playhead.value >= deps.duration()) {
        playhead.value = 0;
      }
      lastFrameAt = performance.now();
      rafId = requestAnimationFrame(tick);
      return;
    }
    stopRaf();
  };

  const scrubTo = (t: number) => {
    deps.onJump?.();
    playhead.value = Math.min(Math.max(roundTime(t), 0), deps.duration());
  };

  onScopeDispose(stopRaf);

  return { playhead, playing, setPlaying, scrubTo };
}
