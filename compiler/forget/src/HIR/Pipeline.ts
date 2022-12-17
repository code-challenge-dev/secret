/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { lower } from "../HIR/BuildHIR";
import { Environment } from "../HIR/HIRBuilder";
import inferReferenceEffects from "../HIR/InferReferenceEffects";
import { buildReactiveFunction } from "../ReactiveScopes/BuildReactiveFunction";
import { codegenReactiveFunction } from "../ReactiveScopes/CodegenReactiveFunction";
import { flattenReactiveLoops } from "../ReactiveScopes/FlattenReactiveLoops";
import { inferReactiveScopes } from "../ReactiveScopes/InferReactiveScopes";
import { inferReactiveScopeVariables } from "../ReactiveScopes/InferReactiveScopeVariables";
import { printReactiveFunction } from "../ReactiveScopes/PrintReactiveFunction";
import { propagateScopeDependencies } from "../ReactiveScopes/PropagateScopeDependencies";
import { pruneUnusedLabels } from "../ReactiveScopes/PruneUnusedLabels";
import { eliminateRedundantPhi } from "../SSA/EliminateRedundantPhi";
import enterSSA from "../SSA/EnterSSA";
import { leaveSSA } from "../SSA/LeaveSSA";
import { logHIRFunction } from "../Utils/logger";
import { HIRFunction } from "./HIR";
import { inferMutableRanges } from "./InferMutableRanges";
import { inferTypes } from "./InferTypes";

export type CompilerFlags = {
  eliminateRedundantPhi: boolean;
  inferReferenceEffects: boolean;
  inferTypes: boolean;
  inferMutableRanges: boolean;
  inferReactiveScopeVariables: boolean;
  inferReactiveScopes: boolean;
  inferReactiveScopeDependencies: boolean;
  leaveSSA: boolean;
  codegen: boolean;
};

export type CompilerResult = {
  ir: HIRFunction;
  ast: t.Function | null;
  scopes: string | null;
};

export default function (
  func: NodePath<t.FunctionDeclaration>,
  flags: CompilerFlags
): CompilerResult {
  const env = new Environment();

  const ir = lower(func, env);
  logHIRFunction("HIR", ir);

  enterSSA(ir, env);
  logHIRFunction("SSA", ir);

  if (flags.eliminateRedundantPhi) {
    eliminateRedundantPhi(ir);
    logHIRFunction("eliminateRedundantPhi", ir);
  }
  if (flags.inferTypes) {
    inferTypes(ir);
    logHIRFunction("inferTypes", ir);
  }
  if (flags.inferReferenceEffects) {
    inferReferenceEffects(ir);
    logHIRFunction("inferReferenceEffects", ir);
  }

  if (flags.inferMutableRanges) {
    inferMutableRanges(ir);
    logHIRFunction("inferMutableRanges", ir);
  }

  if (flags.leaveSSA) {
    leaveSSA(ir);
    logHIRFunction("leaveSSA", ir);
  }

  if (flags.inferReactiveScopeVariables) {
    inferReactiveScopeVariables(ir);
    logHIRFunction("inferReactiveScopeVariables", ir);
  }

  if (flags.inferReactiveScopes) {
    inferReactiveScopes(ir);
    logHIRFunction("inferReactiveScopes", ir);
  }

  if (flags.codegen) {
    const reactiveFunction = buildReactiveFunction(ir);
    pruneUnusedLabels(reactiveFunction);
    flattenReactiveLoops(reactiveFunction);
    propagateScopeDependencies(reactiveFunction);
    const scopes = printReactiveFunction(reactiveFunction);
    const ast = codegenReactiveFunction(reactiveFunction);
    return {
      ast,
      ir,
      scopes,
    };
  }

  return { ast: null, scopes: null, ir: ir };
}
