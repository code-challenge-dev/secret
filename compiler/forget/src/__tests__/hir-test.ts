/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use strict";

import generate from "@babel/generator";
import * as parser from "@babel/parser";
import traverse from "@babel/traverse";
import { wasmFolder } from "@hpcc-js/wasm";
import invariant from "invariant";
import path from "path";
import prettier from "prettier";
import { buildReactiveFunction } from "../HIR/BuildReactiveFunction";
import { toggleLogging } from "../HIR/logger";
import run from "../HIR/Pipeline";
import { printFunction } from "../HIR/PrintHIR";
import { printReactiveFunction } from "../HIR/PrintReactiveFunction";
import visualizeHIRMermaid from "../HIR/VisualizeHIRMermaid";
import generateTestsFromFixtures from "./test-utils/generateTestsFromFixtures";

function wrapWithTripleBackticks(s: string, ext?: string) {
  return `\`\`\`${ext ?? ""}
${s}
\`\`\``;
}

wasmFolder(
  path.join(__dirname, "..", "..", "node_modules", "@hpcc-js", "wasm", "dist")
);

const Pragma_RE = /\/\/\s*@enable\((\w+)\)$/gm;

describe("React Forget (HIR version)", () => {
  generateTestsFromFixtures(
    path.join(__dirname, "fixtures", "hir"),
    (input, file, options) => {
      const matches = input.matchAll(Pragma_RE);

      for (const match of matches) {
        const [, key, value] = match;
        switch (key) {
          case "Pass":
            // do something with value;
            break;
          default:
            throw new Error(`unknown pragma: ${key}`);
        }
      }

      let items: Array<TestOutput> | null = null;
      let error: Error | null = null;
      if (options.debug) {
        toggleLogging(options.debug);
      }
      try {
        items = transform(input, file);
      } catch (e) {
        error = e;
      }
      let outputs: Array<string>;

      const expectError = file.startsWith("error.");
      if (expectError) {
        if (error === null) {
          throw new Error(
            `Expected an error to be thrown for fixture: '${file}', remove the 'error.' prefix if an error is not expected.`
          );
        } else {
          outputs = [formatErrorOutput(error)];
        }
      } else {
        if (error !== null) {
          console.error(error);
          throw new Error(
            `Expected fixture '${file}' to succeed but it failed with error: '${error.message}'. See console output for details.`
          );
        }
        if (items === null || items.length === 0) {
          throw new Error(`Expected at least one output for file '${file}'.`);
        }
        outputs = formatOutput(items);
      }
      return `
## Input

${wrapWithTripleBackticks(input, "javascript")}

${outputs.join("\n")}
      `;
    }
  );
});

function formatErrorOutput(error: Error): string {
  return `
## Error

${wrapWithTripleBackticks(error.message)}
          `;
}

function formatOutput(items: Array<TestOutput>): Array<string> {
  return items.map(({ ir, js, mermaid, scopes }) => {
    return `
## HIR

${wrapWithTripleBackticks(ir)}

## Reactive Scopes

${wrapWithTripleBackticks(scopes)}

### CFG

${wrapWithTripleBackticks(mermaid, "mermaid")}

## Code

${wrapWithTripleBackticks(js, "javascript")}
        `.trim();
  });
}

type TestOutput = {
  ir: string;
  js: string;
  mermaid: string;
  scopes: string;
};

function transform(text: string, file: string): Array<TestOutput> {
  const items: Array<TestOutput> = [];
  const ast = parser.parse(text, {
    sourceFilename: file,
    plugins: ["typescript", "jsx"],
  });
  traverse(ast, {
    FunctionDeclaration: {
      enter(nodePath) {
        const { ir, ast } = run(nodePath, {
          eliminateRedundantPhi: true,
          inferReferenceEffects: true,
          inferTypes: true,
          inferMutableRanges: true,
          inferReactiveScopeVariables: true,
          inferReactiveScopes: true,
          inferReactiveScopeDependencies: true,
          leaveSSA: true,
          codegen: true,
        });

        const reactiveFunction = buildReactiveFunction(ir);
        const scopes = printReactiveFunction(reactiveFunction);

        const textHIR = printFunction(ir);
        const mermaid = visualizeHIRMermaid(ir);

        invariant(ast !== null, "ast is null when codegen option is enabled");
        const text = prettier.format(generate(ast).code.replace("\n\n", "\n"), {
          semi: true,
          parser: "babel-ts",
        });
        items.push({ ir: textHIR, js: text, scopes, mermaid });
      },
    },
  });
  return items;
}
