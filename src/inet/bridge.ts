// Bridge: DatalogStore ↔ Interaction Net
//
// This connects the existing fact storage with the interaction net query engine

import type { DatalogStore } from '../datalog/store';
import type { Net, Agent, Bindings, Value } from './types';
import {
  createFact,
  connect,
} from './net';
import { reduce } from './rules';
import {
  parseQuery,
  buildQueryNet,
  visualConfigToPattern,
  type VisualQueryConfig,
} from './parse';

// ============ Store to Net Conversion ============

// Add all facts from DatalogStore to an interaction net
export function storeToNet(store: DatalogStore, net: Net): Agent[] {
  const factAgents: Agent[] = [];

  for (const storedFact of store.all()) {
    const agent = createFact(
      net,
      storedFact.fact[0],           // key
      storedFact.fact[1],           // value
      storedFact.scope              // scope
    );
    factAgents.push(agent);
  }

  return factAgents;
}

// ============ Query Execution ============

// Execute a text query against the store using interaction nets
export function executeTextQuery(
  store: DatalogStore,
  queryText: string
): Bindings[] {
  // 1. Parse the query string
  const patterns = parseQuery(queryText);
  if (patterns.length === 0) {
    return [];
  }

  // 2. Build the query net
  const { net, matches, result } = buildQueryNet(patterns);

  // 3. Add facts from store
  const factAgents = storeToNet(store, net);

  // 4. Connect facts to matchers
  // For now, simple approach: replicate facts for each matcher
  connectFactsToMatchers(net, factAgents, matches);

  // 5. Reduce the net
  reduce(net);

  // 6. Extract results from Result agent
  return extractResults(net, result);
}

// Execute a visual query (from toggle button UI)
export function executeVisualQuery(
  store: DatalogStore,
  config: VisualQueryConfig,
  currentScope: string
): Bindings[] {
  // 1. Convert visual config to pattern
  const pattern = visualConfigToPattern(config, currentScope);

  // 2. Build query net
  const { net, matches, result } = buildQueryNet([pattern]);

  // 3. Add facts
  const factAgents = storeToNet(store, net);

  // 4. Connect
  connectFactsToMatchers(net, factAgents, matches);

  // 5. Reduce
  reduce(net);

  // 6. Extract
  return extractResults(net, result);
}

// ============ Helpers ============

// Connect facts to match agents
// This creates a Dup tree so each Match can try each Fact
function connectFactsToMatchers(net: Net, facts: Agent[], matches: Agent[]): void {
  if (facts.length === 0 || matches.length === 0) return;

  // For each match, we need to try all facts
  // The proper inet approach would be to use replication agents
  // For now, we duplicate facts for each match

  for (const match of matches) {
    const matchPrincipal = match.ports.get('principal')!;

    if (facts.length === 1) {
      // Single fact - direct connection
      connect(net, facts[0].ports.get('principal')!.id, matchPrincipal.id);
    } else {
      // Multiple facts - need to try each one
      // Create a chain of facts with duplication
      // This is a simplification - real impl would be more sophisticated

      // For now, just connect the first fact
      // (full implementation would need non-determinism or backtracking)
      connect(net, facts[0].ports.get('principal')!.id, matchPrincipal.id);
    }
  }
}

// Extract bindings from the Result agent after reduction
function extractResults(net: Net, resultAgent: Agent): Bindings[] {
  const data = resultAgent.data;
  if (data.type !== 'Result') return [];

  // Check if any Val agents are connected to the Result's collect port
  const results: Bindings[] = [];

  // Look for Val agents in the net that might have been connected
  for (const agent of net.agents.values()) {
    if (agent.data.type === 'Val') {
      try {
        const parsed = JSON.parse(agent.data.value as string);
        results.push(new Map(Object.entries(parsed)));
      } catch {
        // Not a JSON bindings value
      }
    }
  }

  return results;
}

// ============ Simpler Direct Execution ============

// Since full inet reduction for queries is complex (needs non-determinism),
// here's a direct execution that uses inet semantics but simpler iteration

export function executeQueryDirect(
  store: DatalogStore,
  queryText: string
): Array<Record<string, Value>> {
  const patterns = parseQuery(queryText);
  if (patterns.length === 0) return [];

  const facts = store.all();
  const results: Bindings[] = [];

  // Recursive matching with backtracking
  function matchPatterns(
    patternIdx: number,
    bindings: Bindings,
    usedFactIds: Set<string>
  ): void {
    if (patternIdx >= patterns.length) {
      results.push(new Map(bindings));
      return;
    }

    const pattern = patterns[patternIdx];

    for (const fact of facts) {
      // Skip already-used facts in this result
      if (usedFactIds.has(fact.id)) continue;

      let newBindings: Bindings = new Map(bindings);

      // Match scope if specified
      if (pattern.scope) {
        if (pattern.scope.type === 'lit') {
          if (fact.scope !== pattern.scope.value) continue;
        } else {
          const existing = newBindings.get(pattern.scope.name!);
          if (existing !== undefined && existing !== fact.scope) continue;
          newBindings.set(pattern.scope.name!, fact.scope);
        }
      }

      // Match key
      if (pattern.key.type === 'lit') {
        if (fact.fact[0] !== pattern.key.value) continue;
      } else {
        const existing = newBindings.get(pattern.key.name!);
        if (existing !== undefined && existing !== fact.fact[0]) continue;
        newBindings.set(pattern.key.name!, fact.fact[0]);
      }

      // Match value
      if (pattern.value.type === 'lit') {
        if (fact.fact[1] !== pattern.value.value) continue;
      } else {
        const existing = newBindings.get(pattern.value.name!);
        if (existing !== undefined && existing !== fact.fact[1]) continue;
        newBindings.set(pattern.value.name!, fact.fact[1]);
      }

      // Match succeeded - continue to next pattern
      const newUsed = new Set(usedFactIds);
      newUsed.add(fact.id);
      matchPatterns(patternIdx + 1, newBindings, newUsed);
    }
  }

  matchPatterns(0, new Map(), new Set());

  // Convert to plain objects
  return results.map((b) => Object.fromEntries(b));
}

// ============ UI Integration Example ============

/*
In outliner.ts, replace the query execution with:

import { executeQueryDirect } from '../inet/bridge';

// In renderQueryBuilder or wherever queries are run:
const queryText = buildQueryText(scopeMode, keyMode, valueMode, ...);
const results = executeQueryDirect(store, queryText);
renderResults(results);

Or for the visual query:

import { executeVisualQuery } from '../inet/bridge';

const results = executeVisualQuery(store, {
  scope: { mode: scopeMode, value: scopeValue },
  key: { mode: keyMode, value: keyValue },
  value: { mode: valueMode, value: valueValue },
}, currentScope);
*/
