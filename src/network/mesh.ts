import type { Identity } from '../identity/types';
import type { DatalogStore } from '../datalog/store';
import { serializeFact, deserializeFact } from '../datalog/serialize';
import { Peer } from './peer';
import type { Message, PeerInfo } from './protocol';
import { GroupManager } from './group';

export class Mesh {
  private peers: Map<string, Peer> = new Map();
  private listeners: Set<() => void> = new Set();
  readonly groups: GroupManager;

  constructor(
    private identity: Identity,
    private store: DatalogStore
  ) {
    // Initialize group manager with message sending capability
    this.groups = new GroupManager(
      identity.nodeId,
      store,
      (nodeId, msg) => this.sendToNode(nodeId, msg)
    );

    // Broadcast new facts to all peers
    store.onAdd((fact) => {
      const msg: Message = { type: 'fact-add', fact: serializeFact(fact) };
      this.broadcast(msg);
    });
  }

  // Send message to a specific node
  private sendToNode(nodeId: string, msg: Message): void {
    const peer = this.peers.get(nodeId);
    if (peer && peer.getState() === 'connected') {
      peer.send(msg);
    }
  }

  private broadcast(msg: Message, excludeNodeId?: string): void {
    for (const [nodeId, peer] of this.peers) {
      if (nodeId !== excludeNodeId && peer.getState() === 'connected') {
        peer.send(msg);
      }
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private setupPeer(peer: Peer): void {
    peer.onStateChange((state) => {
      console.log('[Mesh] Peer state changed:', state, 'remoteInfo:', peer.remoteInfo?.nodeId);

      if (state === 'connected') {
        // Send hello
        console.log('[Mesh] Sending hello to peer');
        peer.send({
          type: 'hello',
          nodeId: this.identity.nodeId,
          publicKey: this.identity.publicKeyBase64,
        });

        // Request sync
        const haveIds = Array.from(this.store.allIds());
        console.log('[Mesh] Sending sync request with', haveIds.length, 'known facts');
        peer.send({ type: 'sync-request', haveIds });

        // Only notify on actual connection
        this.notifyListeners();
      }

      if (state === 'disconnected' && peer.remoteInfo) {
        console.log('[Mesh] Peer disconnected:', peer.remoteInfo.nodeId);
        this.peers.delete(peer.remoteInfo.nodeId);
        this.notifyListeners();
      }
    });

    peer.onMessage((msg) => {
      console.log('[Mesh] Received message:', msg.type);
      this.handleMessage(peer, msg);
    });
  }

  private handleMessage(peer: Peer, msg: Message): void {
    switch (msg.type) {
      case 'hello':
        peer.remoteInfo = { nodeId: msg.nodeId, publicKey: msg.publicKey };
        this.peers.set(msg.nodeId, peer);
        this.notifyListeners();
        break;

      case 'sync-request': {
        const haveSet = new Set(msg.haveIds);
        const missing = this.store
          .all()
          .filter((f) => !haveSet.has(f.id))
          .map(serializeFact);
        peer.send({ type: 'sync-response', facts: missing });
        break;
      }

      case 'sync-response':
        for (const factData of msg.facts) {
          const stored = deserializeFact(factData);
          this.store.addStored(stored);
        }
        break;

      case 'fact-add': {
        const stored = deserializeFact(msg.fact);
        if (this.store.addStored(stored)) {
          // Propagate to other peers
          this.broadcast(msg, peer.remoteInfo?.nodeId);
        }
        break;
      }

      case 'peer-announce':
        // TODO: DHT integration
        break;

      // Group messages
      case 'group-invite':
        this.groups.handleInvite(msg);
        this.notifyListeners();
        break;

      case 'group-invite-response':
        this.groups.handleInviteResponse(msg);
        this.notifyListeners();
        break;

      case 'group-proposal':
        this.groups.handleProposal(msg);
        this.notifyListeners();
        break;

      case 'group-vote':
        this.groups.handleVote(msg);
        this.notifyListeners();
        break;

      case 'group-sync-request':
        this.groups.handleSyncRequest(msg);
        break;

      case 'group-sync-response':
        this.groups.handleSyncResponse(msg);
        this.notifyListeners();
        break;
    }
  }

  async createOffer(): Promise<string> {
    console.log('[Mesh] Creating offer');
    const peer = new Peer(true);

    // Collect ICE candidates as they arrive
    const candidates: RTCIceCandidate[] = [];
    const iceDone = new Promise<void>((resolve) => {
      peer.onIceCandidate((candidate) => {
        candidates.push(candidate);
      });
      // Also listen for gathering complete
      peer.onIceGatheringComplete(() => resolve());
    });

    const offer = await peer.createOffer();
    console.log('[Mesh] Waiting for ICE candidates...');
    await iceDone;
    console.log('[Mesh] Got', candidates.length, 'ICE candidates');

    const payload = {
      type: 'offer' as const,
      nodeId: this.identity.nodeId,
      publicKey: this.identity.publicKeyBase64,
      sdp: offer,
      candidates: candidates.map((c) => c.toJSON()),
    };

    // Store peer temporarily until we get the answer
    this.peers.set('pending-offer', peer);
    this.setupPeer(peer);

    console.log('[Mesh] Offer created, waiting for answer');
    return btoa(JSON.stringify(payload));
  }

  async acceptOffer(offerBase64: string): Promise<string> {
    console.log('[Mesh] Accepting offer');
    const payload = JSON.parse(atob(offerBase64));
    console.log('[Mesh] Offer from:', payload.nodeId, 'with', payload.candidates.length, 'candidates');

    const peer = new Peer(false);

    // Set remoteInfo early so setupPeer can use it
    peer.remoteInfo = { nodeId: payload.nodeId, publicKey: payload.publicKey };

    // Collect ICE candidates as they arrive
    const candidates: RTCIceCandidate[] = [];
    const iceDone = new Promise<void>((resolve) => {
      peer.onIceCandidate((candidate) => {
        candidates.push(candidate);
      });
      peer.onIceGatheringComplete(() => resolve());
    });

    const answer = await peer.acceptOffer(payload.sdp);

    // Add remote ICE candidates after remote description is set
    console.log('[Mesh] Adding', payload.candidates.length, 'remote ICE candidates');
    for (const candidate of payload.candidates) {
      await peer.addIceCandidate(candidate);
    }

    console.log('[Mesh] Waiting for local ICE candidates...');
    await iceDone;
    console.log('[Mesh] Got', candidates.length, 'local ICE candidates');

    this.peers.set(payload.nodeId, peer);
    this.setupPeer(peer);

    const answerPayload = {
      type: 'answer' as const,
      nodeId: this.identity.nodeId,
      publicKey: this.identity.publicKeyBase64,
      sdp: answer,
      candidates: candidates.map((c) => c.toJSON()),
    };

    console.log('[Mesh] Answer created');
    return btoa(JSON.stringify(answerPayload));
  }

  async acceptAnswer(answerBase64: string): Promise<void> {
    console.log('[Mesh] Accepting answer');
    const payload = JSON.parse(atob(answerBase64));
    console.log('[Mesh] Answer from:', payload.nodeId, 'with', payload.candidates.length, 'candidates');

    // Find the pending peer
    const peer = this.peers.get('pending-offer');
    if (!peer) {
      throw new Error('No pending offer to accept answer for');
    }

    this.peers.delete('pending-offer');

    // Set remoteInfo early so setupPeer handlers can use it
    peer.remoteInfo = { nodeId: payload.nodeId, publicKey: payload.publicKey };
    this.peers.set(payload.nodeId, peer);

    await peer.acceptAnswer(payload.sdp);

    // Add remote ICE candidates after remote description is set
    console.log('[Mesh] Adding', payload.candidates.length, 'remote ICE candidates');
    for (const candidate of payload.candidates) {
      await peer.addIceCandidate(candidate);
    }
    console.log('[Mesh] Connection established');
  }

  getPeers(): PeerInfo[] {
    const result: PeerInfo[] = [];
    for (const peer of this.peers.values()) {
      if (peer.remoteInfo && peer.getState() === 'connected') {
        result.push(peer.remoteInfo);
      }
    }
    return result;
  }

  getPeerCount(): number {
    return this.getPeers().length;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
