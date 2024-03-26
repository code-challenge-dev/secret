/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let ReactDOM;
let React;
let ReactCache;
let ReactTestRenderer;
let act;

describe('ReactTestRenderer', () => {
  beforeEach(() => {
    jest.resetModules();
    ReactDOM = require('react-dom');

    // Isolate test renderer.
    jest.resetModules();
    React = require('react');
    ReactCache = require('react-cache');
    ReactTestRenderer = require('react-test-renderer');
    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
  });

  it('should warn if used to render a ReactDOM portal', async () => {
    const container = document.createElement('div');
    let error;

    await expect(async () => {
      await act(() => {
        ReactTestRenderer.create(ReactDOM.createPortal('foo', container));
      }).catch(e => (error = e));
    }).toErrorDev('An invalid container has been provided.', {
      withoutStack: true,
    });

    // After the update throws, a subsequent render is scheduled to
    // unmount the whole tree. This update also causes an error, so React
    // throws an AggregateError.
    const errors = error.errors;
    expect(errors.length).toBe(2);
    expect(errors[0].message.includes('indexOf is not a function')).toBe(true);
    expect(errors[1].message.includes('indexOf is not a function')).toBe(true);
  });

  describe('timed out Suspense hidden subtrees should not be observable via toJSON', () => {
    let AsyncText;
    let PendingResources;
    let TextResource;

    beforeEach(() => {
      PendingResources = {};
      TextResource = ReactCache.unstable_createResource(
        text =>
          new Promise(resolve => {
            PendingResources[text] = resolve;
          }),
        text => text,
      );

      AsyncText = ({text}) => {
        const value = TextResource.read(text);
        return value;
      };
    });

    it('for root Suspense components', async () => {
      const App = ({text}) => {
        return (
          <React.Suspense fallback="fallback">
            <AsyncText text={text} />
          </React.Suspense>
        );
      };

      let root;
      await act(() => {
        root = ReactTestRenderer.create(<App text="initial" />);
      });
      await act(() => {
        PendingResources.initial('initial');
      });
      expect(root.toJSON()).toEqual('initial');

      await act(() => {
        root.update(<App text="dynamic" />);
      });
      expect(root.toJSON()).toEqual('fallback');

      await act(() => {
        PendingResources.dynamic('dynamic');
      });
      expect(root.toJSON()).toEqual('dynamic');
    });

    it('for nested Suspense components', async () => {
      const App = ({text}) => {
        return (
          <div>
            <React.Suspense fallback="fallback">
              <AsyncText text={text} />
            </React.Suspense>
          </div>
        );
      };

      let root;
      await act(() => {
        root = ReactTestRenderer.create(<App text="initial" />);
      });
      await act(() => {
        PendingResources.initial('initial');
      });
      expect(root.toJSON().children).toEqual(['initial']);

      await act(() => {
        root.update(<App text="dynamic" />);
      });
      expect(root.toJSON().children).toEqual(['fallback']);

      await act(() => {
        PendingResources.dynamic('dynamic');
      });
      expect(root.toJSON().children).toEqual(['dynamic']);
    });
  });
});
