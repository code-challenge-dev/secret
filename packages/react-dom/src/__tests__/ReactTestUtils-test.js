/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let createRenderer;
let React;
let ReactDOM;
let ReactDOMServer;
let ReactTestUtils;
let act;

function getTestDocument(markup) {
  const doc = document.implementation.createHTMLDocument('');
  doc.open();
  doc.write(
    markup ||
      '<!doctype html><html><meta charset=utf-8><title>test doc</title>',
  );
  doc.close();
  return doc;
}

describe('ReactTestUtils', () => {
  beforeEach(() => {
    createRenderer = require('react-test-renderer/shallow').createRenderer;
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMServer = require('react-dom/server');
    ReactTestUtils = require('react-dom/test-utils');
    act = ReactTestUtils.act;
  });

  it('Simulate should have locally attached media events', () => {
    expect(Object.keys(ReactTestUtils.Simulate).sort()).toMatchSnapshot();
  });

  it('SimulateNative should have locally attached media events', () => {
    expect(Object.keys(ReactTestUtils.SimulateNative).sort()).toMatchSnapshot();
  });

  it('gives Jest mocks a passthrough implementation with mockComponent()', () => {
    class MockedComponent extends React.Component {
      render() {
        throw new Error('Should not get here.');
      }
    }
    // This is close enough to what a Jest mock would give us.
    MockedComponent.prototype.render = jest.fn();

    // Patch it up so it returns its children.
    expect(() =>
      ReactTestUtils.mockComponent(MockedComponent),
    ).toLowPriorityWarnDev(
      'ReactTestUtils.mockComponent() is deprecated. ' +
        'Use shallow rendering or jest.mock() instead.\n\n' +
        'See https://fb.me/test-utils-mock-component for more information.',
      {withoutStack: true},
    );

    // De-duplication check
    ReactTestUtils.mockComponent(MockedComponent);

    const container = document.createElement('div');
    ReactDOM.render(<MockedComponent>Hello</MockedComponent>, container);
    expect(container.textContent).toBe('Hello');
  });

  it('can scryRenderedComponentsWithType', () => {
    class Child extends React.Component {
      render() {
        return null;
      }
    }
    class Wrapper extends React.Component {
      render() {
        return (
          <div>
            <Child />
          </div>
        );
      }
    }
    const renderedComponent = ReactTestUtils.renderIntoDocument(<Wrapper />);
    const scryResults = ReactTestUtils.scryRenderedComponentsWithType(
      renderedComponent,
      Child,
    );
    expect(scryResults.length).toBe(1);
  });

  it('can scryRenderedDOMComponentsWithClass with TextComponent', () => {
    class Wrapper extends React.Component {
      render() {
        return (
          <div>
            Hello <span>Jim</span>
          </div>
        );
      }
    }

    const renderedComponent = ReactTestUtils.renderIntoDocument(<Wrapper />);
    const scryResults = ReactTestUtils.scryRenderedDOMComponentsWithClass(
      renderedComponent,
      'NonExistentClass',
    );
    expect(scryResults.length).toBe(0);
  });

  it('can scryRenderedDOMComponentsWithClass with className contains \\n', () => {
    class Wrapper extends React.Component {
      render() {
        return (
          <div>
            Hello <span className={'x\ny'}>Jim</span>
          </div>
        );
      }
    }

    const renderedComponent = ReactTestUtils.renderIntoDocument(<Wrapper />);
    const scryResults = ReactTestUtils.scryRenderedDOMComponentsWithClass(
      renderedComponent,
      'x',
    );
    expect(scryResults.length).toBe(1);
  });

  it('can scryRenderedDOMComponentsWithClass with multiple classes', () => {
    class Wrapper extends React.Component {
      render() {
        return (
          <div>
            Hello <span className={'x y z'}>Jim</span>
          </div>
        );
      }
    }

    const renderedComponent = ReactTestUtils.renderIntoDocument(<Wrapper />);
    const scryResults1 = ReactTestUtils.scryRenderedDOMComponentsWithClass(
      renderedComponent,
      'x y',
    );
    expect(scryResults1.length).toBe(1);

    const scryResults2 = ReactTestUtils.scryRenderedDOMComponentsWithClass(
      renderedComponent,
      'x z',
    );
    expect(scryResults2.length).toBe(1);

    const scryResults3 = ReactTestUtils.scryRenderedDOMComponentsWithClass(
      renderedComponent,
      ['x', 'y'],
    );
    expect(scryResults3.length).toBe(1);

    expect(scryResults1[0]).toBe(scryResults2[0]);
    expect(scryResults1[0]).toBe(scryResults3[0]);

    const scryResults4 = ReactTestUtils.scryRenderedDOMComponentsWithClass(
      renderedComponent,
      ['x', 'a'],
    );
    expect(scryResults4.length).toBe(0);

    const scryResults5 = ReactTestUtils.scryRenderedDOMComponentsWithClass(
      renderedComponent,
      ['x a'],
    );
    expect(scryResults5.length).toBe(0);
  });

  it('traverses children in the correct order', () => {
    class Wrapper extends React.Component {
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(
      <Wrapper>
        {null}
        <div>purple</div>
      </Wrapper>,
      container,
    );
    const tree = ReactDOM.render(
      <Wrapper>
        <div>orange</div>
        <div>purple</div>
      </Wrapper>,
      container,
    );

    const log = [];
    ReactTestUtils.findAllInRenderedTree(tree, function(child) {
      if (ReactTestUtils.isDOMComponent(child)) {
        log.push(ReactDOM.findDOMNode(child).textContent);
      }
    });

    // Should be document order, not mount order (which would be purple, orange)
    expect(log).toEqual(['orangepurple', 'orange', 'purple']);
  });

  it('should support injected wrapper components as DOM components', () => {
    const injectedDOMComponents = [
      'button',
      'form',
      'iframe',
      'img',
      'input',
      'option',
      'select',
      'textarea',
    ];

    injectedDOMComponents.forEach(function(type) {
      const testComponent = ReactTestUtils.renderIntoDocument(
        React.createElement(type),
      );
      expect(testComponent.tagName).toBe(type.toUpperCase());
      expect(ReactTestUtils.isDOMComponent(testComponent)).toBe(true);
    });

    // Full-page components (html, head, body) can't be rendered into a div
    // directly...
    class Root extends React.Component {
      render() {
        return (
          <html ref="html">
            <head ref="head">
              <title>hello</title>
            </head>
            <body ref="body">hello, world</body>
          </html>
        );
      }
    }

    const markup = ReactDOMServer.renderToString(<Root />);
    const testDocument = getTestDocument(markup);
    const component = ReactDOM.hydrate(<Root />, testDocument);

    expect(component.refs.html.tagName).toBe('HTML');
    expect(component.refs.head.tagName).toBe('HEAD');
    expect(component.refs.body.tagName).toBe('BODY');
    expect(ReactTestUtils.isDOMComponent(component.refs.html)).toBe(true);
    expect(ReactTestUtils.isDOMComponent(component.refs.head)).toBe(true);
    expect(ReactTestUtils.isDOMComponent(component.refs.body)).toBe(true);
  });

  it('can scry with stateless components involved', () => {
    const Function = () => (
      <div>
        <hr />
      </div>
    );

    class SomeComponent extends React.Component {
      render() {
        return (
          <div>
            <Function />
            <hr />
          </div>
        );
      }
    }

    const inst = ReactTestUtils.renderIntoDocument(<SomeComponent />);
    const hrs = ReactTestUtils.scryRenderedDOMComponentsWithTag(inst, 'hr');
    expect(hrs.length).toBe(2);
  });

  it('provides a clear error when passing invalid objects to scry', () => {
    // This is probably too relaxed but it's existing behavior.
    ReactTestUtils.findAllInRenderedTree(null, 'span');
    ReactTestUtils.findAllInRenderedTree(undefined, 'span');
    ReactTestUtils.findAllInRenderedTree('', 'span');
    ReactTestUtils.findAllInRenderedTree(0, 'span');
    ReactTestUtils.findAllInRenderedTree(false, 'span');

    expect(() => {
      ReactTestUtils.findAllInRenderedTree([], 'span');
    }).toThrow(
      'findAllInRenderedTree(...): the first argument must be a React class instance. ' +
        'Instead received: an array.',
    );
    expect(() => {
      ReactTestUtils.scryRenderedDOMComponentsWithClass(10, 'button');
    }).toThrow(
      'scryRenderedDOMComponentsWithClass(...): the first argument must be a React class instance. ' +
        'Instead received: 10.',
    );
    expect(() => {
      ReactTestUtils.findRenderedDOMComponentWithClass('hello', 'button');
    }).toThrow(
      'findRenderedDOMComponentWithClass(...): the first argument must be a React class instance. ' +
        'Instead received: hello.',
    );
    expect(() => {
      ReactTestUtils.scryRenderedDOMComponentsWithTag(
        {x: true, y: false},
        'span',
      );
    }).toThrow(
      'scryRenderedDOMComponentsWithTag(...): the first argument must be a React class instance. ' +
        'Instead received: object with keys {x, y}.',
    );
    const div = document.createElement('div');
    expect(() => {
      ReactTestUtils.findRenderedDOMComponentWithTag(div, 'span');
    }).toThrow(
      'findRenderedDOMComponentWithTag(...): the first argument must be a React class instance. ' +
        'Instead received: a DOM node.',
    );
    expect(() => {
      ReactTestUtils.scryRenderedComponentsWithType(true, 'span');
    }).toThrow(
      'scryRenderedComponentsWithType(...): the first argument must be a React class instance. ' +
        'Instead received: true.',
    );
    expect(() => {
      ReactTestUtils.findRenderedComponentWithType(true, 'span');
    }).toThrow(
      'findRenderedComponentWithType(...): the first argument must be a React class instance. ' +
        'Instead received: true.',
    );
  });

  describe('Simulate', () => {
    it('should change the value of an input field', () => {
      const obj = {
        handler: function(e) {
          e.persist();
        },
      };
      spyOnDevAndProd(obj, 'handler').and.callThrough();
      const container = document.createElement('div');
      const node = ReactDOM.render(
        <input type="text" onChange={obj.handler} />,
        container,
      );

      node.value = 'giraffe';
      ReactTestUtils.Simulate.change(node);

      expect(obj.handler).toHaveBeenCalledWith(
        expect.objectContaining({target: node}),
      );
    });

    it('should change the value of an input field in a component', () => {
      class SomeComponent extends React.Component {
        render() {
          return (
            <div>
              <input
                type="text"
                ref="input"
                onChange={this.props.handleChange}
              />
            </div>
          );
        }
      }

      const obj = {
        handler: function(e) {
          e.persist();
        },
      };
      spyOnDevAndProd(obj, 'handler').and.callThrough();
      const container = document.createElement('div');
      const instance = ReactDOM.render(
        <SomeComponent handleChange={obj.handler} />,
        container,
      );

      const node = instance.refs.input;
      node.value = 'zebra';
      ReactTestUtils.Simulate.change(node);

      expect(obj.handler).toHaveBeenCalledWith(
        expect.objectContaining({target: node}),
      );
    });

    it('should throw when attempting to use a React element', () => {
      class SomeComponent extends React.Component {
        render() {
          return <div onClick={this.props.handleClick}>hello, world.</div>;
        }
      }

      const handler = jest.fn().mockName('spy');
      const shallowRenderer = createRenderer();
      const result = shallowRenderer.render(
        <SomeComponent handleClick={handler} />,
      );

      expect(() => ReactTestUtils.Simulate.click(result)).toThrowError(
        'TestUtils.Simulate expected a DOM node as the first argument but received ' +
          'a React element. Pass the DOM node you wish to simulate the event on instead. ' +
          'Note that TestUtils.Simulate will not work if you are using shallow rendering.',
      );
      expect(handler).not.toHaveBeenCalled();
    });

    it('should throw when attempting to use a component instance', () => {
      class SomeComponent extends React.Component {
        render() {
          return <div onClick={this.props.handleClick}>hello, world.</div>;
        }
      }

      const handler = jest.fn().mockName('spy');
      const container = document.createElement('div');
      const instance = ReactDOM.render(
        <SomeComponent handleClick={handler} />,
        container,
      );

      expect(() => ReactTestUtils.Simulate.click(instance)).toThrowError(
        'TestUtils.Simulate expected a DOM node as the first argument but received ' +
          'a component instance. Pass the DOM node you wish to simulate the event on instead.',
      );
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not warn when used with extra properties', () => {
      const CLIENT_X = 100;

      class Component extends React.Component {
        handleClick = e => {
          expect(e.clientX).toBe(CLIENT_X);
        };

        render() {
          return <div onClick={this.handleClick} />;
        }
      }

      const element = document.createElement('div');
      const instance = ReactDOM.render(<Component />, element);
      ReactTestUtils.Simulate.click(ReactDOM.findDOMNode(instance), {
        clientX: CLIENT_X,
      });
    });

    it('should set the type of the event', () => {
      let event;
      const stub = jest.fn().mockImplementation(e => {
        e.persist();
        event = e;
      });

      const container = document.createElement('div');
      const instance = ReactDOM.render(<div onKeyDown={stub} />, container);
      const node = ReactDOM.findDOMNode(instance);

      ReactTestUtils.Simulate.keyDown(node);

      expect(event.type).toBe('keydown');
      expect(event.nativeEvent.type).toBe('keydown');
    });

    it('should work with renderIntoDocument', () => {
      const onChange = jest.fn();

      class MyComponent extends React.Component {
        render() {
          return (
            <div>
              <input type="text" onChange={onChange} />
            </div>
          );
        }
      }

      const instance = ReactTestUtils.renderIntoDocument(<MyComponent />);
      const input = ReactTestUtils.findRenderedDOMComponentWithTag(
        instance,
        'input',
      );
      input.value = 'giraffe';
      ReactTestUtils.Simulate.change(input);

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({target: input}),
      );
    });
  });

  it('should call setState callback with no arguments', () => {
    let mockArgs;
    class Component extends React.Component {
      componentDidMount() {
        this.setState({}, (...args) => (mockArgs = args));
      }
      render() {
        return false;
      }
    }

    ReactTestUtils.renderIntoDocument(<Component />);
    expect(mockArgs.length).toEqual(0);
  });

  it('can use act to batch effects', () => {
    function App(props) {
      React.useEffect(props.callback);
      return null;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);

    try {
      let called = false;
      act(() => {
        ReactDOM.render(
          <App
            callback={() => {
              called = true;
            }}
          />,
          container,
        );
      });

      expect(called).toBe(true);
    } finally {
      document.body.removeChild(container);
    }
  });

  it('flushes effects on every call', () => {
    function App(props) {
      let [ctr, setCtr] = React.useState(0);
      React.useEffect(() => {
        props.callback(ctr);
      });
      return (
        <button id="button" onClick={() => setCtr(x => x + 1)}>
          click me!
        </button>
      );
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    let calledCtr = 0;
    act(() => {
      ReactDOM.render(
        <App
          callback={val => {
            calledCtr = val;
          }}
        />,
        container,
      );
    });
    const button = document.getElementById('button');
    function click() {
      button.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    }

    act(() => {
      click();
      click();
      click();
    });
    expect(calledCtr).toBe(3);
    act(click);
    expect(calledCtr).toBe(4);
    act(click);
    expect(calledCtr).toBe(5);

    document.body.removeChild(container);
  });

  it('can use act to batch effects on updates too', () => {
    function App() {
      let [ctr, setCtr] = React.useState(0);
      return (
        <button id="button" onClick={() => setCtr(x => x + 1)}>
          {ctr}
        </button>
      );
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    let button;
    act(() => {
      ReactDOM.render(<App />, container);
    });
    button = document.getElementById('button');
    expect(button.innerHTML).toBe('0');
    act(() => {
      button.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    });
    expect(button.innerHTML).toBe('1');
    document.body.removeChild(container);
  });

  it('detects setState being called outside of act(...)', () => {
    let setValueRef = null;
    function App() {
      let [value, setValue] = React.useState(0);
      setValueRef = setValue;
      return (
        <button id="button" onClick={() => setValue(2)}>
          {value}
        </button>
      );
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    let button;
    act(() => {
      ReactDOM.render(<App />, container);
      button = container.querySelector('#button');
      button.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    });
    expect(button.innerHTML).toBe('2');
    expect(() => setValueRef(1)).toWarnDev([
      'An update to App inside a test was not wrapped in act(...).',
    ]);
    document.body.removeChild(container);
  });

  it('lets a ticker update', () => {
    function App() {
      let [toggle, setToggle] = React.useState(0);
      React.useEffect(() => {
        let timeout = setTimeout(() => {
          setToggle(1);
        }, 200);
        return () => clearTimeout(timeout);
      });
      return toggle;
    }
    const container = document.createElement('div');

    act(() => {
      act(() => {
        ReactDOM.render(<App />, container);
      });
      jest.advanceTimersByTime(250);
    });

    expect(container.innerHTML).toBe('1');
  });

  it('warns if you return a value inside act', () => {
    expect(() => act(() => null)).toWarnDev(
      [
        'The callback passed to ReactTestUtils.act(...) function must not return anything.',
      ],
      {withoutStack: true},
    );
    expect(() => act(() => 123)).toWarnDev(
      [
        'The callback passed to ReactTestUtils.act(...) function must not return anything.',
      ],
      {withoutStack: true},
    );
  });

  it('warns if you try to await an .act call', () => {
    expect(act(() => {}).then).toWarnDev(
      [
        'Do not await the result of calling ReactTestUtils.act(...), it is not a Promise.',
      ],
      {withoutStack: true},
    );
  });
});
