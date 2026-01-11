import { decodeMessage, encodeMessage, type Message, type PeerInfo } from './protocol';

export type PeerState = 'connecting' | 'connected' | 'disconnected';

export class Peer {
  private connection: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private state: PeerState = 'connecting';
  private messageHandlers: Set<(msg: Message) => void> = new Set();
  private stateHandlers: Set<(state: PeerState) => void> = new Set();
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;

  public remoteInfo: PeerInfo | null = null;

  constructor(
    public readonly isInitiator: boolean,
    private config: RTCConfiguration = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    }
  ) {
    this.connection = new RTCPeerConnection(this.config);

    this.connection.oniceconnectionstatechange = () => {
      console.log('[Peer] ICE connection state:', this.connection.iceConnectionState);
      if (
        this.connection.iceConnectionState === 'disconnected' ||
        this.connection.iceConnectionState === 'failed'
      ) {
        this.setState('disconnected');
      }
    };

    this.connection.onconnectionstatechange = () => {
      console.log('[Peer] Connection state:', this.connection.connectionState);
    };

    this.connection.onsignalingstatechange = () => {
      console.log('[Peer] Signaling state:', this.connection.signalingState);
    };

    if (isInitiator) {
      this.channel = this.connection.createDataChannel('meshlang');
      this.setupChannel(this.channel);
    } else {
      this.connection.ondatachannel = (event) => {
        this.channel = event.channel;
        this.setupChannel(this.channel);
      };
    }
  }

  private setupChannel(channel: RTCDataChannel) {
    console.log('[Peer] Setting up data channel:', channel.label);

    channel.onopen = () => {
      console.log('[Peer] Data channel opened');
      this.setState('connected');
    };

    channel.onclose = () => {
      console.log('[Peer] Data channel closed');
      this.setState('disconnected');
    };

    channel.onerror = (e) => {
      console.error('[Peer] Data channel error:', e);
    };

    channel.onmessage = (event) => {
      try {
        const msg = decodeMessage(event.data);
        console.log('[Peer] Received message:', msg.type);
        if (msg.type === 'hello') {
          this.remoteInfo = { nodeId: msg.nodeId, publicKey: msg.publicKey };
        }
        for (const handler of this.messageHandlers) {
          handler(msg);
        }
      } catch (e) {
        console.error('Failed to decode message:', e);
      }
    };
  }

  private setState(state: PeerState) {
    this.state = state;
    for (const handler of this.stateHandlers) {
      handler(state);
    }
  }

  getState(): PeerState {
    return this.state;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    console.log('[Peer] Creating offer');
    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    console.log('[Peer] Offer created and local description set');
    return offer;
  }

  async acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    console.log('[Peer] Accepting offer');
    await this.connection.setRemoteDescription(offer);
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    console.log('[Peer] Answer created and local description set');
    return answer;
  }

  async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    console.log('[Peer] Accepting answer');
    await this.connection.setRemoteDescription(answer);
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();
    console.log('[Peer] Answer accepted, remote description set');
  }

  private async flushPendingCandidates(): Promise<void> {
    for (const candidate of this.pendingCandidates) {
      await this.connection.addIceCandidate(candidate);
    }
    this.pendingCandidates = [];
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.remoteDescriptionSet) {
      await this.connection.addIceCandidate(candidate);
    } else {
      this.pendingCandidates.push(candidate);
    }
  }

  onIceCandidate(handler: (candidate: RTCIceCandidate) => void): void {
    const existing = this.connection.onicecandidate;
    this.connection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[Peer] ICE candidate:', event.candidate.candidate?.substring(0, 50));
        handler(event.candidate);
      }
      if (existing) existing.call(this.connection, event);
    };
  }

  onIceGatheringComplete(handler: () => void): void {
    const existing = this.connection.onicecandidate;
    this.connection.onicecandidate = (event) => {
      if (existing) existing.call(this.connection, event);
      if (!event.candidate) {
        console.log('[Peer] ICE gathering complete');
        handler();
      }
    };
  }

  send(msg: Message): void {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(encodeMessage(msg));
    }
  }

  onMessage(handler: (msg: Message) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: (state: PeerState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  close(): void {
    this.channel?.close();
    this.connection.close();
    this.setState('disconnected');
  }
}
