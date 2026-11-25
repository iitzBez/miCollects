// WebAuthn needs the server to remember the exact challenge it handed out and check it again at
// verify time. Rather than a server-side session store (nothing like that exists in this project,
// and adding Cloudflare KV just for a ~1-minute-lived value is overkill), the challenge is handed to
// the browser inside a short-lived, HMAC-signed token that it simply echoes back -- the server
// verifies the signature + expiry instead of looking anything up.
import { bytesToB64url, strToB64url, b64urlToStr } from "./b64.js";

const TTL_MS = 5 * 60 * 1000;

async function hmacKey(env) {
  const secret = env.PASSKEY_CHALLENGE_SECRET;
  if (!secret) throw new Error("PASSKEY_CHALLENGE_SECRET is not set");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

// `extra` is bound into the signed payload (e.g. the uid a registration ceremony belongs to) so it
// can't be swapped for a different one when the token comes back.
export async function makeChallengeToken(env, challengeB64url, extra = {}) {
  const payload = JSON.stringify({ c: challengeB64url, x: extra, exp: Date.now() + TTL_MS });
  const payloadB64 = strToB64url(payload);
  const sig = await crypto.subtle.sign({ name: "HMAC" }, await hmacKey(env), new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${bytesToB64url(new Uint8Array(sig))}`;
}

export async function verifyChallengeToken(env, token) {
  const [payloadB64, sigB64] = String(token || "").split(".");
  if (!payloadB64 || !sigB64) throw new Error("Malformed challenge token");
  const sigBytes = Uint8Array.from(atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const ok = await crypto.subtle.verify({ name: "HMAC" }, await hmacKey(env), sigBytes, new TextEncoder().encode(payloadB64));
  if (!ok) throw new Error("Bad challenge token signature");
  const payload = JSON.parse(b64urlToStr(payloadB64));
  if (Date.now() > payload.exp) throw new Error("Challenge expired, please try again");
  return { challenge: payload.c, extra: payload.x };
}
