// src/document.ts
var ALPHA_ROWS = 64;
var ALPHA_THRESHOLD = 16;
var ALPHA_CACHE = /* @__PURE__ */ new WeakMap();
function traceAlpha(img) {
  const w = Math.max(1, Math.min(256, Math.round(img.clientWidth || img.naturalWidth)));
  const h = ALPHA_ROWS;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
  const rows = new Float64Array(h * 3);
  let anyTransparent = false;
  let minL = Infinity;
  let maxR = -Infinity;
  let firstRow = -1;
  let lastRow = -1;
  for (let ry = 0; ry < h; ry++) {
    let first = -1;
    let last = -1;
    const base = ry * w * 4;
    for (let rx = 0; rx < w; rx++) {
      if (data[base + rx * 4 + 3] > ALPHA_THRESHOLD) {
        if (first === -1) first = rx;
        last = rx;
      }
    }
    const y = (ry + 0.5) / h;
    rows[ry * 3] = y;
    if (first === -1) {
      rows[ry * 3 + 1] = 0.5;
      rows[ry * 3 + 2] = 0.5;
      anyTransparent = true;
      continue;
    }
    const l = first / w;
    const r = (last + 1) / w;
    rows[ry * 3 + 1] = l;
    rows[ry * 3 + 2] = r;
    if (l < minL) minL = l;
    if (r > maxR) maxR = r;
    if (firstRow === -1) firstRow = ry;
    lastRow = ry;
    if (first > 0 || last < w - 1) anyTransparent = true;
  }
  if (firstRow === -1) return null;
  return {
    l: minL,
    t: firstRow / h,
    r: maxR,
    b: (lastRow + 1) / h,
    rows: anyTransparent ? rows : null,
    rowH: 1 / h
  };
}
function alphaScanOf(img) {
  if (!img.complete || img.naturalWidth === 0) return null;
  const src = img.currentSrc || img.src;
  const hit = ALPHA_CACHE.get(img);
  if (hit && hit.src === src) return hit.scan;
  const scan = traceAlpha(img);
  ALPHA_CACHE.set(img, { src, scan });
  return scan;
}
function markAlphaFigures(scope) {
  for (const img of Array.from(scope.querySelectorAll("figure.o-img > img"))) {
    const fig = img.parentElement;
    if (!fig) continue;
    if (!img.complete || img.naturalWidth === 0) {
      img.addEventListener("load", () => markAlphaFigures(fig), { once: true });
      continue;
    }
    const scan = alphaScanOf(img);
    if (scan && scan.rows) fig.setAttribute("data-oalphaimg", "");
    else fig.removeAttribute("data-oalphaimg");
  }
}

// src/assets.ts
function resolveAssetRefs(scope, assets) {
  scope.querySelectorAll("img[data-oasset]").forEach((img) => {
    const id = img.getAttribute("data-oasset") ?? "";
    let url = assets[id];
    if (id === "brand-logo" && assets["backdrop-logo"] && img.closest(".o-doc-bg")) url = assets["backdrop-logo"];
    if (url) img.src = url;
    else img.removeAttribute("src");
  });
  markAlphaFigures(scope);
}
function applyFavicon(assets) {
  const logo = assets["brand-logo"];
  if (!logo) return;
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = logo;
}
function applyBrandLogoVar(el, assets) {
  const logo = assets["brand-logo"];
  if (logo) el.style.setProperty("--brand-logo", `url("${logo}")`);
  else el.style.removeProperty("--brand-logo");
}
var FONT_SLOTS = {
  "font-display": "Origami Display",
  "font-body": "Origami Body",
  // per-block fonts (data-ofont) — one asset per family actually used
  "font-playfair": "Playfair Display",
  "font-lora": "Lora",
  "font-inter": "Inter",
  "font-source-serif": "Source Serif 4",
  "font-caveat": "Caveat"
};
var FONT_FORMAT = [
  ["data:font/woff2;", "woff2"],
  ["data:font/woff;", "woff"],
  ["data:font/ttf;", "truetype"],
  ["data:font/otf;", "opentype"]
];
function fontFacesCss(assets) {
  let css = "";
  for (const [id, family] of Object.entries(FONT_SLOTS)) {
    const url = assets[id];
    if (!url || url.includes('"')) continue;
    const fmt = FONT_FORMAT.find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!fmt) continue;
    css += `@font-face { font-family: '${family}'; src: url("${url}") format('${fmt}'); font-weight: 100 900; font-style: normal; font-display: swap; }
`;
  }
  return css;
}
export {
  applyBrandLogoVar,
  applyFavicon,
  fontFacesCss,
  resolveAssetRefs
};
