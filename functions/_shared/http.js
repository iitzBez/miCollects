export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

// Every passkey route is POST-only, parses a JSON body (if any), and should fail as a clean 4xx
// instead of a raw 500/stack trace -- callers throwing a plain Error here is deliberate so the route
// files themselves stay short; anything unexpected still surfaces as a 400 with its message instead
// of exposing internals.
export function handlePost(fn) {
  return async ({ request, env }) => {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    let body = {};
    try { body = request.headers.get("content-length") === "0" ? {} : await request.json(); }
    catch (e) { return json({ error: "Invalid JSON body" }, 400); }
    try {
      return await fn({ request, env, body });
    } catch (e) {
      const status = e.status || 400;
      // `stack` is only here to make an unexpected (non-deliberate) error locatable while this
      // feature is still being brought up live -- worth removing once passkeys are stable, since a
      // stack trace has no business reaching a client in the long run.
      return json({ error: e.message || "Request failed", stack: String(e.stack || "").split("\n").slice(0, 4) }, status);
    }
  };
}
