/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';

import getComponentNameFromFiber from './getComponentNameFromFiber';

import {getGroupNameOfHighestPriorityLane} from './ReactFiberLane';

import {enableProfilerTimer} from 'shared/ReactFeatureFlags';

const supportsUserTiming =
  enableProfilerTimer &&
  typeof performance !== 'undefined' &&
  // $FlowFixMe[method-unbinding]
  typeof performance.measure === 'function';

const TRACK_GROUP = 'Components ⚛';

// Reused to avoid thrashing the GC.
const reusableComponentDevToolDetails = {
  dataType: 'track-entry',
  color: 'primary',
  track: 'Blocking', // Lane
  trackGroup: TRACK_GROUP,
};
const reusableComponentOptions = {
  start: -0,
  end: -0,
  detail: {
    devtools: reusableComponentDevToolDetails,
  },
};

export function setCurrentTrackFromLanes(lanes: number): void {
  reusableComponentDevToolDetails.track =
    getGroupNameOfHighestPriorityLane(lanes);
}

export function logComponentRender(
  fiber: Fiber,
  startTime: number,
  endTime: number,
): void {
  const name = getComponentNameFromFiber(fiber);
  if (name === null) {
    // Skip
    return;
  }
  if (supportsUserTiming) {
    let selfTime: number = (fiber.actualDuration: any);
    if (fiber.alternate === null || fiber.alternate.child !== fiber.child) {
      for (let child = fiber.child; child !== null; child = child.sibling) {
        selfTime -= (child.actualDuration: any);
      }
    }
    reusableComponentDevToolDetails.color =
      selfTime < 0.5
        ? 'primary-light'
        : selfTime < 10
          ? 'primary'
          : selfTime < 100
            ? 'primary-dark'
            : 'error';
    reusableComponentOptions.start = startTime;
    reusableComponentOptions.end = endTime;
    performance.measure(name, reusableComponentOptions);
  }
}

export function logComponentEffect(
  fiber: Fiber,
  startTime: number,
  endTime: number,
  selfTime: number,
): void {
  const name = getComponentNameFromFiber(fiber);
  if (name === null) {
    // Skip
    return;
  }
  if (supportsUserTiming) {
    reusableComponentDevToolDetails.color =
      selfTime < 1
        ? 'secondary-light'
        : selfTime < 100
          ? 'secondary'
          : selfTime < 500
            ? 'secondary-dark'
            : 'error';
    reusableComponentOptions.start = startTime;
    reusableComponentOptions.end = endTime;
    performance.measure(name, reusableComponentOptions);
  }
}
