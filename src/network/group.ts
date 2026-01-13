// Group Manager
//
// Handles group memberships, invitations, and consensus-based updates

import type { DatalogStore } from '../datalog/store';
import type { StoredFact } from '../datalog/types';
import { serializeFact, deserializeFact } from '../datalog/serialize';
import type { GroupInfo, Message } from './protocol';

export interface Proposal {
  id: string;
  groupId: string;
  fact: StoredFact;
  from: string;
  votes: Map<string, boolean>;  // nodeId -> vote
  timestamp: number;
}

export interface PendingInvite {
  groupId: string;
  groupName: string;
  from: string;
  members: string[];
  timestamp: number;
}

export class GroupManager {
  private groups: Map<string, GroupInfo> = new Map();
  private proposals: Map<string, Proposal> = new Map();
  private pendingInvites: Map<string, PendingInvite> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor(
    private nodeId: string,
    private store: DatalogStore,
    private sendToNode: (nodeId: string, msg: Message) => void
  ) {}

  // Create a new group (this node is the creator)
  createGroup(groupId: string, name: string, consensus: GroupInfo['consensus'] = 'unanimous'): GroupInfo {
    const group: GroupInfo = {
      id: groupId,
      name,
      members: [this.nodeId],
      consensus,
    };
    this.groups.set(groupId, group);
    this.notifyListeners();
    return group;
  }

  // Invite a peer to a group
  invitePeer(groupId: string, peerId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;
    if (group.members.includes(peerId)) return false;

    // Send invitation
    this.sendToNode(peerId, {
      type: 'group-invite',
      groupId: group.id,
      groupName: group.name,
      from: this.nodeId,
      members: group.members,
    });

    return true;
  }

  // Handle incoming group invitation
  handleInvite(msg: Extract<Message, { type: 'group-invite' }>): void {
    this.pendingInvites.set(msg.groupId, {
      groupId: msg.groupId,
      groupName: msg.groupName,
      from: msg.from,
      members: msg.members,
      timestamp: Date.now(),
    });
    this.notifyListeners();
  }

  // Accept or reject an invitation
  respondToInvite(groupId: string, accept: boolean): void {
    const invite = this.pendingInvites.get(groupId);
    if (!invite) return;

    this.pendingInvites.delete(groupId);

    if (accept) {
      // Join the group
      const group: GroupInfo = {
        id: groupId,
        name: invite.groupName,
        members: [...invite.members, this.nodeId],
        consensus: 'unanimous',  // Default
      };
      this.groups.set(groupId, group);

      // Request sync of group scope
      for (const memberId of invite.members) {
        this.sendToNode(memberId, {
          type: 'group-sync-request',
          groupId,
          haveIds: [],
        });
      }
    }

    // Notify all existing members of acceptance/rejection
    for (const memberId of invite.members) {
      this.sendToNode(memberId, {
        type: 'group-invite-response',
        groupId,
        accepted: accept,
        from: this.nodeId,
      });
    }

    this.notifyListeners();
  }

  // Handle invitation response
  handleInviteResponse(msg: Extract<Message, { type: 'group-invite-response' }>): void {
    if (!msg.accepted) return;

    const group = this.groups.get(msg.groupId);
    if (!group) return;

    // Add new member
    if (!group.members.includes(msg.from)) {
      group.members.push(msg.from);
      this.notifyListeners();
    }
  }

  // Propose a fact change to a group (requires consensus)
  proposeFact(groupId: string, fact: StoredFact): string | null {
    const group = this.groups.get(groupId);
    if (!group) return null;

    const proposalId = `proposal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const proposal: Proposal = {
      id: proposalId,
      groupId,
      fact,
      from: this.nodeId,
      votes: new Map([[this.nodeId, true]]),  // Creator votes yes
      timestamp: Date.now(),
    };

    this.proposals.set(proposalId, proposal);

    // Send proposal to all group members
    const serialized = serializeFact(fact);
    for (const memberId of group.members) {
      if (memberId !== this.nodeId) {
        this.sendToNode(memberId, {
          type: 'group-proposal',
          groupId,
          proposalId,
          fact: serialized,
          from: this.nodeId,
        });
      }
    }

    // Check if already passed (single member group)
    this.checkProposalConsensus(proposalId);

    return proposalId;
  }

  // Handle incoming proposal
  handleProposal(msg: Extract<Message, { type: 'group-proposal' }>): void {
    const group = this.groups.get(msg.groupId);
    if (!group) return;

    const fact = deserializeFact(msg.fact);
    const proposal: Proposal = {
      id: msg.proposalId,
      groupId: msg.groupId,
      fact,
      from: msg.from,
      votes: new Map([[msg.from, true]]),
      timestamp: Date.now(),
    };

    this.proposals.set(msg.proposalId, proposal);
    this.notifyListeners();
  }

  // Vote on a proposal
  vote(proposalId: string, approve: boolean): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return;

    proposal.votes.set(this.nodeId, approve);

    // Notify other members
    const group = this.groups.get(proposal.groupId);
    if (group) {
      for (const memberId of group.members) {
        if (memberId !== this.nodeId) {
          this.sendToNode(memberId, {
            type: 'group-vote',
            groupId: proposal.groupId,
            proposalId,
            vote: approve,
            from: this.nodeId,
          });
        }
      }
    }

    this.checkProposalConsensus(proposalId);
  }

  // Handle incoming vote
  handleVote(msg: Extract<Message, { type: 'group-vote' }>): void {
    const proposal = this.proposals.get(msg.proposalId);
    if (!proposal) return;

    proposal.votes.set(msg.from, msg.vote);
    this.checkProposalConsensus(msg.proposalId);
    this.notifyListeners();
  }

  // Check if proposal has reached consensus
  private checkProposalConsensus(proposalId: string): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return;

    const group = this.groups.get(proposal.groupId);
    if (!group) return;

    const totalMembers = group.members.length;
    const votes = Array.from(proposal.votes.values());
    const yesVotes = votes.filter((v) => v).length;
    const noVotes = votes.filter((v) => !v).length;

    let passed = false;
    let rejected = false;

    if (group.consensus === 'unanimous') {
      passed = yesVotes === totalMembers;
      rejected = noVotes > 0;
    } else if (group.consensus === 'majority') {
      passed = yesVotes > totalMembers / 2;
      rejected = noVotes > totalMembers / 2;
    } else if (typeof group.consensus === 'object' && 'threshold' in group.consensus) {
      passed = yesVotes >= group.consensus.threshold;
      rejected = noVotes > totalMembers - group.consensus.threshold;
    }

    if (passed) {
      // Apply the fact to the group scope
      this.store.addStored(proposal.fact);
      this.proposals.delete(proposalId);
      this.notifyListeners();
    } else if (rejected) {
      // Remove rejected proposal
      this.proposals.delete(proposalId);
      this.notifyListeners();
    }
  }

  // Handle group sync request
  handleSyncRequest(msg: Extract<Message, { type: 'group-sync-request' }>): void {
    const group = this.groups.get(msg.groupId);
    if (!group) return;

    // Find facts in the group's root scope
    const groupRootScope = `${msg.groupId}:root`;
    const haveSet = new Set(msg.haveIds);
    const facts = this.store
      .findByScope(groupRootScope)
      .filter((f) => !haveSet.has(f.id))
      .map(serializeFact);

    // Send back to requester (we'd need the sender's nodeId)
    // For now, broadcast to all members
    for (const memberId of group.members) {
      this.sendToNode(memberId, {
        type: 'group-sync-response',
        groupId: msg.groupId,
        facts,
      });
    }
  }

  // Handle group sync response
  handleSyncResponse(msg: Extract<Message, { type: 'group-sync-response' }>): void {
    for (const factData of msg.facts) {
      const fact = deserializeFact(factData);
      this.store.addStored(fact);
    }
    this.notifyListeners();
  }

  // Get all groups this node is a member of
  getGroups(): GroupInfo[] {
    return Array.from(this.groups.values());
  }

  // Get pending invitations
  getPendingInvites(): PendingInvite[] {
    return Array.from(this.pendingInvites.values());
  }

  // Get pending proposals for a group
  getProposals(groupId?: string): Proposal[] {
    const all = Array.from(this.proposals.values());
    return groupId ? all.filter((p) => p.groupId === groupId) : all;
  }

  // Get group by ID
  getGroup(groupId: string): GroupInfo | undefined {
    return this.groups.get(groupId);
  }

  // Check if this node is in a group
  isInGroup(groupId: string): boolean {
    return this.groups.has(groupId);
  }

  // Get group root scope ID
  getGroupRootScope(groupId: string): string {
    return `${groupId}:root`;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
