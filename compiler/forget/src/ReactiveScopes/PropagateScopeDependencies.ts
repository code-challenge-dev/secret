/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  Identifier,
  InstructionId,
  InstructionKind,
  isPrimitiveType,
  LValue,
  makeInstructionId,
  Place,
  ReactiveBlock,
  ReactiveFunction,
  ReactiveInstruction,
  ReactiveScope,
  ReactiveScopeDependency,
  ReactiveValue,
} from "../HIR/HIR";
import { eachInstructionValueOperand } from "../HIR/visitors";
import { assertExhaustive } from "../Utils/utils";
import { eachReactiveValueOperand } from "./visitors";

/**
 * Infers the dependencies of each scope to include variables whose values
 * are non-stable and created prior to the start of the scope. Also propagates
 * dependencies upwards, so that parent scope dependencies are the union of
 * their direct dependencies and those of their child scopes.
 */
export function propagateScopeDependencies(fn: ReactiveFunction): void {
  const context = new Context();
  if (fn.id !== null) {
    context.declare(fn.id, { kind: DeclKind.Const, id: makeInstructionId(0) });
  }
  for (const param of fn.params) {
    context.declare(param.identifier, {
      kind: DeclKind.Dynamic,
      id: makeInstructionId(0),
    });
  }
  visit(context, fn.body);
}

enum DeclKind {
  Const = "Const",
  Dynamic = "Dynamic",
}

type DeclMap = Map<Identifier, Decl>;
type Decl = { kind: DeclKind; id: InstructionId };

type Scopes = Array<ReactiveScope>;

class Context {
  #declarations: DeclMap = new Map();
  #dependencies: Set<ReactiveScopeDependency> = new Set();
  #properties: Map<Identifier, ReactiveScopeDependency> = new Map();
  #scopes: Scopes = [];

  enter(scope: ReactiveScope, fn: () => void): Set<ReactiveScopeDependency> {
    const previousDependencies = this.#dependencies;
    const scopedDependencies = new Set<ReactiveScopeDependency>();
    this.#dependencies = scopedDependencies;
    this.#scopes.push(scope);
    fn();
    this.#scopes.pop();
    this.#dependencies = previousDependencies;
    return scopedDependencies;
  }

  declare(identifier: Identifier, decl: Decl): void {
    this.#declarations.set(identifier, decl);
  }

  declareProperty(lvalue: Place, object: Place, property: string): void {
    const objectDependency = this.#properties.get(object.identifier);
    let nextDependency: ReactiveScopeDependency;
    if (objectDependency === undefined) {
      nextDependency = { place: object, path: [property] };
    } else {
      nextDependency = {
        place: objectDependency.place,
        path: [...(objectDependency.path ?? []), property],
      };
    }
    this.#properties.set(lvalue.identifier, nextDependency);
  }

  #isScopeActive(scope: ReactiveScope): boolean {
    return this.#scopes.indexOf(scope) !== -1;
  }

  get #currentScope(): ReactiveScope {
    return this.#scopes.at(-1)!;
  }

  visitOperand(place: Place): void {
    this.visitDependency({ place, path: null });
  }

  visitProperty(object: Place, property: string): void {
    const objectDependency = this.#properties.get(object.identifier);
    let nextDependency: ReactiveScopeDependency;
    if (objectDependency === undefined) {
      nextDependency = { place: object, path: [property] };
    } else {
      nextDependency = {
        place: objectDependency.place,
        path: [...(objectDependency.path ?? []), property],
      };
    }
    this.visitDependency(nextDependency);
  }

  visitDependency(dependency: ReactiveScopeDependency): void {
    let maybeDependency: ReactiveScopeDependency;
    if (dependency.path !== null) {
      // Operands may have memberPaths when propagating depenencies of an inner scope upward
      // In this case we use the dependency as-is
      maybeDependency = dependency;
    } else {
      // Otherwise if this operand is a temporary created for a property load, resolve it to
      // the expanded Place. Fall back to using the operand as-is.
      let propDep = this.#properties.get(dependency.place.identifier);
      if (dependency.place.identifier.name === null && propDep !== undefined) {
        maybeDependency = propDep;
      } else {
        maybeDependency = dependency;
      }
    }

    const decl = this.#declarations.get(maybeDependency.place.identifier);

    // Any value used after its defining scope has concluded must be added as an
    // output of its defining scope. Regardless of whether its a const or not,
    // some later code needs access to the value.
    if (decl !== undefined) {
      const operandScope = maybeDependency.place.identifier.scope;
      if (operandScope !== null && !this.#isScopeActive(operandScope)) {
        operandScope.outputs.add(maybeDependency.place.identifier);
      }
    }

    // If this operand is used in a scope, has a dynamic value, and was defined
    // before this scope, then its a dependency of the scope.
    const currentScope = this.#currentScope;
    if (
      decl !== undefined &&
      decl.kind !== DeclKind.Const &&
      currentScope !== undefined &&
      decl.id < currentScope.range.start
    ) {
      // Check if there is an existing dependency that describes this operand
      for (const dep of this.#dependencies) {
        // not the same identifier
        if (dep.place.identifier !== maybeDependency.place.identifier) {
          continue;
        }
        const depPath = dep.path;
        // existing dep covers all paths
        if (depPath === null) {
          return;
        }
        const operandPath = maybeDependency.path;
        // existing dep is for a path, this operand covers all paths so swap them
        if (operandPath === null) {
          this.#dependencies.delete(dep);
          this.#dependencies.add(maybeDependency);
          return;
        }
        // both the operand and dep have paths, determine if the existing path
        // is a subset of the new path
        let commonPathIndex = 0;
        while (
          commonPathIndex < operandPath.length &&
          commonPathIndex < depPath.length &&
          operandPath[commonPathIndex] === depPath[commonPathIndex]
        ) {
          commonPathIndex++;
        }
        if (commonPathIndex === depPath.length) {
          return;
        }
      }
      this.#dependencies.add(maybeDependency);
    }
  }
}

function visit(context: Context, block: ReactiveBlock): void {
  for (const item of block) {
    switch (item.kind) {
      case "scope": {
        const scopeDependencies = context.enter(item.scope, () => {
          visit(context, item.instructions);
        });
        item.scope.dependencies = scopeDependencies;
        for (const dep of scopeDependencies) {
          // propagate dependencies upward using the same rules as
          // normal dependency collection. child scopes may have dependencies
          // on values created within the outer scope, which necessarily cannot
          // be dependencies of the outer scope
          context.visitDependency(dep);
        }
        break;
      }
      case "instruction": {
        visitInstruction(context, item.instruction);
        break;
      }
      case "terminal": {
        const terminal = item.terminal;
        switch (terminal.kind) {
          case "break":
          case "continue": {
            break;
          }
          case "return": {
            if (terminal.value !== null) {
              context.visitOperand(terminal.value);
            }
            break;
          }
          case "throw": {
            context.visitOperand(terminal.value);
            break;
          }
          case "for": {
            visitReactiveValue(context, terminal.init);
            visitReactiveValue(context, terminal.test);
            visitReactiveValue(context, terminal.update);
            visit(context, terminal.loop);
            break;
          }
          case "while": {
            visitReactiveValue(context, terminal.test);
            visit(context, terminal.loop);
            break;
          }
          case "if": {
            context.visitOperand(terminal.test);
            visit(context, terminal.consequent);
            if (terminal.alternate !== null) {
              visit(context, terminal.alternate);
            }
            break;
          }
          case "switch": {
            context.visitOperand(terminal.test);
            for (const case_ of terminal.cases) {
              if (case_.block !== undefined) {
                visit(context, case_.block);
              }
            }
            break;
          }
          default: {
            assertExhaustive(
              terminal,
              `Unexpected terminal kind '${(terminal as any).kind}'`
            );
          }
        }
        break;
      }
      default: {
        assertExhaustive(item, `Unexpected item`);
      }
    }
  }
}

function visitReactiveValue(context: Context, value: ReactiveValue): void {
  switch (value.kind) {
    case "LogicalExpression": {
      visitReactiveValue(context, value.left);
      visitReactiveValue(context, value.right);
      break;
    }
    case "ConditionalExpression": {
      visitReactiveValue(context, value.test);
      visitReactiveValue(context, value.consequent);
      visitReactiveValue(context, value.alternate);
      break;
    }
    case "SequenceExpression": {
      for (const instr of value.instructions) {
        visitInstruction(context, instr);
      }
      visitInstructionValue(context, value.value, null);
      break;
    }
    default: {
      for (const operand of eachInstructionValueOperand(value)) {
        context.visitOperand(operand);
      }
    }
  }
}

function visitInstructionValue(
  context: Context,
  value: ReactiveValue,
  lvalue: LValue | null
): void {
  if (value.kind === "PropertyLoad") {
    if (lvalue !== null) {
      context.declareProperty(lvalue.place, value.object, value.property);
    } else {
      context.visitProperty(value.object, value.property);
    }
  } else {
    for (const operand of eachReactiveValueOperand(value)) {
      context.visitOperand(operand);
    }
  }
}

function visitInstruction(context: Context, instr: ReactiveInstruction): void {
  const { lvalue } = instr;
  visitInstructionValue(context, instr.value, lvalue);
  if (lvalue !== null && lvalue.kind !== InstructionKind.Reassign) {
    const range = lvalue.place.identifier.mutableRange;
    // TODO: only assign Const if the value is never reassigned
    const kind =
      range.end === range.start + 1
        ? valueKind(lvalue.place.identifier)
        : DeclKind.Dynamic;
    context.declare(lvalue.place.identifier, {
      kind,
      id: lvalue.place.identifier.mutableRange.start,
    });
  }
}

function valueKind(id: Identifier): DeclKind {
  return isPrimitiveType(id) ? DeclKind.Const : DeclKind.Dynamic;
}
