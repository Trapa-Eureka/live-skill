// Byte-view helper (DESIGN §6 D3). Hands parsers that require a Buffer a view over the same memory
// instead of a copy, so a 25 MiB document is never held twice. Do not use it with parsers that
// detach or mutate the buffer (pdf.js).

/** A Buffer is returned as-is; anything else becomes a Buffer view over the same ArrayBuffer (no copy). */
export function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
