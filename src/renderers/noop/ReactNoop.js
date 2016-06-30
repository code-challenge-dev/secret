/**
 * Copyright 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule ReactNoop
 * @flow
 */

/**
 * This is a renderer of React that doesn't have a render target output.
 * It is useful to demonstrate the internals of the reconciler in isolation
 * and for testing semantics of reconciliation separate from the host
 * environment.
 */

'use strict';

import type { Fiber } from 'ReactFiber';
import type { HostChildren } from 'ReactFiberReconciler';

var ReactFiberReconciler = require('ReactFiberReconciler');

var scheduledHighPriCallback = null;
var scheduledLowPriCallback = null;

type Props = { };
type Instance = { id: number };

var instanceCounter = 0;

var NoopRenderer = ReactFiberReconciler({

  createInstance(type : string, props : Props, children : HostChildren<Instance>) : Instance {
    console.log('Create instance #' + instanceCounter);
    return {
      id: instanceCounter++
    };
  },

  prepareUpdate(instance : Instance, oldProps : Props, newProps : Props, children : HostChildren<Instance>) : boolean {
    console.log('Prepare for update on #' + instance.id);
    return true;
  },

  commitUpdate(instance : Instance, oldProps : Props, newProps : Props, children : HostChildren<Instance>) : void {
    console.log('Commit update on #' + instance.id);
  },

  deleteInstance(instance : Instance) : void {
    console.log('Delete #' + instance.id);
  },

  scheduleHighPriCallback(callback) {
    scheduledHighPriCallback = callback;
  },

  scheduleLowPriCallback(callback) {
    scheduledLowPriCallback = callback;
  },

});

var root = null;

var ReactNoop = {

  render(element : ReactElement<any>) {
    if (!root) {
      root = NoopRenderer.mountContainer(element, null);
    } else {
      NoopRenderer.updateContainer(element, root);
    }
  },

  flushHighPri() {
    var cb = scheduledHighPriCallback;
    if (cb === null) {
      return;
    }
    scheduledHighPriCallback = null;
    cb();
  },

  flushLowPri(timeout : number = Infinity) {
    var cb = scheduledLowPriCallback;
    if (cb === null) {
      return;
    }
    scheduledLowPriCallback = null;
    var timeRemaining = timeout;
    cb({
      timeRemaining() {
        // Simulate a fix amount of time progressing between each call.
        timeRemaining -= 5;
        if (timeRemaining < 0) {
          timeRemaining = 0;
        }
        return timeRemaining;
      },
    });
  },

  flush() {
    ReactNoop.flushHighPri();
    ReactNoop.flushLowPri();
  },

  // Logs the current state of the tree.
  dumpTree() {
    if (!root) {
      console.log('Nothing rendered yet.');
      return;
    }
    function logFiber(fiber : Fiber, depth) {
      console.log('  '.repeat(depth) + '- ' + (fiber.type ? fiber.type.name || fiber.type : '[root]'), '[' + fiber.pendingWorkPriority + (fiber.pendingProps ? '*' : '') + ']');
      if (fiber.child) {
        logFiber(fiber.child, depth + 1);
      }
      if (fiber.sibling) {
        logFiber(fiber.sibling, depth);
      }
    }
    logFiber((root.stateNode : any).current, 0);
  },

};

module.exports = ReactNoop;
