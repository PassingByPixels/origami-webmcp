import { validateVideoData, videoCapability } from '../../vendor/format-dist/index.js';

/* Ported verbatim from vendor/mcp-reference/server.ts.
   Capabilities the slide content needs (video blocks -> embed:<host>, F30).
   Mirrors the Studio: the grant rides the same step as the edit. */
const VIDEO_BLOCK_RE = /<script[^>]*\bdata-odata="video"[^>]*>([\s\S]*?)<\/script>/gi;

export function videoCapsNeeded(inner: string): string[] {
  const caps = new Set<string>();
  for (const match of inner.matchAll(VIDEO_BLOCK_RE)) {
    try {
      const data = JSON.parse(match[1]!);
      if (validateVideoData(data).length === 0) {
        const cap = videoCapability(data.provider);
        if (cap) caps.add(cap);
      }
    } catch {
      /* malformed JSON is validateDeck's catch at save time */
    }
  }
  return [...caps];
}
