/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

function getFakeModule() {
  return function FakeModule(props, data) {
    return data;
  };
}

const ReactFlightDOMRelayClientIntegration = {
  preloadModule(jsResource) {
    return null;
  },
  requireModule(jsResource) {
    return getFakeModule();
  },
};

module.exports = ReactFlightDOMRelayClientIntegration;
