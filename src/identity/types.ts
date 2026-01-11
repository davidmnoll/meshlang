export type PublicKey = Uint8Array;
export type SecretKey = Uint8Array;
export type NodeId = string;

export interface KeyPair {
  publicKey: PublicKey;
  secretKey: SecretKey;
}

export interface Identity {
  keyPair: KeyPair;
  nodeId: NodeId;
  publicKeyBase64: string;
}
