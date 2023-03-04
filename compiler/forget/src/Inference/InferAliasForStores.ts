/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import {
  Effect,
  HIRFunction,
  Identifier,
  InstructionId,
  Place,
} from "../HIR/HIR";
import {
  eachInstructionValueOperand,
  eachPatternOperand,
} from "../HIR/visitors";
import DisjointSet from "../Utils/DisjointSet";

export function inferAliasForStores(
  func: HIRFunction,
  aliases: DisjointSet<Identifier>
) {
  for (const [_, block] of func.body.blocks) {
    for (const instr of block.instructions) {
      const { value, lvalue } = instr;
      if (lvalue.effect !== Effect.Store) {
        continue;
      }
      if (value.kind === "StoreLocal") {
        maybeAlias(aliases, value.lvalue.place, value.value, instr.id);
      } else if (value.kind === "Destructure") {
        for (const place of eachPatternOperand(value.lvalue.pattern)) {
          maybeAlias(aliases, place, value.value, instr.id);
        }
      }
      for (const operand of eachInstructionValueOperand(value)) {
        if (
          operand.effect === Effect.Capture ||
          operand.effect === Effect.Store
        ) {
          maybeAlias(aliases, lvalue, operand, instr.id);
        }
      }
    }
  }
}

function maybeAlias(
  aliases: DisjointSet<Identifier>,
  lvalue: Place,
  rvalue: Place,
  id: InstructionId
): void {
  if (
    lvalue.identifier.mutableRange.end > id + 1 ||
    rvalue.identifier.mutableRange.end > id
  ) {
    aliases.union([lvalue.identifier, rvalue.identifier]);
  }
}
