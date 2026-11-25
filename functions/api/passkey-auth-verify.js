// Step 2 of signing in with a passkey: verifies the assertion navigator.credentials.get() produced
// against the public key stored at enrollment time, then mints a real Firebase custom token for that
// account -- this is the actual sign-in, not a local gate; the client exchanges the token via
// signInWithCustomToken() same as any other Firebase sign-in method.
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { handlePost, json } from "../_shared/http.js";
import { getPasskeyCredential, updatePasskeyCounter, mintCustomToken } from "../_shared/gcp.js";
import { verifyChallengeToken } from "../_shared/challenge.js";
import { b64urlToBytes } from "../_shared/b64.js";

export const onRequestPost = handlePost(async ({ request, env, body }) => {
  const { response, challengeToken } = body;
  if (!response || !challengeToken) throw new Error("Missing response or challengeToken");
  const credentialId = response.id;
  if (!credentialId) throw new Error("Missing credential id");

  const { challenge } = await verifyChallengeToken(env, challengeToken);
  const stored = await getPasskeyCredential(env, credentialId);
  if (!stored) throw new Error("This passkey isn't registered here");

  const url = new URL(request.url);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: url.origin,
    expectedRPID: url.hostname,
    credential: { id: credentialId, publicKey: b64urlToBytes(stored.publicKey), counter: stored.counter, transports: stored.transports },
    requireUserVerification: true
  });
  if (!verification.verified) throw new Error("Couldn't verify that passkey");

  const newCounter = verification.authenticationInfo?.newCounter ?? verification.authenticationInfo?.counter ?? stored.counter;
  await updatePasskeyCounter(env, credentialId, newCounter);

  const token = await mintCustomToken(env, stored.uid);
  return json({ token });
});
