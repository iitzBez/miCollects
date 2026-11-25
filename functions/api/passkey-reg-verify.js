// Step 2 of enrolling a passkey: verifies the attestation navigator.credentials.create() produced,
// and stores the public key against this account so passkey-auth-verify can recognise it later.
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { handlePost, json } from "../_shared/http.js";
import { requireFirebaseUser, putPasskeyCredential } from "../_shared/gcp.js";
import { verifyChallengeToken } from "../_shared/challenge.js";
import { bytesToB64url } from "../_shared/b64.js";

export const onRequestPost = handlePost(async ({ request, env, body }) => {
  const { uid } = await requireFirebaseUser(request, env);
  const { response, challengeToken } = body;
  if (!response || !challengeToken) throw new Error("Missing response or challengeToken");

  const { challenge, extra } = await verifyChallengeToken(env, challengeToken);
  if (!extra || extra.uid !== uid) throw new Error("Challenge doesn't belong to this account");

  const url = new URL(request.url);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: url.origin,
    expectedRPID: url.hostname,
    requireUserVerification: true
  });
  if (!verification.verified) throw new Error("Couldn't verify that passkey");

  // registrationInfo's exact shape has moved around across @simplewebauthn/server versions (a flat
  // credentialID/credentialPublicKey/counter in v8, nested under `credential` from v9+) -- read both
  // so a minor version bump doesn't silently break enrollment.
  const info = verification.registrationInfo;
  const cred = info.credential || info;
  const credentialId = cred.id || (cred.credentialID && bytesToB64url(cred.credentialID));
  const publicKeyBytes = cred.publicKey || cred.credentialPublicKey;
  const counter = cred.counter ?? 0;
  const transports = (response.response && response.response.transports) || cred.transports || [];
  if (!credentialId || !publicKeyBytes) throw new Error("Unexpected verification result shape");

  await putPasskeyCredential(env, credentialId, {
    uid, publicKey: bytesToB64url(publicKeyBytes), counter, transports
  });
  return json({ ok: true });
});
