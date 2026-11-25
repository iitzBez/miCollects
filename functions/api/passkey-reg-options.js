// Step 1 of enrolling a passkey: called while already signed in (email/password), returns the
// WebAuthn registration options for navigator.credentials.create() plus a signed challenge token to
// echo back to passkey-reg-verify.
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { handlePost, json } from "../_shared/http.js";
import { requireFirebaseUser, listPasskeyCredentialsForUid } from "../_shared/gcp.js";
import { makeChallengeToken } from "../_shared/challenge.js";

export const onRequestPost = handlePost(async ({ request, env }) => {
  const { uid, email } = await requireFirebaseUser(request, env);
  const rpID = new URL(request.url).hostname;
  const existing = await listPasskeyCredentialsForUid(env, uid);

  const options = await generateRegistrationOptions({
    rpName: "miCollects",
    rpID,
    userID: new TextEncoder().encode(uid),
    userName: email || uid,
    attestationType: "none",
    excludeCredentials: existing.map(c => ({ id: c.credentialId, transports: c.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
    supportedAlgorithmIDs: [-7, -257]
  });

  const challengeToken = await makeChallengeToken(env, options.challenge, { uid });
  return json({ options, challengeToken });
});
