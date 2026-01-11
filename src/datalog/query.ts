import type { DatalogStore } from './store';
import type { Bindings, Pattern, PatternElement, StoredFact, Value, Scope, ScopedPattern } from './types';
import { Var } from './types';

function matchElement(
  element: PatternElement,
  value: string | Value,
  bindings: Bindings
): Bindings | null {
  if (Var.isVar(element)) {
    const existing = bindings.get(element.name);
    if (existing !== undefined) {
      // Variable already bound, check if it matches
      return existing === value ? bindings : null;
    }
    // Bind the variable
    const newBindings = new Map(bindings);
    newBindings.set(element.name, value);
    return newBindings;
  }
  // Literal comparison
  return element === value ? bindings : null;
}

function matchFact(
  pattern: Pattern,
  fact: StoredFact,
  bindings: Bindings,
  scopePattern?: PatternElement
): Bindings | null {
  let current: Bindings | null = bindings;

  // Match scope if pattern provided
  if (scopePattern !== undefined) {
    current = matchElement(scopePattern, fact.scope, current);
    if (!current) return null;
  }

  // Match key (pattern[0])
  current = matchElement(pattern[0], fact.fact[0], current);
  if (!current) return null;

  // Match value (pattern[1])
  current = matchElement(pattern[1], fact.fact[1], current);
  return current;
}

export interface QueryOptions {
  scope?: Scope;              // Filter to specific scope
  scopePattern?: PatternElement; // Or match scope with pattern/variable
}

export function query(
  store: DatalogStore,
  patterns: Pattern[],
  options?: QueryOptions
): Bindings[] {
  if (patterns.length === 0) {
    return [new Map()];
  }

  let results: Bindings[] = [new Map()];

  for (const pattern of patterns) {
    const nextResults: Bindings[] = [];

    for (const bindings of results) {
      // Get candidate facts based on bound values in pattern
      let candidates: StoredFact[];

      const [k, _v] = pattern;

      // If scope is specified, filter by scope first
      if (options?.scope) {
        candidates = store.findByScope(options.scope);
      } else if (!Var.isVar(k) && typeof k === 'string') {
        // If key is a literal, use key index
        candidates = store.findByKey(k);
      } else {
        candidates = store.all();
      }

      // Further filter by scope if scope option but no key constraint
      if (options?.scope && !Var.isVar(k)) {
        candidates = candidates.filter((f) => f.fact[0] === k);
      }

      for (const fact of candidates) {
        const newBindings = matchFact(pattern, fact, bindings, options?.scopePattern);
        if (newBindings) {
          nextResults.push(newBindings);
        }
      }
    }

    results = nextResults;
  }

  return results;
}

// Query with scoped patterns (for cross-scope queries)
export function queryScopedPatterns(
  store: DatalogStore,
  patterns: ScopedPattern[]
): Bindings[] {
  if (patterns.length === 0) {
    return [new Map()];
  }

  let results: Bindings[] = [new Map()];

  for (const { scope, pattern } of patterns) {
    const nextResults: Bindings[] = [];

    for (const bindings of results) {
      // Get candidates
      let candidates: StoredFact[];

      if (!Var.isVar(scope) && typeof scope === 'string') {
        candidates = store.findByScope(scope);
      } else if (!Var.isVar(pattern[0]) && typeof pattern[0] === 'string') {
        candidates = store.findByKey(pattern[0]);
      } else {
        candidates = store.all();
      }

      for (const fact of candidates) {
        const newBindings = matchFact(pattern, fact, bindings, scope);
        if (newBindings) {
          nextResults.push(newBindings);
        }
      }
    }

    results = nextResults;
  }

  return results;
}

// Helper to create variables
export function v(name: string): Var {
  return new Var(name);
}

// Convert bindings to plain object for display
export function bindingsToObject(bindings: Bindings): Record<string, Value | string> {
  const obj: Record<string, Value | string> = {};
  for (const [key, value] of bindings) {
    obj[`?${key}`] = value;
  }
  return obj;
}
