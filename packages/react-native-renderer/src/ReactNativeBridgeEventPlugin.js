/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
'use strict';

import type {ReactNativeBaseComponentViewConfig} from './ReactNativeTypes';

import EventPropagators from 'events/EventPropagators';
import SyntheticEvent from 'events/SyntheticEvent';
import invariant from 'fbjs/lib/invariant';

const customBubblingEventTypes = {};
const customDirectEventTypes = {};

const ReactNativeBridgeEventPlugin = {
  eventTypes: {},

  /**
   * @see {EventPluginHub.extractEvents}
   */
  extractEvents: function(
    topLevelType: string,
    targetInst: Object,
    nativeEvent: Event,
    nativeEventTarget: Object,
  ): ?Object {
    const bubbleDispatchConfig = customBubblingEventTypes[topLevelType];
    const directDispatchConfig = customDirectEventTypes[topLevelType];
    invariant(
      bubbleDispatchConfig || directDispatchConfig,
      'Unsupported top level event type "%s" dispatched',
      topLevelType,
    );
    const event = SyntheticEvent.getPooled(
      bubbleDispatchConfig || directDispatchConfig,
      targetInst,
      nativeEvent,
      nativeEventTarget,
    );
    if (bubbleDispatchConfig) {
      EventPropagators.accumulateTwoPhaseDispatches(event);
    } else if (directDispatchConfig) {
      EventPropagators.accumulateDirectDispatches(event);
    } else {
      return null;
    }
    return event;
  },

  processEventTypes: function(
    viewConfig: ReactNativeBaseComponentViewConfig,
  ): void {
    const {bubblingEventTypes, directEventTypes} = viewConfig;

    if (__DEV__) {
      if (bubblingEventTypes != null && directEventTypes != null) {
        for (const topLevelType in directEventTypes) {
          invariant(
            bubblingEventTypes[topLevelType] == null,
            'Event cannot be both direct and bubbling: %s',
            topLevelType,
          );
        }
      }
    }

    if (bubblingEventTypes != null) {
      for (const topLevelType in bubblingEventTypes) {
        if (customBubblingEventTypes[topLevelType] == null) {
          ReactNativeBridgeEventPlugin.eventTypes[
            topLevelType
          ] = customBubblingEventTypes[topLevelType] =
            bubblingEventTypes[topLevelType];
        }
      }
    }

    if (directEventTypes != null) {
      for (const topLevelType in directEventTypes) {
        if (customDirectEventTypes[topLevelType] == null) {
          ReactNativeBridgeEventPlugin.eventTypes[
            topLevelType
          ] = customDirectEventTypes[topLevelType] =
            directEventTypes[topLevelType];
        }
      }
    }
  },
};

export default ReactNativeBridgeEventPlugin;
