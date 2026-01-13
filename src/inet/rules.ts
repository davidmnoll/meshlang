// Interaction Rules

import type { Net, Agent, ActivePair, Bindings, Value, Pattern } from './types';
import {
  createFact,
  createVal,
  createEra,
  connect,
  removeAgent,
  removeWire,
  followWire,
  matchPattern,
} from './net';

// Apply interaction rules to an active pair
// Returns true if a rule was applied
export function interact(net: Net, pair: ActivePair): boolean {
  const { agent1, agent2, wire } = pair;

  // Sort by type for consistent rule lookup
  const [a, b] = [agent1, agent2].sort((x, y) => x.type.localeCompare(y.type));

  // Dispatch to specific rule
  const ruleName = `${a.type}_${b.type}`;

  switch (ruleName) {
    case 'Dup_Fact':
      return ruleDupFact(net, a, b, wire.id);
    case 'Era_Fact':
      return ruleEraFact(net, a, b, wire.id);
    case 'Fact_Match':
      return ruleFactMatch(net, a, b, wire.id);
    case 'Dup_Dup':
      return ruleDupDup(net, a, b, wire.id);
    case 'Dup_Era':
      return ruleDupEra(net, a, b, wire.id);
    case 'Era_Era':
      return ruleEraEra(net, a, b, wire.id);
    case 'Val_Var':
      return ruleValVar(net, a, b, wire.id);
    case 'Join_Val':
      return ruleJoinVal(net, a, b, wire.id);
    default:
      // No rule for this pair
      return false;
  }
}

// ============ Interaction Rules ============

// Dup >< Fact: Duplicate the fact
//
//     copy1          copy1---Fact'
//       |
// Fact--●--Dup   =>
//       |
//     copy2          copy2---Fact''
//
function ruleDupFact(net: Net, dup: Agent, fact: Agent, wireId: string): boolean {
  if (dup.type !== 'Dup' || fact.type !== 'Fact') {
    [dup, fact] = [fact, dup] as [Agent, Agent];
  }
  if (dup.type !== 'Dup' || fact.type !== 'Fact') return false;

  const factData = fact.data as { type: 'Fact'; key: string; value: Value; scope: string };

  // Get the ports that Dup's copies connect to
  const copy1Port = dup.ports.get('copy1')!;
  const copy2Port = dup.ports.get('copy2')!;
  const copy1Target = followWire(net, copy1Port);
  const copy2Target = followWire(net, copy2Port);

  // Remove the original agents and wire
  removeWire(net, wireId);
  if (copy1Port.wire) removeWire(net, copy1Port.wire);
  if (copy2Port.wire) removeWire(net, copy2Port.wire);
  removeAgent(net, dup.id);
  removeAgent(net, fact.id);

  // Create two copies of the fact
  const fact1 = createFact(net, factData.key, factData.value, factData.scope);
  const fact2 = createFact(net, factData.key, factData.value, factData.scope);

  // Reconnect
  if (copy1Target) {
    connect(net, fact1.ports.get('principal')!.id, copy1Target.id);
  }
  if (copy2Target) {
    connect(net, fact2.ports.get('principal')!.id, copy2Target.id);
  }

  return true;
}

// Era >< Fact: Erase the fact
function ruleEraFact(net: Net, era: Agent, fact: Agent, wireId: string): boolean {
  if (era.type !== 'Era') [era, fact] = [fact, era] as [Agent, Agent];
  if (era.type !== 'Era' || fact.type !== 'Fact') return false;

  // Just remove both
  removeWire(net, wireId);
  removeAgent(net, era.id);
  removeAgent(net, fact.id);
  return true;
}

// Fact >< Match: Pattern matching!
//
// This is the core query operation.
//
//                result_out --> Val(bindings) or Era (no match)
//                    |
// Fact--●--Match    =>    (agents consumed)
//
function ruleFactMatch(net: Net, fact: Agent, match: Agent, wireId: string): boolean {
  if (fact.type !== 'Fact') [fact, match] = [match, fact] as [Agent, Agent];
  if (fact.type !== 'Fact' || match.type !== 'Match') return false;

  const factData = fact.data as { type: 'Fact'; key: string; value: Value; scope: string };
  const matchData = match.data as {
    type: 'Match';
    keyPattern: Pattern;
    valuePattern: Pattern;
  };

  // Get connected ports before removing
  const resultPort = match.ports.get('result_out')!;
  const scopePort = match.ports.get('scope_in')!;
  const resultTarget = followWire(net, resultPort);
  const scopeSource = followWire(net, scopePort);

  // Check scope constraint if connected
  let scopeOk = true;
  if (scopeSource) {
    const scopeAgent = net.agents.get(scopeSource.agent);
    if (scopeAgent?.type === 'Scope') {
      const scopeData = scopeAgent.data as { type: 'Scope'; scope: string | null };
      if (scopeData.scope !== null && scopeData.scope !== factData.scope) {
        scopeOk = false;
      }
    }
  }

  // Try to match
  let bindings: Bindings | null = new Map();

  if (scopeOk) {
    bindings = matchPattern(matchData.keyPattern, factData.key, bindings);
    if (bindings) {
      bindings = matchPattern(matchData.valuePattern, factData.value, bindings);
    }
    // Add scope to bindings
    if (bindings) {
      bindings.set('_scope', factData.scope);
    }
  } else {
    bindings = null;
  }

  // Remove the interacting agents
  removeWire(net, wireId);
  if (resultPort.wire) removeWire(net, resultPort.wire);
  if (scopePort.wire) removeWire(net, scopePort.wire);
  removeAgent(net, fact.id);
  removeAgent(net, match.id);

  // Emit result
  if (resultTarget) {
    if (bindings) {
      // Create a Val agent carrying the bindings (encoded as JSON for now)
      const resultVal = createVal(net, JSON.stringify(Object.fromEntries(bindings)));
      connect(net, resultVal.ports.get('principal')!.id, resultTarget.id);
    } else {
      // No match - send Era to clean up
      const era = createEra(net);
      connect(net, era.ports.get('principal')!.id, resultTarget.id);
    }
  }

  return true;
}

// Dup >< Dup: Annihilation (same level) or commutation
function ruleDupDup(net: Net, dup1: Agent, dup2: Agent, _wireId: string): boolean {
  // Simple annihilation - cross-connect auxiliary ports
  const dup1Copy1 = followWire(net, dup1.ports.get('copy1')!);
  const dup1Copy2 = followWire(net, dup1.ports.get('copy2')!);
  const dup2Copy1 = followWire(net, dup2.ports.get('copy1')!);
  const dup2Copy2 = followWire(net, dup2.ports.get('copy2')!);

  // Remove all wires and agents
  for (const port of dup1.ports.values()) {
    if (port.wire) removeWire(net, port.wire);
  }
  for (const port of dup2.ports.values()) {
    if (port.wire) removeWire(net, port.wire);
  }
  removeAgent(net, dup1.id);
  removeAgent(net, dup2.id);

  // Cross-connect
  if (dup1Copy1 && dup2Copy1) connect(net, dup1Copy1.id, dup2Copy1.id);
  if (dup1Copy2 && dup2Copy2) connect(net, dup1Copy2.id, dup2Copy2.id);

  return true;
}

// Dup >< Era: Duplicate the eraser
function ruleDupEra(net: Net, dup: Agent, era: Agent, _wireId: string): boolean {
  if (dup.type !== 'Dup') [dup, era] = [era, dup] as [Agent, Agent];
  if (dup.type !== 'Dup' || era.type !== 'Era') return false;

  const copy1Target = followWire(net, dup.ports.get('copy1')!);
  const copy2Target = followWire(net, dup.ports.get('copy2')!);

  // Remove originals
  for (const port of dup.ports.values()) {
    if (port.wire) removeWire(net, port.wire);
  }
  removeAgent(net, dup.id);
  removeAgent(net, era.id);

  // Create two erasers
  if (copy1Target) {
    const era1 = createEra(net);
    connect(net, era1.ports.get('principal')!.id, copy1Target.id);
  }
  if (copy2Target) {
    const era2 = createEra(net);
    connect(net, era2.ports.get('principal')!.id, copy2Target.id);
  }

  return true;
}

// Era >< Era: Both disappear
function ruleEraEra(net: Net, era1: Agent, era2: Agent, wireId: string): boolean {
  removeWire(net, wireId);
  removeAgent(net, era1.id);
  removeAgent(net, era2.id);
  return true;
}

// Val >< Var: Bind the variable
function ruleValVar(net: Net, val: Agent, var_: Agent, _wireId: string): boolean {
  if (val.type !== 'Val') [val, var_] = [var_, val] as [Agent, Agent];
  if (val.type !== 'Val' || var_.type !== 'Var') return false;

  // Get the Var's reference port target
  const refTarget = followWire(net, var_.ports.get('ref')!);

  // Remove originals - use the principal port's wire
  const principalWire = val.ports.get('principal')!.wire;
  if (principalWire) removeWire(net, principalWire);
  if (var_.ports.get('ref')!.wire) removeWire(net, var_.ports.get('ref')!.wire!);
  removeAgent(net, var_.id);

  // The Val now connects to wherever the Var's ref pointed
  if (refTarget) {
    const valPort = val.ports.get('principal')!;
    // Val is already disconnected from the removed wire
    connect(net, valPort.id, refTarget.id);
  } else {
    removeAgent(net, val.id);
  }

  return true;
}

// Join >< Val: Accumulate result
function ruleJoinVal(net: Net, join: Agent, val: Agent, _wireId: string): boolean {
  if (join.type !== 'Join') [join, val] = [val, join] as [Agent, Agent];
  if (join.type !== 'Join' || val.type !== 'Val') return false;

  const joinData = join.data as {
    type: 'Join';
    arity: number;
    received: number;
    bindings: Bindings;
  };
  const valData = val.data as { type: 'Val'; value: Value };

  // Parse the incoming bindings
  const incomingBindings: Bindings = new Map(
    Object.entries(JSON.parse(valData.value as string))
  );

  // Merge bindings
  for (const [k, v] of incomingBindings) {
    const existing = joinData.bindings.get(k);
    if (existing !== undefined && existing !== v) {
      // Conflict! This join fails
      // Remove everything and emit Era
      const resultTarget = followWire(net, join.ports.get('result_out')!);
      for (const port of join.ports.values()) {
        if (port.wire) removeWire(net, port.wire);
      }
      removeAgent(net, join.id);
      removeAgent(net, val.id);

      if (resultTarget) {
        const era = createEra(net);
        connect(net, era.ports.get('principal')!.id, resultTarget.id);
      }
      return true;
    }
    joinData.bindings.set(k, v);
  }

  joinData.received++;
  // Remove the wire connecting val to join
  const valPrincipal = val.ports.get('principal')!;
  if (valPrincipal.wire) removeWire(net, valPrincipal.wire);
  removeAgent(net, val.id);

  // Check if all inputs received
  if (joinData.received >= joinData.arity) {
    const resultTarget = followWire(net, join.ports.get('result_out')!);

    for (const port of join.ports.values()) {
      if (port.wire) removeWire(net, port.wire);
    }
    removeAgent(net, join.id);

    if (resultTarget) {
      const resultVal = createVal(net, JSON.stringify(Object.fromEntries(joinData.bindings)));
      connect(net, resultVal.ports.get('principal')!.id, resultTarget.id);
    }
  }

  return true;
}

// ============ Reduction Engine ============

// Reduce the net until no more active pairs
export function reduce(net: Net, maxSteps = 10000): number {
  let steps = 0;

  while (steps < maxSteps) {
    const pairs = findActivePairs(net);
    if (pairs.length === 0) break;

    // Reduce first active pair (could parallelize in real implementation)
    const applied = interact(net, pairs[0]);
    if (!applied) {
      // No rule for this pair, skip it
      // In a real system we'd track this to avoid infinite loops
      break;
    }
    steps++;
  }

  return steps;
}

// Find active pairs
function findActivePairs(net: Net): ActivePair[] {
  const pairs: ActivePair[] = [];
  const seen = new Set<string>();

  for (const wire of net.wires.values()) {
    if (seen.has(wire.id)) continue;
    seen.add(wire.id);

    const port1 = net.ports.get(wire.ports[0]);
    const port2 = net.ports.get(wire.ports[1]);
    if (!port1 || !port2) continue;

    if (port1.isPrincipal && port2.isPrincipal) {
      const agent1 = net.agents.get(port1.agent);
      const agent2 = net.agents.get(port2.agent);
      if (agent1 && agent2) {
        pairs.push({ wire, agent1, agent2 });
      }
    }
  }

  return pairs;
}
