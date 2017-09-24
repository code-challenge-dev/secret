/**
 * Copyright (c) 2013-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @providesModule ReactCurrentOwner
 * @flow
 */

'use strict';

import type {ReactInstance} from 'ReactInstanceType';
import type {Fiber} from 'ReactFiber';

/**
 * Keeps track of the current owner.
 *
 * The current owner is the component who should own any components that are
 * currently being constructed.
 */
var ReactCurrentOwner = {
  /**
   * @internal
   * @type {ReactComponent}
   */
  current: (null: null | ReactInstance | Fiber),
};

module.exports = ReactCurrentOwner;
