// Interaction Net Operations

import type {
  Net, Agent, AgentId, Port, PortId, Wire, WireId,
  AgentType, AgentData, ActivePair, Value, Pattern, Bindings
} from './types';

let idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_${++idCounter}`;
}

// Create an empty net
export function createNet(): Net {
  return {
    agents: new Map(),
    wires: new Map(),
    ports: new Map(),
  };
}

// Create a port
function createPort(agent: AgentId, name: string, isPrincipal: boolean): Port {
  return {
    id: genId('p'),
    agent,
    name,
    isPrincipal,
    wire: null,
  };
}

// Create an agent with specified ports
export function createAgent(
  net: Net,
  type: AgentType,
  data: AgentData,
  portNames: string[]  // First one is principal
): Agent {
  const id = genId('a');
  const ports = new Map<string, Port>();

  for (let i = 0; i < portNames.length; i++) {
    const port = createPort(id, portNames[i], i === 0);
    ports.set(portNames[i], port);
    net.ports.set(port.id, port);
  }

  const agent: Agent = { id, type, ports, data };
  net.agents.set(id, agent);
  return agent;
}

// Connect two ports with a wire
export function connect(net: Net, portId1: PortId, portId2: PortId): Wire {
  const port1 = net.ports.get(portId1);
  const port2 = net.ports.get(portId2);
  if (!port1 || !port2) throw new Error('Port not found');

  const wire: Wire = {
    id: genId('w'),
    ports: [portId1, portId2],
  };

  port1.wire = wire.id;
  port2.wire = wire.id;
  net.wires.set(wire.id, wire);
  return wire;
}

// Get the port on the other end of a wire
export function followWire(net: Net, port: Port): Port | null {
  if (!port.wire) return null;
  const wire = net.wires.get(port.wire);
  if (!wire) return null;
  const otherId = wire.ports[0] === port.id ? wire.ports[1] : wire.ports[0];
  return net.ports.get(otherId) || null;
}

// Find all active pairs (principal ports connected)
export function findActivePairs(net: Net): ActivePair[] {
  const pairs: ActivePair[] = [];
  const seen = new Set<WireId>();

  for (const wire of net.wires.values()) {
    if (seen.has(wire.id)) continue;
    seen.add(wire.id);

    const port1 = net.ports.get(wire.ports[0]);
    const port2 = net.ports.get(wire.ports[1]);
    if (!port1 || !port2) continue;

    // Active pair = both ports are principal
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

// Remove an agent and its ports
export function removeAgent(net: Net, agentId: AgentId): void {
  const agent = net.agents.get(agentId);
  if (!agent) return;

  for (const port of agent.ports.values()) {
    if (port.wire) {
      const wire = net.wires.get(port.wire);
      if (wire) {
        // Disconnect the other port
        const otherId = wire.ports[0] === port.id ? wire.ports[1] : wire.ports[0];
        const otherPort = net.ports.get(otherId);
        if (otherPort) otherPort.wire = null;
        net.wires.delete(wire.id);
      }
    }
    net.ports.delete(port.id);
  }

  net.agents.delete(agentId);
}

// Remove a wire
export function removeWire(net: Net, wireId: WireId): void {
  const wire = net.wires.get(wireId);
  if (!wire) return;

  for (const portId of wire.ports) {
    const port = net.ports.get(portId);
    if (port) port.wire = null;
  }

  net.wires.delete(wireId);
}

// ============ Agent Constructors ============

export function createFact(
  net: Net,
  key: string,
  value: Value,
  scope: string
): Agent {
  // Fact has: principal, scope_out, key_out, value_out
  return createAgent(net, 'Fact', { type: 'Fact', key, value, scope }, [
    'principal',
    'scope_out',
    'key_out',
    'value_out',
  ]);
}

export function createMatch(
  net: Net,
  keyPattern: Pattern,
  valuePattern: Pattern
): Agent {
  // Match has: principal, scope_in, result_out
  return createAgent(net, 'Match', { type: 'Match', keyPattern, valuePattern }, [
    'principal',
    'scope_in',
    'result_out',
  ]);
}

export function createJoin(net: Net, arity: number): Agent {
  // Join has: principal, input ports for each match, result_out
  const portNames = ['principal'];
  for (let i = 0; i < arity; i++) {
    portNames.push(`in_${i}`);
  }
  portNames.push('result_out');

  return createAgent(
    net,
    'Join',
    { type: 'Join', arity, received: 0, bindings: new Map() },
    portNames
  );
}

export function createVar(net: Net, name: string): Agent {
  // Var has: principal, ref (for sharing)
  return createAgent(net, 'Var', { type: 'Var', name }, ['principal', 'ref']);
}

export function createVal(net: Net, value: Value): Agent {
  return createAgent(net, 'Val', { type: 'Val', value }, ['principal']);
}

export function createDup(net: Net): Agent {
  // Dup has: principal, copy1, copy2
  return createAgent(net, 'Dup', { type: 'Dup' }, ['principal', 'copy1', 'copy2']);
}

export function createEra(net: Net): Agent {
  return createAgent(net, 'Era', { type: 'Era' }, ['principal']);
}

export function createScope(net: Net, scope: string | null): Agent {
  return createAgent(net, 'Scope', { type: 'Scope', scope }, ['principal', 'ref']);
}

export function createResult(net: Net): Agent {
  return createAgent(net, 'Result', { type: 'Result', bindings: [] }, [
    'principal',
    'collect',
  ]);
}

// ============ Pattern Helpers ============

export function lit(value: Value): Pattern {
  return { type: 'lit', value };
}

export function varPat(name: string): Pattern {
  return { type: 'var', name };
}

export function matchPattern(pattern: Pattern, value: Value, bindings: Bindings): Bindings | null {
  if (pattern.type === 'lit') {
    return pattern.value === value ? bindings : null;
  } else {
    const existing = bindings.get(pattern.name);
    if (existing !== undefined) {
      return existing === value ? bindings : null;
    }
    const newBindings = new Map(bindings);
    newBindings.set(pattern.name, value);
    return newBindings;
  }
}
