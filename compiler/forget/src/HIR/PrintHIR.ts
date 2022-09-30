/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { assertExhaustive } from "../Common/utils";
import { HIR, Instruction, InstructionValue, Place, Terminal } from "./HIR";

export type Options = {
  indent: number;
};

export default function printHIR(
  ir: HIR,
  options: Options | null = null
): string {
  let output = [];
  let indent = " ".repeat(options?.indent ?? 0);
  const push = (text: string, indent: string = "  ") => {
    output.push(`${indent}${text}`);
  };
  for (const [blockId, block] of ir.blocks) {
    output.push(`bb${blockId}:`);
    for (const instr of block.instructions) {
      push(printInstruction(instr));
    }
    const terminal = printTerminal(block.terminal);
    if (Array.isArray(terminal)) {
      terminal.forEach((line) => push(line));
    } else {
      push(terminal);
    }
  }
  return output.map((line) => indent + line).join("\n");
}

export function printMixedHIR(
  value: Instruction | InstructionValue | Terminal
): string {
  if (!("kind" in value)) {
    return printInstruction(value);
  }
  switch (value.kind) {
    case "if":
    case "return":
    case "switch":
    case "throw":
    case "goto": {
      const terminal = printTerminal(value);
      if (Array.isArray(terminal)) {
        return terminal.join("; ");
      }
      return terminal;
    }
    default: {
      return printInstructionValue(value);
    }
  }
}

function printInstruction(instr: Instruction): string {
  const value = printInstructionValue(instr.value);

  if (instr.place !== null) {
    return `${printPlace(instr.place)} = ${value}`;
  } else {
    return value;
  }
}

function printTerminal(terminal: Terminal): Array<string> | string {
  let value;
  switch (terminal.kind) {
    case "if": {
      value = `If (${printPlace(terminal.test)}) then:bb${
        terminal.consequent
      } else:bb${terminal.alternate}`;
      break;
    }
    case "throw": {
      value = `Throw ${printPlace(terminal.value)}`;
      break;
    }
    case "return": {
      value = `Return${
        terminal.value != null ? " " + printPlace(terminal.value) : ""
      }`;
      break;
    }
    case "goto": {
      value = `Goto bb${terminal.block}`;
      break;
    }
    case "switch": {
      const output = [];
      output.push(`Switch (${printPlace(terminal.test)})`);
      terminal.cases.forEach((case_) => {
        if (case_.test !== null) {
          output.push(`  Case ${printPlace(case_.test)}: bb${case_.block}`);
        } else {
          output.push(`  Default: bb${case_.block}`);
        }
      });
      value = output;
      break;
    }
    default: {
      assertExhaustive(
        terminal,
        `Unexpected terminal kind '${terminal as any as Terminal}'`
      );
    }
  }
  return value;
}

function printInstructionValue(instrValue: InstructionValue): string {
  let value = "";
  switch (instrValue.kind) {
    case "ArrayExpression": {
      value = `Array [${instrValue.elements
        .map((element) => printPlace(element))
        .join(", ")}]`;
      break;
    }
    case "ObjectExpression": {
      const properties = [];
      if (instrValue.properties !== null) {
        for (const [key, value] of Object.entries(instrValue.properties)) {
          properties.push(`${key}: ${printPlace(value)}`);
        }
      }
      value = `Object { ${properties.join(", ")} }`;
      break;
    }
    case "UnaryExpression": {
      value = `Unary ${printPlace(instrValue.value)}`;
      break;
    }
    case "BinaryExpression": {
      value = `Binary ${printPlace(instrValue.left)} ${
        instrValue.operator
      } ${printPlace(instrValue.right)}`;
      break;
    }
    case "CallExpression": {
      value = `Call ${printPlace(instrValue.callee)}(${instrValue.args
        .map((arg) => printPlace(arg))
        .join(", ")})`;
      break;
    }
    case "JSXText":
    case "Primitive": {
      value = JSON.stringify(instrValue.value);
      break;
    }
    case "JsxExpression": {
      const propItems = [];
      for (const [prop, value] of Object.entries(instrValue.props)) {
        propItems.push(`${prop}={${printPlace(value)}}`);
      }
      const props = propItems.length !== 0 ? " " + propItems.join(" ") : "";
      if (instrValue.children !== null) {
        const children = instrValue.children.map((child) => {
          return `{${printPlace(child)}}`;
        });
        value = `JSX <${printPlace(instrValue.tag)}${props}${
          props.length > 0 ? " " : ""
        }>${children.join("")}</${printPlace(instrValue.tag)}>`;
      } else {
        value = `JSX <${printPlace(instrValue.tag)}${props}${
          props.length > 0 ? " " : ""
        }/>`;
      }
      break;
    }
    case "NewExpression": {
      value = `New ${printPlace(instrValue.callee)}(${instrValue.args
        .map((arg) => printPlace(arg))
        .join(", ")})`;
      break;
    }
    case "OtherStatement": {
      value = `Other(${instrValue.path?.node?.type}): \`${String(
        instrValue.path
      )}\``;
      break;
    }
    case "Identifier": {
      value = printPlace(instrValue);
      break;
    }
    default: {
      assertExhaustive(
        instrValue,
        `Unexpected instruction kind '${
          (instrValue as any as InstructionValue).kind
        }'`
      );
    }
  }
  return value;
}

export function printPlace(place: Place): string {
  const items = [place.capability, " ", place.value.name, "$", place.value.id];
  if (place.memberPath != null) {
    for (const path of place.memberPath) {
      items.push(".");
      items.push(path);
    }
  }
  return items.filter((x) => x != null).join("");
}
