/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {Transition} from './ReactFiberTracingMarkerComponent';
import type {ConcurrentUpdate} from './ReactFiberConcurrentUpdates';

// TODO: Ideally these types would be opaque but that doesn't work well with
// our reconciler fork infra, since these leak into non-reconciler packages.

export type Lanes = number;
export type Lane = number;
export type LaneMap<T> = Array<T>;

import {
  enableRetryLaneExpiration,
  enableSchedulingProfiler,
  enableTransitionTracing,
  enableUpdaterTracking,
  syncLaneExpirationMs,
  transitionLaneExpirationMs,
  retryLaneExpirationMs,
} from 'shared/ReactFeatureFlags';
import {isDevToolsPresent} from './ReactFiberDevToolsHook';
import {clz32} from './clz32';

// Lane values below should be kept in sync with getLabelForLane(), used by react-devtools-timeline.
// If those values are changed that package should be rebuilt and redeployed.

export const TotalLanes = 31;

export const NoLanes: Lanes = /*                        */ 0b0000000000000000000000000000000;
export const NoLane: Lane = /*                          */ 0b0000000000000000000000000000000;

export const SyncHydrationLane: Lane = /*               */ 0b0000000000000000000000000000001;
export const SyncLane: Lane = /*                        */ 0b0000000000000000000000000000010;
export const SyncLaneIndex: number = 1;

export const InputContinuousHydrationLane: Lane = /*    */ 0b0000000000000000000000000000100;
export const InputContinuousLane: Lane = /*             */ 0b0000000000000000000000000001000;

export const DefaultHydrationLane: Lane = /*            */ 0b0000000000000000000000000010000;
export const DefaultLane: Lane = /*                     */ 0b0000000000000000000000000100000;

export const SyncUpdateLanes: Lane =
  SyncLane | InputContinuousLane | DefaultLane;

const TransitionHydrationLane: Lane = /*                */ 0b0000000000000000000000001000000;
const TransitionLanes: Lanes = /*                       */ 0b0000000001111111111111110000000;
const TransitionLane1: Lane = /*                        */ 0b0000000000000000000000010000000;
const TransitionLane2: Lane = /*                        */ 0b0000000000000000000000100000000;
const TransitionLane3: Lane = /*                        */ 0b0000000000000000000001000000000;
const TransitionLane4: Lane = /*                        */ 0b0000000000000000000010000000000;
const TransitionLane5: Lane = /*                        */ 0b0000000000000000000100000000000;
const TransitionLane6: Lane = /*                        */ 0b0000000000000000001000000000000;
const TransitionLane7: Lane = /*                        */ 0b0000000000000000010000000000000;
const TransitionLane8: Lane = /*                        */ 0b0000000000000000100000000000000;
const TransitionLane9: Lane = /*                        */ 0b0000000000000001000000000000000;
const TransitionLane10: Lane = /*                       */ 0b0000000000000010000000000000000;
const TransitionLane11: Lane = /*                       */ 0b0000000000000100000000000000000;
const TransitionLane12: Lane = /*                       */ 0b0000000000001000000000000000000;
const TransitionLane13: Lane = /*                       */ 0b0000000000010000000000000000000;
const TransitionLane14: Lane = /*                       */ 0b0000000000100000000000000000000;
const TransitionLane15: Lane = /*                       */ 0b0000000001000000000000000000000;

const RetryLanes: Lanes = /*                            */ 0b0000011110000000000000000000000;
const RetryLane1: Lane = /*                             */ 0b0000000010000000000000000000000;
const RetryLane2: Lane = /*                             */ 0b0000000100000000000000000000000;
const RetryLane3: Lane = /*                             */ 0b0000001000000000000000000000000;
const RetryLane4: Lane = /*                             */ 0b0000010000000000000000000000000;

export const SomeRetryLane: Lane = RetryLane1;

export const SelectiveHydrationLane: Lane = /*          */ 0b0000100000000000000000000000000;

const NonIdleLanes: Lanes = /*                          */ 0b0000111111111111111111111111111;

export const IdleHydrationLane: Lane = /*               */ 0b0001000000000000000000000000000;
export const IdleLane: Lane = /*                        */ 0b0010000000000000000000000000000;

export const OffscreenLane: Lane = /*                   */ 0b0100000000000000000000000000000;
export const DeferredLane: Lane = /*                    */ 0b1000000000000000000000000000000;

// Any lane that might schedule an update. This is used to detect infinite
// update loops, so it doesn't include hydration lanes or retries.
export const UpdateLanes: Lanes =
  SyncLane | InputContinuousLane | DefaultLane | TransitionLanes;

// This function is used for the experimental timeline (react-devtools-timeline)
// It should be kept in sync with the Lanes values above.
export function getLabelForLane(lane: Lane): string | void {
  if (enableSchedulingProfiler) {
    if (lane & SyncHydrationLane) {
      return 'SyncHydrationLane';
    }
    if (lane & SyncLane) {
      return 'Sync';
    }
    if (lane & InputContinuousHydrationLane) {
      return 'InputContinuousHydration';
    }
    if (lane & InputContinuousLane) {
      return 'InputContinuous';
    }
    if (lane & DefaultHydrationLane) {
      return 'DefaultHydration';
    }
    if (lane & DefaultLane) {
      return 'Default';
    }
    if (lane & TransitionHydrationLane) {
      return 'TransitionHydration';
    }
    if (lane & TransitionLanes) {
      return 'Transition';
    }
    if (lane & RetryLanes) {
      return 'Retry';
    }
    if (lane & SelectiveHydrationLane) {
      return 'SelectiveHydration';
    }
    if (lane & IdleHydrationLane) {
      return 'IdleHydration';
    }
    if (lane & IdleLane) {
      return 'Idle';
    }
    if (lane & OffscreenLane) {
      return 'Offscreen';
    }
    if (lane & DeferredLane) {
      return 'Deferred';
    }
  }
}

export const NoTimestamp = -1;

let nextTransitionLane: Lane = TransitionLane1;
let nextRetryLane: Lane = RetryLane1;

function getHighestPriorityLanes(lanes: Lanes | Lane): Lanes {
  const pendingSyncLanes = lanes & SyncUpdateLanes;
  if (pendingSyncLanes !== 0) {
    return pendingSyncLanes;
  }
  switch (getHighestPriorityLane(lanes)) {
    case SyncHydrationLane:
      return SyncHydrationLane;
    case SyncLane:
      return SyncLane;
    case InputContinuousHydrationLane:
      return InputContinuousHydrationLane;
    case InputContinuousLane:
      return InputContinuousLane;
    case DefaultHydrationLane:
      return DefaultHydrationLane;
    case DefaultLane:
      return DefaultLane;
    case TransitionHydrationLane:
      return TransitionHydrationLane;
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
      return lanes & TransitionLanes;
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
      return lanes & RetryLanes;
    case SelectiveHydrationLane:
      return SelectiveHydrationLane;
    case IdleHydrationLane:
      return IdleHydrationLane;
    case IdleLane:
      return IdleLane;
    case OffscreenLane:
      return OffscreenLane;
    case DeferredLane:
      // This shouldn't be reachable because deferred work is always entangled
      // with something else.
      return NoLanes;
    default:
      if (__DEV__) {
        console.error(
          'Should have found matching lanes. This is a bug in React.',
        );
      }
      // This shouldn't be reachable, but as a fallback, return the entire bitmask.
      return lanes;
  }
}

export function getNextLanes(root: FiberRoot, wipLanes: Lanes): Lanes {
  // Early bailout if there's no pending work left.
  const pendingLanes = root.pendingLanes;
  if (pendingLanes === NoLanes) {
    return NoLanes;
  }

  let nextLanes: Lanes = NoLanes;

  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;

  // Do not work on any idle work until all the non-idle work has finished,
  // even if the work is suspended.
  const nonIdlePendingLanes = pendingLanes & NonIdleLanes;
  if (nonIdlePendingLanes !== NoLanes) {
    const nonIdleUnblockedLanes = nonIdlePendingLanes & ~suspendedLanes;
    if (nonIdleUnblockedLanes !== NoLanes) {
      nextLanes = getHighestPriorityLanes(nonIdleUnblockedLanes);
    } else {
      const nonIdlePingedLanes = nonIdlePendingLanes & pingedLanes;
      if (nonIdlePingedLanes !== NoLanes) {
        nextLanes = getHighestPriorityLanes(nonIdlePingedLanes);
      }
    }
  } else {
    // The only remaining work is Idle.
    const unblockedLanes = pendingLanes & ~suspendedLanes;
    if (unblockedLanes !== NoLanes) {
      nextLanes = getHighestPriorityLanes(unblockedLanes);
    } else {
      if (pingedLanes !== NoLanes) {
        nextLanes = getHighestPriorityLanes(pingedLanes);
      }
    }
  }

  if (nextLanes === NoLanes) {
    // This should only be reachable if we're suspended
    // TODO: Consider warning in this path if a fallback timer is not scheduled.
    return NoLanes;
  }

  // If we're already in the middle of a render, switching lanes will interrupt
  // it and we'll lose our progress. We should only do this if the new lanes are
  // higher priority.
  if (
    wipLanes !== NoLanes &&
    wipLanes !== nextLanes &&
    // If we already suspended with a delay, then interrupting is fine. Don't
    // bother waiting until the root is complete.
    (wipLanes & suspendedLanes) === NoLanes
  ) {
    const nextLane = getHighestPriorityLane(nextLanes);
    const wipLane = getHighestPriorityLane(wipLanes);
    if (
      // Tests whether the next lane is equal or lower priority than the wip
      // one. This works because the bits decrease in priority as you go left.
      nextLane >= wipLane ||
      // Default priority updates should not interrupt transition updates. The
      // only difference between default updates and transition updates is that
      // default updates do not support refresh transitions.
      (nextLane === DefaultLane && (wipLane & TransitionLanes) !== NoLanes)
    ) {
      // Keep working on the existing in-progress tree. Do not interrupt.
      return wipLanes;
    }
  }

  return nextLanes;
}

export function getEntangledLanes(root: FiberRoot, renderLanes: Lanes): Lanes {
  let entangledLanes = renderLanes;

  if ((entangledLanes & InputContinuousLane) !== NoLanes) {
    // When updates are sync by default, we entangle continuous priority updates
    // and default updates, so they render in the same batch. The only reason
    // they use separate lanes is because continuous updates should interrupt
    // transitions, but default updates should not.
    entangledLanes |= entangledLanes & DefaultLane;
  }

  // Check for entangled lanes and add them to the batch.
  //
  // A lane is said to be entangled with another when it's not allowed to render
  // in a batch that does not also include the other lane. Typically we do this
  // when multiple updates have the same source, and we only want to respond to
  // the most recent event from that source.
  //
  // Note that we apply entanglements *after* checking for partial work above.
  // This means that if a lane is entangled during an interleaved event while
  // it's already rendering, we won't interrupt it. This is intentional, since
  // entanglement is usually "best effort": we'll try our best to render the
  // lanes in the same batch, but it's not worth throwing out partially
  // completed work in order to do it.
  // TODO: Reconsider this. The counter-argument is that the partial work
  // represents an intermediate state, which we don't want to show to the user.
  // And by spending extra time finishing it, we're increasing the amount of
  // time it takes to show the final state, which is what they are actually
  // waiting for.
  //
  // For those exceptions where entanglement is semantically important,
  // we should ensure that there is no partial work at the
  // time we apply the entanglement.
  const allEntangledLanes = root.entangledLanes;
  if (allEntangledLanes !== NoLanes) {
    const entanglements = root.entanglements;
    let lanes = entangledLanes & allEntangledLanes;
    while (lanes > 0) {
      const index = pickArbitraryLaneIndex(lanes);
      const lane = 1 << index;

      entangledLanes |= entanglements[index];

      lanes &= ~lane;
    }
  }

  return entangledLanes;
}

function computeExpirationTime(lane: Lane, currentTime: number) {
  switch (lane) {
    case SyncHydrationLane:
    case SyncLane:
    case InputContinuousHydrationLane:
    case InputContinuousLane:
      // User interactions should expire slightly more quickly.
      //
      // NOTE: This is set to the corresponding constant as in Scheduler.js.
      // When we made it larger, a product metric in www regressed, suggesting
      // there's a user interaction that's being starved by a series of
      // synchronous updates. If that theory is correct, the proper solution is
      // to fix the starvation. However, this scenario supports the idea that
      // expiration times are an important safeguard when starvation
      // does happen.
      return currentTime + syncLaneExpirationMs;
    case DefaultHydrationLane:
    case DefaultLane:
    case TransitionHydrationLane:
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
      return currentTime + transitionLaneExpirationMs;
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
      // TODO: Retries should be allowed to expire if they are CPU bound for
      // too long, but when I made this change it caused a spike in browser
      // crashes. There must be some other underlying bug; not super urgent but
      // ideally should figure out why and fix it. Unfortunately we don't have
      // a repro for the crashes, only detected via production metrics.
      return enableRetryLaneExpiration
        ? currentTime + retryLaneExpirationMs
        : NoTimestamp;
    case SelectiveHydrationLane:
    case IdleHydrationLane:
    case IdleLane:
    case OffscreenLane:
    case DeferredLane:
      // Anything idle priority or lower should never expire.
      return NoTimestamp;
    default:
      if (__DEV__) {
        console.error(
          'Should have found matching lanes. This is a bug in React.',
        );
      }
      return NoTimestamp;
  }
}

export function markStarvedLanesAsExpired(
  root: FiberRoot,
  currentTime: number,
): void {
  // TODO: This gets called every time we yield. We can optimize by storing
  // the earliest expiration time on the root. Then use that to quickly bail out
  // of this function.

  const pendingLanes = root.pendingLanes;
  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;
  const expirationTimes = root.expirationTimes;

  // Iterate through the pending lanes and check if we've reached their
  // expiration time. If so, we'll assume the update is being starved and mark
  // it as expired to force it to finish.
  // TODO: We should be able to replace this with upgradePendingLanesToSync
  //
  // We exclude retry lanes because those must always be time sliced, in order
  // to unwrap uncached promises.
  // TODO: Write a test for this
  let lanes = enableRetryLaneExpiration
    ? pendingLanes
    : pendingLanes & ~RetryLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    const expirationTime = expirationTimes[index];
    if (expirationTime === NoTimestamp) {
      // Found a pending lane with no expiration time. If it's not suspended, or
      // if it's pinged, assume it's CPU-bound. Compute a new expiration time
      // using the current time.
      if (
        (lane & suspendedLanes) === NoLanes ||
        (lane & pingedLanes) !== NoLanes
      ) {
        // Assumes timestamps are monotonically increasing.
        expirationTimes[index] = computeExpirationTime(lane, currentTime);
      }
    } else if (expirationTime <= currentTime) {
      // This lane expired
      root.expiredLanes |= lane;
    }

    lanes &= ~lane;
  }
}

// This returns the highest priority pending lanes regardless of whether they
// are suspended.
export function getHighestPriorityPendingLanes(root: FiberRoot): Lanes {
  return getHighestPriorityLanes(root.pendingLanes);
}

export function getLanesToRetrySynchronouslyOnError(
  root: FiberRoot,
  originallyAttemptedLanes: Lanes,
): Lanes {
  if (root.errorRecoveryDisabledLanes & originallyAttemptedLanes) {
    // The error recovery mechanism is disabled until these lanes are cleared.
    return NoLanes;
  }

  const everythingButOffscreen = root.pendingLanes & ~OffscreenLane;
  if (everythingButOffscreen !== NoLanes) {
    return everythingButOffscreen;
  }
  if (everythingButOffscreen & OffscreenLane) {
    return OffscreenLane;
  }
  return NoLanes;
}

export function includesSyncLane(lanes: Lanes): boolean {
  return (lanes & (SyncLane | SyncHydrationLane)) !== NoLanes;
}

export function includesNonIdleWork(lanes: Lanes): boolean {
  return (lanes & NonIdleLanes) !== NoLanes;
}
export function includesOnlyRetries(lanes: Lanes): boolean {
  return (lanes & RetryLanes) === lanes;
}
export function includesOnlyNonUrgentLanes(lanes: Lanes): boolean {
  // TODO: Should hydration lanes be included here? This function is only
  // used in `updateDeferredValueImpl`.
  const UrgentLanes = SyncLane | InputContinuousLane | DefaultLane;
  return (lanes & UrgentLanes) === NoLanes;
}
export function includesOnlyTransitions(lanes: Lanes): boolean {
  return (lanes & TransitionLanes) === lanes;
}

export function includesBlockingLane(root: FiberRoot, lanes: Lanes): boolean {
  const SyncDefaultLanes =
    InputContinuousHydrationLane |
    InputContinuousLane |
    DefaultHydrationLane |
    DefaultLane;
  return (lanes & SyncDefaultLanes) !== NoLanes;
}

export function includesExpiredLane(root: FiberRoot, lanes: Lanes): boolean {
  // This is a separate check from includesBlockingLane because a lane can
  // expire after a render has already started.
  return (lanes & root.expiredLanes) !== NoLanes;
}

export function isTransitionLane(lane: Lane): boolean {
  return (lane & TransitionLanes) !== NoLanes;
}

export function claimNextTransitionLane(): Lane {
  // Cycle through the lanes, assigning each new transition to the next lane.
  // In most cases, this means every transition gets its own lane, until we
  // run out of lanes and cycle back to the beginning.
  const lane = nextTransitionLane;
  nextTransitionLane <<= 1;
  if ((nextTransitionLane & TransitionLanes) === NoLanes) {
    nextTransitionLane = TransitionLane1;
  }
  return lane;
}

export function claimNextRetryLane(): Lane {
  const lane = nextRetryLane;
  nextRetryLane <<= 1;
  if ((nextRetryLane & RetryLanes) === NoLanes) {
    nextRetryLane = RetryLane1;
  }
  return lane;
}

export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes;
}

export function pickArbitraryLane(lanes: Lanes): Lane {
  // This wrapper function gets inlined. Only exists so to communicate that it
  // doesn't matter which bit is selected; you can pick any bit without
  // affecting the algorithms where its used. Here I'm using
  // getHighestPriorityLane because it requires the fewest operations.
  return getHighestPriorityLane(lanes);
}

function pickArbitraryLaneIndex(lanes: Lanes) {
  return 31 - clz32(lanes);
}

function laneToIndex(lane: Lane) {
  return pickArbitraryLaneIndex(lane);
}

export function includesSomeLane(a: Lanes | Lane, b: Lanes | Lane): boolean {
  return (a & b) !== NoLanes;
}

export function isSubsetOfLanes(set: Lanes, subset: Lanes | Lane): boolean {
  return (set & subset) === subset;
}

export function mergeLanes(a: Lanes | Lane, b: Lanes | Lane): Lanes {
  return a | b;
}

export function removeLanes(set: Lanes, subset: Lanes | Lane): Lanes {
  return set & ~subset;
}

export function intersectLanes(a: Lanes | Lane, b: Lanes | Lane): Lanes {
  return a & b;
}

// Seems redundant, but it changes the type from a single lane (used for
// updates) to a group of lanes (used for flushing work).
export function laneToLanes(lane: Lane): Lanes {
  return lane;
}

export function higherPriorityLane(a: Lane, b: Lane): Lane {
  // This works because the bit ranges decrease in priority as you go left.
  return a !== NoLane && a < b ? a : b;
}

export function createLaneMap<T>(initial: T): LaneMap<T> {
  // Intentionally pushing one by one.
  // https://v8.dev/blog/elements-kinds#avoid-creating-holes
  const laneMap = [];
  for (let i = 0; i < TotalLanes; i++) {
    laneMap.push(initial);
  }
  return laneMap;
}

export function markRootUpdated(root: FiberRoot, updateLane: Lane) {
  root.pendingLanes |= updateLane;

  // If there are any suspended transitions, it's possible this new update
  // could unblock them. Clear the suspended lanes so that we can try rendering
  // them again.
  //
  // TODO: We really only need to unsuspend only lanes that are in the
  // `subtreeLanes` of the updated fiber, or the update lanes of the return
  // path. This would exclude suspended updates in an unrelated sibling tree,
  // since there's no way for this update to unblock it.
  //
  // We don't do this if the incoming update is idle, because we never process
  // idle updates until after all the regular updates have finished; there's no
  // way it could unblock a transition.
  if (updateLane !== IdleLane) {
    root.suspendedLanes = NoLanes;
    root.pingedLanes = NoLanes;
  }
}

export function markRootSuspended(
  root: FiberRoot,
  suspendedLanes: Lanes,
  spawnedLane: Lane,
) {
  root.suspendedLanes |= suspendedLanes;
  root.pingedLanes &= ~suspendedLanes;

  // The suspended lanes are no longer CPU-bound. Clear their expiration times.
  const expirationTimes = root.expirationTimes;
  let lanes = suspendedLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    expirationTimes[index] = NoTimestamp;

    lanes &= ~lane;
  }

  if (spawnedLane !== NoLane) {
    markSpawnedDeferredLane(root, spawnedLane, suspendedLanes);
  }
}

export function markRootPinged(root: FiberRoot, pingedLanes: Lanes) {
  root.pingedLanes |= root.suspendedLanes & pingedLanes;
}

export function markRootFinished(
  root: FiberRoot,
  remainingLanes: Lanes,
  spawnedLane: Lane,
) {
  const noLongerPendingLanes = root.pendingLanes & ~remainingLanes;

  root.pendingLanes = remainingLanes;

  // Let's try everything again
  root.suspendedLanes = NoLanes;
  root.pingedLanes = NoLanes;

  root.expiredLanes &= remainingLanes;

  root.entangledLanes &= remainingLanes;

  root.errorRecoveryDisabledLanes &= remainingLanes;
  root.shellSuspendCounter = 0;

  const entanglements = root.entanglements;
  const expirationTimes = root.expirationTimes;
  const hiddenUpdates = root.hiddenUpdates;

  // Clear the lanes that no longer have pending work
  let lanes = noLongerPendingLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    entanglements[index] = NoLanes;
    expirationTimes[index] = NoTimestamp;

    const hiddenUpdatesForLane = hiddenUpdates[index];
    if (hiddenUpdatesForLane !== null) {
      hiddenUpdates[index] = null;
      // "Hidden" updates are updates that were made to a hidden component. They
      // have special logic associated with them because they may be entangled
      // with updates that occur outside that tree. But once the outer tree
      // commits, they behave like regular updates.
      for (let i = 0; i < hiddenUpdatesForLane.length; i++) {
        const update = hiddenUpdatesForLane[i];
        if (update !== null) {
          update.lane &= ~OffscreenLane;
        }
      }
    }

    lanes &= ~lane;
  }

  if (spawnedLane !== NoLane) {
    markSpawnedDeferredLane(
      root,
      spawnedLane,
      // This render finished successfully without suspending, so we don't need
      // to entangle the spawned task with the parent task.
      NoLanes,
    );
  }
}

function markSpawnedDeferredLane(
  root: FiberRoot,
  spawnedLane: Lane,
  entangledLanes: Lanes,
) {
  // This render spawned a deferred task. Mark it as pending.
  root.pendingLanes |= spawnedLane;
  root.suspendedLanes &= ~spawnedLane;

  // Entangle the spawned lane with the DeferredLane bit so that we know it
  // was the result of another render. This lets us avoid a useDeferredValue
  // waterfall — only the first level will defer.
  const spawnedLaneIndex = laneToIndex(spawnedLane);
  root.entangledLanes |= spawnedLane;
  root.entanglements[spawnedLaneIndex] |=
    DeferredLane |
    // If the parent render task suspended, we must also entangle those lanes
    // with the spawned task, so that the deferred task includes all the same
    // updates that the parent task did. We can exclude any lane that is not
    // used for updates (e.g. Offscreen).
    (entangledLanes & UpdateLanes);
}

export function markRootEntangled(root: FiberRoot, entangledLanes: Lanes) {
  // In addition to entangling each of the given lanes with each other, we also
  // have to consider _transitive_ entanglements. For each lane that is already
  // entangled with *any* of the given lanes, that lane is now transitively
  // entangled with *all* the given lanes.
  //
  // Translated: If C is entangled with A, then entangling A with B also
  // entangles C with B.
  //
  // If this is hard to grasp, it might help to intentionally break this
  // function and look at the tests that fail in ReactTransition-test.js. Try
  // commenting out one of the conditions below.

  const rootEntangledLanes = (root.entangledLanes |= entangledLanes);
  const entanglements = root.entanglements;
  let lanes = rootEntangledLanes;
  while (lanes) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;
    if (
      // Is this one of the newly entangled lanes?
      (lane & entangledLanes) |
      // Is this lane transitively entangled with the newly entangled lanes?
      (entanglements[index] & entangledLanes)
    ) {
      entanglements[index] |= entangledLanes;
    }
    lanes &= ~lane;
  }
}

export function upgradePendingLaneToSync(root: FiberRoot, lane: Lane) {
  // Since we're upgrading the priority of the given lane, there is now pending
  // sync work.
  root.pendingLanes |= SyncLane;

  // Entangle the sync lane with the lane we're upgrading. This means SyncLane
  // will not be allowed to finish without also finishing the given lane.
  root.entangledLanes |= SyncLane;
  root.entanglements[SyncLaneIndex] |= lane;
}

export function upgradePendingLanesToSync(
  root: FiberRoot,
  lanesToUpgrade: Lanes,
) {
  // Same as upgradePendingLaneToSync but accepts multiple lanes, so it's a
  // bit slower.
  root.pendingLanes |= SyncLane;
  root.entangledLanes |= SyncLane;
  let lanes = lanesToUpgrade;
  while (lanes) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;
    root.entanglements[SyncLaneIndex] |= lane;
    lanes &= ~lane;
  }
}

export function markHiddenUpdate(
  root: FiberRoot,
  update: ConcurrentUpdate,
  lane: Lane,
) {
  const index = laneToIndex(lane);
  const hiddenUpdates = root.hiddenUpdates;
  const hiddenUpdatesForLane = hiddenUpdates[index];
  if (hiddenUpdatesForLane === null) {
    hiddenUpdates[index] = [update];
  } else {
    hiddenUpdatesForLane.push(update);
  }
  update.lane = lane | OffscreenLane;
}

export function getBumpedLaneForHydration(
  root: FiberRoot,
  renderLanes: Lanes,
): Lane {
  const renderLane = getHighestPriorityLane(renderLanes);

  let lane;
  if ((renderLane & SyncUpdateLanes) !== NoLane) {
    lane = SyncHydrationLane;
  } else {
    switch (renderLane) {
      case SyncLane:
        lane = SyncHydrationLane;
        break;
      case InputContinuousLane:
        lane = InputContinuousHydrationLane;
        break;
      case DefaultLane:
        lane = DefaultHydrationLane;
        break;
      case TransitionLane1:
      case TransitionLane2:
      case TransitionLane3:
      case TransitionLane4:
      case TransitionLane5:
      case TransitionLane6:
      case TransitionLane7:
      case TransitionLane8:
      case TransitionLane9:
      case TransitionLane10:
      case TransitionLane11:
      case TransitionLane12:
      case TransitionLane13:
      case TransitionLane14:
      case TransitionLane15:
      case RetryLane1:
      case RetryLane2:
      case RetryLane3:
      case RetryLane4:
        lane = TransitionHydrationLane;
        break;
      case IdleLane:
        lane = IdleHydrationLane;
        break;
      default:
        // Everything else is already either a hydration lane, or shouldn't
        // be retried at a hydration lane.
        lane = NoLane;
        break;
    }
  }

  // Check if the lane we chose is suspended. If so, that indicates that we
  // already attempted and failed to hydrate at that level. Also check if we're
  // already rendering that lane, which is rare but could happen.
  if ((lane & (root.suspendedLanes | renderLanes)) !== NoLane) {
    // Give up trying to hydrate and fall back to client render.
    return NoLane;
  }

  return lane;
}

export function addFiberToLanesMap(
  root: FiberRoot,
  fiber: Fiber,
  lanes: Lanes | Lane,
) {
  if (!enableUpdaterTracking) {
    return;
  }
  if (!isDevToolsPresent) {
    return;
  }
  const pendingUpdatersLaneMap = root.pendingUpdatersLaneMap;
  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;

    const updaters = pendingUpdatersLaneMap[index];
    updaters.add(fiber);

    lanes &= ~lane;
  }
}

export function movePendingFibersToMemoized(root: FiberRoot, lanes: Lanes) {
  if (!enableUpdaterTracking) {
    return;
  }
  if (!isDevToolsPresent) {
    return;
  }
  const pendingUpdatersLaneMap = root.pendingUpdatersLaneMap;
  const memoizedUpdaters = root.memoizedUpdaters;
  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;

    const updaters = pendingUpdatersLaneMap[index];
    if (updaters.size > 0) {
      updaters.forEach(fiber => {
        const alternate = fiber.alternate;
        if (alternate === null || !memoizedUpdaters.has(alternate)) {
          memoizedUpdaters.add(fiber);
        }
      });
      updaters.clear();
    }

    lanes &= ~lane;
  }
}

export function addTransitionToLanesMap(
  root: FiberRoot,
  transition: Transition,
  lane: Lane,
) {
  if (enableTransitionTracing) {
    const transitionLanesMap = root.transitionLanes;
    const index = laneToIndex(lane);
    let transitions = transitionLanesMap[index];
    if (transitions === null) {
      transitions = new Set();
    }
    transitions.add(transition);

    transitionLanesMap[index] = transitions;
  }
}

export function getTransitionsForLanes(
  root: FiberRoot,
  lanes: Lane | Lanes,
): Array<Transition> | null {
  if (!enableTransitionTracing) {
    return null;
  }

  const transitionsForLanes = [];
  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;
    const transitions = root.transitionLanes[index];
    if (transitions !== null) {
      transitions.forEach(transition => {
        transitionsForLanes.push(transition);
      });
    }

    lanes &= ~lane;
  }

  if (transitionsForLanes.length === 0) {
    return null;
  }

  return transitionsForLanes;
}

export function clearTransitionsForLanes(root: FiberRoot, lanes: Lane | Lanes) {
  if (!enableTransitionTracing) {
    return;
  }

  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;

    const transitions = root.transitionLanes[index];
    if (transitions !== null) {
      root.transitionLanes[index] = null;
    }

    lanes &= ~lane;
  }
}
