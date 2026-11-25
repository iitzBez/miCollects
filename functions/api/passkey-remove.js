// Lets a signed-in user revoke a passkey (e.g. this device was lost/sold). Checks the credential
// actually belongs to the caller before deleting it, so one account can't delete another's by
// guessing/replaying a credential id.
import { handlePost, json } from "../_shared/http.js";
import { requireFirebaseUser, getPasskeyCredential, deletePasskeyCredential } from "../_shared/gcp.js";

export const onRequestPost = handlePost(async ({ request, env, body }) => {
  const { uid } = await requireFirebaseUser(request, env);
  const { credentialId } = body;
  if (!credentialId) throw new Error("Missing credentialId");
  const stored = await getPasskeyCredential(env, credentialId);
  if (stored && stored.uid !== uid) throw new Error("Not your passkey");
  await deletePasskeyCredential(env, credentialId);
  return json({ ok: true });
});
