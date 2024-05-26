/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import ReactSharedInternals from 'shared/ReactSharedInternals';
import {enableOwnerStacks} from 'shared/ReactFeatureFlags';

let suppressWarning = false;
export function setSuppressWarning(newSuppressWarning) {
  if (__DEV__) {
    suppressWarning = newSuppressWarning;
  }
}

// In DEV, calls to console.warn and console.error get replaced
// by calls to these methods by a Babel plugin.
//
// In PROD (or in packages without access to React internals),
// they are left as they are instead.

export function warn(format, ...args) {
  if (__DEV__) {
    if (!suppressWarning) {
      printWarning('warn', format, args);
    }
  }
}

export function error(format, ...args) {
  if (__DEV__) {
    if (!suppressWarning) {
      printWarning('error', format, args);
    }
  }
}

// eslint-disable-next-line react-internal/no-production-logging
const supportsCreateTask = __DEV__ && enableOwnerStacks && !!console.createTask;

function printWarning(level, format, args) {
  // When changing this logic, you might want to also
  // update consoleWithStackDev.www.js as well.
  if (__DEV__) {
    const isErrorLogger =
      format === '%s\n\n%s\n' || format === '%o\n\n%s\n\n%s\n';

    if (!supportsCreateTask && ReactSharedInternals.getCurrentStack) {
      // We only add the current stack to the console when createTask is not supported.
      // Since createTask requires DevTools to be open to work, this means that stacks
      // can be lost while DevTools isn't open but we can't detect this.
      const stack = ReactSharedInternals.getCurrentStack();
      if (stack !== '') {
        format += '%s';
        args = args.concat([stack]);
      }
    }

    if (isErrorLogger) {
      // Don't prefix our default logging formatting in ReactFiberErrorLoggger.
      // Don't toString the arguments.
      args.unshift(format);
    } else {
      // TODO: Remove this prefix and stop toStringing in the wrapper and
      // instead do it at each callsite as needed.
      // Careful: RN currently depends on this prefix
      // eslint-disable-next-line react-internal/safe-string-coercion
      args = args.map(item => String(item));
      args.unshift('Warning: ' + format);
    }
    // We intentionally don't use spread (or .apply) directly because it
    // breaks IE9: https://github.com/facebook/react/issues/13610
    // eslint-disable-next-line react-internal/no-production-logging
    Function.prototype.apply.call(console[level], console, args);
  }
}
