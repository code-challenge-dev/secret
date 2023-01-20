import {
  Effect,
  HIRFunction,
  Identifier,
  mergeConsecutiveBlocks,
  Place,
} from "../HIR";
import { eachInstructionOperand } from "../HIR/visitors";
import { constantPropagation } from "../Optimization";
import { eliminateRedundantPhi, enterSSA } from "../SSA";
import { inferTypes } from "../TypeInference";
import { logHIRFunction } from "../Utils/logger";
import { inferMutableRanges } from "./InferMutableRanges";
import inferReferenceEffects from "./InferReferenceEffects";

type Dependency = {
  place: Place;
  path: Array<string> | null;
};

function declareProperty(
  properties: Map<Identifier, Dependency>,
  lvalue: Place,
  object: Place,
  property: string
): void {
  const objectDependency = properties.get(object.identifier);
  let nextDependency: Dependency;
  if (objectDependency === undefined) {
    nextDependency = { place: object, path: [property] };
  } else {
    nextDependency = {
      place: objectDependency.place,
      path: [...(objectDependency.path ?? []), property],
    };
  }
  properties.set(lvalue.identifier, nextDependency);
}

export default function (func: HIRFunction) {
  const properties: Map<Identifier, Dependency> = new Map();

  for (const [_, block] of func.body.blocks) {
    for (const instr of block.instructions) {
      switch (instr.value.kind) {
        case "FunctionExpression": {
          instr.value.mutatedDeps = buildMutatedDeps(
            analyzeMutatedPlaces(instr.value.loweredFunc),
            instr.value.dependencies,
            properties
          );
          break;
        }
        case "PropertyLoad": {
          declareProperty(
            properties,
            instr.lvalue.place,
            instr.value.object,
            instr.value.property
          );
        }
      }
    }
  }
}

function buildMutatedDeps(
  mutations: Place[],
  capturedDeps: Place[],
  properties: Map<Identifier, Dependency>
): Place[] {
  const mutatedIds: Set<string> = new Set(
    mutations
      .map((m) => m.identifier.name)
      .filter((m) => m !== null) as string[]
  );
  const mutatedDeps: Place[] = [];

  for (const dep of capturedDeps) {
    if (properties.has(dep.identifier)) {
      let captured = properties.get(dep.identifier)!;
      let name = captured.place.identifier.name;

      if (name === null || !mutatedIds.has(name)) {
        continue;
      }

      mutatedDeps.push(dep);
    }
  }

  return mutatedDeps;
}

function analyzeMutatedPlaces(func: HIRFunction): Array<Place> {
  mergeConsecutiveBlocks(func);
  enterSSA(func);
  eliminateRedundantPhi(func);
  constantPropagation(func);
  inferTypes(func);
  inferReferenceEffects(func);
  inferMutableRanges(func);
  logHIRFunction("AnalyseFunction (inner)", func);

  const mutations: Array<Place> = [];
  for (const [_, block] of func.body.blocks) {
    for (const instr of block.instructions) {
      if (
        instr.value.kind === "FunctionExpression" &&
        instr.value.loweredFunc !== null
      ) {
        mutations.push(...analyzeMutatedPlaces(instr.value.loweredFunc));
      }

      for (const operand of eachInstructionOperand(instr)) {
        if (isMutated(operand)) {
          mutations.push(operand);
        }
      }
    }
  }

  return mutations;
}

function isMutated(place: Place): boolean {
  return place.effect === Effect.Mutate || place.effect === Effect.Store;
}
