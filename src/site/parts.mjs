/* The site's shared markup, generated at BUILD time (imported by build.mjs — never shipped).
   Plain .mjs on purpose: build.mjs is node, and this file must run with no loader.

   The petal config below is the ONE place the flower and the tool cards come from. Adding a
   tool = one row. Un-greying a "room to grow" petal = filling one row in. */

/* The same crane the deck runtime stamps on a Fold (runtime-dist STATIC_CRANE_SVG). One copy:
   the favicon file and every inline mark on the site are built from it. */
export const CRANE_GROUP =
  '<g fill="#557A4E"><polygon points="30,40 47,40 52,11" opacity="0.45"/><polygon points="26,40 48,40 43,7" opacity="0.92"/><polygon points="44,40 62,29 47,48" opacity="0.72"/><polygon points="28,39 48,41 36,55"/><polygon points="21,44 28,39 36,55" opacity="0.7"/><polygon points="9,12 15,13 28,41 22,44" opacity="0.85"/><polygon points="9,12 15,13 14,19 2,17"/></g>';

export const CRANE_FILE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${CRANE_GROUP}</svg>`;

export const BMC_URL = 'https://buymeacoffee.com/passingbypixels';
/* Support is a PAGE on the Labs site, not a mailbox. One constant, so the footer and the privacy
   page cannot point at two different places. The guard already allows this origin in an <a>. */
export const SUPPORT_URL = 'https://origamilabs.nl/support';

/* ------------------------------------------------------------------ the petals ------------ */

/* Colours are shades of the tokens in src/app/styles.css :root — `dark` is the left facet,
   `light` the right one, `crease` the hairline down the spine. A petal reads as folded paper
   because the two facets of ONE kite catch different light, not because of a gradient.

   A "blank" petal — room to grow. Paper one step darker than --bg with a --rule hairline, so it
   reads as a petal not yet unlocked rather than a watermark. Never a link, never labelled. */
const BLANK = { dark: '#E3DCCE', light: '#EFE9DE', crease: '#DBD3C3', stroke: '#E8E2D6' };

/* Order IS the ring: angle rises 45 degrees a row, so a blank never sits next to a blank, and
   the cards (the rows with an href, in this order) come out Folio · Draw · Charts · Gantt ·
   Design — the order docs/SITE.md asks for. */
export const PETALS = [
  {
    name: 'Folio',
    href: 'folio/',
    angle: 0,
    blurb: 'Decks and documents. The whole editor, in the tab.',
    chip: 'live',
    dark: '#3F5F39', // --accent #557A4E, shaded
    light: '#6F9366',
    crease: '#2F4A2B',
  },
  {
    name: 'Draw',
    chip: 'live',
    href: 'draw/',
    angle: 45,
    blurb: 'Hand-drawn sketches and diagrams.',
    dark: '#8A4522', // --warn #A8562B, the copper family
    light: '#C87B45',
    crease: '#6E3418',
  },
  { ...BLANK, angle: 90 },
  {
    name: 'Charts',
    chip: 'live',
    href: 'charts/',
    angle: 135,
    blurb: 'Twelve chart types and a Venn.',
    dark: '#171717', // --ink #1A1A1A
    light: '#3E3A34',
    crease: '#050505',
  },
  { ...BLANK, angle: 180 },
  {
    name: 'Gantt',
    chip: 'live',
    href: 'gantt/',
    angle: 225,
    blurb: 'Roadmaps on a real calendar.',
    dark: '#7C9673', // --accent lifted toward sage
    light: '#A7BC9E',
    crease: '#5F7A57',
  },
  { ...BLANK, angle: 270 },
  {
    name: 'Design',
    href: 'design/',
    angle: 315,
    blurb: 'Pages and posters. Coming soon.',
    chip: 'soon',
    // Filled, not hollow: a hole in the ring would break the flower. Pale sage sits between the
    // blanks and Gantt, so Design reads as nearly alive. The dashed crease carries the "not yet".
    dash: true,
    dark: '#B7CAB0',
    light: '#D4DFCE',
    crease: '#8FA687',
  },
];

/* Flower geometry, in viewBox units. Everything is derived from these, so one number moves the
   whole shape. The waist half-width comes FROM the 45-degree sector: at R_WIDE two neighbours
   would touch at exactly R_WIDE x tan(22.5deg), and 0.92 of that leaves a hairline between them,
   so the eight waists close into one continuous mass around the disc. The base sits well inside
   the disc, which is painted after the petals and hides every base. */
const C = 300; // centre x and y of the 600x600 drawing space
const DISC = 46;
const R_BASE = 26; // well inside the disc, which is painted last and hides every base
const R_WIDE = 110;
const R_TIP = 168; // kept close to the waist: a long thin kite reads as a star, not a flower
const HALF_W = Math.round(R_WIDE * Math.tan(Math.PI / 8) * 0.92 * 10) / 10;
const R_LABEL = R_TIP + 18;
/* The "soon" chip is drawn UPRIGHT while its petal may be diagonal, so its half-DIAGONAL (~19),
   not its half-width, is what has to fit inside the kite at this radius (~27). */
const R_CHIP = 120;

const n = (v) => Math.round(v * 10) / 10;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One petal's two facet polygons + crease, drawn pointing straight up from the centre.
    `outline` (the /design/ page motif only) is ONE kite path, not two stroked halves — two would
    draw the spine twice and the dashed crease would land on a solid line. */
function facets(p) {
  const base = `${C},${n(C - R_BASE)}`;
  const tip = `${C},${n(C - R_TIP)}`;
  const left = `${n(C - HALF_W)},${n(C - R_WIDE)}`;
  const right = `${n(C + HALF_W)},${n(C - R_WIDE)}`;
  const dash = p.dash || p.outline ? ' stroke-dasharray="5 4"' : '';
  const crease = `<path class="crease" d="M${base} L${tip}" stroke="${p.crease}" stroke-width="1" fill="none"${dash}/>`;

  if (p.outline) {
    return `<path class="facet" d="M${base} L${left} L${tip} L${right} Z" fill="none" stroke="${p.crease}" stroke-width="1.5"/>${crease}`;
  }
  const edge = p.stroke ? ` stroke="${p.stroke}" stroke-width="1"` : '';
  return (
    `<polygon class="facet" points="${base} ${left} ${tip}" fill="${p.dark}"${edge}/>` +
    `<polygon class="facet" points="${base} ${right} ${tip}" fill="${p.light}"${edge}/>` +
    crease
  );
}

/** Upright text at a point that the parent rotation would otherwise tip over. */
function upright(angle, x, y, inner) {
  return angle === 0 ? inner : `<g transform="rotate(${-angle} ${x} ${y})">${inner}</g>`;
}

function petalSvg(p, i) {
  const rot = p.angle === 0 ? '' : ` transform="rotate(${p.angle} ${C} ${C})"`;
  const ly = n(C - R_LABEL);
  const label = upright(p.angle, C, ly, `<text class="petal-label" x="${C}" y="${ly}" text-anchor="middle">${esc(p.name ?? '')}</text>`);
  const cy = n(C - R_CHIP);
  const chip = p.chip === 'soon'
    ? upright(p.angle, C, cy,
        `<g class="petal-chip"><rect x="${C - 16}" y="${cy - 7}" width="32" height="14" rx="7"/>` +
        `<text x="${C}" y="${cy + 3.3}" text-anchor="middle">soon</text></g>`)
    : '';

  const body = `<g class="lift">${facets(p)}${chip}${p.name ? label : ''}</g>`;
  const inner = p.href
    ? `<a class="petal" href="${p.href}" aria-label="${esc(p.name)}" data-testid="petal-link">${body}</a>`
    : body;
  const cls = p.href ? 'petal-slot' : 'petal-slot petal-idle';
  return `<g class="${cls}" data-testid="petal" data-petal="${p.name ? esc(p.name.toLowerCase()) : `empty-${i}`}"${rot}>${inner}</g>`;
}

/** The whole flower: eight petals at i x 45 degrees around the crane. */
export function flowerSvg() {
  const petals = PETALS.map(petalSvg).join('');
  const crane = `<g transform="translate(${C - 25} ${C - 25}) scale(0.78)">${CRANE_GROUP}</g>`;
  const disc = `<circle class="disc" cx="${C}" cy="${C}" r="${DISC}"/>`;
  /* Cropped to what the flower actually draws. The outermost ink is a tip label at R_LABEL, so
     the box is that ring plus room for one line of type — no dead margin under the header. */
  const pad = C - R_LABEL - 12;
  return (
    `<svg class="flower" viewBox="${pad} ${pad} ${600 - pad * 2} ${600 - pad * 2}" data-testid="flower" ` +
    `xmlns="http://www.w3.org/2000/svg"><title>Origami tools</title>${petals}${disc}${crane}</svg>`
  );
}

/** The Design petal on its own, cropped to its own box — the motif on the coming-soon page.
    Same kite, same `facets()`, so the motif can never drift from the petal in the flower. It is
    drawn OUTLINED here (docs/SITE.md asks for an outlined motif); in the flower the same petal is
    filled, because a hollow petal would punch a hole in the ring. */
export function designMotif() {
  const design = PETALS.find((p) => p.name === 'Design');
  const x = C - HALF_W - 6;
  const y = C - R_TIP - 6;
  return (
    `<svg class="motif" viewBox="${x} ${y} ${HALF_W * 2 + 12} ${R_TIP - R_BASE + 12}" aria-hidden="true" ` +
    `xmlns="http://www.w3.org/2000/svg">${facets({ ...design, outline: true, crease: '#8C857A' })}</svg>`
  );
}

/* ------------------------------------------------------------------ the cards ------------- */

/** The accessible nav. Same rows, same order, same hrefs as the petals — petals alone are hostile.
    On the home page each card is a sheet of folded paper lying on the desk. The parts that make
    it one come from the SAME row as the petal: `dark` paints the swatch, `chip` decides the
    status and the wording of the action, and `slot-<name>` is the hook the desk layout and the
    per-card tilt hang off. No card can name a tool the flower does not. */
export function toolCards() {
  return PETALS.filter((p) => p.href)
    .map(
      (p) =>
        `<a class="tool-card slot-${esc(p.name.toLowerCase())}" href="${p.href}" data-testid="tool-card">` +
        `<span class="tool-name"><span class="tool-swatch" style="background:${p.dark}"></span>${esc(p.name)}` +
        `${p.chip ? `<span class="tool-chip" data-chip="${p.chip}">${p.chip}</span>` : ''}</span>` +
        `<span class="tool-blurb">${esc(p.blurb)}</span>` +
        `<span class="tool-go">${p.chip === 'soon' ? 'Take a look' : 'Open'} &rarr;</span></a>`,
    )
    .join('');
}

/* ------------------------------------------------------------------ chrome ---------------- */

/** `up` is the path back to the site root: '' at the root, '../' one level down. */
export function header(up) {
  return (
    `<header class="site-head"><a class="brand" href="${up || './'}">` +
    `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">${CRANE_GROUP}</svg>` +
    `<span class="wordmark">Origami</span><span class="subbrand">Gratis</span></a></header>`
  );
}

export function footer(up) {
  return (
    `<footer class="site-foot">` +
    `<a class="coffee" href="${BMC_URL}" target="_blank" rel="noopener" data-testid="bmc-link">&#9749; Buy me a coffee</a>` +
    `<a href="${up}privacy/" data-testid="privacy-link">Privacy</a>` +
    `<a href="${SUPPORT_URL}" data-testid="support-link">Support</a>` +
    `<span class="colophon">Origami Labs</span>` +
    `</footer>`
  );
}

/** The support pointer in running prose. A marker, not a literal in the page, so the footer and
    the privacy copy cannot end up pointing at two different places. */
export function supportLink() {
  return `<a href="${SUPPORT_URL}" data-testid="support-inline">origamilabs.nl/support</a>`;
}

/** Fill the markers a site page carries. A page uses the ones it needs and ignores the rest. */
export function renderPage(html, up) {
  return html
    .replace('<!--HEADER-->', header(up))
    .replace('<!--SUPPORT-->', supportLink())
    .replace('<!--FLOWER-->', flowerSvg())
    .replace('<!--CARDS-->', toolCards())
    .replace('<!--MOTIF-->', designMotif())
    .replace('<!--FOOTER-->', footer(up));
}
