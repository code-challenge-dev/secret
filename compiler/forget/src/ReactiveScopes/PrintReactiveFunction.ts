/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import invariant from "invariant";
import {
  ReactiveFunction,
  ReactiveScopeBlock,
  ReactiveScopeDependency,
  ReactiveStatement,
  ReactiveTerminal,
  ReactiveValueBlock,
} from "../HIR/HIR";
import {
  printIdentifier,
  printInstruction,
  printInstructionValue,
  printPlace,
} from "../HIR/PrintHIR";
import { assertExhaustive } from "../Utils/utils";

export function printReactiveFunction(fn: ReactiveFunction): string {
  const writer = new Writer();
  writer.writeLine(`function ${fn.id?.name ?? "<unknown>"}(`);
  writer.indented(() => {
    for (const param of fn.params) {
      writer.writeLine(`${param.identifier.name ?? "<param>"},`);
    }
  });
  writer.writeLine(") {");
  printReactiveInstructions(writer, fn.body);
  writer.writeLine("}");
  return writer.complete();
}

export function printReactiveBlock(
  writer: Writer,
  block: ReactiveScopeBlock
): void {
  writer.writeLine(
    `scope @${block.scope.id} [${block.scope.range.start}:${
      block.scope.range.end
    }] deps=[${Array.from(block.scope.dependencies)
      .map((dep) => printDependency(dep))
      .join(", ")}] out=[${Array.from(block.scope.outputs)
      .map((out) => printIdentifier(out))
      .join(", ")}] {`
  );
  printReactiveInstructions(writer, block.instructions);
  writer.writeLine("}");
}

function printDependency(dependency: ReactiveScopeDependency): string {
  const place = printPlace(dependency.place);
  if (dependency.path === null) {
    return place;
  } else {
    return `${place}${dependency.path.map((prop) => `.${prop}`).join("")}`;
  }
}

export function printReactiveInstructions(
  writer: Writer,
  instructions: Array<ReactiveStatement>
): void {
  writer.indented(() => {
    for (const instr of instructions) {
      printReactiveInstruction(writer, instr);
    }
  });
}

function printReactiveInstruction(
  writer: Writer,
  instr: ReactiveStatement
): void {
  switch (instr.kind) {
    case "instruction": {
      writer.writeLine(printInstruction(instr.instruction));
      break;
    }
    case "scope": {
      printReactiveBlock(writer, instr);
      break;
    }
    case "terminal": {
      printTerminal(writer, instr.terminal);
      break;
    }
    default: {
      assertExhaustive(
        instr,
        `Unexpected terminal kind '${(instr as any).kind}'`
      );
    }
  }
}

function printValueBlock(writer: Writer, block: ReactiveValueBlock): void {
  writer.indented(() => {
    for (const instr of block.instructions) {
      printReactiveInstruction(writer, instr);
    }
    if (block.last !== null) {
      writer.writeLine(printInstructionValue(block.last.value));
    }
  });
}

function printTerminal(writer: Writer, terminal: ReactiveTerminal): void {
  switch (terminal.kind) {
    case "break": {
      const id = terminal.id !== null ? `[${terminal.id}]` : [];
      if (terminal.label !== null) {
        writer.writeLine(`${id} break bb${terminal.label}`);
      } else {
        writer.writeLine(`${id} break`);
      }
      break;
    }
    case "continue": {
      const id = `[${terminal.id}]`;
      if (terminal.label !== null) {
        writer.writeLine(`${id} continue bb${terminal.label}`);
      } else {
        writer.writeLine(`${id} continue`);
      }
      break;
    }
    case "while": {
      writer.writeLine(`[${terminal.id}] while (`);
      printValueBlock(writer, terminal.test);
      writer.writeLine(") {");
      printReactiveInstructions(writer, terminal.loop);
      writer.writeLine("}");
      break;
    }
    case "if": {
      const { test, consequent, alternate } = terminal;
      writer.writeLine(`[${terminal.id}] if (${printPlace(test)}) {`);
      printReactiveInstructions(writer, consequent);
      if (alternate !== null) {
        writer.writeLine("} else {");
        printReactiveInstructions(writer, alternate);
      }
      writer.writeLine("}");
      break;
    }
    case "switch": {
      writer.writeLine(
        `[${terminal.id}] switch (${printPlace(terminal.test)}) {`
      );
      writer.indented(() => {
        for (const case_ of terminal.cases) {
          let prefix =
            case_.test !== null ? `case ${printPlace(case_.test)}` : "default";
          writer.writeLine(`${prefix}: {`);
          writer.indented(() => {
            const block = case_.block;
            invariant(block != null, "Expected case to have a block");
            printReactiveInstructions(writer, block);
          });
          writer.writeLine("}");
        }
      });
      writer.writeLine("}");
      break;
    }
    case "for": {
      writer.writeLine("[${terminal.id}] for (");
      printValueBlock(writer, terminal.init);
      writer.writeLine(";");
      printValueBlock(writer, terminal.test);
      writer.writeLine(";");
      printValueBlock(writer, terminal.update);
      writer.writeLine(") {");
      printReactiveInstructions(writer, terminal.loop);
      writer.writeLine("}");
      break;
    }
    case "throw": {
      writer.writeLine(`[${terminal.id}] throw ${printPlace(terminal.value)}`);
      break;
    }
    case "return": {
      if (terminal.value !== null) {
        writer.writeLine(
          `[${terminal.id}] return ${printPlace(terminal.value)}`
        );
      } else {
        writer.writeLine(`[${terminal.id}] return`);
      }
      break;
    }
  }
}

export class Writer {
  #out: Array<string> = [];
  #depth: number;

  constructor({ depth }: { depth: number } = { depth: 0 }) {
    this.#depth = depth;
  }

  complete(): string {
    return this.#out.join("");
  }

  write(s: string): void {
    this.#out.push("  ".repeat(this.#depth) + s);
  }

  writeLine(s: string): void {
    this.#out.push("  ".repeat(this.#depth) + s + "\n");
  }

  indented(f: () => void): void {
    this.#depth++;
    f();
    this.#depth--;
  }
}
