/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {CacheDispatcher} from 'react-reconciler/src/ReactInternalTypes';
import ReactSharedInternals from 'shared/ReactSharedInternals';

const ReactCurrentCache = ReactSharedInternals.ReactCurrentCache;

function unsupported() {
  throw new Error('This feature is not supported by ReactSuspenseTestUtils.');
}

export function waitForSuspense<T>(fn: () => T): Promise<T> {
  const cache: Map<Function, mixed> = new Map();
  const testDispatcher: CacheDispatcher = {
    getCacheSignal: unsupported,
    getCacheForType<R>(resourceType: () => R): R {
      let entry: R | void = (cache.get(resourceType): any);
      if (entry === undefined) {
        entry = resourceType();
        // TODO: Warn if undefined?
        cache.set(resourceType, entry);
      }
      return entry;
    },
  };
  // Not using async/await because we don't compile it.
  return new Promise((resolve, reject) => {
    function retry() {
      const prevDispatcher = ReactCurrentCache.current;
      ReactCurrentCache.current = testDispatcher;
      try {
        const result = fn();
        resolve(result);
      } catch (thrownValue) {
        if (typeof thrownValue.then === 'function') {
          thrownValue.then(retry, retry);
        } else {
          reject(thrownValue);
        }
      } finally {
        ReactCurrentCache.current = prevDispatcher;
      }
    }
    retry();
  });
}
