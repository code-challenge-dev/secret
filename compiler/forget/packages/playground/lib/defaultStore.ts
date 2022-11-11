/*
 * Copyright (c) Facebook, Inc. and its affiliates.
 */

import type { Store } from "./stores";
import { createCompilerFlags } from "babel-plugin-react-forget";

const index = `\
function fibbonacci(n) {
  let a = 0;
  let b = 1;
  let c = 1;
  for (let i = 0; i < n; i++) {
    a = b;
    b = c;
    c = a + b;
  }
  return a;
}
`;

export const defaultStore: Store = {
  source: index,
  compilerFlags: createCompilerFlags(),
};

const minimalIndex = `\
export default function MyApp() {
  return <div>Hello World</div>;
}
`;

export const minimalStore: Store = {
  source: minimalIndex,
  compilerFlags: createCompilerFlags(),
};

export const emptyStore: Store = {
  source: "",
  compilerFlags: createCompilerFlags(),
};
