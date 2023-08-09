/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type * as BabelCore from "@babel/core";
import { transformFromAstSync } from "@babel/core";
import * as BabelParser from "@babel/parser";
import * as HermesParser from "hermes-parser";
import invariant from "invariant";
import prettier from "prettier";
import type { PluginOptions } from "../Entrypoint";
import ReactForgetBabelPlugin from "./BabelPlugin";

type ReactForgetBabelPluginResult = {
  ast: BabelCore.BabelFileResult["ast"];
  code: string;
  map: BabelCore.BabelFileResult["map"];
};

export function runReactForgetBabelPlugin(
  text: string,
  file: string,
  language: "flow" | "typescript",
  options: PluginOptions | null
): ReactForgetBabelPluginResult {
  let ast;
  if (language === "flow") {
    ast = HermesParser.parse(text, {
      babel: true,
      flow: "all",
      sourceFilename: file,
      sourceType: "module",
      enableExperimentalComponentSyntax: true,
    });
  } else {
    ast = BabelParser.parse(text, {
      sourceFilename: file,
      plugins: ["typescript", "jsx"],
      sourceType: "module",
    });
  }
  const result = transformFromAstSync(ast, text, {
    filename: file,
    highlightCode: false,
    retainLines: true,
    plugins: [
      [ReactForgetBabelPlugin, options],
      "babel-plugin-fbt",
      "babel-plugin-fbt-runtime",
    ],
    sourceType: "module",
  });
  invariant(
    result?.code != null,
    `Expected BabelPluginReactForget to codegen successfully, got: ${result}`
  );
  return {
    ast: result.ast,
    code: prettier.format(result.code, {
      semi: true,
      parser: language === "typescript" ? "babel-ts" : "flow",
    }),
    map: result.map,
  };
}
