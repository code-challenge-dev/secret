/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NodePath, Scope } from "@babel/traverse";
import * as t from "@babel/types";
import { Expression } from "@babel/types";
import invariant from "invariant";
import { CompilerError, ErrorSeverity } from "../CompilerError";
import { Err, Ok, Result } from "../Utils/Result";
import { assertExhaustive } from "../Utils/utils";
import { Environment } from "./Environment";
import {
  ArrayPattern,
  BlockId,
  BranchTerminal,
  BuiltinTag,
  Case,
  Effect,
  GeneratedSource,
  GotoVariant,
  HIRFunction,
  Identifier,
  IfTerminal,
  InstructionKind,
  InstructionValue,
  JsxAttribute,
  ObjectPattern,
  ObjectProperty,
  Place,
  ReturnTerminal,
  SourceLocation,
  SpreadPattern,
  ThrowTerminal,
  makeInstructionId,
} from "./HIR";
import HIRBuilder, { Bindings } from "./HIRBuilder";

// *******************************************************************************************
// *******************************************************************************************
// ************************************* Lowering to HIR *************************************
// *******************************************************************************************
// *******************************************************************************************

/**
 * Lower a function declaration into a control flow graph that models aspects of
 * control flow that are necessary for memoization. Notably, only control flow
 * that occurs at statement granularity is modeled (eg `if`, `for`, `return`
 * statements), not control flow at the expression level (ternaries or boolean
 * short-circuiting). Throw semantics are also not modeled: in general exceptions
 * are treated as exceptional conditions that invalidate memoization.
 *
 * TODO: consider modeling control-flow at expression level for even more fine-
 * grained reactivity.
 */
export function lower(
  func: NodePath<t.Function>,
  env: Environment,
  bindings: Bindings | null = null,
  capturedRefs: t.Identifier[] = [],
  // the outermost function being compiled, in case lower() is called recursively (for lambdas)
  parent: NodePath<t.Function> | null = null
): Result<HIRFunction, CompilerError> {
  const builder = new HIRBuilder(env, parent ?? func, bindings, capturedRefs);
  const context: Place[] = [];

  for (const ref of capturedRefs ?? []) {
    context.push({
      kind: "Identifier",
      identifier: builder.resolveBinding(ref),
      effect: Effect.Unknown,
      loc: GeneratedSource,
    });
  }

  // Internal babel is on an older version that does not have hasNode (v7.17)
  // See https://github.com/babel/babel/pull/13940/files for impl
  // TODO: write helper function for NodePath.node != null
  let id: Identifier | null = null;
  if (func.isFunctionDeclaration() && func.get("id").node != null) {
    id = builder.resolveIdentifier(func.get("id") as NodePath<t.Identifier>);
  }
  const params: Array<Place> = [];
  func.get("params").forEach((param) => {
    if (param.isIdentifier()) {
      const identifier = builder.resolveIdentifier(param);
      if (identifier === null) {
        builder.errors.push({
          reason: `(BuildHIR::lower) Could not find binding for param '${param.node.name}'`,
          severity: ErrorSeverity.Invariant,
          nodePath: param,
        });
        return;
      }
      const place: Place = {
        kind: "Identifier",
        identifier,
        effect: Effect.Unknown,
        loc: param.node.loc ?? GeneratedSource,
      };
      params.push(place);
    } else if (
      param.isObjectPattern() ||
      param.isArrayPattern() ||
      param.isAssignmentPattern()
    ) {
      const place: Place = {
        kind: "Identifier",
        identifier: builder.makeTemporary(),
        effect: Effect.Unknown,
        loc: param.node.loc ?? GeneratedSource,
      };
      params.push(place);
      lowerAssignment(
        builder,
        param.node.loc ?? GeneratedSource,
        InstructionKind.Let,
        param,
        place
      );
    } else {
      builder.errors.push({
        reason: `(BuildHIR::lower) Handle ${param.node.type} params`,
        severity: ErrorSeverity.Todo,
        nodePath: param,
      });
    }
  });

  const body = func.get("body");
  if (body.isExpression()) {
    const fallthrough = builder.reserve("block");
    const terminal: ReturnTerminal = {
      kind: "return",
      loc: GeneratedSource,
      value: lowerExpressionToTemporary(builder, body),
      id: makeInstructionId(0),
    };
    builder.terminateWithContinuation(terminal, fallthrough);
  } else if (body.isBlockStatement()) {
    lowerStatement(builder, body);
  } else {
    builder.errors.push({
      reason: `(BuildHIR::lower) Unexpected function body kind: ${body.type}}`,
      severity: ErrorSeverity.InvalidInput,
      nodePath: body,
    });
  }

  if (builder.errors.hasErrors()) {
    return Err(builder.errors);
  }

  builder.terminate(
    {
      kind: "return",
      loc: GeneratedSource,
      value: lowerValueToTemporary(builder, {
        kind: "Primitive",
        value: undefined,
        loc: GeneratedSource,
      }),
      id: makeInstructionId(0),
    },
    null
  );

  return Ok({
    id,
    params,
    body: builder.build(),
    context,
    generator: func.node.generator === true,
    async: func.node.async === true,
    loc: func.node.loc ?? GeneratedSource,
    env,
  });
}

/**
 * Helper to lower a statement
 */
function lowerStatement(
  builder: HIRBuilder,
  stmtPath: NodePath<t.Statement>,
  label: string | null = null
): undefined {
  const stmtNode = stmtPath.node;
  switch (stmtNode.type) {
    case "ThrowStatement": {
      const stmt = stmtPath as NodePath<t.ThrowStatement>;
      const value = lowerExpressionToTemporary(builder, stmt.get("argument"));
      const terminal: ThrowTerminal = {
        kind: "throw",
        value,
        id: makeInstructionId(0),
        loc: stmt.node.loc ?? GeneratedSource,
      };
      builder.terminate(terminal, "block");
      return;
    }
    case "ReturnStatement": {
      const stmt = stmtPath as NodePath<t.ReturnStatement>;
      const argument = stmt.get("argument");
      let value;
      if (argument.node === null) {
        value = lowerValueToTemporary(builder, {
          kind: "Primitive",
          value: undefined,
          loc: GeneratedSource,
        });
      } else {
        value = lowerExpressionToTemporary(
          builder,
          argument as NodePath<t.Expression>
        );
      }
      const terminal: ReturnTerminal = {
        kind: "return",
        loc: stmt.node.loc ?? GeneratedSource,
        value,
        id: makeInstructionId(0),
      };
      builder.terminate(terminal, "block");
      return;
    }
    case "IfStatement": {
      const stmt = stmtPath as NodePath<t.IfStatement>;
      //  Block for code following the if
      const continuationBlock = builder.reserve("block");
      //  Block for the consequent (if the test is truthy)
      const consequentBlock = builder.enter("block", (_blockId) => {
        const consequent = stmt.get("consequent");
        lowerStatement(builder, consequent);
        return {
          kind: "goto",
          block: continuationBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: consequent.node.loc ?? GeneratedSource,
        };
      });
      //  Block for the alternate (if the test is not truthy)
      let alternateBlock: BlockId;
      const alternate = stmt.get("alternate");
      if (alternate.node != null) {
        alternateBlock = builder.enter("block", (_blockId) => {
          lowerStatement(builder, alternate as NodePath<t.Statement>);
          return {
            kind: "goto",
            block: continuationBlock.id,
            variant: GotoVariant.Break,
            id: makeInstructionId(0),
            loc: alternate.node?.loc ?? GeneratedSource,
          };
        });
      } else {
        //  If there is no else clause, use the continuation directly
        alternateBlock = continuationBlock.id;
      }
      const test = lowerExpressionToTemporary(builder, stmt.get("test"));
      const terminal: IfTerminal = {
        kind: "if",
        test,
        consequent: consequentBlock,
        alternate: alternateBlock,
        fallthrough: continuationBlock.id,
        id: makeInstructionId(0),
        loc: stmt.node.loc ?? GeneratedSource,
      };
      builder.terminateWithContinuation(terminal, continuationBlock);
      return;
    }
    case "BlockStatement": {
      const stmt = stmtPath as NodePath<t.BlockStatement>;
      stmt.get("body").forEach((s) => lowerStatement(builder, s));
      return;
    }
    case "BreakStatement": {
      const stmt = stmtPath as NodePath<t.BreakStatement>;
      const block = builder.lookupBreak(stmt.node.label?.name ?? null);
      builder.terminate(
        {
          kind: "goto",
          block,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: stmt.node.loc ?? GeneratedSource,
        },
        "block"
      );
      return;
    }
    case "ContinueStatement": {
      const stmt = stmtPath as NodePath<t.ContinueStatement>;
      const block = builder.lookupContinue(stmt.node.label?.name ?? null);
      builder.terminate(
        {
          kind: "goto",
          block,
          variant: GotoVariant.Continue,
          id: makeInstructionId(0),
          loc: stmt.node.loc ?? GeneratedSource,
        },
        "block"
      );
      return;
    }
    case "ForStatement": {
      const stmt = stmtPath as NodePath<t.ForStatement>;

      const testBlock = builder.reserve("loop");
      //  Block for code following the loop
      const continuationBlock = builder.reserve("block");

      const initBlock = builder.enter("loop", (_blockId) => {
        const init = stmt.get("init");
        if (!init.isVariableDeclaration()) {
          builder.errors.push({
            reason:
              "(BuildHIR::lowerStatement) Handle non-variable initialization in ForStatement",
            severity: ErrorSeverity.Todo,
            nodePath: stmt,
          });
          return {
            kind: "unsupported",
            id: makeInstructionId(0),
            loc: init.node?.loc ?? GeneratedSource,
          };
        }
        lowerStatement(builder, init);
        return {
          kind: "goto",
          block: testBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: init.node.loc ?? GeneratedSource,
        };
      });

      let updateBlock: BlockId | null = null;
      const update = stmt.get("update");
      if (update.node != null) {
        updateBlock = builder.enter("loop", (_blockId) => {
          lowerExpressionToTemporary(builder, update as NodePath<t.Expression>);
          return {
            kind: "goto",
            block: testBlock.id,
            variant: GotoVariant.Break,
            id: makeInstructionId(0),
            loc: update.node?.loc ?? GeneratedSource,
          };
        });
      }

      const bodyBlock = builder.enter("block", (_blockId) => {
        return builder.loop(
          label,
          updateBlock ?? testBlock.id,
          continuationBlock.id,
          () => {
            const body = stmt.get("body");
            lowerStatement(builder, body);
            return {
              kind: "goto",
              block: updateBlock ?? testBlock.id,
              variant: GotoVariant.Continue,
              id: makeInstructionId(0),
              loc: body.node.loc ?? GeneratedSource,
            };
          }
        );
      });

      builder.terminateWithContinuation(
        {
          kind: "for",
          loc: stmtNode.loc ?? GeneratedSource,
          init: initBlock,
          test: testBlock.id,
          update: updateBlock,
          loop: bodyBlock,
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
        },
        testBlock
      );

      const test = stmt.get("test");
      if (test.node == null) {
        builder.errors.push({
          reason: `(BuildHIR::lowerStatement) Handle empty test in ForStatement`,
          severity: ErrorSeverity.Todo,
          nodePath: stmt,
        });
      } else {
        builder.terminateWithContinuation(
          {
            kind: "branch",
            test: lowerExpressionToTemporary(
              builder,
              test as NodePath<t.Expression>
            ),
            consequent: bodyBlock,
            alternate: continuationBlock.id,
            id: makeInstructionId(0),
            loc: stmt.node.loc ?? GeneratedSource,
          },
          continuationBlock
        );
      }
      return;
    }
    case "WhileStatement": {
      const stmt = stmtPath as NodePath<t.WhileStatement>;
      //  Block used to evaluate whether to (re)enter or exit the loop
      const conditionalBlock = builder.reserve("loop");
      //  Block for code following the loop
      const continuationBlock = builder.reserve("block");
      //  Loop body
      const loopBlock = builder.enter("block", (_blockId) => {
        return builder.loop(
          label,
          conditionalBlock.id,
          continuationBlock.id,
          () => {
            const body = stmt.get("body");
            lowerStatement(builder, body);
            return {
              kind: "goto",
              block: conditionalBlock.id,
              variant: GotoVariant.Continue,
              id: makeInstructionId(0),
              loc: body.node.loc ?? GeneratedSource,
            };
          }
        );
      });
      /**
       * The code leading up to the loop must jump to the conditional block,
       * to evaluate whether to enter the loop or bypass to the continuation.
       */
      const loc = stmt.node.loc ?? GeneratedSource;
      builder.terminateWithContinuation(
        {
          kind: "while",
          loc,
          test: conditionalBlock.id,
          loop: loopBlock,
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
        },
        conditionalBlock
      );
      /**
       * The conditional block is empty and exists solely as conditional for
       * (re)entering or exiting the loop
       */
      const test = lowerExpressionToTemporary(builder, stmt.get("test"));
      const terminal: BranchTerminal = {
        kind: "branch",
        test,
        consequent: loopBlock,
        alternate: continuationBlock.id,
        id: makeInstructionId(0),
        loc: stmt.node.loc ?? GeneratedSource,
      };
      //  Complete the conditional and continue with code after the loop
      builder.terminateWithContinuation(terminal, continuationBlock);
      return;
    }
    case "LabeledStatement": {
      const stmt = stmtPath as NodePath<t.LabeledStatement>;
      const label = stmt.node.label.name;
      const body = stmt.get("body");
      switch (body.node.type) {
        case "ForInStatement":
        case "ForOfStatement":
        case "ForStatement":
        case "WhileStatement":
        case "DoWhileStatement": {
          // labeled loops are special because of continue, so push the label
          // down
          lowerStatement(builder, stmt.get("body"), label);
          break;
        }
        default: {
          // All other statements create a continuation block to allow `break`,
          // explicitly *don't* pass the label down
          const continuationBlock = builder.reserve("block");
          const block = builder.enter("block", () => {
            const body = stmt.get("body");
            builder.label(label, continuationBlock.id, () => {
              lowerStatement(builder, body);
            });
            return {
              kind: "goto",
              block: continuationBlock.id,
              variant: GotoVariant.Break,
              id: makeInstructionId(0),
              loc: body.node.loc ?? GeneratedSource,
            };
          });
          builder.terminateWithContinuation(
            {
              kind: "label",
              block,
              fallthrough: continuationBlock.id,
              id: makeInstructionId(0),
              loc: stmt.node.loc ?? GeneratedSource,
            },
            continuationBlock
          );
        }
      }
      return;
    }
    case "SwitchStatement": {
      const stmt = stmtPath as NodePath<t.SwitchStatement>;
      //  Block following the switch
      const continuationBlock = builder.reserve("block");
      /**
       * The goto target for any cases that fallthrough, which initially starts
       * as the continuation block and is then updated as we iterate through cases
       * in reverse order.
       */
      let fallthrough = continuationBlock.id;
      /**
       * Iterate through cases in reverse order, so that previous blocks can fallthrough
       * to successors
       */
      const cases: Case[] = [];
      let hasDefault = false;
      for (let ii = stmt.get("cases").length - 1; ii >= 0; ii--) {
        const case_: NodePath<t.SwitchCase> = stmt.get("cases")[ii];
        const testExpr = case_.get("test");
        if (testExpr.node == null) {
          if (hasDefault) {
            builder.errors.push({
              reason:
                "(BuildHIR::lowerStatement) Expected at most one `default` branch in SwitchStatement, this code should have failed to parse",
              severity: ErrorSeverity.InvalidInput,
              nodePath: case_,
            });
            break;
          }
          hasDefault = true;
        }
        const block = builder.enter("block", (_blockId) => {
          return builder.switch(label, continuationBlock.id, () => {
            case_
              .get("consequent")
              .forEach((consequent) => lowerStatement(builder, consequent));
            /**
             * always generate a fallthrough to the next block, this may be dead code
             * if there was an explicit break, but if so it will be pruned later.
             */
            return {
              kind: "goto",
              block: fallthrough,
              variant: GotoVariant.Break,
              id: makeInstructionId(0),
              loc: case_.node.loc ?? GeneratedSource,
            };
          });
        });
        let test: Place | null = null;
        if (testExpr.node != null) {
          test = lowerReorderableExpression(
            builder,
            testExpr as NodePath<t.Expression>
          );
        }
        cases.push({
          test,
          block,
        });
        fallthrough = block;
      }
      /**
       * it doesn't matter for our analysis purposes, but reverse the order of the cases
       * back to the original to make it match the original code/intent.
       */
      cases.reverse();
      /**
       * If there wasn't an explicit default case, generate one to model the fact that execution
       * could bypass any of the other cases and jump directly to the continuation.
       */
      if (!hasDefault) {
        cases.push({ test: null, block: continuationBlock.id });
      }

      const test = lowerExpressionToTemporary(
        builder,
        stmt.get("discriminant")
      );
      builder.terminateWithContinuation(
        {
          kind: "switch",
          test,
          cases,
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
          loc: stmt.node.loc ?? GeneratedSource,
        },
        continuationBlock
      );
      return;
    }
    case "VariableDeclaration": {
      const stmt = stmtPath as NodePath<t.VariableDeclaration>;
      const nodeKind: t.VariableDeclaration["kind"] = stmt.node.kind;
      if (nodeKind === "var") {
        builder.errors.push({
          reason: `(BuildHIR::lowerStatement) Handle ${nodeKind} kinds in VariableDeclaration`,
          severity: ErrorSeverity.Todo,
          nodePath: stmt,
        });
        return;
      }
      const kind =
        nodeKind === "let" ? InstructionKind.Let : InstructionKind.Const;
      for (const declaration of stmt.get("declarations")) {
        const id = declaration.get("id");
        const init = declaration.get("init");
        if (init.node != null) {
          const value = lowerExpressionToTemporary(
            builder,
            init as NodePath<t.Expression>
          );
          lowerAssignment(
            builder,
            stmt.node.loc ?? GeneratedSource,
            kind,
            id,
            value
          );
        } else if (id.isIdentifier()) {
          const identifier = builder.resolveIdentifier(id);
          if (identifier == null) {
            builder.errors.push({
              reason: `(BuildHIR::lowerAssignment) Could not find binding for declaration.`,
              severity: ErrorSeverity.Invariant,
              nodePath: id,
            });
          } else {
            lowerValueToTemporary(builder, {
              kind: "DeclareLocal",
              lvalue: {
                kind,
                place: {
                  effect: Effect.Unknown,
                  identifier,
                  kind: "Identifier",
                  loc: id.node.loc ?? GeneratedSource,
                },
              },
              loc: id.node.loc ?? GeneratedSource,
            });
          }
        } else {
          builder.errors.push({
            reason: `(BuildHIR::lowerStatement) Expected variable declaration to be an identifier if no initializer was provided.`,
            severity: ErrorSeverity.InvalidInput,
            nodePath: stmt,
          });
        }
      }
      return;
    }
    case "ExpressionStatement": {
      const stmt = stmtPath as NodePath<t.ExpressionStatement>;
      const expression = stmt.get("expression");
      const value = lowerExpressionToTemporary(builder, expression);
      const exprNode = expression.node;
      if (
        exprNode.type === "LogicalExpression" ||
        exprNode.type === "ConditionalExpression"
      ) {
        const loc = exprNode.loc ?? GeneratedSource;
        builder.push({
          id: makeInstructionId(0),
          lvalue: buildTemporaryPlace(builder, loc),
          value: {
            kind: "ExpressionStatement",
            value,
            loc,
          },
          loc,
        });
      }
      return;
    }
    case "DoWhileStatement": {
      const stmt = stmtPath as NodePath<t.DoWhileStatement>;
      //  Block used to evaluate whether to (re)enter or exit the loop
      const conditionalBlock = builder.reserve("loop");
      //  Block for code following the loop
      const continuationBlock = builder.reserve("block");
      //  Loop body, executed at least once uncondtionally prior to exit
      const loopBlock = builder.enter("block", (_loopBlockId) => {
        return builder.loop(
          label,
          conditionalBlock.id,
          continuationBlock.id,
          () => {
            const body = stmt.get("body");
            lowerStatement(builder, body);
            return {
              kind: "goto",
              block: conditionalBlock.id,
              variant: GotoVariant.Continue,
              id: makeInstructionId(0),
              loc: body.node.loc ?? GeneratedSource,
            };
          }
        );
      });
      // Jump to the conditional block to evaluate whether to (re)enter the loop or exit to the
      // continuation block.
      const loc = stmt.node.loc ?? GeneratedSource;
      builder.terminateWithContinuation(
        {
          kind: "do-while",
          loc,
          test: conditionalBlock.id,
          loop: loopBlock,
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
        },
        conditionalBlock
      );
      /**
       * The conditional block is empty and exists solely as conditional for
       * (re)entering or exiting the loop
       */
      const test = lowerExpressionToTemporary(builder, stmt.get("test"));
      const terminal: BranchTerminal = {
        kind: "branch",
        test,
        consequent: loopBlock,
        alternate: continuationBlock.id,
        id: makeInstructionId(0),
        loc,
      };
      //  Complete the conditional and continue with code after the loop
      builder.terminateWithContinuation(terminal, continuationBlock);
      return;
    }
    case "FunctionDeclaration": {
      const stmt = stmtPath as NodePath<t.FunctionDeclaration>;
      stmt.skip();
      invariant(
        stmt.get("id").type === "Identifier",
        "function declarations must have a name"
      );
      const id = stmt.get("id") as NodePath<t.Identifier>;

      // Desugar FunctionDeclaration to FunctionExpression.
      //
      // For example:
      //   function foo() {};
      // becomes
      //   let foo = function foo() {};
      const desugared = stmt.replaceWith(
        t.variableDeclaration("let", [
          t.variableDeclarator(
            id.node,
            t.functionExpression(
              id.node,
              stmt.node.params,
              stmt.node.body,
              stmt.node.generator,
              stmt.node.async
            )
          ),
        ])
      );
      invariant(
        desugared.length === 1,
        "only one declaration is created from desugaring function declaration"
      );
      lowerStatement(builder, desugared.at(0)!);
      return;
    }
    case "ForOfStatement": {
      const stmt = stmtPath as NodePath<t.ForOfStatement>;
      const continuationBlock = builder.reserve("block");
      const initBlock = builder.reserve("loop");

      const loopBlock = builder.enter("block", (_blockId) => {
        return builder.loop(label, initBlock.id, continuationBlock.id, () => {
          const body = stmt.get("body");
          lowerStatement(builder, body);
          return {
            kind: "goto",
            block: initBlock.id,
            variant: GotoVariant.Continue,
            id: makeInstructionId(0),
            loc: body.node.loc ?? GeneratedSource,
          };
        });
      });

      const loc = stmt.node.loc ?? GeneratedSource;
      const value = lowerExpressionToTemporary(builder, stmt.get("right"));
      builder.terminateWithContinuation(
        {
          kind: "for-of",
          loc,
          init: initBlock.id,
          loop: loopBlock,
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
        },
        initBlock
      );

      // The init of a ForOf statement is compound over a left (VariableDeclaration | LVal) and
      // right (Expression), so we synthesize a new InstrValue and assignment (potentially multiple
      // instructions when we handle other syntax like Patterns)
      const left = stmt.get("left");
      const leftLoc = left.node.loc ?? GeneratedSource;
      let test: Place;
      if (left.isVariableDeclaration()) {
        const declarations = left.get("declarations");
        invariant(
          declarations.length === 1,
          `Expected only one declaration in the init of a ForOfStatement, got ${declarations.length}`
        );
        const id = declarations[0].get("id");
        const nextIterableOf = lowerValueToTemporary(builder, {
          kind: "NextIterableOf",
          loc: leftLoc,
          value,
        });
        const assign = lowerAssignment(
          builder,
          leftLoc,
          InstructionKind.Let,
          id,
          nextIterableOf
        );
        test = lowerValueToTemporary(builder, assign);
      } else {
        builder.errors.push({
          reason: `(BuildHIR::lowerStatement) Handle ${left.type} inits in ForOfStatement`,
          severity: ErrorSeverity.Todo,
          nodePath: left,
        });
        return;
      }
      builder.terminateWithContinuation(
        {
          id: makeInstructionId(0),
          kind: "branch",
          test,
          consequent: loopBlock,
          alternate: continuationBlock.id,
          loc: stmt.node.loc ?? GeneratedSource,
        },
        continuationBlock
      );
      return;
    }
    case "DebuggerStatement": {
      const stmt = stmtPath as NodePath<t.DebuggerStatement>;
      const loc = stmt.node.loc ?? GeneratedSource;
      builder.push({
        id: makeInstructionId(0),
        lvalue: buildTemporaryPlace(builder, loc),
        value: {
          kind: "Debugger",
          loc,
        },
        loc,
      });
      return;
    }
    case "EmptyStatement": {
      return;
    }
    case "ForInStatement":
    case "ClassDeclaration":
    case "DeclareClass":
    case "DeclareExportAllDeclaration":
    case "DeclareExportDeclaration":
    case "DeclareFunction":
    case "DeclareInterface":
    case "DeclareModule":
    case "DeclareModuleExports":
    case "DeclareOpaqueType":
    case "DeclareTypeAlias":
    case "DeclareVariable":
    case "EnumDeclaration":
    case "ExportAllDeclaration":
    case "ExportDefaultDeclaration":
    case "ExportNamedDeclaration":
    case "ImportDeclaration":
    case "InterfaceDeclaration":
    case "OpaqueType":
    case "TryStatement":
    case "TypeAlias":
    case "TSDeclareFunction":
    case "TSEnumDeclaration":
    case "TSExportAssignment":
    case "TSImportEqualsDeclaration":
    case "TSInterfaceDeclaration":
    case "TSModuleDeclaration":
    case "TSNamespaceExportDeclaration":
    case "TSTypeAliasDeclaration":
    case "WithStatement": {
      builder.errors.push({
        reason: `(BuildHIR::lowerStatement) Handle ${stmtPath.type} statements`,
        severity: ErrorSeverity.Todo,
        nodePath: stmtPath,
      });
      lowerValueToTemporary(builder, {
        kind: "UnsupportedNode",
        loc: stmtPath.node.loc ?? GeneratedSource,
        node: stmtPath.node,
      });
      return;
    }
    default: {
      return assertExhaustive(
        stmtNode,
        `Unsupported statement kind '${
          (stmtNode as any as NodePath<t.Statement>).type
        }'`
      );
    }
  }
}

function lowerExpression(
  builder: HIRBuilder,
  exprPath: NodePath<t.Expression>
): InstructionValue {
  const exprNode = exprPath.node;
  const exprLoc = exprNode.loc ?? GeneratedSource;
  switch (exprNode.type) {
    case "Identifier": {
      const expr = exprPath as NodePath<t.Identifier>;
      const place = lowerIdentifier(builder, expr);
      return {
        kind: "LoadLocal",
        place,
        loc: exprLoc,
      };
    }
    case "NullLiteral": {
      return {
        kind: "Primitive",
        value: null,
        loc: exprLoc,
      };
    }
    case "BooleanLiteral":
    case "NumericLiteral":
    case "StringLiteral": {
      const expr = exprPath as NodePath<
        t.StringLiteral | t.BooleanLiteral | t.NumericLiteral
      >;
      const value = expr.node.value;
      return {
        kind: "Primitive",
        value,
        loc: exprLoc,
      };
    }
    case "ObjectExpression": {
      const expr = exprPath as NodePath<t.ObjectExpression>;
      const propertyPaths = expr.get("properties");
      const properties: Array<ObjectProperty | SpreadPattern> = [];
      for (const propertyPath of propertyPaths) {
        if (propertyPath.isObjectProperty()) {
          const key = propertyPath.node.key;
          let keyName: string;
          if (key.type === "Identifier") {
            keyName = key.name;
          } else if (key.type === "StringLiteral") {
            keyName = key.value;
          } else {
            builder.errors.push({
              reason: `(BuildHIR::lowerExpression) Expected Identifier, got ${key.type} key in ObjectExpression`,
              severity: ErrorSeverity.InvalidInput,
              nodePath: propertyPath,
            });
            continue;
          }
          const valuePath = propertyPath.get("value");
          if (!valuePath.isExpression()) {
            builder.errors.push({
              reason: `(BuildHIR::lowerExpression) Handle ${valuePath.type} values in ObjectExpression`,
              severity: ErrorSeverity.Todo,
              nodePath: valuePath,
            });
            continue;
          }
          const value = lowerExpressionToTemporary(builder, valuePath);
          properties.push({
            kind: "ObjectProperty",
            name: keyName,
            place: value,
          });
        } else if (propertyPath.isSpreadElement()) {
          const place = lowerExpressionToTemporary(
            builder,
            propertyPath.get("argument")
          );
          properties.push({
            kind: "Spread",
            place,
          });
        } else {
          builder.errors.push({
            reason: `(BuildHIR::lowerExpression) Handle ${propertyPath.type} properties in ObjectExpression`,
            severity: ErrorSeverity.Todo,
            nodePath: propertyPath,
          });
          continue;
        }
      }
      return {
        kind: "ObjectExpression",
        properties,
        loc: exprLoc,
      };
    }
    case "ArrayExpression": {
      const expr = exprPath as NodePath<t.ArrayExpression>;
      let elements: Array<Place | SpreadPattern> = [];
      for (const element of expr.get("elements")) {
        if (element.node == null) {
          builder.errors.push({
            reason: `(BuildHIR::lowerExpression) Handle ${element.type} elements in ArrayExpression`,
            severity: ErrorSeverity.Todo,
            nodePath: element,
          });
          continue;
        } else if (element.isExpression()) {
          elements.push(lowerExpressionToTemporary(builder, element));
        } else if (element.isSpreadElement()) {
          const place = lowerExpressionToTemporary(
            builder,
            element.get("argument")
          );
          elements.push({ kind: "Spread", place });
        } else {
          builder.errors.push({
            reason: `(BuildHIR::lowerExpression) Handle ${element.type} elements in ArrayExpression`,
            severity: ErrorSeverity.Todo,
            nodePath: element,
          });
          continue;
        }
      }
      return {
        kind: "ArrayExpression",
        elements,
        loc: exprLoc,
      };
    }
    case "NewExpression": {
      const expr = exprPath as NodePath<t.NewExpression>;
      const calleePath = expr.get("callee");
      if (!calleePath.isExpression()) {
        builder.errors.push({
          reason: `(BuildHIR::lowerExpression) Expected Expression, got ${calleePath.type} in NewExpression (v8 intrinsics not supported): ${calleePath.type}`,
          severity: ErrorSeverity.InvalidInput,
          nodePath: calleePath,
        });
        return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
      }
      const callee = lowerExpressionToTemporary(builder, calleePath);
      const args = lowerArguments(builder, expr.get("arguments"));

      return {
        kind: "NewExpression",
        callee,
        args,
        loc: exprLoc,
      };
    }
    case "OptionalCallExpression": {
      const expr = exprPath as NodePath<t.OptionalCallExpression>;
      return lowerOptionalCallExpression(builder, expr, null);
    }
    case "CallExpression": {
      const expr = exprPath as NodePath<t.CallExpression>;
      const calleePath = expr.get("callee");
      if (!calleePath.isExpression()) {
        builder.errors.push({
          reason: `(BuildHIR::lowerExpression) Expected Expression, got ${calleePath.type} in CallExpression (v8 intrinsics not supported)`,
          severity: ErrorSeverity.InvalidInput,
          nodePath: calleePath,
        });
        return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
      }
      if (calleePath.isMemberExpression()) {
        const memberExpr = lowerMemberExpression(builder, calleePath);
        const propertyPlace = lowerValueToTemporary(builder, memberExpr.value);
        const args = lowerArguments(builder, expr.get("arguments"));
        return {
          kind: "MethodCall",
          receiver: memberExpr.object,
          property: { ...propertyPlace },
          args,
          loc: exprLoc,
        };
      } else {
        const callee = lowerExpressionToTemporary(builder, calleePath);
        const args = lowerArguments(builder, expr.get("arguments"));
        return {
          kind: "CallExpression",
          callee,
          args,
          loc: exprLoc,
        };
      }
    }
    case "BinaryExpression": {
      const expr = exprPath as NodePath<t.BinaryExpression>;
      const leftPath = expr.get("left");
      if (!leftPath.isExpression()) {
        builder.errors.push({
          reason: `(BuildHIR::lowerExpression) Expected Expression, got ${leftPath.type} lval in BinaryExpression`,
          severity: ErrorSeverity.InvalidInput,
          nodePath: leftPath,
        });
        return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
      }
      const left = lowerExpressionToTemporary(builder, leftPath);
      const right = lowerExpressionToTemporary(builder, expr.get("right"));
      const operator = expr.node.operator;
      return {
        kind: "BinaryExpression",
        operator,
        left,
        right,
        loc: exprLoc,
      };
    }
    case "SequenceExpression": {
      const expr = exprPath as NodePath<t.SequenceExpression>;
      const exprLoc = expr.node.loc ?? GeneratedSource;

      let last: Place | null = null;
      for (const item of expr.get("expressions")) {
        last = lowerExpressionToTemporary(builder, item);
      }
      if (last === null) {
        builder.errors.push({
          reason: `(BuildHIR::lowerExpression) Expected SequenceExpression to have at least one expression`,
          severity: ErrorSeverity.InvalidInput,
          nodePath: expr,
        });
        return { kind: "UnsupportedNode", node: expr.node, loc: exprLoc };
      }
      return {
        kind: "LoadLocal", // TODO: LoadTemp
        place: last,
        loc: last.loc,
      };
    }
    case "ConditionalExpression": {
      const expr = exprPath as NodePath<t.ConditionalExpression>;
      const exprLoc = expr.node.loc ?? GeneratedSource;

      //  Block for code following the if
      const continuationBlock = builder.reserve(builder.currentBlockKind());
      const testBlock = builder.reserve("value");
      const place = buildTemporaryPlace(builder, exprLoc);

      //  Block for the consequent (if the test is truthy)
      const consequentBlock = builder.enter("value", (_blockId) => {
        const consequentPath = expr.get("consequent");
        const consequent = lowerExpressionToTemporary(builder, consequentPath);
        lowerValueToTemporary(builder, {
          kind: "StoreLocal",
          lvalue: { kind: InstructionKind.Const, place: { ...place } },
          value: consequent,
          loc: exprLoc,
        });
        return {
          kind: "goto",
          block: continuationBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: consequentPath.node.loc ?? GeneratedSource,
        };
      });
      //  Block for the alternate (if the test is not truthy)
      const alternateBlock = builder.enter("value", (_blockId) => {
        const alternatePath = expr.get("alternate");
        const alternate = lowerExpressionToTemporary(builder, alternatePath);
        lowerValueToTemporary(builder, {
          kind: "StoreLocal",
          lvalue: { kind: InstructionKind.Const, place: { ...place } },
          value: alternate,
          loc: exprLoc,
        });
        return {
          kind: "goto",
          block: continuationBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: alternatePath.node.loc ?? GeneratedSource,
        };
      });

      builder.terminateWithContinuation(
        {
          kind: "ternary",
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
          test: testBlock.id,
          loc: exprLoc,
        },
        testBlock
      );
      const testPlace = lowerExpressionToTemporary(builder, expr.get("test"));
      builder.terminateWithContinuation(
        {
          kind: "branch",
          test: { ...testPlace },
          consequent: consequentBlock,
          alternate: alternateBlock,
          id: makeInstructionId(0),
          loc: exprLoc,
        },
        continuationBlock
      );
      return { kind: "LoadLocal", place, loc: place.loc };
    }
    case "LogicalExpression": {
      const expr = exprPath as NodePath<t.LogicalExpression>;
      const exprLoc = expr.node.loc ?? GeneratedSource;
      const continuationBlock = builder.reserve(builder.currentBlockKind());
      const testBlock = builder.reserve("value");
      const place = buildTemporaryPlace(builder, exprLoc);
      const leftPlace = buildTemporaryPlace(
        builder,
        expr.get("left").node.loc ?? GeneratedSource
      );
      const consequent = builder.enter("value", () => {
        lowerValueToTemporary(builder, {
          kind: "StoreLocal",
          lvalue: { kind: InstructionKind.Const, place: { ...place } },
          value: { ...leftPlace },
          loc: leftPlace.loc,
        });
        return {
          kind: "goto",
          block: continuationBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: leftPlace.loc,
        };
      });
      const alternate = builder.enter("value", () => {
        const right = lowerExpressionToTemporary(builder, expr.get("right"));
        lowerValueToTemporary(builder, {
          kind: "StoreLocal",
          lvalue: { kind: InstructionKind.Const, place: { ...place } },
          value: { ...right },
          loc: right.loc,
        });
        return {
          kind: "goto",
          block: continuationBlock.id,
          variant: GotoVariant.Break,
          id: makeInstructionId(0),
          loc: right.loc,
        };
      });
      builder.terminateWithContinuation(
        {
          kind: "logical",
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
          test: testBlock.id,
          operator: expr.node.operator,
          loc: exprLoc,
        },
        testBlock
      );
      const leftValue = lowerExpressionToTemporary(builder, expr.get("left"));
      builder.push({
        id: makeInstructionId(0),
        lvalue: { ...leftPlace },
        value: {
          kind: "LoadLocal",
          place: leftValue,
          loc: exprLoc,
        },
        loc: exprLoc,
      });
      builder.terminateWithContinuation(
        {
          kind: "branch",
          test: { ...leftPlace },
          consequent,
          alternate,
          id: makeInstructionId(0),
          loc: exprLoc,
        },
        continuationBlock
      );
      return { kind: "LoadLocal", place, loc: place.loc };
    }
    case "AssignmentExpression": {
      const expr = exprPath as NodePath<t.AssignmentExpression>;
      const operator = expr.node.operator;

      if (operator === "=") {
        const left = expr.get("left");
        return lowerAssignment(
          builder,
          left.node.loc ?? GeneratedSource,
          InstructionKind.Reassign,
          left,
          lowerExpressionToTemporary(builder, expr.get("right"))
        );
      }

      const operators: { [key: string]: t.BinaryExpression["operator"] } = {
        "+=": "+",
        "-=": "-",
        "/=": "/",
        "%=": "%",
        "*=": "*",
        "**=": "**",
        "&=": "&",
        "|=": "|",
        ">>=": ">>",
        ">>>=": ">>>",
        "<<=": "<<",
        "^=": "^",
      };
      const binaryOperator = operators[operator];
      if (binaryOperator == null) {
        builder.errors.push({
          reason: `(BuildHIR::lowerExpression) Handle ${operator} operators in AssignmentExpression`,
          severity: ErrorSeverity.Todo,
          nodePath: expr.get("operator"),
        });
        return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
      }
      const left = expr.get("left");
      const leftNode = left.node;
      switch (leftNode.type) {
        case "Identifier": {
          const leftExpr = left as NodePath<t.Identifier>;
          const identifier = lowerIdentifier(builder, leftExpr);
          const leftPlace = lowerExpressionToTemporary(builder, leftExpr);
          const right = lowerExpressionToTemporary(builder, expr.get("right"));
          const binaryPlace = lowerValueToTemporary(builder, {
            kind: "BinaryExpression",
            operator: binaryOperator,
            left: leftPlace,
            right,
            loc: exprLoc,
          });
          lowerValueToTemporary(builder, {
            kind: "StoreLocal",
            lvalue: {
              place: { ...identifier },
              kind: InstructionKind.Reassign,
            },
            value: { ...binaryPlace },
            loc: exprLoc,
          });
          return { kind: "LoadLocal", place: identifier, loc: exprLoc };
        }
        case "MemberExpression": {
          // a.b.c += <right>
          const leftExpr = left as NodePath<t.MemberExpression>;
          const { object, property, value } = lowerMemberExpression(
            builder,
            leftExpr
          );

          // Store the previous value to a temporary
          const previousValuePlace = lowerValueToTemporary(builder, value);
          // Store the new value to a temporary
          const newValuePlace = lowerValueToTemporary(builder, {
            kind: "BinaryExpression",
            operator: binaryOperator,
            left: { ...previousValuePlace },
            right: lowerExpressionToTemporary(builder, expr.get("right")),
            loc: leftExpr.node.loc ?? GeneratedSource,
          });

          // Save the result back to the property
          if (typeof property === "string") {
            return {
              kind: "PropertyStore",
              object: { ...object },
              property,
              value: { ...newValuePlace },
              loc: leftExpr.node.loc ?? GeneratedSource,
            };
          } else {
            return {
              kind: "ComputedStore",
              object: { ...object },
              property: { ...property },
              value: { ...newValuePlace },
              loc: leftExpr.node.loc ?? GeneratedSource,
            };
          }
        }
        default: {
          builder.errors.push({
            reason: `(BuildHIR::lowerExpression) Expected Identifier or MemberExpression, got ${expr.type} lval in AssignmentExpression`,
            severity: ErrorSeverity.InvalidInput,
            nodePath: expr,
          });
          return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
        }
      }
    }
    case "OptionalMemberExpression": {
      const expr = exprPath as NodePath<t.OptionalMemberExpression>;
      const { value } = lowerOptionalMemberExpression(builder, expr, null);
      return { kind: "LoadLocal", place: value, loc: value.loc };
    }
    case "MemberExpression": {
      const expr = exprPath as NodePath<
        t.MemberExpression | t.OptionalMemberExpression
      >;
      const { value } = lowerMemberExpression(builder, expr);
      const place = lowerValueToTemporary(builder, value);
      return { kind: "LoadLocal", place, loc: place.loc };
    }
    case "JSXElement": {
      const expr = exprPath as NodePath<t.JSXElement>;
      const opening = expr.get("openingElement");
      const tag = lowerJsxElementName(builder, opening.get("name"));
      const children: Array<Place> = expr
        .get("children")
        .map((child) => lowerJsxElement(builder, child))
        .filter(notNull);
      const props: Array<JsxAttribute> = [];
      for (const attribute of opening.get("attributes")) {
        if (attribute.isJSXSpreadAttribute()) {
          const argument = lowerExpressionToTemporary(
            builder,
            attribute.get("argument")
          );
          props.push({ kind: "JsxSpreadAttribute", argument });
          continue;
        }
        if (!attribute.isJSXAttribute()) {
          builder.errors.push({
            reason: `(BuildHIR::lowerExpression) Handle ${attribute.type} attributes in JSXElement`,
            severity: ErrorSeverity.Todo,
            nodePath: attribute,
          });
          continue;
        }
        const namePath = attribute.get("name");
        let propName;
        if (namePath.isJSXIdentifier()) {
          propName = namePath.node.name;
          if (propName.indexOf(":") !== -1) {
            builder.errors.push({
              reason: `(BuildHIR::lowerExpression) Unexpected colon in attribute name '${name}'`,
              severity: ErrorSeverity.Todo,
              nodePath: namePath,
            });
          }
        } else {
          invariant(namePath.isJSXNamespacedName(), "Refinement");
          const namespace = namePath.node.namespace.name;
          const name = namePath.node.name.name;
          propName = `${namespace}:${name}`;
        }
        const valueExpr = attribute.get("value");
        let value;
        if (valueExpr.isJSXElement() || valueExpr.isStringLiteral()) {
          value = lowerExpressionToTemporary(builder, valueExpr);
        } else {
          if (!valueExpr.isJSXExpressionContainer()) {
            builder.errors.push({
              reason: `(BuildHIR::lowerExpression) Handle ${valueExpr.type} attribute values in JSXElement`,
              severity: ErrorSeverity.Todo,
              nodePath: valueExpr,
            });
            continue;
          }
          const expression = valueExpr.get("expression");
          if (!expression.isExpression()) {
            builder.errors.push({
              reason: `(BuildHIR::lowerExpression) Handle ${expression.type} expressions in JSXExpressionContainer within JSXElement`,
              severity: ErrorSeverity.Todo,
              nodePath: valueExpr,
            });
            continue;
          }
          value = lowerExpressionToTemporary(builder, expression);
        }
        props.push({ kind: "JsxAttribute", name: propName, place: value });
      }
      return {
        kind: "JsxExpression",
        tag,
        props,
        children: children.length === 0 ? null : children,
        loc: exprLoc,
      };
    }
    case "JSXFragment": {
      const expr = exprPath as NodePath<t.JSXFragment>;
      const children: Array<Place> = expr
        .get("children")
        .map((child) => lowerJsxElement(builder, child))
        .filter(notNull);
      return {
        kind: "JsxFragment",
        children,
        loc: exprLoc,
      };
    }
    case "ArrowFunctionExpression":
    case "FunctionExpression": {
      const expr = exprPath as NodePath<
        t.FunctionExpression | t.ArrowFunctionExpression
      >;
      return lowerFunctionExpression(builder, expr);
    }
    case "TaggedTemplateExpression": {
      const expr = exprPath as NodePath<t.TaggedTemplateExpression>;
      if (expr.get("quasi").get("expressions").length !== 0) {
        builder.errors.push({
          reason:
            "(BuildHIR::lowerExpression) Handle tagged template with interpolations",
          severity: ErrorSeverity.Todo,
          nodePath: exprPath,
        });
        return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
      }
      invariant(
        expr.get("quasi").get("quasis").length == 1,
        "there should be only one quasi as we don't support interpolations yet"
      );
      const value = expr.get("quasi").get("quasis").at(0)!.node.value;
      if (value.raw !== value.cooked) {
        builder.errors.push({
          reason:
            "(BuildHIR::lowerExpression) Handle tagged template where cooked value is different from raw value",
          severity: ErrorSeverity.Todo,
          nodePath: exprPath,
        });
        return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
      }

      return {
        kind: "TaggedTemplateExpression",
        tag: lowerExpressionToTemporary(builder, expr.get("tag")),
        value,
        loc: exprLoc,
      };
    }
    case "TemplateLiteral": {
      const expr = exprPath as NodePath<t.TemplateLiteral>;
      const subexprs = expr.get("expressions");
      const quasis = expr.get("quasis");

      if (subexprs.length !== quasis.length - 1) {
        builder.errors.push({
          reason: `(BuildHIR::lowerExpression) Unexpected quasi and subexpression lengths in TemplateLiteral.`,
          severity: ErrorSeverity.InvalidInput,
          nodePath: exprPath,
        });
        return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
      }

      if (subexprs.some((e) => !e.isExpression())) {
        builder.errors.push({
          reason: `(BuildHIR::lowerAssignment) Handle TSType in TemplateLiteral.`,
          severity: ErrorSeverity.Todo,
          nodePath: exprPath,
        });
        return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
      }

      const subexprPlaces = subexprs.map((e) =>
        lowerExpressionToTemporary(builder, e as NodePath<t.Expression>)
      );

      return {
        kind: "TemplateLiteral",
        subexprs: subexprPlaces,
        quasis: expr.get("quasis").map((q) => q.node.value),
        loc: exprLoc,
      };
    }
    case "UnaryExpression": {
      let expr = exprPath as NodePath<t.UnaryExpression>;
      if (expr.node.operator === "delete") {
        const argument = expr.get("argument");
        if (argument.isMemberExpression()) {
          const { object, property } = lowerMemberExpression(builder, argument);
          if (typeof property === "string") {
            return {
              kind: "PropertyDelete",
              object,
              property,
              loc: exprLoc,
            };
          } else {
            return {
              kind: "ComputedDelete",
              object,
              property,
              loc: exprLoc,
            };
          }
        } else {
          builder.errors.push({
            reason: `(BuildHIR::lowerExpression) delete on a non-member expression has no semantic meaning`,
            severity: ErrorSeverity.InvalidInput,
            nodePath: expr,
          });
          return { kind: "UnsupportedNode", node: expr.node, loc: exprLoc };
        }
      } else {
        return {
          kind: "UnaryExpression",
          operator: expr.node.operator,
          value: lowerExpressionToTemporary(builder, expr.get("argument")),
          loc: exprLoc,
        };
      }
    }
    case "AwaitExpression": {
      let expr = exprPath as NodePath<t.AwaitExpression>;
      return {
        kind: "Await",
        value: lowerExpressionToTemporary(builder, expr.get("argument")),
        loc: exprLoc,
      };
    }
    case "TypeCastExpression": {
      let expr = exprPath as NodePath<t.TypeCastExpression>;
      return {
        kind: "TypeCastExpression",
        value: lowerExpressionToTemporary(builder, expr.get("expression")),
        type: expr.get("typeAnnotation").node,
        loc: exprLoc,
      };
    }
    case "UpdateExpression": {
      let expr = exprPath as NodePath<t.UpdateExpression>;
      const argument = expr.get("argument");
      if (!argument.isIdentifier()) {
        builder.errors.push({
          reason: `(BuildHIR::lowerExpression) Handle UpdateExpression with ${argument.type} argument`,
          severity: ErrorSeverity.Todo,
          nodePath: exprPath,
        });
        return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
      }
      if (expr.node.prefix) {
        builder.errors.push({
          reason: `(BuildHIR::lowerExpression) Handle prefix UpdateExpression`,
          severity: ErrorSeverity.Todo,
          nodePath: exprPath,
        });
        return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
      }
      const primitiveTemp = lowerValueToTemporary(builder, {
        kind: "Primitive",
        value: 1,
        loc: expr.node.loc ?? GeneratedSource,
      });
      const temp = buildTemporaryPlace(
        builder,
        expr.node.loc ?? GeneratedSource
      );
      const identifier = lowerIdentifier(
        builder,
        argument as NodePath<t.Identifier>
      );
      builder.push({
        id: makeInstructionId(0),
        lvalue: { ...temp },
        value: {
          kind: "BinaryExpression",
          operator: expr.node.operator === "++" ? "+" : "-",
          left: { ...identifier },
          right: { ...primitiveTemp },
          loc: exprLoc,
        },
        loc: exprLoc,
      });
      lowerValueToTemporary(builder, {
        kind: "StoreLocal",
        lvalue: { place: { ...identifier }, kind: InstructionKind.Reassign },
        value: { ...temp },
        loc: exprLoc,
      });
      return {
        kind: "LoadLocal",
        place: { ...identifier },
        loc: exprLoc,
      };
    }
    case "RegExpLiteral": {
      let expr = exprPath as NodePath<t.RegExpLiteral>;
      return {
        kind: "RegExpLiteral",
        pattern: expr.node.pattern,
        flags: expr.node.flags,
        loc: expr.node.loc ?? GeneratedSource,
      };
    }
    default: {
      builder.errors.push({
        reason: `(BuildHIR::lowerExpression) Handle ${exprPath.type} expressions`,
        severity: ErrorSeverity.Todo,
        nodePath: exprPath,
      });
      return { kind: "UnsupportedNode", node: exprNode, loc: exprLoc };
    }
  }
}

function lowerOptionalMemberExpression(
  builder: HIRBuilder,
  expr: NodePath<t.OptionalMemberExpression>,
  parentAlternate: BlockId | null
): { object: Place; value: Place } {
  const optional = expr.node.optional;
  const loc = expr.node.loc ?? GeneratedSource;
  const place = buildTemporaryPlace(builder, loc);
  const continuationBlock = builder.reserve(builder.currentBlockKind());
  const consequent = builder.reserve("value");

  // block to evaluate if the callee is null/undefined, this sets the result of the call to undefined.
  // note that we only create an alternate when first entering an optional subtree of the ast: if this
  // is a child of an optional node, we use the alterate created by the parent.
  const alternate =
    parentAlternate !== null
      ? parentAlternate
      : builder.enter("value", () => {
          const temp = lowerValueToTemporary(builder, {
            kind: "Primitive",
            value: undefined,
            loc,
          });
          lowerValueToTemporary(builder, {
            kind: "StoreLocal",
            lvalue: { kind: InstructionKind.Const, place: { ...place } },
            value: { ...temp },
            loc,
          });
          return {
            kind: "goto",
            variant: GotoVariant.Break,
            block: continuationBlock.id,
            id: makeInstructionId(0),
            loc,
          };
        });

  let object: Place | null = null;
  const testBlock = builder.enter("value", () => {
    const objectPath = expr.get("object");
    if (objectPath.isOptionalMemberExpression()) {
      const { value } = lowerOptionalMemberExpression(
        builder,
        objectPath,
        alternate
      );
      object = value;
    } else if (objectPath.isOptionalCallExpression()) {
      const value = lowerOptionalCallExpression(builder, objectPath, alternate);
      object = lowerValueToTemporary(builder, value);
    } else {
      object = lowerExpressionToTemporary(builder, objectPath);
    }
    return {
      kind: "branch",
      test: { ...object },
      consequent: consequent.id,
      alternate,
      id: makeInstructionId(0),
      loc,
    };
  });
  invariant(object !== null, "Satisfy type checker");

  // block to evaluate if the callee is non-null/undefined. arguments are lowered in this block to preserve
  // the semantic of conditional evaluation depending on the callee
  builder.enterReserved(consequent, () => {
    const { value } = lowerMemberExpression(builder, expr, object);
    const temp = lowerValueToTemporary(builder, value);
    lowerValueToTemporary(builder, {
      kind: "StoreLocal",
      lvalue: { kind: InstructionKind.Const, place: { ...place } },
      value: { ...temp },
      loc,
    });
    return {
      kind: "goto",
      variant: GotoVariant.Break,
      block: continuationBlock.id,
      id: makeInstructionId(0),
      loc,
    };
  });

  builder.terminateWithContinuation(
    {
      kind: "optional",
      optional,
      test: testBlock,
      fallthrough: continuationBlock.id,
      id: makeInstructionId(0),
      loc,
    },
    continuationBlock
  );

  return { object, value: place };
}

function lowerOptionalCallExpression(
  builder: HIRBuilder,
  expr: NodePath<t.OptionalCallExpression>,
  parentAlternate: BlockId | null
): InstructionValue {
  const optional = expr.node.optional;
  const calleePath = expr.get("callee");
  const loc = expr.node.loc ?? GeneratedSource;
  const place = buildTemporaryPlace(builder, loc);
  const continuationBlock = builder.reserve(builder.currentBlockKind());
  const consequent = builder.reserve("value");

  // block to evaluate if the callee is null/undefined, this sets the result of the call to undefined.
  // note that we only create an alternate when first entering an optional subtree of the ast: if this
  // is a child of an optional node, we use the alterate created by the parent.
  const alternate =
    parentAlternate !== null
      ? parentAlternate
      : builder.enter("value", () => {
          const temp = lowerValueToTemporary(builder, {
            kind: "Primitive",
            value: undefined,
            loc,
          });
          lowerValueToTemporary(builder, {
            kind: "StoreLocal",
            lvalue: { kind: InstructionKind.Const, place: { ...place } },
            value: { ...temp },
            loc,
          });
          return {
            kind: "goto",
            variant: GotoVariant.Break,
            block: continuationBlock.id,
            id: makeInstructionId(0),
            loc,
          };
        });

  // Lower the callee within the test block to represent the fact that the code for the callee is
  // scoped within the optional
  let callee:
    | { kind: "CallExpression"; callee: Place }
    | { kind: "MethodCall"; receiver: Place; property: Place };
  const testBlock = builder.enter("value", () => {
    if (calleePath.isOptionalCallExpression()) {
      // Recursively call lowerOptionalCallExpression to thread down the alternate block
      const value = lowerOptionalCallExpression(builder, calleePath, alternate);
      const valuePlace = lowerValueToTemporary(builder, value);
      callee = {
        kind: "CallExpression",
        callee: valuePlace,
      };
    } else if (calleePath.isOptionalMemberExpression()) {
      const { object, value } = lowerOptionalMemberExpression(
        builder,
        calleePath,
        alternate
      );
      callee = {
        kind: "MethodCall",
        receiver: object,
        property: value,
      };
    } else if (calleePath.isMemberExpression()) {
      const memberExpr = lowerMemberExpression(builder, calleePath);
      const propertyPlace = lowerValueToTemporary(builder, memberExpr.value);
      callee = {
        kind: "MethodCall",
        receiver: memberExpr.object,
        property: propertyPlace,
      };
    } else {
      callee = {
        kind: "CallExpression",
        callee: lowerExpressionToTemporary(builder, calleePath),
      };
    }
    const testPlace =
      callee.kind === "CallExpression" ? callee.callee : callee.property;
    return {
      kind: "branch",
      test: { ...testPlace },
      consequent: consequent.id,
      alternate,
      id: makeInstructionId(0),
      loc,
    };
  });

  // block to evaluate if the callee is non-null/undefined. arguments are lowered in this block to preserve
  // the semantic of conditional evaluation depending on the callee
  builder.enterReserved(consequent, () => {
    const args = lowerArguments(builder, expr.get("arguments"));
    const temp = buildTemporaryPlace(builder, loc);
    if (callee.kind === "CallExpression") {
      builder.push({
        id: makeInstructionId(0),
        lvalue: { ...temp },
        value: {
          kind: "CallExpression",
          callee: { ...callee.callee },
          args,
          loc,
        },
        loc,
      });
    } else {
      builder.push({
        id: makeInstructionId(0),
        lvalue: { ...temp },
        value: {
          kind: "MethodCall",
          receiver: { ...callee.receiver },
          property: { ...callee.property },
          args,
          loc,
        },
        loc,
      });
    }
    lowerValueToTemporary(builder, {
      kind: "StoreLocal",
      lvalue: { kind: InstructionKind.Const, place: { ...place } },
      value: { ...temp },
      loc,
    });
    return {
      kind: "goto",
      variant: GotoVariant.Break,
      block: continuationBlock.id,
      id: makeInstructionId(0),
      loc,
    };
  });

  builder.terminateWithContinuation(
    {
      kind: "optional",
      optional,
      test: testBlock,
      fallthrough: continuationBlock.id,
      id: makeInstructionId(0),
      loc,
    },
    continuationBlock
  );

  return { kind: "LoadLocal", place, loc: place.loc };
}

/**
 * There are a few places where we do not preserve original evaluation ordering and/or control flow, such as
 * switch case test values and default values in destructuring (assignment patterns). In these cases we allow
 * simple expressions whose evaluation cannot be observed:
 *  - primitives
 *  - arrays/objects whose values are also safely reorderable.
 */
function lowerReorderableExpression(
  builder: HIRBuilder,
  expr: NodePath<t.Expression>
): Place {
  if (!isReorderableExpression(builder, expr)) {
    builder.errors.push({
      reason: `(BuildHIR::node.lowerReorderableExpression) Expression type '${expr.type}' cannot be safely reordered`,
      severity: ErrorSeverity.Todo,
      nodePath: expr,
    });
  }
  return lowerExpressionToTemporary(builder, expr);
}

function isReorderableExpression(
  builder: HIRBuilder,
  expr: NodePath<t.Expression>
): boolean {
  switch (expr.node.type) {
    case "Identifier":
    case "RegExpLiteral":
    case "StringLiteral":
    case "NumericLiteral":
    case "NullLiteral":
    case "BooleanLiteral":
    case "BigIntLiteral": {
      return true;
    }
    case "ArrayExpression": {
      return (expr as NodePath<t.ArrayExpression>)
        .get("elements")
        .every(
          (element) =>
            element.isExpression() && isReorderableExpression(builder, element)
        );
    }
    case "ObjectExpression": {
      return (expr as NodePath<t.ObjectExpression>)
        .get("properties")
        .every((property) => {
          if (!property.isObjectProperty() || property.node.computed) {
            return false;
          }
          const value = property.get("value");
          return (
            value.isExpression() && isReorderableExpression(builder, value)
          );
        });
    }
    case "MemberExpression": {
      // A common pattern is switch statements where the case test values are properties of a global,
      // eg `case ProductOptions.Option: { ... }`
      // We therefore allow expressions where the innermost object is a global identifier, and reject
      // all other member expressions (for now).
      const test = expr as NodePath<t.MemberExpression>;
      let innerObject: NodePath<t.Expression> = test;
      while (innerObject.isMemberExpression()) {
        innerObject = innerObject.get("object");
      }
      if (
        innerObject.isIdentifier() &&
        builder.resolveIdentifier(innerObject) === null // null means global
      ) {
        // This is a property/computed load from a global, that's safe to reorder
        return true;
      } else {
        return false;
      }
    }
    default: {
      return false;
    }
  }
}

function lowerArguments(
  builder: HIRBuilder,
  expr: Array<
    NodePath<
      | t.Expression
      | t.SpreadElement
      | t.JSXNamespacedName
      | t.ArgumentPlaceholder
    >
  >
): Array<Place | SpreadPattern> {
  let args: Array<Place | SpreadPattern> = [];
  for (const argPath of expr) {
    if (argPath.isSpreadElement()) {
      args.push({
        kind: "Spread",
        place: lowerExpressionToTemporary(builder, argPath.get("argument")),
      });
    } else if (argPath.isExpression()) {
      args.push(lowerExpressionToTemporary(builder, argPath));
    } else {
      builder.errors.push({
        reason: `(BuildHIR::lowerExpression) Handle ${argPath.type} arguments in CallExpression`,
        severity: ErrorSeverity.Todo,
        nodePath: argPath,
      });
    }
  }
  return args;
}

type LoweredMemberExpression = {
  object: Place;
  property: Place | string;
  value: InstructionValue;
};
function lowerMemberExpression(
  builder: HIRBuilder,
  expr: NodePath<t.MemberExpression | t.OptionalMemberExpression>,
  loweredObject: Place | null = null
): LoweredMemberExpression {
  const exprNode = expr.node;
  const exprLoc = exprNode.loc ?? GeneratedSource;
  const objectNode = expr.get("object");
  const propertyNode = expr.get("property");
  const object =
    loweredObject ?? lowerExpressionToTemporary(builder, objectNode);

  if (!expr.node.computed) {
    if (!propertyNode.isIdentifier()) {
      builder.errors.push({
        reason: `(BuildHIR::lowerMemberExpression) Handle ${propertyNode.type} property`,
        severity: ErrorSeverity.Todo,
        nodePath: propertyNode,
      });
      return {
        object,
        property: propertyNode.toString(),
        value: { kind: "UnsupportedNode", node: exprNode, loc: exprLoc },
      };
    }
    const value: InstructionValue = {
      kind: "PropertyLoad",
      object: { ...object },
      property: propertyNode.node.name,
      loc: exprLoc,
    };
    return { object, property: propertyNode.node.name, value };
  } else {
    if (!propertyNode.isExpression()) {
      builder.errors.push({
        reason: `(BuildHIR::lowerMemberExpression) Expected Expression, got ${propertyNode.type} property`,
        severity: ErrorSeverity.InvalidInput,
        nodePath: propertyNode,
      });
      return {
        object,
        property: propertyNode.toString(),
        value: {
          kind: "UnsupportedNode",
          node: exprNode,
          loc: exprLoc,
        },
      };
    }
    const property = lowerExpressionToTemporary(builder, propertyNode);
    const value: InstructionValue = {
      kind: "ComputedLoad",
      object: { ...object },
      property: { ...property },
      loc: exprLoc,
    };
    return { object, property, value };
  }
}

function lowerJsxElementName(
  builder: HIRBuilder,
  exprPath: NodePath<
    t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName
  >
): Place | BuiltinTag {
  const exprNode = exprPath.node;
  const exprLoc = exprNode.loc ?? GeneratedSource;
  if (exprPath.isJSXIdentifier()) {
    const tag: string = exprPath.node.name;
    if (tag.match(/^[A-Z]/)) {
      return lowerValueToTemporary(builder, {
        kind: "LoadLocal",
        place: lowerIdentifier(builder, exprPath),
        loc: exprLoc,
      });
    } else {
      return {
        kind: "BuiltinTag",
        name: tag,
        loc: exprLoc,
      };
    }
  } else if (exprPath.isJSXMemberExpression()) {
    return lowerJsxMemberExpression(builder, exprPath);
  } else if (exprPath.isJSXNamespacedName()) {
    const namespace = exprPath.node.namespace.name;
    const name = exprPath.node.name.name;
    const tag = `${namespace}:${name}`;
    if (namespace.indexOf(":") !== -1 || name.indexOf(":") !== -1) {
      builder.errors.push({
        reason: `(BuildHIR::lowerJsxElementName) Expected JSXNamespacedName to have no colons in the namespace or name, got '${namespace}' : '${name}'`,
        severity: ErrorSeverity.InvalidInput,
        nodePath: exprPath,
      });
    }
    const place = lowerValueToTemporary(builder, {
      kind: "Primitive",
      value: tag,
      loc: exprLoc,
    });
    return place;
  } else {
    builder.errors.push({
      reason: `(BuildHIR::lowerJsxElementName) Handle ${exprPath.type} tags`,
      severity: ErrorSeverity.Todo,
      nodePath: exprPath,
    });
    return lowerValueToTemporary(builder, {
      kind: "UnsupportedNode",
      node: exprNode,
      loc: exprLoc,
    });
  }
}

function lowerJsxMemberExpression(
  builder: HIRBuilder,
  exprPath: NodePath<t.JSXMemberExpression>
): Place {
  const loc = exprPath.node.loc ?? GeneratedSource;
  const object = exprPath.get("object");
  let objectPlace: Place;
  if (object.isJSXMemberExpression()) {
    objectPlace = lowerJsxMemberExpression(builder, object);
  } else {
    invariant(
      object.isJSXIdentifier(),
      "TypeScript refinement fail: expected 'JsxIdentifier', got '%s'",
      object.node.type
    );
    objectPlace = lowerIdentifier(builder, object);
  }
  const property = exprPath.get("property").node.name;
  return lowerValueToTemporary(builder, {
    kind: "PropertyLoad",
    object: objectPlace,
    property,
    loc,
  });
}

function lowerJsxElement(
  builder: HIRBuilder,
  exprPath: NodePath<
    | t.JSXText
    | t.JSXExpressionContainer
    | t.JSXSpreadChild
    | t.JSXElement
    | t.JSXFragment
  >
): Place | null {
  const exprNode = exprPath.node;
  const exprLoc = exprNode.loc ?? GeneratedSource;
  if (exprPath.isJSXElement() || exprPath.isJSXFragment()) {
    return lowerExpressionToTemporary(builder, exprPath);
  } else if (exprPath.isJSXExpressionContainer()) {
    const expression = exprPath.get("expression");
    if (expression.isJSXEmptyExpression()) {
      return null;
    } else {
      invariant(
        expression.isExpression(),
        `(BuildHIR::lowerJsxElement) Expected Expression but found ${expression.type}!`
      );
      return lowerExpressionToTemporary(builder, expression);
    }
  } else if (exprPath.isJSXText()) {
    const place = lowerValueToTemporary(builder, {
      kind: "JSXText",
      value: exprPath.node.value,
      loc: exprLoc,
    });
    return place;
  } else {
    if (!(t.isJSXFragment(exprNode) || t.isJSXSpreadChild(exprNode))) {
      builder.errors.push({
        reason: `(BuildHIR::lowerJsxElement) Expected refinement to work, got: ${exprPath.type}`,
        severity: ErrorSeverity.InvalidInput,
        nodePath: exprPath,
      });
    }
    const place = lowerValueToTemporary(builder, {
      kind: "UnsupportedNode",
      node: exprNode,
      loc: exprLoc,
    });
    return place;
  }
}

function lowerFunctionExpression(
  builder: HIRBuilder,
  expr: NodePath<t.FunctionExpression | t.ArrowFunctionExpression>
): InstructionValue {
  const exprNode = expr.node;
  const exprLoc = exprNode.loc ?? GeneratedSource;
  let name: string | null = null;
  if (expr.isFunctionExpression()) {
    name = expr.get("id")?.node?.name ?? null;
  }
  const componentScope: Scope = expr.scope.parent.getFunctionParent()!;
  const captured = gatherCapturedDeps(builder, expr, componentScope);

  // TODO(gsn): In the future, we could only pass in the context identifiers
  // that are actually used by this function and it's nested functions, rather
  // than all context identifiers.
  //
  // This isn't a problem in practice because use Babel's scope analysis to
  // identify the correct references.
  const lowering = lower(
    expr,
    builder.environment,
    builder.bindings,
    [...builder.context, ...captured.identifiers],
    builder.parentFunction
  );
  let loweredFunc: HIRFunction;
  if (lowering.isErr()) {
    lowering
      .unwrapErr()
      .details.forEach((detail) => builder.errors.pushErrorDetail(detail));
    return {
      kind: "UnsupportedNode",
      node: exprNode,
      loc: exprLoc,
    };
  }
  loweredFunc = lowering.unwrap();
  return {
    kind: "FunctionExpression",
    name,
    loweredFunc,
    dependencies: captured.refs,
    expr: expr.node,
    loc: exprLoc,
  };
}

function lowerExpressionToTemporary(
  builder: HIRBuilder,
  exprPath: NodePath<t.Expression>
): Place {
  const value = lowerExpression(builder, exprPath);
  return lowerValueToTemporary(builder, value);
}

function lowerValueToTemporary(
  builder: HIRBuilder,
  value: InstructionValue
): Place {
  if (value.kind === "LoadLocal" && value.place.identifier.name === null) {
    return value.place;
  }
  const place: Place = buildTemporaryPlace(builder, value.loc);
  builder.push({
    id: makeInstructionId(0),
    value: value,
    loc: value.loc,
    lvalue: { ...place },
  });
  return place;
}

function lowerIdentifier(
  builder: HIRBuilder,
  exprPath: NodePath<t.Identifier | t.JSXIdentifier>
): Place {
  const exprNode = exprPath.node;
  const exprLoc = exprNode.loc ?? GeneratedSource;
  const identifier = builder.resolveIdentifier(exprPath);
  if (identifier === null) {
    const global = builder.resolveGlobal(exprPath);
    let value: InstructionValue;
    if (global !== null) {
      value = { kind: "LoadGlobal", name: global.name, loc: exprLoc };
    } else {
      value = { kind: "UnsupportedNode", node: exprPath.node, loc: exprLoc };
    }
    return lowerValueToTemporary(builder, value);
  }
  const place: Place = {
    kind: "Identifier",
    identifier: identifier,
    effect: Effect.Unknown,
    loc: exprLoc,
  };
  return place;
}

/**
 * Creates a temporary Identifier and Place referencing that identifier.
 */
function buildTemporaryPlace(builder: HIRBuilder, loc: SourceLocation): Place {
  const place: Place = {
    kind: "Identifier",
    identifier: builder.makeTemporary(),
    effect: Effect.Unknown,
    loc,
  };
  return place;
}

function lowerAssignment(
  builder: HIRBuilder,
  loc: SourceLocation,
  kind: InstructionKind,
  lvaluePath: NodePath<t.LVal>,
  value: Place
): InstructionValue {
  const lvalueNode = lvaluePath.node;
  switch (lvalueNode.type) {
    case "Identifier": {
      const lvalue = lvaluePath as NodePath<t.Identifier>;
      const identifier = builder.resolveIdentifier(lvalue);
      if (identifier == null) {
        if (kind === InstructionKind.Reassign) {
          // Trying to reassign a global is not allowed
          builder.errors.push({
            reason: `(BuildHIR::lowerAssignment) Assigning to an identifier defined outside the function scope is not supported.`,
            severity: ErrorSeverity.InvalidInput,
            nodePath: lvalue,
          });
        } else {
          // Else its an internal error bc we couldn't find the binding
          builder.errors.push({
            reason: `(BuildHIR::lowerAssignment) Could not find binding for declaration.`,
            severity: ErrorSeverity.Invariant,
            nodePath: lvalue,
          });
        }
        return {
          kind: "UnsupportedNode",
          loc: lvalue.node.loc ?? GeneratedSource,
          node: lvalue.node,
        };
      }

      const place: Place = {
        kind: "Identifier",
        identifier: identifier,
        effect: Effect.Unknown,
        loc: lvalue.node.loc ?? GeneratedSource,
      };
      const temporary = lowerValueToTemporary(builder, {
        kind: "StoreLocal",
        lvalue: { place: { ...place }, kind },
        value,
        loc,
      });
      return { kind: "LoadLocal", place: temporary, loc: temporary.loc };
    }
    case "MemberExpression": {
      // This can only occur because of a coding error, parsers enforce this condition
      invariant(
        kind === InstructionKind.Reassign,
        "MemberExpression may only appear in an assignment expression"
      );
      const lvalue = lvaluePath as NodePath<t.MemberExpression>;
      const property = lvalue.get("property");
      const object = lowerExpressionToTemporary(builder, lvalue.get("object"));
      if (!lvalue.node.computed) {
        if (!property.isIdentifier()) {
          builder.errors.push({
            reason: `(BuildHIR::lowerAssignment) Handle ${property.type} properties in MemberExpression`,
            severity: ErrorSeverity.Todo,
            nodePath: property,
          });
          return { kind: "UnsupportedNode", node: lvalueNode, loc };
        }
        const temporary = lowerValueToTemporary(builder, {
          kind: "PropertyStore",
          object,
          property: property.node.name,
          value,
          loc,
        });
        return { kind: "LoadLocal", place: temporary, loc: temporary.loc };
      } else {
        if (!property.isExpression()) {
          builder.errors.push({
            reason:
              "(BuildHIR::lowerAssignment) Expected private name to appear as a non-computed property",
            severity: ErrorSeverity.InvalidInput,
            nodePath: property,
          });
          return { kind: "UnsupportedNode", node: lvalueNode, loc };
        }
        const propertyPlace = lowerExpressionToTemporary(builder, property);
        const temporary = lowerValueToTemporary(builder, {
          kind: "ComputedStore",
          object,
          property: propertyPlace,
          value,
          loc,
        });
        return { kind: "LoadLocal", place: temporary, loc: temporary.loc };
      }
    }
    case "ArrayPattern": {
      const lvalue = lvaluePath as NodePath<t.ArrayPattern>;
      const elements = lvalue.get("elements");
      const items: ArrayPattern["items"] = [];
      const followups: Array<{ place: Place; path: NodePath<t.LVal> }> = [];
      for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (element.node == null) {
          continue;
        }
        if (element.isRestElement()) {
          const argument = element.get("argument");
          if (!argument.isIdentifier()) {
            builder.errors.push({
              reason: `(BuildHIR::lowerAssignment) Handle ${argument.node.type} rest element in ArrayPattern`,
              severity: ErrorSeverity.Todo,
              nodePath: element,
            });
            continue;
          }
          const identifier = lowerIdentifier(builder, argument);
          items.push({
            kind: "Spread",
            place: identifier,
          });
        } else if (element.isIdentifier()) {
          const identifier = lowerIdentifier(builder, element);
          items.push(identifier);
        } else {
          const temp = buildTemporaryPlace(
            builder,
            element.node.loc ?? GeneratedSource
          );
          items.push({ ...temp });
          followups.push({ place: temp, path: element as NodePath<t.LVal> }); // TODO remove type cast
        }
      }
      const temporary = lowerValueToTemporary(builder, {
        kind: "Destructure",
        lvalue: {
          kind,
          pattern: {
            kind: "ArrayPattern",
            items,
          },
        },
        value,
        loc,
      });
      for (const { place, path } of followups) {
        lowerAssignment(builder, path.node.loc ?? loc, kind, path, place);
      }
      return { kind: "LoadLocal", place: temporary, loc: value.loc };
    }
    case "ObjectPattern": {
      const lvalue = lvaluePath as NodePath<t.ObjectPattern>;
      const propertiesPaths = lvalue.get("properties");
      const properties: ObjectPattern["properties"] = [];
      const followups: Array<{ place: Place; path: NodePath<t.LVal> }> = [];
      for (let i = 0; i < propertiesPaths.length; i++) {
        const property = propertiesPaths[i];
        if (property.isRestElement()) {
          const argument = property.get("argument");
          if (!argument.isIdentifier()) {
            builder.errors.push({
              reason: `(BuildHIR::lowerAssignment) Handle ${argument.node.type} rest element in ArrayPattern`,
              severity: ErrorSeverity.Todo,
              nodePath: argument,
            });
            continue;
          }
          const identifier = lowerIdentifier(builder, argument);
          properties.push({
            kind: "Spread",
            place: identifier,
          });
        } else {
          // TODO: this should always be true given the if/else
          if (!property.isObjectProperty()) {
            builder.errors.push({
              reason: `(BuildHIR::lowerAssignment) Handle ${property.type} properties in ObjectPattern`,
              severity: ErrorSeverity.Todo,
              nodePath: property,
            });
            continue;
          }
          const key = property.get("key");
          if (!key.isIdentifier()) {
            builder.errors.push({
              reason: `(BuildHIR::lowerAssignment) Handle ${key.type} keys in ObjectPattern`,
              severity: ErrorSeverity.Todo,
              nodePath: key,
            });
            continue;
          }
          const element = property.get("value");
          if (!element.isLVal()) {
            builder.errors.push({
              reason: `(BuildHIR::lowerAssignment) Expected object property value to be an LVal, got: ${element.type}`,
              severity: ErrorSeverity.InvalidInput,
              nodePath: element,
            });
            continue;
          }
          if (element.isIdentifier()) {
            const identifier = lowerIdentifier(builder, element);
            properties.push({
              kind: "ObjectProperty",
              name: key.node.name,
              place: identifier,
            });
          } else {
            const temp = buildTemporaryPlace(
              builder,
              element.node.loc ?? GeneratedSource
            );
            properties.push({
              kind: "ObjectProperty",
              name: key.node.name,
              place: { ...temp },
            });
            followups.push({ place: temp, path: element as NodePath<t.LVal> }); // TODO remove type cast
          }
        }
      }
      const temporary = lowerValueToTemporary(builder, {
        kind: "Destructure",
        lvalue: {
          kind,
          pattern: {
            kind: "ObjectPattern",
            properties,
          },
        },
        value,
        loc,
      });
      for (const { place, path } of followups) {
        lowerAssignment(builder, path.node.loc ?? loc, kind, path, place);
      }
      return { kind: "LoadLocal", place: temporary, loc: value.loc };
    }
    case "AssignmentPattern": {
      const lvalue = lvaluePath as NodePath<t.AssignmentPattern>;
      const loc = lvalue.node.loc ?? GeneratedSource;
      const temp = buildTemporaryPlace(builder, loc);

      const testBlock = builder.reserve("value");
      const continuationBlock = builder.reserve(builder.currentBlockKind());

      const consequent = builder.enter("value", () => {
        // Because we reorder evaluation, we restrict the allowed default values to those where
        // evaluation order is unobservable
        const defaultValue = lowerReorderableExpression(
          builder,
          lvalue.get("right")
        );
        lowerValueToTemporary(builder, {
          kind: "StoreLocal",
          lvalue: { kind: InstructionKind.Const, place: { ...temp } },
          value: { ...defaultValue },
          loc,
        });
        return {
          kind: "goto",
          variant: GotoVariant.Break,
          block: continuationBlock.id,
          id: makeInstructionId(0),
          loc,
        };
      });

      const alternate = builder.enter("value", () => {
        lowerValueToTemporary(builder, {
          kind: "StoreLocal",
          lvalue: { kind: InstructionKind.Const, place: { ...temp } },
          value: { ...value },
          loc,
        });
        return {
          kind: "goto",
          variant: GotoVariant.Break,
          block: continuationBlock.id,
          id: makeInstructionId(0),
          loc,
        };
      });
      builder.terminateWithContinuation(
        {
          kind: "ternary",
          test: testBlock.id,
          fallthrough: continuationBlock.id,
          id: makeInstructionId(0),
          loc,
        },
        testBlock
      );
      const undef = lowerValueToTemporary(builder, {
        kind: "Primitive",
        value: undefined,
        loc,
      });
      const test = lowerValueToTemporary(builder, {
        kind: "BinaryExpression",
        left: { ...value },
        operator: "===",
        right: { ...undef },
        loc,
      });
      builder.terminateWithContinuation(
        {
          kind: "branch",
          test: { ...test },
          consequent,
          alternate,
          id: makeInstructionId(0),
          loc,
        },
        continuationBlock
      );

      return lowerAssignment(builder, loc, kind, lvalue.get("left"), temp);
    }
    default: {
      builder.errors.push({
        reason: `(BuildHIR::lowerAssignment) Handle ${lvaluePath.type} assignments`,
        severity: ErrorSeverity.Todo,
        nodePath: lvaluePath,
      });
      return { kind: "UnsupportedNode", node: lvalueNode, loc };
    }
  }
}

function captureScopes({ from, to }: { from: Scope; to: Scope }): Set<Scope> {
  let scopes: Set<Scope> = new Set();
  while (from) {
    scopes.add(from);

    if (from === to) {
      break;
    }

    from = from.parent;
  }
  return scopes;
}

function gatherCapturedDeps(
  builder: HIRBuilder,
  fn: NodePath<t.FunctionExpression | t.ArrowFunctionExpression>,
  componentScope: Scope
): { identifiers: t.Identifier[]; refs: Place[] } {
  const capturedIds: Map<t.Identifier, number> = new Map();
  const capturedRefs: Set<Place> = new Set();
  const seenPaths: Set<string> = new Set();

  // Capture all the scopes from the parent of this function up to and including
  // the component scope.
  const pureScopes: Set<Scope> = captureScopes({
    from: fn.scope.parent,
    to: componentScope,
  });

  function visit(path: NodePath<Expression>): void {
    // Babel has a bug where it doesn't visit the LHS of an
    // AssignmentExpression if it's an Identifier. Work around it by explicitly
    // visiting it.
    if (path.isAssignmentExpression()) {
      const left = path.get("left");
      if (left.isIdentifier()) {
        visit(left);
      }
      return;
    }

    let obj = path;
    while (obj.isMemberExpression()) {
      obj = obj.get("object");
    }

    if (!obj.isIdentifier()) {
      return;
    }

    const binding = obj.scope.getBinding(obj.node.name);
    if (binding === undefined || !pureScopes.has(binding.scope)) {
      return;
    }

    if (path.isMemberExpression()) {
      // For CallExpression, we need to depend on the receiver, not the
      // function itself.
      if (
        path.parent.type === "CallExpression" &&
        path.parent.callee === path.node
      ) {
        path = path.get("object");
      }

      // Skip the computed part of the member expression.
      while (path.isMemberExpression() && path.node.computed) {
        path = path.get("object");
      }

      path.skip();
    }

    // Store the top-level identifiers that are captured as well as the list
    // of Places (including PropertyLoad)
    let index: number;
    if (!capturedIds.has(binding.identifier)) {
      index = capturedIds.size;
      capturedIds.set(binding.identifier, index);
    } else {
      index = capturedIds.get(binding.identifier)!;
    }
    let pathTokens = [];
    let current = path;
    while (current.isMemberExpression()) {
      const property = path.get("property") as NodePath<t.Identifier>;
      pathTokens.push(property.node.name);
      current = current.get("object");
    }
    pathTokens.push(String(index));
    pathTokens.reverse();
    const pathKey = pathTokens.join(".");
    if (!seenPaths.has(pathKey)) {
      capturedRefs.add(lowerExpressionToTemporary(builder, path));
      seenPaths.add(pathKey);
    }
  }

  fn.get("body").traverse({
    Expression(path) {
      visit(path);
    },
  });

  return { identifiers: [...capturedIds.keys()], refs: [...capturedRefs] };
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}
