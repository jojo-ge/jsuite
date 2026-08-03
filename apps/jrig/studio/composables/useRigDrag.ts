// Joint drag maths, lifted from the ported RigEditor. Rotation is measured
// about the pivot cached at drag start (world rotation composes additively, so
// a view-box angle delta IS the local channel delta, and the ambient sway can't
// make the drag jitter); translation is authored in the joint's own frame so
// the shape follows the pointer even under a rotated ancestor.

import type { ChannelId, JointFrame, JointId } from '../../rig/core';

import { JOINTS_BY_ID } from '../../rig/core';
import { usePointerDrag } from './usePointerDrag';

export const roundValue = (v: number) => Math.round(v * 100) / 100;

const shortestDelta = (delta: number) => {
  let d = delta;
  while (d > 180) {
    d -= 360;
  }
  while (d < -180) {
    d += 360;
  }
  return d;
};

export interface RigDragDeps {
  svgEl: () => SVGSVGElement | null;
  frames: () => Record<JointId, JointFrame> | undefined;
  channelValue: (channel: ChannelId) => number;
  /** Streams values during the gesture — commit happens once, in onEnd. */
  setChannel: (channel: ChannelId, value: number) => void;
  onStart?: (joint: JointId) => void;
  onEnd?: () => void;
  onCancel?: () => void;
}

export function useRigDrag(deps: RigDragDeps) {
  const drag = usePointerDrag();

  const toViewBox = (event: PointerEvent) => {
    const svg = deps.svgEl();
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) {
      return null;
    }
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(ctm.inverse());
  };

  const onJointPointerDown = (jointId: JointId, event: PointerEvent) => {
    deps.onStart?.(jointId);
    const frames = deps.frames();
    const point = toViewBox(event);
    if (!frames || !point) {
      return;
    }
    const frame = frames[jointId];
    const joint = JOINTS_BY_ID[jointId];
    const state = {
      mode: event.shiftKey || event.altKey ? 'translate' as const : 'rotate' as const,
      startAngle: Math.atan2(point.y - frame.y, point.x - frame.x) * (180 / Math.PI),
      startRot: deps.channelValue(`${jointId}.rot`),
      startX: deps.channelValue(`${jointId}.x`),
      startY: deps.channelValue(`${jointId}.y`),
      originX: point.x,
      originY: point.y,
      pivotX: frame.x,
      pivotY: frame.y,
      parentRot: frame.parentRot,
    };

    drag.start(event, {
      onMove: (moveEvent) => {
        const at = toViewBox(moveEvent);
        if (!at) {
          return;
        }
        if (state.mode === 'rotate') {
          if (!joint.channels.includes('rot')) {
            return;
          }
          const now = Math.atan2(at.y - state.pivotY, at.x - state.pivotX) * (180 / Math.PI);
          const delta = shortestDelta(now - state.startAngle);
          deps.setChannel(`${jointId}.rot`, roundValue(state.startRot + delta));
          return;
        }
        const dx = at.x - state.originX;
        const dy = at.y - state.originY;
        const rad = (-state.parentRot * Math.PI) / 180;
        const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
        const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
        if (joint.channels.includes('x')) {
          deps.setChannel(`${jointId}.x`, roundValue(state.startX + localX));
        }
        if (joint.channels.includes('y')) {
          deps.setChannel(`${jointId}.y`, roundValue(state.startY + localY));
        }
      },
      onUp: () => deps.onEnd?.(),
      onCancel: () => deps.onCancel?.(),
    });
  };

  return { onJointPointerDown };
}
