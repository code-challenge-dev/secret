/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import {
  Environment,
  HIRFunction,
  lower,
  mergeConsecutiveBlocks,
  ReactiveFunction,
} from "./HIR";
import { inferMutableRanges, inferReferenceEffects } from "./Inference";
import { constantPropagation } from "./Optimization";
import {
  alignReactiveScopesToBlockScopes,
  buildReactiveBlocks,
  buildReactiveFunction,
  codegenReactiveFunction,
  flattenReactiveLoops,
  inferReactiveScopeVariables,
  mergeOverlappingReactiveScopes,
  propagateScopeDependencies,
  pruneUnusedLabels,
  pruneUnusedLValues,
  pruneUnusedScopes,
  renameVariables,
} from "./ReactiveScopes";
import { eliminateRedundantPhi, enterSSA, leaveSSA } from "./SSA";
import { inferTypes } from "./TypeInference";
import { logHIRFunction, logReactiveFunction } from "./Utils/logger";
import { assertExhaustive } from "./Utils/utils";

export type CompilerPipelineValue =
  | { kind: "ast"; name: string; value: t.Function }
  | { kind: "hir"; name: string; value: HIRFunction }
  | { kind: "reactive"; name: string; value: ReactiveFunction };

export function* run(
  func: NodePath<t.FunctionDeclaration>
): Iterator<CompilerPipelineValue, t.Function> {
  const env = new Environment();

  const lowering = lower(func, env).orElse((errors) => {
    const msg = errors.map((error) => error.toString()).join("\n\n");
    throw new Error(msg);
  });

  const hir = lowering.unwrap();
  yield log({ kind: "hir", name: "HIR", value: hir });

  mergeConsecutiveBlocks(hir);
  yield log({ kind: "hir", name: "MergeConsecutiveBlocks", value: hir });

  enterSSA(hir, env);
  yield log({ kind: "hir", name: "SSA", value: hir });

  eliminateRedundantPhi(hir);
  yield log({ kind: "hir", name: "EliminateRedundantPhi", value: hir });

  constantPropagation(hir);
  yield log({ kind: "hir", name: "ConstantPropagation", value: hir });

  inferTypes(hir);
  yield log({ kind: "hir", name: "InferTypes", value: hir });

  inferReferenceEffects(hir);
  yield log({ kind: "hir", name: "InferReferenceEffects", value: hir });

  inferMutableRanges(hir);
  yield log({ kind: "hir", name: "InferMutableRanges", value: hir });

  leaveSSA(hir);
  yield log({ kind: "hir", name: "LeaveSSA", value: hir });

  inferReactiveScopeVariables(hir);
  yield log({ kind: "hir", name: "InferReactiveScopeVariables", value: hir });

  const reactiveFunction = buildReactiveFunction(hir);
  yield log({
    kind: "reactive",
    name: "BuildReactiveFunction",
    value: reactiveFunction,
  });

  alignReactiveScopesToBlockScopes(reactiveFunction);
  yield log({
    kind: "reactive",
    name: "AlignReactiveScopesToBlockScopes",
    value: reactiveFunction,
  });

  mergeOverlappingReactiveScopes(reactiveFunction);
  yield log({
    kind: "reactive",
    name: "MergeOverlappingReactiveScopes",
    value: reactiveFunction,
  });

  buildReactiveBlocks(reactiveFunction);
  yield log({
    kind: "reactive",
    name: "BuildReactiveBlocks",
    value: reactiveFunction,
  });

  pruneUnusedLabels(reactiveFunction);
  yield log({
    kind: "reactive",
    name: "PruneUnusedLabels",
    value: reactiveFunction,
  });

  flattenReactiveLoops(reactiveFunction);
  yield log({
    kind: "reactive",
    name: "FlattenReactiveLoops",
    value: reactiveFunction,
  });

  propagateScopeDependencies(reactiveFunction);
  yield log({
    kind: "reactive",
    name: "PropagateScopeDependencies",
    value: reactiveFunction,
  });

  pruneUnusedScopes(reactiveFunction);
  yield log({
    kind: "reactive",
    name: "PruneUnusedScopes",
    value: reactiveFunction,
  });

  pruneUnusedLValues(reactiveFunction);
  yield log({
    kind: "reactive",
    name: "PruneUnusedLValues",
    value: reactiveFunction,
  });

  renameVariables(reactiveFunction);
  yield log({
    kind: "reactive",
    name: "RenameVariables",
    value: reactiveFunction,
  });

  const ast = codegenReactiveFunction(reactiveFunction);
  yield log({ kind: "ast", name: "Codegen", value: ast });

  return ast;
}

export function compile(func: NodePath<t.FunctionDeclaration>): t.Function {
  let generator = run(func);
  while (true) {
    const next = generator.next();
    if (next.done) {
      return next.value;
    }
  }
}

function log(value: CompilerPipelineValue): CompilerPipelineValue {
  switch (value.kind) {
    case "ast": {
      break;
    }
    case "hir": {
      logHIRFunction(value.name, value.value);
      break;
    }
    case "reactive": {
      logReactiveFunction(value.name, value.value);
      break;
    }
    default: {
      assertExhaustive(value, "Unexpected compilation kind");
    }
  }
  return value;
}
