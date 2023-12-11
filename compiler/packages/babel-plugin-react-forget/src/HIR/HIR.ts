/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as t from "@babel/types";
import { CompilerError } from "../CompilerError";
import { assertExhaustive } from "../Utils/utils";
import { Environment } from "./Environment";
import { HookKind } from "./ObjectShape";
import { Type } from "./Types";

/*
 * *******************************************************************************************
 * *******************************************************************************************
 * ************************************* Core Data Model *************************************
 * *******************************************************************************************
 * *******************************************************************************************
 */

// AST -> (lowering) -> HIR -> (analysis) -> Reactive Scopes -> (codegen) -> AST

/*
 * A location in a source file, intended to be used for providing diagnostic information and
 * transforming code while preserving source information (ie to emit source maps).
 *
 * `GeneratedSource` indicates that there is no single source location from which the code derives.
 */
export const GeneratedSource = Symbol();
export type SourceLocation = t.SourceLocation | typeof GeneratedSource;

/*
 * A React function defines a computation that takes some set of reactive inputs
 * (props, hook arguments) and return a result (JSX, hook return value). Unlike
 * HIR, the data model is tree-shaped:
 *
 * ReactFunction
 *    ReactiveBlock
 *      ReactiveBlockScope*
 *       Place* (dependencies)
 *       (ReactiveInstruction | ReactiveTerminal)*
 *
 * Where ReactiveTerminal may recursively contain zero or more ReactiveBlocks.
 *
 * Each ReactiveBlockScope describes a set of dependencies as well as the instructions (and terminals)
 * within that scope.
 */
export type ReactiveFunction = {
  loc: SourceLocation;
  id: string | null;
  params: Array<Place | SpreadPattern>;
  generator: boolean;
  async: boolean;
  body: ReactiveBlock;
  env: Environment;
};

export type ReactiveScopeBlock = {
  kind: "scope";
  scope: ReactiveScope;
  instructions: ReactiveBlock;
};

export type ReactiveBlock = Array<ReactiveStatement>;

export type ReactiveStatement =
  | ReactiveInstructionStatement
  | ReactiveTerminalStatement
  | ReactiveScopeBlock;

export type ReactiveInstructionStatement = {
  kind: "instruction";
  instruction: ReactiveInstruction;
};

export type ReactiveTerminalStatement<
  Tterminal extends ReactiveTerminal = ReactiveTerminal
> = {
  kind: "terminal";
  terminal: Tterminal;
  label: BlockId | null;
};

export type ReactiveInstruction = {
  id: InstructionId;
  lvalue: Place | null;
  value: ReactiveValue;
  loc: SourceLocation;
};

export type ReactiveValue =
  | InstructionValue
  | ReactiveLogicalValue
  | ReactiveSequenceValue
  | ReactiveTernaryValue
  | ReactiveOptionalCallValue;

export type ReactiveLogicalValue = {
  kind: "LogicalExpression";
  operator: t.LogicalExpression["operator"];
  left: ReactiveValue;
  right: ReactiveValue;
  loc: SourceLocation;
};

export type ReactiveTernaryValue = {
  kind: "ConditionalExpression";
  test: ReactiveValue;
  consequent: ReactiveValue;
  alternate: ReactiveValue;
  loc: SourceLocation;
};

export type ReactiveSequenceValue = {
  kind: "SequenceExpression";
  instructions: Array<ReactiveInstruction>;
  id: InstructionId;
  value: ReactiveValue;
  loc: SourceLocation;
};

export type ReactiveOptionalCallValue = {
  kind: "OptionalExpression";
  id: InstructionId;
  value: ReactiveValue;
  optional: boolean;
  loc: SourceLocation;
};

export type ReactiveTerminal =
  | ReactiveBreakTerminal
  | ReactiveContinueTerminal
  | ReactiveReturnTerminal
  | ReactiveThrowTerminal
  | ReactiveSwitchTerminal
  | ReactiveDoWhileTerminal
  | ReactiveWhileTerminal
  | ReactiveForTerminal
  | ReactiveForOfTerminal
  | ReactiveForInTerminal
  | ReactiveIfTerminal
  | ReactiveLabelTerminal
  | ReactiveTryTerminal;

export type ReactiveBreakTerminal = {
  kind: "break";
  label: BlockId | null;
  id: InstructionId | null;
  implicit: boolean;
};
export type ReactiveContinueTerminal = {
  kind: "continue";
  label: BlockId | null;
  id: InstructionId;
  implicit: boolean;
};
export type ReactiveReturnTerminal = {
  kind: "return";
  value: Place;
  id: InstructionId;
};
export type ReactiveThrowTerminal = {
  kind: "throw";
  value: Place;
  id: InstructionId;
};
export type ReactiveSwitchTerminal = {
  kind: "switch";
  test: Place;
  cases: Array<{
    test: Place | null;
    block: ReactiveBlock | void;
  }>;
  id: InstructionId;
};
export type ReactiveDoWhileTerminal = {
  kind: "do-while";
  loop: ReactiveBlock;
  test: ReactiveValue;
  id: InstructionId;
};
export type ReactiveWhileTerminal = {
  kind: "while";
  test: ReactiveValue;
  loop: ReactiveBlock;
  id: InstructionId;
};
export type ReactiveForTerminal = {
  kind: "for";
  init: ReactiveValue;
  test: ReactiveValue;
  update: ReactiveValue | null;
  loop: ReactiveBlock;
  id: InstructionId;
};
export type ReactiveForOfTerminal = {
  kind: "for-of";
  init: ReactiveValue;
  loop: ReactiveBlock;
  id: InstructionId;
};
export type ReactiveForInTerminal = {
  kind: "for-in";
  init: ReactiveValue;
  loop: ReactiveBlock;
  id: InstructionId;
};
export type ReactiveIfTerminal = {
  kind: "if";
  test: Place;
  consequent: ReactiveBlock;
  alternate: ReactiveBlock | null;
  id: InstructionId;
};
export type ReactiveLabelTerminal = {
  kind: "label";
  block: ReactiveBlock;
  id: InstructionId;
};
export type ReactiveTryTerminal = {
  kind: "try";
  block: ReactiveBlock;
  handlerBinding: Place | null;
  handler: ReactiveBlock;
  id: InstructionId;
};

// A function lowered to HIR form, ie where its body is lowered to an HIR control-flow graph
export type HIRFunction = {
  loc: SourceLocation;
  id: string | null;
  env: Environment;
  params: Array<Place | SpreadPattern>;
  context: Array<Place>;
  body: HIR;
  generator: boolean;
  async: boolean;
};

/*
 * Each reactive scope may have its own control-flow, so the instructions form
 * a control-flow graph. The graph comprises a set of basic blocks which reference
 * each other via terminal statements, as well as a reference to the entry block.
 */
export type HIR = {
  entry: BlockId;

  /*
   * Basic blocks are stored as a map to aid certain operations that need to
   * lookup blocks by their id. However, the order of the items in the map is
   * reverse postorder, that is, barring cycles, predecessors appear before
   * successors. This is designed to facilitate forward data flow analysis.
   */
  blocks: Map<BlockId, BasicBlock>;
};

/*
 * Each basic block within an instruction graph contains zero or more instructions
 * followed by a terminal node. Note that basic blocks always execute consecutively,
 * there can be no branching within a block other than for an exception. Exceptions
 * can occur pervasively and React runtime is responsible for resetting state when
 * an exception occurs, therefore the block model only represents explicit throw
 * statements and not implicit exceptions which may occur.
 */
export type BlockKind = "block" | "value" | "loop" | "sequence" | "catch";
export type BasicBlock = {
  kind: BlockKind;
  id: BlockId;
  instructions: Array<Instruction>;
  terminal: Terminal;
  preds: Set<BlockId>;
  phis: Set<Phi>;
};

/*
 * Terminal nodes generally represent statements that affect control flow, such as
 * for-of, if-else, return, etc.
 */
export type Terminal =
  | UnsupportedTerminal
  | ThrowTerminal
  | ReturnTerminal
  | GotoTerminal
  | IfTerminal
  | BranchTerminal
  | SwitchTerminal
  | ForTerminal
  | ForOfTerminal
  | ForInTerminal
  | DoWhileTerminal
  | WhileTerminal
  | LogicalTerminal
  | TernaryTerminal
  | OptionalTerminal
  | LabelTerminal
  | SequenceTerminal
  | MaybeThrowTerminal
  | TryTerminal;

function _staticInvariantTerminalHasLocation(
  terminal: Terminal
): SourceLocation {
  // If this fails, it is because a variant of Terminal is missing a .loc - add it!
  return terminal.loc;
}

function _staticInvariantTerminalHasInstructionId(
  terminal: Terminal
): InstructionId {
  // If this fails, it is because a variant of Terminal is missing a .id - add it!
  return terminal.id;
}

/*
 * Terminal nodes allowed for a value block
 * A terminal that couldn't be lowered correctly.
 */
export type UnsupportedTerminal = {
  kind: "unsupported";
  id: InstructionId;
  loc: SourceLocation;
};
export type ThrowTerminal = {
  kind: "throw";
  value: Place;
  id: InstructionId;
  loc: SourceLocation;
};
export type Case = { test: Place | null; block: BlockId };

export type ReturnTerminal = {
  kind: "return";
  loc: SourceLocation;
  value: Place;
  id: InstructionId;
};

export type GotoTerminal = {
  kind: "goto";
  block: BlockId;
  variant: GotoVariant;
  id: InstructionId;
  loc: SourceLocation;
};

export enum GotoVariant {
  Break = "Break",
  Continue = "Continue",
  Try = "Try",
}

export type IfTerminal = {
  kind: "if";
  test: Place;
  consequent: BlockId;
  alternate: BlockId;
  fallthrough: BlockId | null;
  id: InstructionId;
  loc: SourceLocation;
};

export type BranchTerminal = {
  kind: "branch";
  test: Place;
  consequent: BlockId;
  alternate: BlockId;
  id: InstructionId;
  loc: SourceLocation;
};

export type SwitchTerminal = {
  kind: "switch";
  test: Place;
  cases: Case[];
  fallthrough: BlockId | null;
  id: InstructionId;
  loc: SourceLocation;
};

export type DoWhileTerminal = {
  kind: "do-while";
  loop: BlockId;
  test: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
};

export type WhileTerminal = {
  kind: "while";
  loc: SourceLocation;
  test: BlockId;
  loop: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
};

export type ForTerminal = {
  kind: "for";
  loc: SourceLocation;
  init: BlockId;
  test: BlockId;
  update: BlockId | null;
  loop: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
};

export type ForOfTerminal = {
  kind: "for-of";
  loc: SourceLocation;
  init: BlockId;
  loop: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
};

export type ForInTerminal = {
  kind: "for-in";
  loc: SourceLocation;
  init: BlockId;
  loop: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
};

export type LogicalTerminal = {
  kind: "logical";
  operator: t.LogicalExpression["operator"];
  test: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
};

export type TernaryTerminal = {
  kind: "ternary";
  test: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
};

export type LabelTerminal = {
  kind: "label";
  block: BlockId;
  fallthrough: BlockId | null;
  id: InstructionId;
  loc: SourceLocation;
};

export type OptionalTerminal = {
  kind: "optional";
  /*
   * Specifies whether this node was optional. If false, it means that the original
   * node was part of an optional chain but this specific item was non-optional.
   * For example, in `a?.b.c?.()`, the `.b` access is non-optional but appears within
   * an optional chain.
   */
  optional: boolean;
  test: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
};

export type SequenceTerminal = {
  kind: "sequence";
  block: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
};

export type TryTerminal = {
  kind: "try";
  block: BlockId;
  handlerBinding: Place | null;
  handler: BlockId;
  // TODO: support `finally`
  fallthrough: BlockId | null;
  id: InstructionId;
  loc: SourceLocation;
};

export type MaybeThrowTerminal = {
  kind: "maybe-throw";
  continuation: BlockId;
  handler: BlockId;
  id: InstructionId;
  loc: SourceLocation;
};

/*
 * Instructions generally represent expressions but with all nesting flattened away,
 * such that all operands to each instruction are either primitive values OR are
 * references to a place, which may be a temporary that holds the results of a
 * previous instruction. So `foo(bar(a))` would decompose into two instructions,
 * one to store `tmp0 = bar(a)`, one for `foo(tmp0)`.
 *
 * Instructions generally store their value into a Place, though some instructions
 * may not produce a value that is necessary to track (for example, class definitions)
 * or may occur only for side-effects (many expression statements).
 */
export type Instruction = {
  id: InstructionId;
  lvalue: Place;
  value: InstructionValue;
  loc: SourceLocation;
};

export type LValue = {
  place: Place;
  kind: InstructionKind;
};

export type LValuePattern = {
  pattern: Pattern;
  kind: InstructionKind;
};

export type ArrayExpression = {
  kind: "ArrayExpression";
  elements: Array<Place | SpreadPattern | Hole>;
  loc: SourceLocation;
};

export type Pattern = ArrayPattern | ObjectPattern;

export type Hole = {
  kind: "Hole";
};

export type SpreadPattern = {
  kind: "Spread";
  place: Place;
};

export type ArrayPattern = {
  kind: "ArrayPattern";
  items: Array<Place | SpreadPattern | Hole>;
};

export type ObjectPattern = {
  kind: "ObjectPattern";
  properties: Array<ObjectProperty | SpreadPattern>;
};

export type ObjectPropertyKey =
  | {
      kind: "string";
      name: string;
    }
  | {
      kind: "identifier";
      name: string;
    }
  | {
      kind: "computed";
      name: Place;
    };

export type ObjectProperty = {
  kind: "ObjectProperty";
  key: ObjectPropertyKey;
  type: "property" | "method";
  place: Place;
};

export type LoweredFunction = {
  dependencies: Array<Place>;
  func: HIRFunction;
};

export type ObjectMethod = {
  kind: "ObjectMethod";
  loc: SourceLocation;
  loweredFunc: LoweredFunction;
};

export enum InstructionKind {
  // const declaration
  Const = "Const",
  // let declaration
  Let = "Let",
  // assing a new value to a let binding
  Reassign = "Reassign",
  // catch clause binding
  Catch = "Catch",

  // hoisted const declarations
  HoistedConst = "HoistedConst",
}

function _staticInvariantInstructionValueHasLocation(
  value: InstructionValue
): SourceLocation {
  // If this fails, it is because a variant of InstructionValue is missing a .loc - add it!
  return value.loc;
}

export type Phi = {
  kind: "Phi";
  id: Identifier;
  operands: Map<BlockId, Identifier>;
  type: Type;
};

/*
 * Forget currently does not handle MethodCall correctly in
 * all cases. Specifically, we do not bind the receiver and method property
 * before calling to args. Until we add a SequenceExpression to inline all
 * instructions generated when lowering args, we have a limited representation
 * with some constraints.
 *
 * Forget currently makes these assumptions (checked in codegen):
 *   - {@link MethodCall.property} is a temporary produced by a PropertyLoad or ComputedLoad
 *     on {@link MethodCall.receiver}
 *   - {@link MethodCall.property} remains an rval (i.e. never promoted to a
 *     named identifier). We currently rely on this for codegen.
 *
 * Type inference does not currently guarantee that {@link MethodCall.property}
 * is a FunctionType.
 */
export type MethodCall = {
  kind: "MethodCall";
  receiver: Place;
  property: Place;
  args: Array<Place | SpreadPattern>;
  loc: SourceLocation;
};

export type CallExpression = {
  kind: "CallExpression";
  callee: Place;
  args: Array<Place | SpreadPattern>;
  loc: SourceLocation;
};

/*
 * The value of a given instruction. Note that values are not recursive: complex
 * values such as objects or arrays are always defined by instructions to define
 * their operands (saving to a temporary), then passing those temporaries as
 * the operands to the final instruction (ObjectExpression, ArrayExpression, etc).
 *
 * Operands are therefore always a Place.
 */

export type InstructionValue =
  | {
      kind: "LoadLocal";
      place: Place;
      loc: SourceLocation;
    }
  | {
      kind: "LoadContext";
      place: Place;
      loc: SourceLocation;
    }
  | {
      kind: "DeclareLocal";
      lvalue: LValue;
      loc: SourceLocation;
    }
  | {
      kind: "DeclareContext";
      lvalue: {
        kind: InstructionKind.Let | InstructionKind.HoistedConst;
        place: Place;
      };
      loc: SourceLocation;
    }
  | {
      kind: "StoreLocal";
      lvalue: LValue;
      value: Place;
      loc: SourceLocation;
    }
  | {
      kind: "StoreContext";
      lvalue: {
        kind: InstructionKind.Reassign;
        place: Place;
      };
      value: Place;
      loc: SourceLocation;
    }
  | Destructure
  | {
      kind: "Primitive";
      value: number | boolean | string | null | undefined;
      loc: SourceLocation;
    }
  | JSXText
  | {
      kind: "BinaryExpression";
      operator: t.BinaryExpression["operator"];
      left: Place;
      right: Place;
      loc: SourceLocation;
    }
  | {
      kind: "NewExpression";
      callee: Place;
      args: Array<Place | SpreadPattern>;
      loc: SourceLocation;
    }
  | CallExpression
  | MethodCall
  | {
      kind: "UnaryExpression";
      operator: string;
      value: Place;
      loc: SourceLocation;
    }
  | {
      kind: "TypeCastExpression";
      value: Place;
      typeAnnotation: t.FlowType | t.TSType;
      type: Type;
      loc: SourceLocation;
    }
  | {
      kind: "JsxExpression";
      tag: Place | BuiltinTag;
      props: Array<JsxAttribute>;
      children: Array<Place> | null; // null === no children
      loc: SourceLocation;
    }
  | {
      kind: "ObjectExpression";
      properties: Array<ObjectProperty | SpreadPattern>;
      loc: SourceLocation;
    }
  | ObjectMethod
  | ArrayExpression
  | { kind: "JsxFragment"; children: Array<Place>; loc: SourceLocation }
  | {
      kind: "RegExpLiteral";
      pattern: string;
      flags: string;
      loc: SourceLocation;
    }

  // store `object.property = value`
  | {
      kind: "PropertyStore";
      object: Place;
      property: string;
      value: Place;
      loc: SourceLocation;
    }
  // load `object.property`
  | {
      kind: "PropertyLoad";
      object: Place;
      property: string;
      loc: SourceLocation;
    }
  // `delete object.property`
  | {
      kind: "PropertyDelete";
      object: Place;
      property: string;
      loc: SourceLocation;
    }

  // store `object[index] = value` - like PropertyStore but with a dynamic property
  | {
      kind: "ComputedStore";
      object: Place;
      property: Place;
      value: Place;
      loc: SourceLocation;
    }
  // load `object[index]` - like PropertyLoad but with a dynamic property
  | {
      kind: "ComputedLoad";
      object: Place;
      property: Place;
      loc: SourceLocation;
    }
  // `delete object[property]`
  | {
      kind: "ComputedDelete";
      object: Place;
      property: Place;
      loc: SourceLocation;
    }
  | LoadGlobal
  | FunctionExpression
  | {
      kind: "TaggedTemplateExpression";
      tag: Place;
      value: { raw: string; cooked?: string };
      loc: SourceLocation;
    }
  | {
      kind: "TemplateLiteral";
      subexprs: Array<Place>;
      quasis: Array<{ raw: string; cooked?: string }>;
      loc: SourceLocation;
    }
  | {
      kind: "Await";
      value: Place;
      loc: SourceLocation;
    }
  | {
      kind: "NextIterableOf";
      value: Place; // the collection
      loc: SourceLocation;
    }
  | {
      kind: "NextPropertyOf";
      value: Place; // the collection
      loc: SourceLocation;
    }
  /*
   * Models a prefix update expression such as --x or ++y
   * This instructions increments or decrements the <lvalue>
   * but evaluates to the value of <value> prior to the update.
   */
  | {
      kind: "PrefixUpdate";
      lvalue: Place;
      operation: t.UpdateExpression["operator"];
      value: Place;
      loc: SourceLocation;
    }
  /*
   * Models a postfix update expression such as x-- or y++
   * This instructions increments or decrements the <lvalue>
   * and evaluates to the value after the update
   */
  | {
      kind: "PostfixUpdate";
      lvalue: Place;
      operation: t.UpdateExpression["operator"];
      value: Place;
      loc: SourceLocation;
    }
  // `debugger` statement
  | { kind: "Debugger"; loc: SourceLocation }
  /*
   * Catch-all for statements such as type imports, nested class declarations, etc
   * which are not directly represented, but included for completeness and to allow
   * passing through in codegen.
   */
  | {
      kind: "UnsupportedNode";
      node: t.Node;
      loc: SourceLocation;
    };

export type JsxAttribute =
  | { kind: "JsxSpreadAttribute"; argument: Place }
  | { kind: "JsxAttribute"; name: string; place: Place };

export type FunctionExpression = {
  kind: "FunctionExpression";
  name: string | null;
  loweredFunc: LoweredFunction;
  expr:
    | t.ArrowFunctionExpression
    | t.FunctionExpression
    | t.FunctionDeclaration;
  loc: SourceLocation;
};

export type Destructure = {
  kind: "Destructure";
  lvalue: LValuePattern;
  value: Place;
  loc: SourceLocation;
};

/*
 * A place where data may be read from / written to:
 * - a variable (identifier)
 * - a path into an identifier
 */
export type Place = {
  kind: "Identifier";
  identifier: Identifier;
  effect: Effect;
  reactive: boolean;
  loc: SourceLocation;
};

// A primitive value with a specific (constant) value.
export type Primitive = {
  kind: "Primitive";
  value: number | boolean | string | null | undefined;
  loc: SourceLocation;
};

export type JSXText = { kind: "JSXText"; value: string; loc: SourceLocation };

export type LoadGlobal = {
  kind: "LoadGlobal";
  name: string;
  loc: SourceLocation;
};

export type BuiltinTag = {
  kind: "BuiltinTag";
  name: string;
  loc: SourceLocation;
};

/*
 * Range in which an identifier is mutable. Start and End refer to Instruction.id.
 *
 * Start is inclusive, End is exclusive (ie, end is the "first" instruction for which
 * the value is not mutable).
 */
export type MutableRange = {
  start: InstructionId;
  end: InstructionId;
};

// Represents a user-defined variable (has a name) or a temporary variable (no name).
export type Identifier = {
  /*
   * unique value to distinguish a variable, since name is not guaranteed to
   * exist or be unique
   */
  id: IdentifierId;
  // null for temporaries. name is primarily used for debugging.
  name: string | null;
  // The range for which this variable is mutable
  mutableRange: MutableRange;
  /*
   * The ID of the reactive scope which will compute this value. Multiple
   * variables may have the same scope id.
   */
  scope: ReactiveScope | null;
  type: Type;
};

/*
 * Distinguish between different kinds of values relevant to inference purposes:
 * see the main docblock for the module for details.
 */
export enum ValueKind {
  MaybeFrozen = "maybefrozen",
  Frozen = "frozen",
  Immutable = "immutable",
  Mutable = "mutable",
  Context = "context",
}

// The effect with which a value is modified.
export enum Effect {
  // Default value: not allowed after lifetime inference
  Unknown = "<unknown>",
  // This reference freezes the value (corresponds to a place where codegen should emit a freeze instruction)
  Freeze = "freeze",
  // This reference reads the value
  Read = "read",
  // This reference reads and stores the value
  Capture = "capture",
  /*
   * This reference *may* write to (mutate) the value. This covers two similar cases:
   * - The compiler is being conservative and assuming that a value *may* be mutated
   * - The effect is polymorphic: mutable values may be mutated, non-mutable values
   *   will not be mutated.
   * In both cases, we conservatively assume that mutable values will be mutated.
   * But we do not error if the value is known to be immutable.
   */
  ConditionallyMutate = "mutate?",

  /*
   * This reference *does* write to (mutate) the value. It is an error (invalid input)
   * if an immutable value flows into a location with this effect.
   */
  Mutate = "mutate",
  // This reference may alias to (mutate) the value
  Store = "store",
}

export function isMutableEffect(
  effect: Effect,
  location: SourceLocation
): boolean {
  switch (effect) {
    case Effect.Capture:
    case Effect.Store:
    case Effect.ConditionallyMutate:
    case Effect.Mutate: {
      return true;
    }

    case Effect.Unknown: {
      CompilerError.invariant(false, {
        reason: "Unexpected unknown effect",
        description: null,
        loc: location,
        suggestions: null,
      });
    }
    case Effect.Read:
    case Effect.Freeze: {
      return false;
    }
    default: {
      assertExhaustive(effect, `Unexpected effect '${effect}'`);
    }
  }
}

export type ReactiveScope = {
  id: ScopeId;
  range: MutableRange;
  dependencies: ReactiveScopeDependencies;
  declarations: Map<IdentifierId, ReactiveScopeDeclaration>;
  reassignments: Set<Identifier>;

  /*
   * Some passes may merge scopes together. The merged set contains the
   * ids of scopes that were merged into this one, for passes that need
   * to track which scopes are still present (in some form) vs scopes that
   * no longer exist due to being pruned.
   */
  merged: Set<ScopeId>;
};

export type ReactiveScopeDependencies = Set<ReactiveScopeDependency>;

export type ReactiveScopeDeclaration = {
  identifier: Identifier;
  scope: ReactiveScope; // the scope in which the variable was originally declared
};

export type ReactiveScopeDependency = {
  identifier: Identifier;
  path: Array<string>;
};

/*
 * Simulated opaque type for BlockIds to prevent using normal numbers as block ids
 * accidentally.
 */
const opaqueBlockId = Symbol();
export type BlockId = number & { [opaqueBlockId]: "BlockId" };

export function makeBlockId(id: number): BlockId {
  CompilerError.invariant(id >= 0 && Number.isInteger(id), {
    reason: "Expected block id to be a non-negative integer",
    description: null,
    loc: null,
    suggestions: null,
  });
  return id as BlockId;
}

/*
 * Simulated opaque type for ScopeIds to prevent using normal numbers as scope ids
 * accidentally.
 */
const opaqueScopeId = Symbol();
export type ScopeId = number & { [opaqueScopeId]: "ScopeId" };

export function makeScopeId(id: number): ScopeId {
  CompilerError.invariant(id >= 0 && Number.isInteger(id), {
    reason: "Expected block id to be a non-negative integer",
    description: null,
    loc: null,
    suggestions: null,
  });
  return id as ScopeId;
}

/*
 * Simulated opaque type for IdentifierId to prevent using normal numbers as ids
 * accidentally.
 */
const opaqueIdentifierId = Symbol();
export type IdentifierId = number & { [opaqueIdentifierId]: "IdentifierId" };

export function makeIdentifierId(id: number): IdentifierId {
  CompilerError.invariant(id >= 0 && Number.isInteger(id), {
    reason: "Expected identifier id to be a non-negative integer",
    description: null,
    loc: null,
    suggestions: null,
  });
  return id as IdentifierId;
}

/*
 * Simulated opaque type for InstructionId to prevent using normal numbers as ids
 * accidentally.
 */
const opaqueInstructionId = Symbol();
export type InstructionId = number & { [opaqueInstructionId]: "IdentifierId" };

export function makeInstructionId(id: number): InstructionId {
  CompilerError.invariant(id >= 0 && Number.isInteger(id), {
    reason: "Expected instruction id to be a non-negative integer",
    description: null,
    loc: null,
    suggestions: null,
  });
  return id as InstructionId;
}

export function isObjectMethodType(id: Identifier): boolean {
  return id.type.kind == "ObjectMethod";
}

export function isObjectType(id: Identifier): boolean {
  return id.type.kind === "Object";
}

export function isPrimitiveType(id: Identifier): boolean {
  return id.type.kind === "Primitive";
}

export function isRefValueType(id: Identifier): boolean {
  return id.type.kind === "Object" && id.type.shapeId === "BuiltInRefValue";
}

export function isUseRefType(id: Identifier): boolean {
  return id.type.kind === "Object" && id.type.shapeId === "BuiltInUseRefId";
}

export function isUseStateType(id: Identifier): boolean {
  return id.type.kind === "Object" && id.type.shapeId === "BuiltInUseState";
}

export function isSetStateType(id: Identifier): boolean {
  return id.type.kind === "Function" && id.type.shapeId === "BuiltInSetState";
}

export function isUseEffectHookType(id: Identifier): boolean {
  return (
    id.type.kind === "Function" && id.type.shapeId === "BuiltInUseEffectHook"
  );
}
export function isUseLayoutEffectHookType(id: Identifier): boolean {
  return (
    id.type.kind === "Function" &&
    id.type.shapeId === "BuiltInUseLayoutEffectHook"
  );
}
export function isUseInsertionEffectHookType(id: Identifier): boolean {
  return (
    id.type.kind === "Function" &&
    id.type.shapeId === "BuiltInUseInsertionEffectHook"
  );
}

export function getHookKind(env: Environment, id: Identifier): HookKind | null {
  const idType = id.type;
  if (idType.kind === "Function") {
    const signature = env.getFunctionSignature(idType);
    return signature?.hookKind ?? null;
  }
  return null;
}

export * from "./Types";
