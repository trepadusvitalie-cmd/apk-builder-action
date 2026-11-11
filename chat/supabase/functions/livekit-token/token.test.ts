// Rulare: node --test chat/supabase/functions/livekit-token/token.test.ts  (Node 22.18+)
//     sau: deno test chat/supabase/functions/livekit-token/token.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mintLiveKitToken } from "./token.ts";

test("tokenul are semnătură HS256 validă și drepturi doar pentru camera cerută", async () => {
  const token = await mintLiveKitToken({
    apiKey: "APIkey",
    apiSecret: "secret-de-test",
    room: "call_abc",
    identity: "user-1",
    name: "Ana Țurcanu",
    ttlSeconds: 600,
    now: 1_700_000_000,
  });

  const [header, payload, signature] = token.split(".");
  const expected = createHmac("sha256", "secret-de-test").update(`${header}.${payload}`).digest("base64url");
  assert.equal(signature, expected);

  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "HS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.iss, "APIkey");
  assert.equal(claims.sub, "user-1");
  assert.equal(claims.name, "Ana Țurcanu");
  assert.equal(claims.exp, 1_700_000_600);
  assert.equal(claims.video.room, "call_abc");
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.roomAdmin, undefined);
});
