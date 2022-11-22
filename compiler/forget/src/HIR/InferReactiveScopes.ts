/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import invariant from "invariant";
import DisjointSet from "./DisjointSet";
import {
  HIRFunction,
  Instruction,
  InstructionId,
  InstructionValue,
  makeInstructionId,
  ReactiveScope,
  ScopeId,
} from "./HIR";
import { BlockTerminal, Visitor, visitTree } from "./HIRTreeVisitor";
import { eachInstructionOperand } from "./visitors";

/**
 * This is a second (final) stage of constructing reactive scopes. Prior to this pass,
 * InferReactiveScopeVariables infers the sets of identifiers that "construct together",
 * assigning each identifier in each scope the same ScopeId and same MutableRange which
 * describes that span.
 *
 * Note that at this point reactive scopes describe ranges based on specific instructions
 * at arbitrary points in the control flow graph. However, reactive scopes must align
 * with control-flow boundaries — we can't memoize half of a loop!
 *
 * This pass refines the reactive scopes as follows:
 *
 * ## Expanding each reactive scope to align with control-flow boundaries (DONE)
 *
 * This corresponds with the shape of the AST: a scope that extends into an if consequent
 * would expand across the alternate branch, A scope that extends partway into an if
 * would expand to cover the full loop body, etc.
 *
 * ```javascript
 * function foo(cond, a) {
 *                    ⌵ original scope
 *                         ⌵ expanded scope
 *   const x = [];    ⌝    ⌝
 *   if (cond) {      ⎮    ⎮
 *     ...            ⎮    ⎮
 *     x.push(a);     ⌟    ⎮
 *     ...                 ⎮
 *   }                     ⌟
 * }
 * ```
 *
 * ## Merging (some) overlapping reactive scopes (TODO)
 *
 * Two scopes overlap if there is one or more instruction that is inside the range
 * of both scopes. In general, overlapping scopes are merged togther. The only
 * exception to this is when one scope *shadows* another scope. For example:
 *
 * ```javascript
 * function foo(cond, a) {
 *                                 ⌵ scope for x
 *   let x = [];                   ⌝
 *   if (cond) {                   ⎮
 *                   ⌵ scope for y ⎮
 *     let y = [];   ⌝             ⎮
 *     if (b) {      ⎮             ⎮
 *       y.push(b);  ⌟             ⎮
 *     }                           ⎮
 *     x.push(<div>{y}</div>);     ⎮
 *   }                             ⌟
 * }
 * ```
 *
 * In this example the two scopes overlap, but mutation of the two scopes is not
 * interleaved. Specifically within the y scope there are no instructions that
 * modify any other scope: the inner scope "shadows" the outer one. This category
 * of overlap does *NOT* merge the scopes together.
 *
 * The implementation is inspired by the Rust notion of "stacked borrows". We traverse
 * the control-flow graph in tree form, at each point keeping track of which scopes are
 * active. So initially we see
 *
 * `let x = []`
 * active scopes: [x]
 *
 * and mark the x scope as active.
 *
 * Then we later encounter
 *
 * `let y = [];`
 * active scopes: [x, y]
 *
 * Here we first check to see if 'y' is already in the list of active scopes. It isn't,
 * so we push it to the stop of the stack.
 *
 * Then
 *
 * `y.push(b)`
 * active scopes: [x, y]
 *
 * Mutates y, so we check if y is the top of the stack. It is, so no merging must occur.
 *
 * If instead we saw eg
 *
 * `x.push(b)`
 * active scopes: [x, y]
 *
 * Then we would see that 'x' is active, but that it is shadowed. The two scopes would have
 * to be merged.
 */
export function inferReactiveScopes(fn: HIRFunction) {
  // Note sure if this is strictly required: in general the only way for two scopes to have
  // the same range is if they were already inferred as aliasing together, and therefore
  // they should end up with the same range and scope anyway.
  mergeScopesWithIdenticalRanges(fn);

  visitTree(fn, new AlignReactiveScopesToBlockScopeRangeVisitor());
  visitTree(fn, new MergeOverlappingReactiveScopesVisitor());
}

/**
 * Finds scopes with identical ranges and merges them
 */
function mergeScopesWithIdenticalRanges(fn: HIRFunction) {
  const scopesByRange: Map<string, ReactiveScope> = new Map();
  for (const [_, block] of fn.body.blocks) {
    for (const instr of block.instructions) {
      const instrScope = getInstructionScope(instr);
      if (instrScope === null) {
        continue;
      }
      const rangeKey = `${instrScope.range.start}:${instrScope.range.end}`;
      let scope = scopesByRange.get(rangeKey);
      if (scope === undefined) {
        scope = instrScope;
        scopesByRange.set(rangeKey, scope);
      }
      if (scope.id !== instrScope.id) {
        instrScope.id = scope.id;
        instrScope.range = scope.range;
      }
    }
  }
}

class BlockScope {
  seen: Set<ScopeId> = new Set();
  scopes: Array<PendingReactiveScope> = [];
}

// maybe we just merge cases of interleaving when at the same block scope - eh fine?
// then we can look at scopes that start at the same block scope and overlap
class MergeOverlappingReactiveScopesVisitor
  implements Visitor<void, void, void, void>
{
  scopes: Array<BlockScope> = [];
  seenScopes: Set<ScopeId> = new Set();
  joinedScopes: DisjointSet<ReactiveScope> = new DisjointSet();

  /**
   * Determine if this scope is interleaved with any other scopes,
   * and if so merge them.
   */
  visitScope(scope: ReactiveScope) {
    const currentBlock = this.scopes[this.scopes.length - 1]!;
    // Fast-path for the first time we see a new scope
    if (!this.seenScopes.has(scope.id)) {
      this.seenScopes.add(scope.id);
      currentBlock.seen.add(scope.id);
      currentBlock.scopes.push({ active: true, scope });
      return;
    }
    // Scope has already been seen, find it in the current block or a parent
    let index = this.scopes.length - 1;
    let nextBlock = currentBlock;
    while (!nextBlock.seen.has(scope.id)) {
      // scopes that cross control-flow boundaries are merged with overlapping
      // scopes
      this.joinedScopes.union([scope, ...nextBlock.scopes.map((s) => s.scope)]);
      index--;
      if (index < 0) {
        // TODO: handle reassignments in multiple branches. these create new identifiers that
        // add an entry to this.seenScopes but which are then removed when their blocks exit.
        // this is also wrong for codegen, different versions of an identifier could be cached
        // differently and so a reassigned version of a variable needs a separate declaration.
        currentBlock.seen.add(scope.id);
        currentBlock.scopes.push({ active: true, scope });
        return;
      }
      nextBlock = this.scopes[index]!;
    }

    // Handle interleaving within a given block scope
    let found = false;
    let active = null;
    for (let i = 0; i < nextBlock.scopes.length; i++) {
      const current = nextBlock.scopes[i]!;
      if (current.active && !found) {
        active = current;
      }
      if (current.scope.id === scope.id) {
        found = true;
        if (!current.active) {
          invariant(active !== null, "Expected an active scope");
          this.joinedScopes.union([active.scope, current.scope]);
        }
      } else if (found && current.active) {
        // `scope` is shadowing `current`, but we don't know they are interleaved yet
        current.active = false;
      }
    }
    if (!currentBlock.seen.has(scope.id)) {
      currentBlock.seen.add(scope.id);
      currentBlock.scopes.push({ active: true, scope });
    }
  }

  /**
   * Prune any scopes that are out of range
   */
  visitId(id: InstructionId) {
    const currentBlock = this.scopes[this.scopes.length - 1]!;
    retainWhere(currentBlock.scopes, (pending) => {
      if (pending.scope.range.end > id) {
        return true;
      } else {
        currentBlock.seen.delete(pending.scope.id);
        return false;
      }
    });
  }

  enterBlock(): void {
    this.scopes.push(new BlockScope());
  }
  visitValue(value: InstructionValue): void {}
  visitInstruction(instruction: Instruction, value: void): void {
    const scope = getInstructionScope(instruction);
    if (scope !== null && instruction.id < scope.range.end) {
      this.visitScope(scope);
    }
    this.visitId(instruction.id);
  }
  visitImplicitTerminal(id: InstructionId | null): void | null {
    if (id !== null) {
      this.visitId(id);
    }
  }
  visitTerminal(terminal: BlockTerminal<void, void, void, void>): void {
    if (terminal.id !== null) {
      this.visitId(terminal.id);
    }
  }
  visitCase(test: void | null, block: void): void {}
  appendBlock(block: void, item: void, label?: string | undefined): void {}
  leaveBlock(block: void): void {
    this.scopes.pop();
    if (this.scopes.length === 0) {
      this.joinedScopes.forEach((scope, groupScope) => {
        if (scope !== groupScope) {
          groupScope.range.start = makeInstructionId(
            Math.min(groupScope.range.start, scope.range.start)
          );
          groupScope.range.end = makeInstructionId(
            Math.max(groupScope.range.end, scope.range.end)
          );
          scope.range = groupScope.range;
          scope.id = groupScope.id;
        }
      });
    }
  }
}

type PendingReactiveScope = { active: boolean; scope: ReactiveScope };

/**
 * Aligns scopes to block scope boundaries.
 */
class AlignReactiveScopesToBlockScopeRangeVisitor
  implements Visitor<void, void, void, void>
{
  // For each block scope (outer array) stores a list of ReactiveScopes that start
  // in that block scope.
  blockScopes: Array<Array<PendingReactiveScope>> = [];

  // ReactiveScopes whose declaring block scope has ended but may still need to
  // be "closed" (ie have their range.end be updated). A given scope can be in
  // blockScopes OR this array but not both.
  unclosedScopes: Array<PendingReactiveScope> = [];

  // Set of all scope ids that have been seen so far, regardless of which of
  // the above data structures they're in, to avoid tracking the same scope twice.
  seenScopes: Set<ScopeId> = new Set();

  visitId(id: InstructionId) {
    const currentScopes = this.blockScopes[this.blockScopes.length - 1]!;
    const scopes = [...currentScopes, ...this.unclosedScopes];
    for (const pending of scopes) {
      if (!pending.active) {
        continue;
      }
      if (id >= pending.scope.range.end) {
        pending.active = false;
        pending.scope.range.end = id;
      }
    }
  }

  enterBlock(): void {
    this.blockScopes.push([]);
  }

  leaveBlock(block: void): void {
    const lastScope = this.blockScopes.pop();
    invariant(
      lastScope !== undefined,
      "Expected enterBlock/leaveBlock to be called 1:1"
    );
    for (const scope of lastScope) {
      if (scope.active) {
        this.unclosedScopes.push(scope);
      }
    }
  }

  visitInstruction(instruction: Instruction, value: void): void {
    const scope = getInstructionScope(instruction);
    if (scope !== null) {
      if (!this.seenScopes.has(scope.id)) {
        const currentScopes = this.blockScopes[this.blockScopes.length - 1]!;
        this.seenScopes.add(scope.id);
        currentScopes.push({
          active: true,
          scope,
        });
      }
    }

    this.visitId(instruction.id);
  }

  visitTerminal(terminal: BlockTerminal<void, void, void, void>): void {
    if (terminal.id !== null) {
      this.visitId(terminal.id);
    }
  }

  visitImplicitTerminal(id: InstructionId | null): void | null {
    if (id !== null) {
      this.visitId(id);
    }
  }

  // no-ops
  visitValue(value: InstructionValue): void {}
  visitCase(test: void | null, block: void): void {}
  appendBlock(block: void, item: void, label?: string | undefined): void {}
}

function getInstructionScope(instr: Instruction): ReactiveScope | null {
  if (instr.lvalue !== null && instr.lvalue.place.identifier.scope !== null) {
    return instr.lvalue.place.identifier.scope;
  } else {
    for (const operand of eachInstructionOperand(instr)) {
      if (operand.identifier.scope !== null) {
        return operand.identifier.scope;
      }
    }
  }
  return null;
}

/**
 * Modifies @param array, retaining only the items where the predicate returns true.
 */
function retainWhere<T>(array: Array<T>, predicate: (item: T) => boolean) {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < array.length; readIndex++) {
    const item = array[readIndex];
    if (predicate(item) === true) {
      array[writeIndex++] = item;
    }
  }
  array.length = writeIndex;
}
