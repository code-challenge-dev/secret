/**
 * Copyright (c) 2013-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export type TypeOfMode = number;

export const NoContext = 0b000;
export const AsyncMode = 0b001;
export const StrictMode = 0b010;
export const ProfileMode = 0b100;
