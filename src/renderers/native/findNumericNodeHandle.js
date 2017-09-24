/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @providesModule findNumericNodeHandle
 * @flow
 */
'use strict';

var findNodeHandle = require('findNodeHandle');

/**
 * External users of findNodeHandle() expect the host tag number return type.
 * The injected findNodeHandle() strategy returns the instance wrapper though.
 * See NativeMethodsMixin#setNativeProps for more info on why this is done.
 */
module.exports = function findNumericNodeHandleFiber(
  componentOrHandle: any,
): ?number {
  const instance: any = findNodeHandle(componentOrHandle);
  if (instance == null || typeof instance === 'number') {
    return instance;
  }
  return instance._nativeTag;
};
