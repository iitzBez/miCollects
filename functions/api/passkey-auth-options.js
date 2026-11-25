// Step 1 of signing in with a passkey. No Firebase session exists yet at this point, so this is the
// one passkey route that needs no bearer token -- allowCredentials is left empty on purpose so the
// browser offers every discoverable passkey it holds for this site (usernameless sign-in), matching
// the "just click one button, no typing" flow asked for.
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { handlePost, json } from "../_shared/http.js";
import { makeChallengeToken } from "../_shared/challenge.js";

export const onRequestPost = handlePost(async ({ request, env }) => {
  const rpID = new URL(request.url).hostname;
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  const challengeToken = await makeChallengeToken(env, options.challenge, {});
  return json({ options, challengeToken });
});
