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
var ReactNoop;
var ReactFeatureFlags;

describe('ReactIncrementalTriangle', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactNoop = require('ReactNoopEntry');

    ReactFeatureFlags = require('ReactFeatureFlags');
    ReactFeatureFlags.disableNewFiberFeatures = false;
  });

  function span(prop) {
    return {type: 'span', children: [], prop};
  }

  const FLUSH = 'FLUSH';
  function flush(unitsOfWork = Infinity) {
    return {
      type: FLUSH,
      unitsOfWork,
    };
  }

  const STEP = 'STEP';
  function step(counter) {
    return {
      type: STEP,
      counter,
    };
  }

  const INTERRUPT = 'INTERRUPT';
  function interrupt(key) {
    return {
      type: INTERRUPT,
    };
  }

  const TOGGLE = 'TOGGLE';
  function toggle(childIndex) {
    return {
      type: TOGGLE,
      childIndex,
    };
  }

  function TriangleSimulator() {
    let triangles = [];
    let leafTriangles = [];
    let yieldAfterEachRender = false;
    class Triangle extends React.Component {
      constructor(props) {
        super();
        this.index = triangles.length;
        triangles.push(this);
        if (props.depth === 0) {
          this.leafIndex = leafTriangles.length;
          leafTriangles.push(this);
        }
        this.state = {isActive: false};
      }
      activate() {
        if (this.props.depth !== 0) {
          throw new Error('Cannot activate non-leaf component');
        }
        ReactNoop.syncUpdates(() => {
          this.setState({isActive: true});
        });
      }
      deactivate() {
        if (this.props.depth !== 0) {
          throw new Error('Cannot deactivate non-leaf component');
        }
        ReactNoop.syncUpdates(() => {
          this.setState({isActive: false});
        });
      }
      shouldComponentUpdate(nextProps, nextState) {
        return (
          this.props.counter !== nextProps.counter ||
          this.state.isActive !== nextState.isActive
        );
      }
      render() {
        if (yieldAfterEachRender) {
          ReactNoop.yield(this);
        }
        const {counter, depth} = this.props;
        if (depth === 0) {
          if (this.state.isActive) {
            return <span prop={'*' + counter + '*'} />;
          }
          return <span prop={counter} />;
        }
        return [
          <Triangle key={1} counter={counter} depth={depth - 1} />,
          <Triangle key={2} counter={counter} depth={depth - 1} />,
          <Triangle key={3} counter={counter} depth={depth - 1} />,
        ];
      }
    }

    let appInstance;
    class App extends React.Component {
      state = {counter: 0};
      interrupt() {
        // Triggers a restart from the top.
        ReactNoop.syncUpdates(() => {
          this.forceUpdate();
        });
      }
      setCounter(counter) {
        const currentCounter = this.state.counter;
        this.setState({counter});
        return currentCounter;
      }
      render() {
        appInstance = this;
        return <Triangle counter={this.state.counter} depth={3} />;
      }
    }

    const depth = 3;

    let keyCounter = 0;
    function reset(nextStep = 0) {
      triangles = [];
      leafTriangles = [];
      // Remounts the whole tree by changing the key
      ReactNoop.render(<App depth={depth} key={keyCounter++} />);
      ReactNoop.flush();
      assertConsistentTree();
      return appInstance;
    }

    reset();
    const totalChildren = leafTriangles.length;
    const totalTriangles = triangles.length;

    function assertConsistentTree(activeTriangle, counter) {
      const activeIndex = activeTriangle ? activeTriangle.leafIndex : -1;

      const children = ReactNoop.getChildren();
      for (let i = 0; i < children.length; i++) {
        let child = children[i];
        let num = child.prop;

        // If an expected counter is not specified, use the value of the
        // first child.
        if (counter === undefined) {
          if (typeof num === 'string') {
            counter = num.substr(1, num.length - 2);
          } else {
            counter = num;
          }
        }

        if (i === activeIndex) {
          if (num !== `*${counter}*`) {
            throw new Error(
              `Triangle ${i} is inconsistent: ${num} instead of *${counter}*.`,
            );
          }
        } else {
          if (num !== counter) {
            throw new Error(
              `Triangle ${i} is inconsistent: ${num} instead of ${counter}.`,
            );
          }
        }
      }
    }

    function simulate(...actions) {
      const app = reset();
      let expectedCounterAtEnd = app.state.counter;

      let activeTriangle = null;
      ReactNoop.batchedUpdates(() => {
        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          switch (action.type) {
            case FLUSH:
              ReactNoop.flushUnitsOfWork(action.unitsOfWork);
              break;
            case STEP:
              app.setCounter(action.counter);
              expectedCounterAtEnd = action.counter;
              break;
            case INTERRUPT:
              app.interrupt();
              break;
            case TOGGLE:
              const targetTriangle = leafTriangles[action.childIndex];
              if (targetTriangle === undefined) {
                throw new Error('Target index is out of bounds');
              }
              if (targetTriangle === activeTriangle) {
                activeTriangle = null;
                targetTriangle.deactivate();
              } else {
                if (activeTriangle !== null) {
                  activeTriangle.deactivate();
                }
                activeTriangle = targetTriangle;
                targetTriangle.activate();
              }
              break;
            default:
              break;
          }
        }
      });
      // Flush remaining work
      ReactNoop.flush();
      assertConsistentTree(activeTriangle, expectedCounterAtEnd);
    }

    return {simulate, totalChildren, totalTriangles};
  }

  xit('renders the triangle demo without inconsistencies', () => {
    const {simulate} = TriangleSimulator();
    simulate(step(1));
    simulate(toggle(0), step(1), toggle(0));
    simulate(step(1), toggle(0), flush(2), step(2), toggle(0));
  });

  xit('fuzz tester', () => {
    // This test is not deterministic because the inputs are randomized. It runs
    // a limited number of tests on every run. If it fails, it will output the
    // case that led to the failure. Add the failing case to the test above
    // to prevent future regressions.
    const {simulate, totalTriangles, totalChildren} = TriangleSimulator();

    const limit = 1000;

    function randomInteger(min, max) {
      min = Math.ceil(min);
      max = Math.floor(max);
      return Math.floor(Math.random() * (max - min)) + min;
    }

    function randomAction() {
      switch (randomInteger(0, 4)) {
        case 0:
          return flush(randomInteger(0, totalTriangles * 1.5));
        case 1:
          return step(randomInteger(0, 10));
        case 2:
          return interrupt();
        case 3:
          return toggle(randomInteger(0, totalChildren));
        default:
          throw new Error('Switch statement should be exhaustive');
      }
    }

    function randomActions(n) {
      let actions = [];
      for (let i = 0; i < n; i++) {
        actions.push(randomAction());
      }
      return actions;
    }

    function formatActions(actions) {
      let result = 'simulate(';
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        switch (action.type) {
          case FLUSH:
            result += `flush(${action.unitsOfWork})`;
            break;
          case STEP:
            result += `step(${action.counter})`;
            break;
          case INTERRUPT:
            result += 'interrupt()';
            break;
          case TOGGLE:
            result += `toggle(${action.childIndex})`;
            break;
          default:
            throw new Error('Switch statement should be exhaustive');
        }
        if (i !== actions.length - 1) {
          result += ', ';
        }
      }
      result += ')';
      return result;
    }

    for (let i = 0; i < limit; i++) {
      const actions = randomActions(5);
      try {
        simulate(...actions);
      } catch (e) {
        console.error(
          `
Triangle fuzz tester error! Copy and paste the following line into the test suite:
  ${formatActions(actions)}
        `,
        );
        throw e;
      }
    }
  });
});
