/**
 * Copyright (c) 2013-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @providesModule ReactMockedComponentTestComponent
 */

'use strict';

var React = require('ReactEntry');

class ReactMockedComponentTestComponent extends React.Component {
  state = {foo: 'bar'};

  hasCustomMethod() {
    return true;
  }

  render() {
    return <span />;
  }

}
ReactMockedComponentTestComponent.defaultProps = {bar: 'baz'};

module.exports = ReactMockedComponentTestComponent;
