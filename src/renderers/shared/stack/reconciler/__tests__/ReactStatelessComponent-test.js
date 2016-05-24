/**
 * Copyright 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @emails react-core
 */

'use strict';

var React;
var ReactDOM;
var ReactTestUtils;

function StatelessComponent(props) {
  return <div>{props.name}</div>;
}

describe('ReactStatelessComponent', function() {

  beforeEach(function() {
    React = require('React');
    ReactDOM = require('ReactDOM');
    ReactTestUtils = require('ReactTestUtils');
  });

  it('should render stateless component', function() {
    var el = document.createElement('div');
    ReactDOM.render(<StatelessComponent name="A" />, el);

    expect(el.textContent).toBe('A');
  });

  it('should update stateless component', function() {
    var Parent = React.createClass({
      render() {
        return <StatelessComponent {...this.props} />;
      },
    });

    var el = document.createElement('div');
    ReactDOM.render(<Parent name="A" />, el);
    expect(el.textContent).toBe('A');

    ReactDOM.render(<Parent name="B" />, el);
    expect(el.textContent).toBe('B');
  });

  it('should unmount stateless component', function() {
    var container = document.createElement('div');

    ReactDOM.render(<StatelessComponent name="A" />, container);
    expect(container.textContent).toBe('A');

    ReactDOM.unmountComponentAtNode(container);
    expect(container.textContent).toBe('');
  });

  it('should pass context thru stateless component', function() {
    var Child = React.createClass({
      contextTypes: {
        test: React.PropTypes.string.isRequired,
      },

      render: function() {
        return <div>{this.context.test}</div>;
      },
    });

    function Parent() {
      return <Child />;
    }

    var GrandParent = React.createClass({
      childContextTypes: {
        test: React.PropTypes.string.isRequired,
      },

      getChildContext() {
        return {test: this.props.test};
      },

      render: function() {
        return <Parent />;
      },
    });

    var el = document.createElement('div');
    ReactDOM.render(<GrandParent test="test" />, el);

    expect(el.textContent).toBe('test');

    ReactDOM.render(<GrandParent test="mest" />, el);

    expect(el.textContent).toBe('mest');
  });

  it('should warn when stateless component returns array', function() {
    spyOn(console, 'error');
    function NotAComponent() {
      return [<div />, <div />];
    }
    expect(function() {
      ReactTestUtils.renderIntoDocument(<div><NotAComponent /></div>);
    }).toThrow();
    expect(console.error.calls.length).toBe(1);
    expect(console.error.argsForCall[0][0]).toContain(
      'NotAComponent(...): A valid React element (or null) must be returned. '+
      'You may have returned undefined, an array or some other invalid object.'
    );
  });

  it('should throw on string refs in pure functions', function() {
    function Child() {
      return <div ref="me" />;
    }

    expect(function() {
      ReactTestUtils.renderIntoDocument(<Child test="test" />);
    }).toThrow(
      'Stateless function components cannot have refs.'
    );
  });

  it('should warn when given a ref', function() {
    spyOn(console, 'error');

    var Parent = React.createClass({
      displayName: 'Parent',
      render: function() {
        return <StatelessComponent name="A" ref="stateless"/>;
      },
    });
    ReactTestUtils.renderIntoDocument(<Parent/>);

    expect(console.error.argsForCall.length).toBe(1);
    expect(console.error.argsForCall[0][0]).toContain(
      'Stateless function components cannot be given refs ' +
      '(See ref "stateless" in StatelessComponent created by Parent). ' +
      'Attempts to access this ref will fail.'
    );
  });

  it('should provide a null ref', function() {
    function Child() {
      return <div />;
    }

    var comp = ReactTestUtils.renderIntoDocument(<Child />);
    expect(comp).toBe(null);
  });

  it('should use correct name in key warning', function() {
    function Child() {
      return <div>{[<span />]}</div>;
    }

    spyOn(console, 'error');
    ReactTestUtils.renderIntoDocument(<Child />);
    expect(console.error.argsForCall.length).toBe(1);
    expect(console.error.argsForCall[0][0]).toContain('a unique "key" prop');
    expect(console.error.argsForCall[0][0]).toContain('Child');
  });

  it('should support default props and prop types', function() {
    function Child(props) {
      return <div>{props.test}</div>;
    }
    Child.defaultProps = {test: 2};
    Child.propTypes = {test: React.PropTypes.string};

    spyOn(console, 'error');
    ReactTestUtils.renderIntoDocument(<Child />);
    expect(console.error.argsForCall.length).toBe(1);
    expect(
      console.error.argsForCall[0][0].replace(/\(at .+?:\d+\)/g, '(at **)')
    ).toBe(
      'Warning: Failed prop type: Invalid prop `test` of type `number` ' +
      'supplied to `Child`, expected `string`.\n' +
      '    in Child (at **)'
    );
  });

  it('should receive context', function() {
    var Parent = React.createClass({
      childContextTypes: {
        lang: React.PropTypes.string,
      },
      getChildContext: function() {
        return {lang: 'en'};
      },
      render: function() {
        return <Child />;
      },
    });
    function Child(props, context) {
      return <div>{context.lang}</div>;
    }
    Child.contextTypes = {lang: React.PropTypes.string};

    var el = document.createElement('div');
    ReactDOM.render(<Parent />, el);
    expect(el.textContent).toBe('en');
  });

  it('should work with arrow functions', function() {
    var Child = function() {
      return <div />;
    };
    // Will create a new bound function without a prototype, much like a native
    // arrow function.
    Child = Child.bind(this);

    expect(() => ReactTestUtils.renderIntoDocument(<Child />)).not.toThrow();
  });

  it('should allow simple functions to return null', function() {
    var Child = function() {
      return null;
    };
    expect(() => ReactTestUtils.renderIntoDocument(<Child />)).not.toThrow();
  });

  it('should allow simple functions to return false', function() {
    function Child() {
      return false;
    }
    expect(() => ReactTestUtils.renderIntoDocument(<Child />)).not.toThrow();
  });

  it('should warn when using non-React functions in JSX', function() {
    spyOn(console, 'error');
    function NotAComponent() {
      return [<div />, <div />];
    }
    expect(function() {
      ReactTestUtils.renderIntoDocument(<div><NotAComponent /></div>);
    }).toThrow();  // has no method 'render'
    expect(console.error.calls.length).toBe(1);
    expect(console.error.argsForCall[0][0]).toContain(
      'NotAComponent(...): A valid React element (or null) must be returned. You may ' +
      'have returned undefined, an array or some other invalid object.'
    );
  });
});
