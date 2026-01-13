// Interaction Net Types

export type PortId = string;
export type AgentId = string;
export type WireId = string;

// A port is a connection point on an agent
export interface Port {
  id: PortId;
  agent: AgentId;
  name: string;        // 'principal' | 'aux0' | 'aux1' | etc.
  isPrincipal: boolean;
  wire: WireId | null; // Connected wire, if any
}

// A wire connects exactly two ports
export interface Wire {
  id: WireId;
  ports: [PortId, PortId];
}

// Agent types
export type AgentType =
  | 'Fact'      // Stores [key, value] in scope
  | 'Match'     // Query pattern for single [key, value]
  | 'Join'      // Combines multiple match results
  | 'Var'       // Unbound variable
  | 'Val'       // Literal value
  | 'Dup'       // Duplicator (fan-out)
  | 'Era'       // Eraser (garbage collection)
  | 'Scope'     // Scope constraint
  | 'Result';   // Query result collector

// Base agent structure
export interface Agent {
  id: AgentId;
  type: AgentType;
  ports: Map<string, Port>;  // name -> Port
  data: AgentData;
}

// Agent-specific data
export type AgentData =
  | { type: 'Fact'; key: string; value: Value; scope: string }
  | { type: 'Match'; keyPattern: Pattern; valuePattern: Pattern }
  | { type: 'Join'; arity: number; received: number; bindings: Bindings }
  | { type: 'Var'; name: string }
  | { type: 'Val'; value: Value }
  | { type: 'Dup' }
  | { type: 'Era' }
  | { type: 'Scope'; scope: string | null }  // null = variable
  | { type: 'Result'; bindings: Bindings[] };

export type Value = string | number | boolean | null;

// Pattern element: literal or variable reference
export type Pattern =
  | { type: 'lit'; value: Value }
  | { type: 'var'; name: string };

// Variable bindings
export type Bindings = Map<string, Value>;

// The interaction net itself
export interface Net {
  agents: Map<AgentId, Agent>;
  wires: Map<WireId, Wire>;
  ports: Map<PortId, Port>;
}

// An active pair: two agents connected at their principal ports
export interface ActivePair {
  wire: Wire;
  agent1: Agent;
  agent2: Agent;
}

// Result of an interaction rule
export interface RewriteResult {
  // Agents/wires to remove
  remove: {
    agents: AgentId[];
    wires: WireId[];
  };
  // Agents/wires to add
  add: {
    agents: Agent[];
    wires: Array<{ from: PortId; to: PortId }>;
  };
  // New connections to existing ports
  reconnect: Array<{ from: PortId; to: PortId }>;
}
