/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactNodeList} from 'shared/ReactTypes';
import type {BootstrapScriptDescriptor} from 'react-dom-bindings/src/server/ReactFizzConfigDOM';
import type {PostponedState} from 'react-server/src/ReactFizzServer';
import type {ImportMap} from '../shared/ReactDOMTypes';

import ReactVersion from 'shared/ReactVersion';

import {
  createRequest,
  startPrerender,
  startFlowing,
  abort,
  getPostponedState,
} from 'react-server/src/ReactFizzServer';

import {
  createResumableState,
  createRenderState,
  createRootFormatContext,
} from 'react-dom-bindings/src/server/ReactFizzConfigDOM';

type Options = {
  identifierPrefix?: string,
  namespaceURI?: string,
  bootstrapScriptContent?: string,
  bootstrapScripts?: Array<string | BootstrapScriptDescriptor>,
  bootstrapModules?: Array<string | BootstrapScriptDescriptor>,
  progressiveChunkSize?: number,
  signal?: AbortSignal,
  onError?: (error: mixed) => ?string,
  onPostpone?: (reason: string) => void,
  unstable_externalRuntimeSrc?: string | BootstrapScriptDescriptor,
  importMap?: ImportMap,
};

type StaticResult = {
  postponed: null | PostponedState,
  prelude: ReadableStream,
};

function prerender(
  children: ReactNodeList,
  options?: Options,
): Promise<StaticResult> {
  return new Promise((resolve, reject) => {
    const onFatalError = reject;

    function onAllReady() {
      const stream = new ReadableStream(
        {
          type: 'bytes',
          pull: (controller): ?Promise<void> => {
            startFlowing(request, controller);
          },
        },
        // $FlowFixMe[prop-missing] size() methods are not allowed on byte streams.
        {highWaterMark: 0},
      );

      const result = {
        postponed: getPostponedState(request),
        prelude: stream,
      };
      resolve(result);
    }
    const resources = createResumableState(
      options ? options.identifierPrefix : undefined,
      undefined, // nonce is not compatible with prerendered bootstrap scripts
      options ? options.bootstrapScriptContent : undefined,
      options ? options.bootstrapScripts : undefined,
      options ? options.bootstrapModules : undefined,
      options ? options.unstable_externalRuntimeSrc : undefined,
    );
    const request = createRequest(
      children,
      resources,
      createRenderState(
        resources,
        undefined, // nonce
        options ? options.importMap : undefined,
      ),
      createRootFormatContext(options ? options.namespaceURI : undefined),
      options ? options.progressiveChunkSize : undefined,
      options ? options.onError : undefined,
      onAllReady,
      undefined,
      undefined,
      onFatalError,
      options ? options.onPostpone : undefined,
    );
    if (options && options.signal) {
      const signal = options.signal;
      if (signal.aborted) {
        abort(request, (signal: any).reason);
      } else {
        const listener = () => {
          abort(request, (signal: any).reason);
          signal.removeEventListener('abort', listener);
        };
        signal.addEventListener('abort', listener);
      }
    }
    startPrerender(request);
  });
}

export {prerender, ReactVersion as version};
