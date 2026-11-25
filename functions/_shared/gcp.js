// Talks to Firebase/GCP straight over REST using the project's service account, instead of
// firebase-admin (built for Node, not the Workers runtime Cloudflare Pages Functions run on). Three
// things live here: minting a Firebase custom token, verifying a Firebase ID token, and a thin
// Firestore REST client -- all signed/verified with Workers' own Web Crypto, no npm dependency beyond
// what WebAuthn itself needs.
import { importPrivateKey, signRS256, verifyRS256, decodeJwtHeader } from "./jwt.js";

function serviceAccount(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
  const sa = JSON.parse(raw);
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error("Service account JSON is missing fields");
  return sa;
}

/* ---------- Firebase custom tokens (sign-in) ---------- */
export async function mintCustomToken(env, uid) {
  const sa = serviceAccount(env);
  const key = await importPrivateKey(sa.private_key);
  const now = Math.floor(Date.now() / 1000);
  return signRS256({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid
  }, key);
}

/* ---------- Firebase ID token verification (confirms who's asking) ---------- */
// Google rotates these keys; cached per-isolate for the lesser of an hour and whatever max-age it
// actually sends, instead of re-fetching on every call.
let jwkCache = { keys: null, expiresAt: 0 };
async function getGoogleJwks() {
  if (jwkCache.keys && Date.now() < jwkCache.expiresAt) return jwkCache.keys;
  const res = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if (!res.ok) throw new Error("Couldn't fetch Google's signing keys");
  const cacheControl = res.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeMs = maxAgeMatch ? Math.min(+maxAgeMatch[1], 3600) * 1000 : 3600000;
  const { keys } = await res.json();
  jwkCache = { keys, expiresAt: Date.now() + maxAgeMs };
  return keys;
}

export async function verifyFirebaseIdToken(env, idToken) {
  const sa = serviceAccount(env);
  const header = decodeJwtHeader(idToken);
  const keys = await getGoogleJwks();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error("Unknown signing key");
  const payload = await verifyRS256(idToken, jwk);
  if (payload.iss !== `https://securetoken.google.com/${sa.project_id}`) throw new Error("Bad issuer");
  if (payload.aud !== sa.project_id) throw new Error("Bad audience");
  if (!payload.sub) throw new Error("Missing subject");
  return { uid: payload.sub, email: payload.email || null };
}

export async function requireFirebaseUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer (.+)$/i);
  if (!m) throw new Error("Missing bearer token");
  return verifyFirebaseIdToken(env, m[1]);
}

/* ---------- OAuth2 access token for Firestore REST calls ---------- */
let tokenCache = { token: null, expiresAt: 0 };
async function getAccessToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) return tokenCache.token;
  const sa = serviceAccount(env);
  const key = await importPrivateKey(sa.private_key);
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signRS256({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }, key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${assertion}`
  });
  if (!res.ok) throw new Error("Couldn't get a Google access token: " + (await res.text()));
  const { access_token, expires_in } = await res.json();
  tokenCache = { token: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token;
}

/* ---------- Firestore REST (just what the passkeyCredentials collection needs) ---------- */
function fsUrl(env, path) {
  const sa = serviceAccount(env);
  return `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/${path}`;
}
async function fsFetch(env, path, init) {
  const token = await getAccessToken(env);
  const res = await fetch(fsUrl(env, path), {
    ...init,
    headers: { ...(init && init.headers), authorization: `Bearer ${token}`, "content-type": "application/json" }
  });
  return res;
}
// runQuery is an RPC on the *documents* collection itself (the collection being queried is named
// inside the request body's structuredQuery.from, not the URL) -- ".../documents:runQuery", never
// ".../documents/<collection>:runQuery", which Firestore instead parses as a plain document path and
// rejects the moment it sees a body that isn't a Document (hence "Unknown name structuredQuery").
async function fsRunQuery(env, structuredQuery) {
  const sa = serviceAccount(env);
  const token = await getAccessToken(env);
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ structuredQuery })
  });
  return res;
}

// Credential IDs arrive from the browser as base64url already, which (unlike plain base64) uses only
// '-'/'_' in place of '+'/'/' -- exactly the character it'd otherwise collide with Firestore's own
// '/' path separator -- so it's usable as a Firestore document id and a URL path segment unchanged.
export function credentialDocId(credentialIdB64url) { return credentialIdB64url; }

export async function getPasskeyCredential(env, credentialIdB64url) {
  const res = await fsFetch(env, `passkeyCredentials/${credentialDocId(credentialIdB64url)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Firestore read failed: " + (await res.text()));
  const doc = await res.json();
  const f = doc.fields;
  return {
    uid: f.uid.stringValue,
    publicKey: f.publicKey.stringValue,
    counter: parseInt(f.counter.integerValue, 10),
    transports: (f.transports?.arrayValue?.values || []).map(v => v.stringValue)
  };
}

export async function putPasskeyCredential(env, credentialIdB64url, data) {
  const res = await fsFetch(env, `passkeyCredentials/${credentialDocId(credentialIdB64url)}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        uid: { stringValue: data.uid },
        publicKey: { stringValue: data.publicKey },
        counter: { integerValue: String(data.counter) },
        transports: { arrayValue: { values: (data.transports || []).map(t => ({ stringValue: t })) } },
        createdAt: { timestampValue: new Date().toISOString() }
      }
    })
  });
  if (!res.ok) throw new Error("Firestore write failed: " + (await res.text()));
}

export async function updatePasskeyCounter(env, credentialIdB64url, counter) {
  const res = await fsFetch(env, `passkeyCredentials/${credentialDocId(credentialIdB64url)}?updateMask.fieldPaths=counter`, {
    method: "PATCH",
    body: JSON.stringify({ fields: { counter: { integerValue: String(counter) } } })
  });
  if (!res.ok) throw new Error("Firestore counter update failed: " + (await res.text()));
}

export async function deletePasskeyCredential(env, credentialIdB64url) {
  const res = await fsFetch(env, `passkeyCredentials/${credentialDocId(credentialIdB64url)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error("Firestore delete failed: " + (await res.text()));
}

// Used to build excludeCredentials at registration time -- lists every credential doc for one uid.
export async function listPasskeyCredentialsForUid(env, uid) {
  const res = await fsRunQuery(env, {
    from: [{ collectionId: "passkeyCredentials" }],
    where: { fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: uid } } }
  });
  if (!res.ok) throw new Error("Firestore query failed: " + (await res.text()));
  const rows = await res.json();
  return rows
    .filter(r => r.document)
    .map(r => {
      const name = r.document.name;
      const credentialId = name.slice(name.lastIndexOf("/") + 1);
      return { credentialId, transports: (r.document.fields.transports?.arrayValue?.values || []).map(v => v.stringValue) };
    });
}
