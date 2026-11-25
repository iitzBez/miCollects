// Minimal RS256 JWT sign/verify using Workers' built-in Web Crypto -- deliberately not firebase-admin
// (which assumes a Node runtime) or a general JWT library, since this only ever needs to do two
// things: mint a Firebase custom token, and verify a Firebase ID token against Google's own public
// keys. Both are plain, documented JWT shapes (see Firebase's "Create Custom Tokens without the Admin
// SDK" and "Verify ID Tokens" docs), so a few dozen lines of Web Crypto cover it without a dependency.
import { bytesToB64url, strToB64url } from "./b64.js";

const RSA_ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

function pemToDer(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function importPrivateKey(pem) {
  return crypto.subtle.importKey("pkcs8", pemToDer(pem), RSA_ALG, false, ["sign"]);
}

export async function signRS256(payload, privateKey) {
  const header = { alg: "RS256", typ: "JWT" };
  const signingInput = `${strToB64url(JSON.stringify(header))}.${strToB64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign(RSA_ALG, privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;
}

// Verifies signature + exp/iat only; caller checks iss/aud/sub itself since those differ per use.
export async function verifyRS256(jwt, jwk) {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT");
  const [headerB64, payloadB64, sigB64] = parts;
  const key = await crypto.subtle.importKey("jwk", jwk, RSA_ALG, false, ["verify"]);
  const sigBytes = Uint8Array.from(atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const ok = await crypto.subtle.verify(RSA_ALG, key, sigBytes, new TextEncoder().encode(`${headerB64}.${payloadB64}`));
  if (!ok) throw new Error("Bad signature");
  const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) throw new Error("Token expired");
  if (payload.iat && now < payload.iat - 60) throw new Error("Token not yet valid");
  return payload;
}

export function decodeJwtHeader(jwt) {
  const headerB64 = jwt.split(".")[0];
  return JSON.parse(atob(headerB64.replace(/-/g, "+").replace(/_/g, "/")));
}
