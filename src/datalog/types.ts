export type Value = string | number | boolean | null;
export type Key = string;
export type Scope = string;

// 2-tuple: [key, value] - scope is in StoredFact metadata
export type Fact = readonly [Key, Value];
export type FactId = string;

export interface StoredFact {
  id: FactId;
  fact: Fact;
  scope: Scope;        // The actor/entity scope (implicit context)
  timestamp: number;
  source: string;      // nodeId that created this fact
}

// Variables start with ?
export class Var {
  constructor(public readonly name: string) {}

  static isVar(v: unknown): v is Var {
    return v instanceof Var;
  }
}

export type PatternElement = Key | Value | Var;
// 2-element pattern: [key, value]
export type Pattern = readonly [PatternElement, PatternElement];

export type Bindings = Map<string, Value | Key | Scope>;

// For queries that need to match across scopes
export interface ScopedPattern {
  scope: PatternElement;  // Can be a Var or literal scope
  pattern: Pattern;
}
