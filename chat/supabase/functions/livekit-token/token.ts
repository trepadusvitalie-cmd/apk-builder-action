// Emite un token de acces LiveKit (JWT HS256) folosind doar WebCrypto.
// Fără dependențe, ca să poată fi testat separat (vezi token.test.ts).

export interface TokenInput {
  apiKey: string;
  apiSecret: string;
  room: string;
  identity: string;
  name: string;
  /** Valabilitatea token-ului în secunde. Tokenul e folosit doar la intrare. */
  ttlSeconds?: number;
  /** Momentul emiterii (secunde Unix); implicit acum. */
  now?: number;
}

const encoder = new TextEncoder();

function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function mintLiveKitToken(input: TokenInput): Promise<string> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: input.apiKey,
    sub: input.identity,
    name: input.name,
    nbf: now - 5,
    exp: now + (input.ttlSeconds ?? 600),
    video: {
      room: input.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput)));
  return `${signingInput}.${base64url(signature)}`;
}
