import type { SerializedFact } from '../datalog/serialize';

export type Message =
  | { type: 'hello'; nodeId: string; publicKey: string }
  | { type: 'sync-request'; haveIds: string[] }
  | { type: 'sync-response'; facts: SerializedFact[] }
  | { type: 'fact-add'; fact: SerializedFact }
  | { type: 'peer-announce'; peers: PeerInfo[] };

export interface PeerInfo {
  nodeId: string;
  publicKey: string;
}

export function encodeMessage(msg: Message): string {
  return JSON.stringify(msg);
}

export function decodeMessage(data: string): Message {
  return JSON.parse(data) as Message;
}
