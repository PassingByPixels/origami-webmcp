/* The stdio server mints ids with node:crypto randomBytes(4).toString('hex').
   Same shape, Web Crypto source: 's'/'p'/'d-' + 8 lowercase hex. */

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const newSlideId = (): string => 's' + randomHex(4);
export const newProposalId = (): string => 'p' + randomHex(4);
export const newDeckId = (): string => 'd-' + randomHex(4);

/** sha256 hex of a string — the per-chunk staleness key. Mirrors the stdio server's
    innerHash (node:crypto createHash('sha256')...digest('hex')) via Web Crypto. */
export async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
