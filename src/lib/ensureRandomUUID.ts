/** The UUID shape `crypto.randomUUID()` is declared to return. */
type UuidString = ReturnType<Crypto['randomUUID']>;

/**
 * Ensures `crypto.randomUUID()` exists, even in insecure browsing contexts.
 *
 * The Web Crypto `randomUUID()` method is only exposed in *secure contexts*
 * (HTTPS pages, or `http://localhost`). A self-hosted CADAM instance served
 * over plain HTTP on a LAN address — e.g. `http://192.168.1.50:3000` — is not a
 * secure context, so `crypto.randomUUID` is `undefined` there and the app
 * crashes on startup with `TypeError: crypto.randomUUID is not a function`.
 *
 * `crypto.getRandomValues()` *is* available in insecure contexts, so we use it
 * to build a spec-compliant RFC 4122 v4 UUID as a fallback. The native
 * implementation is always preferred when present, so this is a no-op on HTTPS
 * and on localhost.
 *
 * Imported for its side effect at the very top of the client entry point.
 */
function installRandomUUIDPolyfill(): void {
  if (
    typeof crypto === 'undefined' ||
    typeof crypto.getRandomValues !== 'function' ||
    typeof crypto.randomUUID === 'function'
  ) {
    return;
  }

  crypto.randomUUID = function randomUUID(): UuidString {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const a = hex.slice(0, 8);
    const b = hex.slice(8, 12);
    const c = hex.slice(12, 16);
    const d = hex.slice(16, 20);
    const e = hex.slice(20);
    return `${a}-${b}-${c}-${d}-${e}`;
  };
}

installRandomUUIDPolyfill();
