// Base64url <-> bytes/string helpers shared by the JWT and WebAuthn glue code below. Workers expose
// atob/btoa (binary-string based, like a browser) but not Node's Buffer, so everything funnels
// through a plain binary string in between.
export function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
export function strToB64url(s) { return bytesToB64url(new TextEncoder().encode(s)); }
export function b64urlToStr(s) { return new TextDecoder().decode(b64urlToBytes(s)); }
export function b64urlToB64(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return s.replace(/-/g, "+").replace(/_/g, "/") + pad;
}
export function b64ToB64url(s) { return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
