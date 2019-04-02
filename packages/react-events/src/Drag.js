/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {EventResponderContext} from 'events/EventTypes';
import {REACT_EVENT_COMPONENT_TYPE} from 'shared/ReactSymbols';

const targetEventTypes = ['pointerdown', 'pointercancel'];
const rootEventTypes = ['pointerup', {name: 'pointermove', passive: false}];

type DragState = {
  dragTarget: null | Element | Document,
  isPointerDown: boolean,
  isDragging: boolean,
  startX: number,
  startY: number,
  x: number,
  y: number,
};

// In the case we don't have PointerEvents (Safari), we listen to touch events
// too
if (typeof window !== 'undefined' && window.PointerEvent === undefined) {
  targetEventTypes.push('touchstart', 'touchend', 'mousedown', 'touchcancel');
  rootEventTypes.push('mouseup', 'mousemove', {
    name: 'touchmove',
    passive: false,
  });
}

type EventData = {
  diffX: number,
  diffY: number,
};
type DragEventType = 'dragend' | 'dragchange' | 'dragmove';

type DragEvent = {|
  listener: DragEvent => void,
  target: Element | Document,
  type: DragEventType,
  diffX?: number,
  diffY?: number,
|};

function createDragEvent(
  type: DragEventType,
  target: Element | Document,
  listener: DragEvent => void,
  eventData?: EventData,
): DragEvent {
  return {
    listener,
    target,
    type,
    ...eventData,
  };
}

function dispatchDragEvent(
  context: EventResponderContext,
  name: DragEventType,
  listener: DragEvent => void,
  state: DragState,
  discrete: boolean,
  eventData?: EventData,
): void {
  const target = ((state.dragTarget: any): Element | Document);
  const syntheticEvent = createDragEvent(name, target, listener, eventData);
  context.dispatchEvent(syntheticEvent, {discrete});
}

const DragResponder = {
  targetEventTypes,
  createInitialState(): DragState {
    return {
      dragTarget: null,
      isPointerDown: false,
      isDragging: false,
      startX: 0,
      startY: 0,
      x: 0,
      y: 0,
    };
  },
  handleEvent(
    context: EventResponderContext,
    props: Object,
    state: DragState,
  ): void {
    const {eventTarget, eventType, event} = context;

    switch (eventType) {
      case 'touchstart':
      case 'mousedown':
      case 'pointerdown': {
        if (!state.isDragging) {
          const obj =
            eventType === 'touchstart' ? (event: any).changedTouches[0] : event;
          const x = (state.startX = (obj: any).screenX);
          const y = (state.startY = (obj: any).screenY);
          state.x = x;
          state.y = y;
          state.dragTarget = eventTarget;
          state.isPointerDown = true;
          context.addRootEventTypes(rootEventTypes);
        }
        break;
      }
      case 'touchmove':
      case 'mousemove':
      case 'pointermove': {
        if (context.isPassive()) {
          return;
        }
        if (state.isPointerDown) {
          const obj =
            eventType === 'touchmove' ? (event: any).changedTouches[0] : event;
          const x = (obj: any).screenX;
          const y = (obj: any).screenY;
          state.x = x;
          state.y = y;
          if (!state.isDragging && x !== state.startX && y !== state.startY) {
            let shouldEnableDragging = true;

            if (
              props.onShouldClaimOwnership &&
              props.onShouldClaimOwnership()
            ) {
              shouldEnableDragging = context.requestOwnership(state.dragTarget);
            }
            if (shouldEnableDragging) {
              state.isDragging = true;
              if (props.onDragChange) {
                const dragChangeEventListener = () => {
                  props.onDragChange(true);
                };
                dispatchDragEvent(
                  context,
                  'dragchange',
                  dragChangeEventListener,
                  state,
                  true,
                );
              }
            } else {
              state.dragTarget = null;
              state.isPointerDown = false;
              context.removeRootEventTypes(rootEventTypes);
            }
          } else {
            if (props.onDragMove) {
              const eventData = {
                diffX: x - state.startX,
                diffY: y - state.startY,
              };
              dispatchDragEvent(
                context,
                'dragmove',
                props.onDragMove,
                state,
                false,
                eventData,
              );
            }
            (event: any).preventDefault();
          }
        }
        break;
      }
      case 'pointercancel':
      case 'touchcancel':
      case 'touchend':
      case 'mouseup':
      case 'pointerup': {
        if (state.isDragging) {
          if (props.onShouldClaimOwnership) {
            context.releaseOwnership(state.dragTarget);
          }
          if (props.onDragEnd) {
            dispatchDragEvent(context, 'dragend', props.onDragEnd, state, true);
          }
          if (props.onDragChange) {
            const dragChangeEventListener = () => {
              props.onDragChange(false);
            };
            dispatchDragEvent(
              context,
              'dragchange',
              dragChangeEventListener,
              state,
              true,
            );
          }
          state.isDragging = false;
        }
        if (state.isPointerDown) {
          state.dragTarget = null;
          state.isPointerDown = false;
          context.removeRootEventTypes(rootEventTypes);
        }
        break;
      }
    }
  },
};

export default {
  $$typeof: REACT_EVENT_COMPONENT_TYPE,
  props: null,
  responder: DragResponder,
};
