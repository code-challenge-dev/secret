/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  ReactResponderEvent,
  ReactResponderContext,
} from 'shared/ReactTypes';
import {REACT_EVENT_COMPONENT_TYPE} from 'shared/ReactSymbols';
import {getEventCurrentTarget} from './utils.js';

type FocusProps = {
  disabled: boolean,
  onBlur: (e: FocusEvent) => void,
  onFocus: (e: FocusEvent) => void,
  onFocusChange: boolean => void,
  onFocusVisibleChange: boolean => void,
};

type FocusState = {
  focusTarget: null | Element | Document,
  isFocused: boolean,
  isLocalFocusVisible: boolean,
};

type FocusEventType = 'focus' | 'blur' | 'focuschange' | 'focusvisiblechange';

type FocusEvent = {|
  target: Element | Document,
  type: FocusEventType,
|};

const targetEventTypes = [
  {name: 'focus', passive: true, capture: true},
  {name: 'blur', passive: true, capture: true},
];

const rootEventTypes = [
  'keydown',
  'keypress',
  'keyup',
  'mousemove',
  'mousedown',
  'mouseup',
  'pointermove',
  'pointerdown',
  'pointerup',
  'touchmove',
  'touchstart',
  'touchend',
];

function createFocusEvent(
  type: FocusEventType,
  target: Element | Document,
): FocusEvent {
  return {
    target,
    type,
  };
}

function dispatchFocusInEvents(
  context: ReactResponderContext,
  props: FocusProps,
  state: FocusState,
) {
  const target = ((state.focusTarget: any): Element | Document);
  if (props.onFocus) {
    const syntheticEvent = createFocusEvent('focus', target);
    context.dispatchEvent(syntheticEvent, props.onFocus, {discrete: true});
  }
  if (props.onFocusChange) {
    const listener = () => {
      props.onFocusChange(true);
    };
    const syntheticEvent = createFocusEvent('focuschange', target);
    context.dispatchEvent(syntheticEvent, listener, {discrete: true});
  }
  if (props.onFocusVisibleChange && state.isLocalFocusVisible) {
    const listener = () => {
      props.onFocusVisibleChange(true);
    };
    const syntheticEvent = createFocusEvent('focusvisiblechange', target);
    context.dispatchEvent(syntheticEvent, listener, {discrete: true});
  }
}

function dispatchFocusOutEvents(
  context: ReactResponderContext,
  props: FocusProps,
  state: FocusState,
) {
  const target = ((state.focusTarget: any): Element | Document);
  if (props.onBlur) {
    const syntheticEvent = createFocusEvent('blur', target);
    context.dispatchEvent(syntheticEvent, props.onBlur, {discrete: true});
  }
  if (props.onFocusChange) {
    const listener = () => {
      props.onFocusChange(false);
    };
    const syntheticEvent = createFocusEvent('focuschange', target);
    context.dispatchEvent(syntheticEvent, listener, {discrete: true});
  }
  dispatchFocusVisibleOutEvent(context, props, state);
}

function dispatchFocusVisibleOutEvent(
  context: ReactResponderContext,
  props: FocusProps,
  state: FocusState,
) {
  const target = ((state.focusTarget: any): Element | Document);
  if (props.onFocusVisibleChange && state.isLocalFocusVisible) {
    const listener = () => {
      props.onFocusVisibleChange(false);
    };
    const syntheticEvent = createFocusEvent('focusvisiblechange', target);
    context.dispatchEvent(syntheticEvent, listener, {discrete: true});
    state.isLocalFocusVisible = false;
  }
}

function unmountResponder(
  context: ReactResponderContext,
  props: FocusProps,
  state: FocusState,
): void {
  if (state.isFocused) {
    dispatchFocusOutEvents(context, props, state);
  }
}

let isGlobalFocusVisible = true;

const FocusResponder = {
  targetEventTypes,
  rootEventTypes,
  createInitialState(): FocusState {
    return {
      focusTarget: null,
      isFocused: false,
      isLocalFocusVisible: false,
    };
  },
  stopLocalPropagation: true,
  onEvent(
    event: ReactResponderEvent,
    context: ReactResponderContext,
    props: FocusProps,
    state: FocusState,
  ): void {
    const {type, target} = event;

    if (props.disabled) {
      if (state.isFocused) {
        dispatchFocusOutEvents(context, props, state);
        state.isFocused = false;
        state.focusTarget = null;
      }
      return;
    }

    switch (type) {
      case 'focus': {
        if (!state.isFocused) {
          // Limit focus events to the direct child of the event component.
          // Browser focus is not expected to bubble.
          state.focusTarget = getEventCurrentTarget(event, context);
          if (state.focusTarget === target) {
            state.isFocused = true;
            state.isLocalFocusVisible = isGlobalFocusVisible;
            dispatchFocusInEvents(context, props, state);
          }
        }
        break;
      }
      case 'blur': {
        if (state.isFocused) {
          dispatchFocusOutEvents(context, props, state);
          state.isFocused = false;
          state.focusTarget = null;
        }
        break;
      }
    }
  },
  onRootEvent(
    event: ReactResponderEvent,
    context: ReactResponderContext,
    props: FocusProps,
    state: FocusState,
  ): void {
    const {type, target} = event;

    switch (type) {
      case 'mousemove':
      case 'mousedown':
      case 'mouseup':
      case 'pointermove':
      case 'pointerdown':
      case 'pointerup':
      case 'touchmove':
      case 'touchstart':
      case 'touchend': {
        // Ignore a Safari quirks where 'mousemove' is dispatched on the 'html'
        // element when the window blurs.
        if (type === 'mousemove' && target.nodeName === 'HTML') {
          return;
        }

        isGlobalFocusVisible = false;

        // Focus should stop being visible if a pointer is used on the element
        // after it was focused using a keyboard.
        if (
          state.focusTarget === getEventCurrentTarget(event, context) &&
          (type === 'mousedown' ||
            type === 'touchstart' ||
            type === 'pointerdown')
        ) {
          dispatchFocusVisibleOutEvent(context, props, state);
        }
        break;
      }

      case 'keydown':
      case 'keypress':
      case 'keyup': {
        const nativeEvent = event.nativeEvent;
        if (
          nativeEvent.key === 'Tab' &&
          !(nativeEvent.metaKey || nativeEvent.altKey || nativeEvent.ctrlKey)
        ) {
          isGlobalFocusVisible = true;
        }
        break;
      }
    }
  },
  onUnmount(
    context: ReactResponderContext,
    props: FocusProps,
    state: FocusState,
  ) {
    unmountResponder(context, props, state);
  },
  onOwnershipChange(
    context: ReactResponderContext,
    props: FocusProps,
    state: FocusState,
  ) {
    unmountResponder(context, props, state);
  },
};

export default {
  $$typeof: REACT_EVENT_COMPONENT_TYPE,
  displayName: 'Focus',
  props: null,
  responder: FocusResponder,
};
