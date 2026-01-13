// Query Builder for Interaction Nets
//
// High-level API to construct queries that compile to interaction net patterns

import type { Net, Agent, Bindings, Value } from './types';
import {
  createNet,
  createFact,
  createMatch,
  createJoin,
  createDup,
  createScope,
  createResult,
  connect,
  lit,
  varPat,
} from './net';

// Query DSL types
export interface QueryPattern {
  key: string | { var: string };
  value: Value | { var: string };
  scope?: string | { var: string };
}

export interface Query {
  patterns: QueryPattern[];
}

// Build a query net from patterns
export function buildQuery(patterns: QueryPattern[]): Net {
  const net = createNet();

  if (patterns.length === 0) {
    return net;
  }

  // Create a result collector
  const result = createResult(net);

  if (patterns.length === 1) {
    // Single pattern - just a Match
    const p = patterns[0];
    const match = createMatch(
      net,
      typeof p.key === 'string' ? lit(p.key) : varPat(p.key.var),
      isVarPattern(p.value) ? varPat((p.value as { var: string }).var) : lit(p.value as Value)
    );

    // Connect Match result to Result collector
    connect(
      net,
      match.ports.get('result_out')!.id,
      result.ports.get('collect')!.id
    );

    // Add scope constraint if specified
    if (p.scope !== undefined) {
      const scope = createScope(
        net,
        typeof p.scope === 'string' ? p.scope : null
      );
      connect(
        net,
        scope.ports.get('principal')!.id,
        match.ports.get('scope_in')!.id
      );
    }
  } else {
    // Multiple patterns - use Join
    const join = createJoin(net, patterns.length);

    // Connect Join result to Result collector
    connect(
      net,
      join.ports.get('result_out')!.id,
      result.ports.get('collect')!.id
    );

    // Create a Match for each pattern
    patterns.forEach((p, i) => {
      const match = createMatch(
        net,
        typeof p.key === 'string' ? lit(p.key) : varPat(p.key.var),
        isVarPattern(p.value) ? varPat((p.value as { var: string }).var) : lit(p.value as Value)
      );

      // Connect to Join input
      connect(
        net,
        match.ports.get('result_out')!.id,
        join.ports.get(`in_${i}`)!.id
      );

      // Add scope constraint if specified
      if (p.scope !== undefined) {
        const scope = createScope(
          net,
          typeof p.scope === 'string' ? p.scope : null
        );
        connect(
          net,
          scope.ports.get('principal')!.id,
          match.ports.get('scope_in')!.id
        );
      }
    });
  }

  return net;
}

function isVarPattern(v: unknown): v is { var: string } {
  return typeof v === 'object' && v !== null && 'var' in v;
}

// Add facts to a net (for testing/querying)
export function addFacts(
  net: Net,
  facts: Array<{ key: string; value: Value; scope: string }>
): Agent[] {
  return facts.map((f) => createFact(net, f.key, f.value, f.scope));
}

// Connect facts to query (via Dup for replication)
export function connectFactsToQuery(
  net: Net,
  facts: Agent[],
  matches: Agent[]
): void {
  // For each match, we need access to all facts
  // Use Dup agents to replicate facts

  for (const match of matches) {
    const matchPrincipal = match.ports.get('principal')!;

    if (facts.length === 1) {
      // Direct connection
      connect(net, facts[0].ports.get('principal')!.id, matchPrincipal.id);
    } else {
      // Need to try each fact - create a chain of Dups
      // This is simplified - real implementation would be smarter
      let currentPort = matchPrincipal;

      for (let i = 0; i < facts.length - 1; i++) {
        const dup = createDup(net);
        connect(net, facts[i].ports.get('principal')!.id, dup.ports.get('copy1')!.id);

        if (i === facts.length - 2) {
          connect(net, facts[i + 1].ports.get('principal')!.id, dup.ports.get('copy2')!.id);
        }

        connect(net, dup.ports.get('principal')!.id, currentPort.id);
      }
    }
  }
}

// Execute a query against facts and return bindings
export function executeQuery(
  patterns: QueryPattern[],
  facts: Array<{ key: string; value: Value; scope: string }>
): Bindings[] {
  // For simplicity, we'll simulate the interaction net reduction
  // by doing direct pattern matching (the net approach above is
  // more for illustration of the concept)

  const results: Bindings[] = [];

  function matchPatterns(
    patternIdx: number,
    bindings: Bindings,
    usedFacts: Set<number>
  ): void {
    if (patternIdx >= patterns.length) {
      // All patterns matched
      results.push(new Map(bindings));
      return;
    }

    const pattern = patterns[patternIdx];

    for (let i = 0; i < facts.length; i++) {
      if (usedFacts.has(i)) continue; // Don't reuse facts in same result

      const fact = facts[i];
      let newBindings: Bindings | null = new Map(bindings);

      // Match scope
      if (pattern.scope !== undefined) {
        if (typeof pattern.scope === 'string') {
          if (fact.scope !== pattern.scope) continue;
        } else {
          const existing = newBindings.get(pattern.scope.var);
          if (existing !== undefined) {
            if (existing !== fact.scope) continue;
          } else {
            newBindings.set(pattern.scope.var, fact.scope);
          }
        }
      }

      // Match key
      if (typeof pattern.key === 'string') {
        if (fact.key !== pattern.key) continue;
      } else {
        const existing = newBindings.get(pattern.key.var);
        if (existing !== undefined) {
          if (existing !== fact.key) continue;
        } else {
          newBindings.set(pattern.key.var, fact.key);
        }
      }

      // Match value
      if (isVarPattern(pattern.value)) {
        const varName = (pattern.value as { var: string }).var;
        const existing = newBindings.get(varName);
        if (existing !== undefined) {
          if (existing !== fact.value) continue;
        } else {
          newBindings.set(varName, fact.value);
        }
      } else {
        if (fact.value !== pattern.value) continue;
      }

      // Pattern matched, continue to next
      const newUsed = new Set(usedFacts);
      newUsed.add(i);
      matchPatterns(patternIdx + 1, newBindings, newUsed);
    }
  }

  matchPatterns(0, new Map(), new Set());
  return results;
}

// ============ DSL Helpers ============

export function q(key: string | { var: string }, value: Value | { var: string }): QueryPattern {
  return { key, value };
}

export function v(name: string): { var: string } {
  return { var: name };
}

export function inScope(pattern: QueryPattern, scope: string | { var: string }): QueryPattern {
  return { ...pattern, scope };
}

// ============ Example Usage ============

export function exampleQuery(): void {
  // Facts:
  // [name, "Alice"] in scope "user1"
  // [age, 30] in scope "user1"
  // [name, "Bob"] in scope "user2"
  // [age, 25] in scope "user2"

  const facts = [
    { key: 'name', value: 'Alice', scope: 'user1' },
    { key: 'age', value: 30, scope: 'user1' },
    { key: 'name', value: 'Bob', scope: 'user2' },
    { key: 'age', value: 25, scope: 'user2' },
  ];

  // Query: Find all names
  console.log('Query: [name, ?n]');
  const r1 = executeQuery([q('name', v('n'))], facts);
  console.log('Results:', r1.map((b) => Object.fromEntries(b)));

  // Query: Find name and age in same scope
  console.log('\nQuery: [name, ?n], [age, ?a] in same scope');
  const r2 = executeQuery(
    [
      inScope(q('name', v('n')), v('s')),
      inScope(q('age', v('a')), v('s')),
    ],
    facts
  );
  console.log('Results:', r2.map((b) => Object.fromEntries(b)));

  // Query: Find name where age is 30
  console.log('\nQuery: [name, ?n], [age, 30] in same scope');
  const r3 = executeQuery(
    [
      inScope(q('name', v('n')), v('s')),
      inScope(q('age', 30), v('s')),
    ],
    facts
  );
  console.log('Results:', r3.map((b) => Object.fromEntries(b)));
}
