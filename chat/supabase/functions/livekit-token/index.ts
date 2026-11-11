// Edge Function: POST /functions/v1/livekit-token  { "call_id": "<uuid>" }
//
// Verifică utilizatorul (JWT Supabase), întreabă baza de date dacă are voie în
// apel (RPC join_call — singura sursă de adevăr) și abia apoi emite un token
// LiveKit cu valabilitate scurtă, valabil doar pentru camera acelui apel.
// Secretul LiveKit nu ajunge niciodată în aplicație.
import { createClient } from "npm:@supabase/supabase-js@2";
import { mintLiveKitToken } from "./token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "not_authenticated" }, 401);

  const livekitUrl = Deno.env.get("LIVEKIT_URL");
  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!livekitUrl || !apiKey || !apiSecret) {
    console.error("LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET nu sunt setate");
    return json({ error: "server_not_configured" }, 500);
  }

  let callId: unknown;
  try {
    callId = (await req.json())?.call_id;
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (typeof callId !== "string" || !UUID.test(callId)) return json({ error: "invalid_call_id" }, 400);

  // Client cu identitatea utilizatorului: RLS și auth.uid() se aplică normal.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc("join_call", { p_call_id: callId });
  if (error) {
    const known = ["forbidden", "call_ended", "call_locked"].find((code) => error.message.includes(code));
    if (known) return json({ error: known }, known === "forbidden" ? 403 : 409);
    console.error("join_call a eșuat:", error.message);
    return json({ error: "internal_error" }, 500);
  }
  const grant = Array.isArray(data) ? data[0] : data;
  if (!grant) return json({ error: "forbidden" }, 403);

  const token = await mintLiveKitToken({
    apiKey,
    apiSecret,
    room: grant.room_name,
    identity: grant.identity,
    name: grant.display_name,
    ttlSeconds: 600,
  });

  return json({ token, url: livekitUrl, room: grant.room_name, kind: grant.kind });
});
