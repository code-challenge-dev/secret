/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// This is a host config that's used for the `react-server` package on npm.
// It is only used by third-party renderers.
//
// Its API lets you pass the host config as an argument.
// However, inside the `react-server` we treat host config as a module.
// This file is a shim between two worlds.
//
// It works because the `react-server` bundle is wrapped in something like:
//
// module.exports = function ($$$config) {
//   /* renderer code */
// }
//
// So `$$$config` looks like a global variable, but it's
// really an argument to a top-level wrapping function.

declare var $$$config: any;
export opaque type Destination = mixed; // eslint-disable-line no-undef

export opaque type PrecomputedChunk = mixed; // eslint-disable-line no-undef
export opaque type Chunk = mixed; // eslint-disable-line no-undef

export const scheduleWork = $$$config.scheduleWork;
export const beginWriting = $$$config.beginWriting;
export const writeChunk = $$$config.writeChunk;
export const writeChunkAndReturn = $$$config.writeChunkAndReturn;
export const completeWriting = $$$config.completeWriting;
export const flushBuffered = $$$config.flushBuffered;
export const supportsRequestStorage = $$$config.supportsRequestStorage;
export const requestStorage = $$$config.requestStorage;
export const close = $$$config.close;
export const closeWithError = $$$config.closeWithError;
export const stringToChunk = $$$config.stringToChunk;
export const stringToPrecomputedChunk = $$$config.stringToPrecomputedChunk;
export const clonePrecomputedChunk = $$$config.clonePrecomputedChunk;
