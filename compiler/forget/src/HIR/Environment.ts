/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as t from "@babel/types";
import invariant from "invariant";
import { log } from "../Utils/logger";
import {
  DEFAULT_GLOBALS,
  DEFAULT_SHAPES,
  Global,
  GlobalRegistry,
} from "./Globals";
import {
  BlockId,
  BuiltInType,
  Effect,
  FunctionType,
  IdentifierId,
  ObjectType,
  PolyType,
  ValueKind,
  makeBlockId,
  makeIdentifierId,
} from "./HIR";
import {
  DefaultMutatingHook,
  DefaultNonmutatingHook,
  FunctionSignature,
  ShapeRegistry,
  addHook,
} from "./ObjectShape";

export type Hook = {
  effectKind: Effect;
  valueKind: ValueKind;
};

// TODO(mofeiZ): User defined global types (with corresponding shapes).
// User defined global types should have inline ObjectShapes instead of directly
// using ObjectShapes.ShapeRegistry, as a user-provided ShapeRegistry may be
// accidentally be not well formed.
// i.e.
//   missing required shapes (BuiltInArray for [] and BuiltInObject for {})
//   missing some recursive Object / Function shapeIds
export type EnvironmentConfig = Partial<{
  customHooks: Map<string, Hook>;

  /**
   * Enable memoization of JSX elements in addition to other types of values. When disabled,
   * other types (objects, arrays, call expressions, etc) are memoized, but not known JSX
   * values.
   *
   * Defaults to true
   */
  memoizeJsxElements: boolean;

  /**
   * Enable validation of hooks to partially check that the component honors the rules of hooks.
   * When disabled, the component is assumed to follow the rules (though the Babel plugin looks
   * for suppressions of the lint rule).
   *
   * Defaults to false
   */
  validateHooksUsage: boolean;

  /**
   * Validate that ref values (`ref.current`) are not accessed during render.
   *
   * Defaults to false
   */
  validateRefAccessDuringRender: boolean;

  /**
   * Validate that mutable lambdas are not passed where a frozen value is expected, since mutable
   * lambdas cannot be frozen. The only mutation allowed inside a frozen lambda is of ref values.
   *
   * Defaults to false
   */
  validateFrozenLambdas: boolean;

  /**
   * Enable inlining of `useMemo()` function expressions so that they can be more optimally
   * compiled.
   *
   * Defaults to false
   */
  inlineUseMemo: boolean;

  /**
   * Enable optimizations based on the signature of (non-method) built-in function calls.
   *
   * Defaults to false
   */
  enableFunctionCallSignatureOptimizations: boolean;

  /**
   * When enabled, the compiler assumes that hooks follow the Rules of React:
   * - Hooks may memoize computation based on any of their parameters, thus
   *   any arguments to a hook are assumed frozen after calling the hook.
   * - Hooks may memoize the result they return, thus the return value is
   *   assumed frozen.

   * Defaults to false
   */
  enableAssumeHooksFollowRulesOfReact: boolean;

  /**
   * When enabled, the compiler treats hooks as normal typed functions for
   * type and effect inference.
   * Enabling this may change inference to have a higher confidence level
   * and create more bailouts (e.g. for mutable effects to immutable values).
   *
   * Defaults to true
   */
  enableTreatHooksAsFunctions: boolean;

  /**
   * When enabled, removes *all* memoization from the function: this includes
   * removing manually added useMemo/useCallback as well as not adding Forget's
   * usual useMemoCache-based memoization.
   *
   * Defaults to false (ie, by default memoization is enabled)
   */
  disableAllMemoization: boolean;
}>;

export class Environment {
  #globals: GlobalRegistry;
  #shapes: ShapeRegistry;
  #nextIdentifer: number = 0;
  #nextBlock: number = 0;
  validateHooksUsage: boolean;
  validateRefAccessDuringRender: boolean;
  validateFrozenLambdas: boolean;
  enableFunctionCallSignatureOptimizations: boolean;
  enableAssumeHooksFollowRulesOfReact: boolean;
  enableTreatHooksAsFunctions: boolean;
  disableAllMemoization: boolean;
  #contextIdentifiers: Set<t.Identifier>;

  constructor(
    config: EnvironmentConfig | null,
    contextIdentifiers: Set<t.Identifier>
  ) {
    this.#shapes = new Map(DEFAULT_SHAPES);

    if (config?.customHooks) {
      this.#globals = new Map(DEFAULT_GLOBALS);
      for (const [hookName, hook] of config.customHooks) {
        invariant(
          !this.#globals.has(hookName),
          `[Globals] Found existing definition in global registry for custom hook ${hookName}`
        );
        this.#globals.set(
          hookName,
          addHook(this.#shapes, [], {
            positionalParams: [],
            restParam: hook.effectKind,
            returnType: { kind: "Poly" },
            returnValueKind: hook.valueKind,
            calleeEffect: Effect.Read,
            hookKind: "Custom",
          })
        );
      }
    } else {
      this.#globals = DEFAULT_GLOBALS;
    }
    this.validateHooksUsage = config?.validateHooksUsage ?? false;
    this.validateRefAccessDuringRender =
      config?.validateRefAccessDuringRender ?? false;
    this.validateFrozenLambdas = config?.validateFrozenLambdas ?? false;
    this.enableFunctionCallSignatureOptimizations =
      config?.enableFunctionCallSignatureOptimizations ?? false;
    this.enableAssumeHooksFollowRulesOfReact =
      config?.enableAssumeHooksFollowRulesOfReact ?? false;
    this.enableTreatHooksAsFunctions =
      config?.enableTreatHooksAsFunctions ?? true;
    this.disableAllMemoization = config?.disableAllMemoization ?? false;
    this.#contextIdentifiers = contextIdentifiers;
  }

  get nextIdentifierId(): IdentifierId {
    return makeIdentifierId(this.#nextIdentifer++);
  }

  get nextBlockId(): BlockId {
    return makeBlockId(this.#nextBlock++);
  }
  isContextIdentifier(node: t.Identifier): boolean {
    return this.#contextIdentifiers.has(node);
  }

  getGlobalDeclaration(name: string): Global | null {
    let resolvedGlobal: Global | null = this.#globals.get(name) ?? null;
    if (resolvedGlobal === null) {
      // Hack, since we don't track module level declarations and imports
      if (isHookName(name)) {
        if (this.enableAssumeHooksFollowRulesOfReact) {
          return DefaultNonmutatingHook;
        } else {
          return DefaultMutatingHook;
        }
      } else {
        log(() => `Undefined global '${name}'`);
      }
    }
    return resolvedGlobal;
  }

  getPropertyType(
    receiver: ObjectType | FunctionType,
    property: string
  ): BuiltInType | PolyType | null {
    const { shapeId } = receiver;
    if (shapeId !== null) {
      // If an object or function has a shapeId, it must have been assigned
      // by Forget (and be present in a builtin or user-defined registry)
      const shape = this.#shapes.get(shapeId);
      invariant(
        shape !== undefined,
        `[HIR] Forget internal error: cannot resolve shape ${shapeId}`
      );
      return shape.properties.get(property) ?? null;
    } else {
      return null;
    }
  }

  getFunctionSignature(type: FunctionType): FunctionSignature | null {
    const { shapeId } = type;
    if (shapeId !== null) {
      const shape = this.#shapes.get(shapeId);
      invariant(
        shape !== undefined,
        `[HIR] Forget internal error: cannot resolve shape ${shapeId}`
      );
      return shape.functionType;
    }
    return null;
  }
}

// From https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/src/RulesOfHooks.js#LL18C1-L23C2
function isHookName(name: string): boolean {
  // if (__EXPERIMENTAL__) {
  //   return name === 'use' || /^use[A-Z0-9]/.test(name);
  // }
  return /^use[A-Z0-9]/.test(name);
}
