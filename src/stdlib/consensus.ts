// Standard Library: Consensus Constructors
//
// These constructors define the pattern for consensus-based group state.
// The consensus mechanism works through facts, not hardcoded logic:
//
// 1. Groups have members and a state with a content hash
// 2. Proposals reference the current state hash and propose changes
// 3. Votes are collected in the proposal scope
// 4. When consensus is reached, the state is updated (manually for now)
//
// The mesh handles visibility-based routing:
// - Facts in peer(X)/outbox are visible to peer X
// - Facts in group scopes are visible to all members

import type { ConstructorDef } from '../expr/types';

// ============ Group Structure ============

export const GROUP_CONSTRUCTORS: ConstructorDef[] = [
  // Group definition - contains members and state
  {
    name: 'group',
    params: [{ name: 'name', type: 'string' }],
    description: 'Group with consensus-based shared state',
    allowedChildren: ['member', 'rule', 'state', 'proposal'],
  },

  // Member of a group (by public key)
  {
    name: 'member',
    params: [{ name: 'pubkey', type: 'string' }],
    description: 'Group member by public key',
    allowedChildren: [],
  },

  // Consensus rule for the group
  {
    name: 'rule',
    params: [],
    description: 'Consensus rule (default: unanimous)',
    allowedChildren: ['unanimous', 'majority', 'threshold'],
  },

  // Group state - content-addressed
  {
    name: 'state',
    params: [],
    description: 'Current group state (content-addressed)',
    allowedChildren: undefined,  // any facts allowed in state
  },
];

// ============ Proposal Structure ============

export const PROPOSAL_CONSTRUCTORS: ConstructorDef[] = [
  // Proposal to change group state
  {
    name: 'proposal',
    params: [{ name: 'id', type: 'string' }],
    description: 'Proposal to change group state',
    allowedChildren: ['from', 'base', 'change', 'vote'],
  },

  // Who created the proposal
  {
    name: 'from',
    params: [{ name: 'pubkey', type: 'string' }],
    description: 'Proposal author',
    allowedChildren: [],
  },

  // Base state hash (must match current for proposal to be valid)
  {
    name: 'base',
    params: [{ name: 'hash', type: 'string' }],
    description: 'Base state hash (current state when proposed)',
    allowedChildren: [],
  },

  // The proposed change
  {
    name: 'change',
    params: [],
    description: 'The proposed change to state',
    allowedChildren: undefined,  // any facts can be the change
  },

  // Vote on a proposal
  {
    name: 'vote',
    params: [{ name: 'voter', type: 'string' }],
    description: 'Vote on proposal (by public key)',
    allowedChildren: ['approve', 'sig'],
  },

  // Vote approval (true/false)
  {
    name: 'approve',
    params: [{ name: 'value', type: 'boolean' }],
    description: 'Approval vote',
    allowedChildren: [],
  },

  // Cryptographic signature
  {
    name: 'sig',
    params: [{ name: 'signature', type: 'string' }],
    description: 'Cryptographic signature',
    allowedChildren: [],
  },
];

// ============ Messaging ============

export const MESSAGING_CONSTRUCTORS: ConstructorDef[] = [
  // Outbox for sending messages to a peer
  {
    name: 'outbox',
    params: [],
    description: 'Messages to send to this peer',
    allowedChildren: ['proposal', 'vote', 'msg'],
  },

  // Inbox for received messages (populated by mesh)
  {
    name: 'inbox',
    params: [],
    description: 'Messages received from this peer',
    allowedChildren: ['proposal', 'vote', 'msg'],
  },

  // Generic message
  {
    name: 'msg',
    params: [{ name: 'id', type: 'string' }],
    description: 'Generic message',
    allowedChildren: undefined,
  },
];

// ============ All Standard Library Constructors ============

export const STDLIB_CONSTRUCTORS: ConstructorDef[] = [
  ...GROUP_CONSTRUCTORS,
  ...PROPOSAL_CONSTRUCTORS,
  ...MESSAGING_CONSTRUCTORS,
];

// ============ Helper Functions ============

// Check if all required votes are present for unanimous consensus
export function hasUnanimousConsensus(
  members: string[],
  votes: Map<string, boolean>
): { reached: boolean; approved: boolean } {
  if (votes.size < members.length) {
    return { reached: false, approved: false };
  }

  const approved = members.every((m) => votes.get(m) === true);
  return { reached: true, approved };
}

// Check if majority consensus is reached
export function hasMajorityConsensus(
  members: string[],
  votes: Map<string, boolean>
): { reached: boolean; approved: boolean } {
  const yesVotes = Array.from(votes.values()).filter((v) => v === true).length;
  const noVotes = Array.from(votes.values()).filter((v) => v === false).length;
  const majority = Math.floor(members.length / 2) + 1;

  if (yesVotes >= majority) {
    return { reached: true, approved: true };
  }
  if (noVotes >= majority) {
    return { reached: true, approved: false };
  }
  return { reached: false, approved: false };
}

// Check if threshold consensus is reached
export function hasThresholdConsensus(
  members: string[],
  votes: Map<string, boolean>,
  threshold: number
): { reached: boolean; approved: boolean } {
  const yesVotes = Array.from(votes.values()).filter((v) => v === true).length;
  const noVotes = Array.from(votes.values()).filter((v) => v === false).length;
  const rejectThreshold = members.length - threshold + 1;

  if (yesVotes >= threshold) {
    return { reached: true, approved: true };
  }
  if (noVotes >= rejectThreshold) {
    return { reached: true, approved: false };
  }
  return { reached: false, approved: false };
}
