// Solana wire transactions begin with a compact-u16 signature count followed by
// 64-byte signatures. The fee payer's first signature is the transaction ID.
export function paymentSignatureFromTransaction(bytes: Uint8Array): string {
  let count = 0;
  let offset = 0;
  for (; offset < 3; offset += 1) {
    const byte = bytes[offset];
    if (byte === undefined) throw new Error("Truncated transaction");
    count |= (byte & 0x7f) << (offset * 7);
    if (!(byte & 0x80)) { offset += 1; break; }
  }
  if (!count || count > 64 || bytes.length <= offset + count * 64) throw new Error("Invalid signed transaction");
  const signature = bytes.slice(offset, offset + 64);
  if (signature.every((byte) => byte === 0)) throw new Error("Payment is not signed");
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of signature) value = (value << 8n) + BigInt(byte);
  let encoded = "";
  while (value > 0n) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  for (const byte of signature) { if (byte !== 0) break; encoded = "1" + encoded; }
  return encoded;
}
