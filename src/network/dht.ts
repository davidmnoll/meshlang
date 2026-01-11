import type { PeerInfo } from './protocol';

// Kademlia-style DHT for peer discovery
// Node IDs are derived from public keys

const K = 20; // Bucket size
// const ALPHA = 3; // Parallelism factor (for future iterative lookups)

function xorDistance(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(Math.min(a.length, b.length));
  for (let i = 0; i < result.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

function compareDistance(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function bucketIndex(distance: Uint8Array): number {
  for (let i = 0; i < distance.length; i++) {
    if (distance[i] !== 0) {
      // Find the highest set bit
      let bit = 7;
      while (bit >= 0 && ((distance[i] >> bit) & 1) === 0) {
        bit--;
      }
      return i * 8 + (7 - bit);
    }
  }
  return distance.length * 8 - 1;
}

interface DHTNode {
  nodeId: Uint8Array;
  info: PeerInfo;
  lastSeen: number;
}

export class DHT {
  private buckets: DHTNode[][] = [];
  private localId: Uint8Array;

  constructor(localNodeId: Uint8Array) {
    this.localId = localNodeId;
    // Initialize 256 buckets (for 256-bit node IDs)
    for (let i = 0; i < 256; i++) {
      this.buckets[i] = [];
    }
  }

  private nodeIdToBytes(nodeId: string): Uint8Array {
    // Convert base64url node ID to bytes
    const base64 = nodeId.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  addPeer(info: PeerInfo): void {
    const nodeId = this.nodeIdToBytes(info.nodeId);
    const distance = xorDistance(this.localId, nodeId);
    const bucket = bucketIndex(distance);

    // Check if peer already exists
    const existing = this.buckets[bucket].findIndex(
      (n) => n.info.nodeId === info.nodeId
    );

    if (existing >= 0) {
      // Update last seen
      this.buckets[bucket][existing].lastSeen = Date.now();
      return;
    }

    // Add to bucket if not full
    if (this.buckets[bucket].length < K) {
      this.buckets[bucket].push({
        nodeId,
        info,
        lastSeen: Date.now(),
      });
    } else {
      // Bucket is full - could implement LRU eviction here
      // For now, just skip
    }
  }

  removePeer(nodeId: string): void {
    const nodeIdBytes = this.nodeIdToBytes(nodeId);
    const distance = xorDistance(this.localId, nodeIdBytes);
    const bucket = bucketIndex(distance);

    const index = this.buckets[bucket].findIndex(
      (n) => n.info.nodeId === nodeId
    );

    if (index >= 0) {
      this.buckets[bucket].splice(index, 1);
    }
  }

  findClosest(targetNodeId: string, count: number = K): PeerInfo[] {
    const targetBytes = this.nodeIdToBytes(targetNodeId);

    // Collect all peers with their distances
    const peers: Array<{ distance: Uint8Array; info: PeerInfo }> = [];

    for (const bucket of this.buckets) {
      for (const node of bucket) {
        peers.push({
          distance: xorDistance(targetBytes, node.nodeId),
          info: node.info,
        });
      }
    }

    // Sort by distance
    peers.sort((a, b) => compareDistance(a.distance, b.distance));

    // Return closest
    return peers.slice(0, count).map((p) => p.info);
  }

  getAllPeers(): PeerInfo[] {
    const result: PeerInfo[] = [];
    for (const bucket of this.buckets) {
      for (const node of bucket) {
        result.push(node.info);
      }
    }
    return result;
  }

  getPeerCount(): number {
    let count = 0;
    for (const bucket of this.buckets) {
      count += bucket.length;
    }
    return count;
  }
}
