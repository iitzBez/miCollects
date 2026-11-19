// Cloudflare Pages Function: server-side fetch proxy, used only by "Add using URL" and the
// product-photo downloads it triggers. The website's own fetch() can't read a cross-origin shop
// page or image directly (no CORS there), unlike the APK's native HTTP client -- this runs the
// fetch on Cloudflare's own server instead, same-origin from the browser's point of view, and hands
// the result back. GET /api/proxy?url=<encoded target>
//
// This is a public endpoint that fetches whatever URL it's given, so it's deliberately kept narrow:
// GET only, http(s) only, a hard response-size cap, a timeout, and a best-effort block on
// private/internal network targets (not bulletproof against DNS rebinding, but Workers' own fetch()
// already refuses most internal-network destinations on top of this).
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0") return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) return new Response("Missing url parameter", { status: 400 });

  let parsed;
  try { parsed = new URL(target); } catch (e) { return new Response("Invalid url", { status: 400 }); }
  if (!/^https?:$/.test(parsed.protocol)) return new Response("Unsupported protocol", { status: 400 });
  if (isBlockedHost(parsed.hostname)) return new Response("That address can't be fetched", { status: 400 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(parsed.href, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,image/avif,image/webp,image/*,*/*;q=0.8",
        "Accept-Language": "en-ZA,en;q=0.9"
      }
    });
  } catch (e) {
    return new Response("Couldn't reach that address", { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  const contentLength = +upstream.headers.get("content-length") || 0;
  if (contentLength > MAX_BYTES) return new Response("Response too large", { status: 502 });

  // Read with a hard cap even when the server omitted (or lied about) content-length.
  const reader = upstream.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { reader.cancel(); return new Response("Response too large", { status: 502 }); }
    chunks.push(value);
  }

  return new Response(new Blob(chunks), {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "X-Final-Url": upstream.url || parsed.href,
      "Cache-Control": "no-store"
    }
  });
}
