'use strict';

jest.mock('shared/ReactFeatureFlags', () => {
  jest.mock(
    'ReactNativeInternalFeatureFlags',
    () =>
      jest.requireActual('shared/forks/ReactFeatureFlags.native-fb-dynamic.js'),
    {virtual: true}
  );
  const actual = jest.requireActual(
    'shared/forks/ReactFeatureFlags.native-fb.js'
  );

  actual.enableOwnerStacks = __VARIANT__;

  // Lots of tests use these, but we don't want to expose it to RN.
  // Ideally, tests for xplat wouldn't use react-dom, but many of our tests do.
  // Since the xplat tests run with the www entry points, some of these flags
  // need to be set to the www value for the entrypoint, otherwise gating would
  // fail due to the tests passing. Ideally, the www entry points for these APIs
  // would be gated, and then these would fail correctly.
  actual.enableLegacyCache = true;
  actual.enableLegacyHidden = true;
  actual.enableScopeAPI = true;
  actual.enableTaint = false;

  return actual;
});

jest.mock('react-noop-renderer', () =>
  jest.requireActual('react-noop-renderer/persistent')
);

global.__PERSISTENT__ = true;
global.__XPLAT__ = true;
