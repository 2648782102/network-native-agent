import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';

export function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function hashText(text) {
  return hashBytes(Buffer.from(text, 'utf8'));
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

export function generateIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyFingerprint = hashText(publicPem);
  return {
    agentId: `nna_${publicKeyFingerprint.slice(0, 16)}`,
    publicKeyFingerprint,
    publicPem,
    privatePem,
  };
}

export function identityFromPrivatePem(privatePem) {
  const privateKey = createPrivateKey(privatePem);
  const publicKey = createPublicKey(privateKey);
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const publicKeyFingerprint = hashText(publicPem);
  return {
    agentId: `nna_${publicKeyFingerprint.slice(0, 16)}`,
    publicKeyFingerprint,
    publicPem,
    privatePem,
    privateKey,
    publicKey,
  };
}

export function identityFromPublicPem(publicPem) {
  const publicKey = createPublicKey(publicPem);
  const publicKeyFingerprint = hashText(publicPem);
  return {
    agentId: `nna_${publicKeyFingerprint.slice(0, 16)}`,
    publicKeyFingerprint,
    publicPem,
    publicKey,
  };
}

function unsignedEvent(event) {
  const copy = { ...event };
  delete copy.id;
  delete copy.signature;
  return copy;
}

export function createEvent(privatePem, fields) {
  const identity = identityFromPrivatePem(privatePem);
  const unsigned = unsignedEvent({
    v: 1,
    ...fields,
    agentId: identity.agentId,
  });
  const id = hashText(canonicalJson(unsigned));
  const signature = sign(null, Buffer.from(id, 'utf8'), identity.privateKey).toString('base64');
  return { ...unsigned, id, signature };
}

export function verifyEvent(event, expectedPublicPem = null, options = {}) {
  const unsigned = unsignedEvent(event);
  const id = hashText(canonicalJson(unsigned));
  if (id !== event.id) {
    throw new Error(`event ${event.seq}: id does not match canonical content`);
  }
  const publicPem = expectedPublicPem ?? event.payload?.publicPem;
  if (!publicPem) {
    throw new Error(`event ${event.seq}: public key unavailable`);
  }
  const identity = identityFromPublicPem(publicPem);
  if (event.agentId !== identity.agentId) {
    throw new Error(`event ${event.seq}: agentId does not match public key`);
  }
  if (options.skipSignature === true) {
    return event;
  }
  const valid = verify(
    null,
    Buffer.from(event.id, 'utf8'),
    identity.publicKey,
    Buffer.from(event.signature, 'base64'),
  );
  if (!valid) {
    throw new Error(`event ${event.seq}: invalid signature`);
  }
  return event;
}

export function makeBodyId() {
  return `body_${randomUUID()}`;
}
