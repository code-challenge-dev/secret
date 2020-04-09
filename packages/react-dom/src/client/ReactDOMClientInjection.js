/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {setComponentTree} from 'legacy-events/EventPluginUtils';

import {
  getFiberCurrentPropsFromNode,
  getInstanceFromNode,
  getNodeFromInstance,
} from './ReactDOMComponentTree';
import BeforeInputEventPlugin from '../events/plugins/LegacyBeforeInputEventPlugin';
import ChangeEventPlugin from '../events/plugins/LegacyChangeEventPlugin';
import EnterLeaveEventPlugin from '../events/plugins/LegacyEnterLeaveEventPlugin';
import SelectEventPlugin from '../events/plugins/LegacySelectEventPlugin';
import SimpleEventPlugin from '../events/plugins/LegacySimpleEventPlugin';
import {
  injectEventPluginOrder,
  injectEventPluginsByName,
  injectEventPlugins,
} from 'legacy-events/EventPluginRegistry';
import {enableModernEventSystem} from 'shared/ReactFeatureFlags';

if (enableModernEventSystem) {
  injectEventPlugins([
    SimpleEventPlugin,
    EnterLeaveEventPlugin,
    ChangeEventPlugin,
    SelectEventPlugin,
    BeforeInputEventPlugin,
  ]);
} else {
  /**
   * Specifies a deterministic ordering of `EventPlugin`s. A convenient way to
   * reason about plugins, without having to package every one of them. This
   * is better than having plugins be ordered in the same order that they
   * are injected because that ordering would be influenced by the packaging order.
   * `ResponderEventPlugin` must occur before `SimpleEventPlugin` so that
   * preventing default on events is convenient in `SimpleEventPlugin` handlers.
   */
  const DOMEventPluginOrder = [
    'ResponderEventPlugin',
    'SimpleEventPlugin',
    'EnterLeaveEventPlugin',
    'ChangeEventPlugin',
    'SelectEventPlugin',
    'BeforeInputEventPlugin',
  ];

  /**
   * Inject modules for resolving DOM hierarchy and plugin ordering.
   */
  injectEventPluginOrder(DOMEventPluginOrder);
  setComponentTree(
    getFiberCurrentPropsFromNode,
    getInstanceFromNode,
    getNodeFromInstance,
  );

  /**
   * Some important event plugins included by default (without having to require
   * them).
   */
  injectEventPluginsByName({
    SimpleEventPlugin: SimpleEventPlugin,
    EnterLeaveEventPlugin: EnterLeaveEventPlugin,
    ChangeEventPlugin: ChangeEventPlugin,
    SelectEventPlugin: SelectEventPlugin,
    BeforeInputEventPlugin: BeforeInputEventPlugin,
  });
}
