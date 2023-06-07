/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as parser from "@babel/parser";
import traverse from "@babel/traverse";
import {
  CompilerError,
  compileProgram,
  parsePluginOptions,
} from "babel-plugin-react-forget";
import type { Rule } from "eslint";

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Surfaces diagnostics from React Forget",
      recommended: true,
    },
  },
  create(context: Rule.RuleContext) {
    const babelAST = parser.parse(context.sourceCode.text);
    if (babelAST != null) {
      traverse(babelAST, {
        Program(prog) {
          try {
            compileProgram(prog, {
              opts: parsePluginOptions(null), // use defaults for now
              filename: context.filename,
              comments: babelAST.comments ?? [],
            });
          } catch (err) {
            if (err instanceof CompilerError) {
              for (const detail of err.details) {
                if (detail.loc != null) {
                  context.report({
                    message: detail.toString(),
                    loc: detail.loc,
                  });
                }
              }
            }
          }
        },
      });
    }
    return {};
  },
};

export default rule;
