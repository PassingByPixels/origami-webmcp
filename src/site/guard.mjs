/* The no-external-URL guard. Pure functions so the build and a unit test run the SAME check.

   The rule differs by file kind, because the risk does:
   - APP CODE (.js/.mjs/.css): any `https?://` at all is an offence. Nothing this repo writes
     needs one; a CDN import or a beacon would look exactly like a legitimate string here.
   - PAGES (.html/.svg): a link a human clicks is fine, so `https?://` is allowed ONLY inside
     an `<a href>`. Anything that makes the BROWSER fetch — `src=`, `<link href=>`, `@import` —
     is an offence wherever it appears, `<a>` or not.

   ALLOWED is an exact-prefix list of strings that arrive inside the VENDORED @origami/format
   and @origami/runtime bundles (src/ itself contains no external URL — grep it). Each is
   either a namespace URI that is never fetched, or a URL the deck runtime builds only when a
   reader clicks a video the deck author put there. A URL that is not on this list fails. */
export const ALLOWED = [
  // XML/SVG namespace URIs. Identifiers, never fetched.
  'http://www.w3.org/',
  // vendor/format-dist/blocks/video.js — the embed src built when a reader plays a video block.
  'https://www.youtube-nocookie.com/embed/',
  'https://player.vimeo.com/video/',
  'https://www.loom.com/embed/',
  // vendor/runtime-dist — the mark in a rendered deck's own chrome links home.
  'https://origamilabs.nl',
];

const URL_RE = /https?:\/\/[^\s"'`)<>]+/g;
const FETCH_RES = [
  /\b(?:src|srcset|data-src)\s*=\s*["'](https?:\/\/[^"']*)/gi,
  /<link\b[^>]*?\bhref\s*=\s*["'](https?:\/\/[^"']*)/gi,
  /@import\s+(?:url\(\s*)?["']?(https?:\/\/[^"')\s]*)/gi,
];
const LINK_RE = /<a\b[^>]*?\bhref\s*=\s*["'](https?:\/\/[^"']*)/gi;

const isAllowed = (url) => ALLOWED.some((prefix) => url.startsWith(prefix));

/** '' for files the guard does not police (deck payloads, images, JSON). */
function kindOf(rel) {
  if (/\.(js|mjs|css)$/i.test(rel)) return 'code';
  if (/\.(html|svg)$/i.test(rel)) return 'page';
  return '';
}

/** Start/end offsets of capture group 1 for every match of `re` in `text`. */
function spans(text, re) {
  const out = [];
  for (const m of text.matchAll(re)) {
    const start = m.index + m[0].length - m[1].length;
    out.push({ start, end: start + m[1].length, url: m[1] });
  }
  return out;
}

const covers = (list, i) => list.some((s) => i >= s.start && i < s.end);

/**
 * @param {string} rel  path inside dist/, for the message
 * @param {string} text file contents
 * @returns {string[]} one line per offence; empty means clean
 */
export function scanExternalUrls(rel, text) {
  const kind = kindOf(rel);
  if (!kind) return [];
  const out = [];

  if (kind === 'code') {
    for (const m of text.matchAll(URL_RE)) if (!isAllowed(m[0])) out.push(`${rel}: ${m[0]}`);
    return out;
  }

  /* A page. First the fetches — an offence even inside an <a>, because the browser goes and
     gets them without anyone clicking. */
  const fetched = FETCH_RES.flatMap((re) => spans(text, re));
  for (const s of fetched) {
    if (!isAllowed(s.url)) out.push(`${rel}: ${s.url} — the browser would fetch this`);
  }

  /* Then everything else: allowed only as the href of an <a>. */
  const linked = spans(text, LINK_RE);
  for (const m of text.matchAll(URL_RE)) {
    if (isAllowed(m[0]) || covers(linked, m.index) || covers(fetched, m.index)) continue;
    out.push(`${rel}: ${m[0]} — only an <a href> may carry an external URL on a page`);
  }
  return out;
}
