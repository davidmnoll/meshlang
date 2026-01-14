import type { SerializedFact } from '../datalog/serialize';

export type Message =
  | { type: 'hello'; nodeId: string; publicKey: string }
  | { type: 'sync-request'; haveIds: string[] }
  | { type: 'sync-response'; facts: SerializedFact[] }
  | { type: 'fact-add'; fact: SerializedFact }
  | { type: 'peer-announce'; peers: PeerInfo[] }
  // Scope-based queries (pull model)
  | { type: 'scope-query'; scopes: ScopeQuery[] }  // Request specific scopes by hash
  | { type: 'scope-response'; scopes: ScopeData[] }  // Response with scope facts
  | { type: 'scope-hashes'; hashes: Record<string, string> }  // Broadcast scope hashes for comparison
  // Group messages (legacy - to be replaced by scope-based consensus)
  | { type: 'group-invite'; groupId: string; groupName: string; from: string; members: string[] }
  | { type: 'group-invite-response'; groupId: string; accepted: boolean; from: string }
  | { type: 'group-proposal'; groupId: string; proposalId: string; fact: SerializedFact; from: string }
  | { type: 'group-vote'; groupId: string; proposalId: string; vote: boolean; from: string }
  | { type: 'group-sync-request'; groupId: string; haveIds: string[] }
  | { type: 'group-sync-response'; groupId: string; facts: SerializedFact[] };

// Scope query - request a scope if our hash differs
export interface ScopeQuery {
  scope: string;
  knownHash: string;  // Hash we have (empty if we don't have it)
}

// Scope data - response with scope contents
export interface ScopeData {
  scope: string;
  hash: string;
  facts: SerializedFact[];
}

export interface PeerInfo {
  nodeId: string;
  publicKey: string;
}

export interface GroupInfo {
  id: string;
  name: string;
  members: string[];  // nodeIds
  consensus: 'unanimous' | 'majority' | { threshold: number };
}

export function encodeMessage(msg: Message): string {
  return JSON.stringify(msg);
}

export function decodeMessage(data: string): Message {
  return JSON.parse(data) as Message;
}
