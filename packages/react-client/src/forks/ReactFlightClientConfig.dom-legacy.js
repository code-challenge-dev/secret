/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export * from 'react-client/src/ReactFlightClientStreamConfigWeb';
export * from 'react-client/src/ReactFlightClientConsoleConfigBrowser';
export * from 'react-dom-bindings/src/shared/ReactFlightClientConfigDOM';

export type Response = any;
export opaque type ModuleLoading = mixed;
export opaque type SSRModuleMap = mixed;
export opaque type ServerManifest = mixed;
export opaque type ServerReferenceId = string;
export opaque type ClientReferenceMetadata = mixed;
export opaque type ClientReference<T> = mixed; // eslint-disable-line no-unused-vars
export const resolveClientReference: any = null;
export const resolveServerReference: any = null;
export const preloadModule: any = null;
export const requireModule: any = null;
export const prepareDestinationForModule: any = null;
export const usedWithSSR = true;
