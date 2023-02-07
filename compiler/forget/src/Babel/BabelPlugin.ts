/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/// <reference path="./plugin-syntax-jsx.d.ts" />

import type * as BabelCore from "@babel/core";
import generate from "@babel/generator";
import jsx from "@babel/plugin-syntax-jsx";
import { parseCompilerFlags } from "../CompilerFlags";
import prettier from "prettier";
import { compile } from "../CompilerPipeline";

/**
 * The React Forget Babel Plugin
 * @param {*} _babel
 * @returns
 */
export default function ReactForgetBabelPlugin(
  _babel: typeof BabelCore
): BabelCore.PluginObj {
  return {
    name: "react-forget",
    inherits: jsx,
    visitor: {
      FunctionDeclaration: {
        enter(fn, pass) {
          const flags = parseCompilerFlags(pass.opts);
          if (flags.enableOnlyOnUseForgetDirective) {
            let hasUseForgetDirective = false;
            for (const directive of fn.node.body.directives) {
              if (directive.value.value === "use forget") {
                hasUseForgetDirective = true;
                break;
              }
            }
            if (!hasUseForgetDirective) {
              return;
            }
          }
          if (fn.scope.getProgramParent() !== fn.scope.parent) {
            return;
          }
          const ast = compile(fn);

          // We are generating a new FunctionDeclaration node, so we must skip over it or this
          // traversal will loop infinitely.
          try {
            fn.replaceWith(ast);
            fn.skip();
          } catch (err) {
            const result = generate(ast);
            err.message = `${err.message}\n\n${prettier.format(result.code, {
              semi: true,
              parser: "babel-ts",
            })}`;
            throw err;
          }
        },
      },
    },
  };
}
