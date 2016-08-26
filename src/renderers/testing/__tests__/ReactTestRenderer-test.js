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

var React = require('React');
var ReactTestRenderer = require('ReactTestRenderer');

describe('ReactTestRenderer', function() {

  it('renders a simple component', function() {
    function Link() {
      return <a role="link" />;
    }
    var renderer = ReactTestRenderer.create(<Link />);
    expect(renderer.toJSON()).toEqual({
      type: 'a',
      props: { role: 'link' },
      children: null,
    });
  });

  it('renders a top-level empty component', function() {
    function Empty() {
      return null;
    }
    var renderer = ReactTestRenderer.create(<Empty />);
    expect(renderer.toJSON()).toEqual(null);
  });

  it('exposes a type flag', function() {
    function Link() {
      return <a role="link" />;
    }
    var renderer = ReactTestRenderer.create(<Link />);
    var object = renderer.toJSON();
    expect(object.$$typeof).toBe(Symbol.for('react.test.json'));

    // $$typeof should not be enumerable.
    for (var key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        expect(key).not.toBe('$$typeof');
      }
    }
  });

  it('renders some basics with an update', function() {
    var renders = 0;

    class Component extends React.Component {
      state = {x: 3};

      render() {
        renders++;
        return (
          <div className="purple">
            {this.state.x}
            <Child />
            <Null />
          </div>
        );
      }

      componentDidMount() {
        this.setState({x: 7});
      }
    }

    var Child = () => (renders++, <moo />);
    var Null = () => (renders++, null);

    var renderer = ReactTestRenderer.create(<Component />);
    expect(renderer.toJSON()).toEqual({
      type: 'div',
      props: { className: 'purple' },
      children: [
        7,
        { type: 'moo', props: {}, children: null },
      ],
    });
    expect(renders).toBe(6);
  });

  it('exposes the instance', function() {
    class Mouse extends React.Component {
      constructor() {
        super();
        this.state = {mouse: 'mouse'};
      }
      handleMoose() {
        this.setState({mouse: 'moose'});
      }
      render() {
        return <div>{this.state.mouse}</div>;
      }
    }
    var renderer = ReactTestRenderer.create(<Mouse />);

    expect(renderer.toJSON()).toEqual({
      type: 'div',
      props: {},
      children: ['mouse'],
    });

    var mouse = renderer.getInstance();
    mouse.handleMoose();
    expect(renderer.toJSON()).toEqual({
      type: 'div',
      props: {},
      children: ['moose'],
    });
  });

  it('updates types', function() {
    var renderer = ReactTestRenderer.create(<div>mouse</div>);
    expect(renderer.toJSON()).toEqual({
      type: 'div',
      props: {},
      children: ['mouse'],
    });

    renderer.update(<span>mice</span>);
    expect(renderer.toJSON()).toEqual({
      type: 'span',
      props: {},
      children: ['mice'],
    });
  });

  it('updates children', function() {
    var renderer = ReactTestRenderer.create(
      <div>
        <span key="a">A</span>
        <span key="b">B</span>
        <span key="c">C</span>
      </div>
    );
    expect(renderer.toJSON()).toEqual({
      type: 'div',
      props: {},
      children: [
        {type: 'span', props: {}, children: ['A']},
        {type: 'span', props: {}, children: ['B']},
        {type: 'span', props: {}, children: ['C']},
      ],
    });

    renderer.update(
      <div>
        <span key="d">D</span>
        <span key="c">C</span>
        <span key="b">B</span>
      </div>
    );
    expect(renderer.toJSON()).toEqual({
      type: 'div',
      props: {},
      children: [
        {type: 'span', props: {}, children: ['D']},
        {type: 'span', props: {}, children: ['C']},
        {type: 'span', props: {}, children: ['B']},
      ],
    });
  });

  it('does the full lifecycle', function() {
    var log = [];
    class Log extends React.Component {
      render() {
        log.push('render ' + this.props.name);
        return <div />;
      }
      componentDidMount() {
        log.push('mount ' + this.props.name);
      }
      componentWillUnmount() {
        log.push('unmount ' + this.props.name);
      }
    }

    var renderer = ReactTestRenderer.create(<Log key="foo" name="Foo" />);
    renderer.update(<Log key="bar" name="Bar" />);
    renderer.unmount();

    expect(log).toEqual([
      'render Foo',
      'mount Foo',
      'unmount Foo',
      'render Bar',
      'mount Bar',
      'unmount Bar',
    ]);
  });

  it('gives a ref to native components', function() {
    var log = [];
    ReactTestRenderer.create(<div ref={(r) => log.push(r)} />);
    expect(log).toEqual([null]);
  });

  it('supports error boundaries', function() {
    var log = [];
    class Angry extends React.Component {
      render() {
        log.push('Angry render');
        throw new Error('Please, do not render me.');
      }
      componentDidMount() {
        log.push('Angry componentDidMount');
      }
      componentWillUnmount() {
        log.push('Angry componentWillUnmount');
      }
    }

    class Boundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = {error: false};
      }
      render() {
        log.push('Boundary render');
        if (!this.state.error) {
          return (
            <div><button onClick={this.onClick}>ClickMe</button><Angry /></div>
          );
        } else {
          return <div>Happy Birthday!</div>;
        }
      }
      componentDidMount() {
        log.push('Boundary componentDidMount');
      }
      componentWillUnmount() {
        log.push('Boundary componentWillUnmount');
      }
      onClick() {
        /* do nothing */
      }
      unstable_handleError() {
        this.setState({error: true});
      }
    }

    var renderer = ReactTestRenderer.create(<Boundary />);
    expect(renderer.toJSON()).toEqual({
      type: 'div',
      props: {},
      children: ['Happy Birthday!'],
    });
    expect(log).toEqual([
      'Boundary render',
      'Angry render',
      'Boundary render',
      'Boundary componentDidMount',
    ]);
  });

});
