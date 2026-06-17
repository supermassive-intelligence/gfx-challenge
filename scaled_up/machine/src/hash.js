/**
 * FNV-1a 32-bit hash (matches MAME Lua side).
 * Using unsigned 32-bit integers via >>> 0.
 */
function fnv1a32(data) {
  let hash = 0x811c9dc5 >>> 0;
  const prime = 0x01000193 >>> 0;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, prime) >>> 0;
  }
  return hash;
}

export { fnv1a32 };
