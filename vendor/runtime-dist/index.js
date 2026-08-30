// src/wrap-geometry.ts
function freeIntervals(bandTop, bandBottom, contentLeft, contentRight, exclusions) {
  const blocked = [];
  for (const ex of exclusions) {
    if (ex.fullBelow != null && bandBottom > ex.fullBelow && bandTop < ex.bottom) return [];
    const span2 = spanInBand(ex, bandTop, bandBottom);
    if (!span2) continue;
    const l = Math.max(contentLeft, span2[0]);
    const r = Math.min(contentRight, span2[1]);
    if (r > l) blocked.push([l, r]);
  }
  if (!blocked.length) return [[contentLeft, contentRight]];
  blocked.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const b of blocked) {
    const last = merged[merged.length - 1];
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push([b[0], b[1]]);
  }
  const free = [];
  let x = contentLeft;
  for (const [l, r] of merged) {
    if (l - x > 0) free.push([x, l]);
    x = Math.max(x, r);
  }
  if (contentRight - x > 0) free.push([x, contentRight]);
  return free;
}
function spanInBand(ex, bandTop, bandBottom) {
  if (ex.bottom <= bandTop || ex.top >= bandBottom) return null;
  if (!ex.rows || !ex.rows.length) return [ex.left, ex.right];
  const rows = ex.rows;
  const opaque = (i) => rows[i + 2] - rows[i + 1] > 0;
  let l = Infinity;
  let r = -Infinity;
  for (let i = 0; i < rows.length; i += 3) {
    const y = rows[i];
    if (y < bandTop || y >= bandBottom) continue;
    if (!opaque(i)) continue;
    if (rows[i + 1] < l) l = rows[i + 1];
    if (rows[i + 2] > r) r = rows[i + 2];
  }
  if (l === Infinity) {
    let bestBelow = -1;
    let bestAbove = -1;
    for (let i = 0; i < rows.length; i += 3) {
      if (!opaque(i)) continue;
      if (rows[i] < bandTop) bestBelow = i;
      if (rows[i] >= bandBottom && bestAbove === -1) bestAbove = i;
    }
    for (const i of [bestBelow, bestAbove]) {
      if (i < 0) continue;
      if (rows[i + 1] < l) l = rows[i + 1];
      if (rows[i + 2] > r) r = rows[i + 2];
    }
  }
  if (l === Infinity || r <= l) return null;
  return [l, r];
}
function inflate(ex, m) {
  if (!m) return ex;
  const out = {
    left: ex.left - m,
    top: ex.top - m,
    right: ex.right + m,
    bottom: ex.bottom + m,
    rows: null,
    // the foot moves DOWN with the margin, exactly as the box's own bottom edge does: the caption
    // starts one margin below the last opaque row, which is the A carve's capTop to the pixel
    fullBelow: ex.fullBelow == null ? null : ex.fullBelow + m
  };
  if (ex.rows && ex.rows.length) {
    const rows = new Float64Array(ex.rows.length);
    for (let i = 0; i < ex.rows.length; i += 3) {
      rows[i] = ex.rows[i];
      const empty = ex.rows[i + 2] - ex.rows[i + 1] <= 0;
      rows[i + 1] = empty ? ex.rows[i + 1] : ex.rows[i + 1] - m;
      rows[i + 2] = empty ? ex.rows[i + 2] : ex.rows[i + 2] + m;
    }
    out.rows = rows;
  }
  return out;
}
function usable(intervals, minRun) {
  if (!minRun) return intervals;
  return intervals.filter((iv) => iv[1] - iv[0] >= minRun);
}

// src/wrap-runs.ts
var CJK = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-｠]/;
var MAX_BLOCKED_RUN = 400;
var STASH = /* @__PURE__ */ new WeakMap();
var MOUNT_ARGS = /* @__PURE__ */ new WeakMap();
var GEN_ALIGN = /* @__PURE__ */ new WeakMap();
var OBSERVERS = /* @__PURE__ */ new WeakMap();
function tripwireArmed() {
  return typeof navigator !== "undefined" && navigator.webdriver === true;
}
function tripwireLog() {
  const w = window;
  if (!w.__origamiRuns) w.__origamiRuns = { violations: [] };
  return w.__origamiRuns.violations;
}
function armTripwire(leaf) {
  if (!tripwireArmed()) return;
  tripwireLog();
  const obs = new MutationObserver((records) => {
    const detail = `run subtree mutated from outside wrap-runs (${records.length} record(s), first: ${records[0]?.type})`;
    tripwireLog().push(detail);
    throw new Error("[origami] " + detail);
  });
  obs.observe(leaf, { childList: true, characterData: true, subtree: true });
  OBSERVERS.set(leaf, obs);
}
function disarmTripwire(leaf) {
  const obs = OBSERVERS.get(leaf);
  if (!obs) return;
  obs.disconnect();
  OBSERVERS.delete(leaf);
}
var heldLeaf = null;
function holdRuns(leaf) {
  heldLeaf = leaf;
}
function isRunsHeld(leaf) {
  return heldLeaf === leaf;
}
function tokenize(text) {
  const toks = [];
  let i = 0;
  while (i < text.length) {
    const wsStart = i;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    const start = i;
    if (CJK.test(text[i])) {
      i++;
    } else {
      while (i < text.length && !/\s/.test(text[i]) && !CJK.test(text[i])) {
        i++;
        if (text[i - 1] === "-") break;
      }
    }
    toks.push({ wsStart, start, end: i });
  }
  return toks;
}
function lineHeightOf(cs) {
  const lh = parseFloat(cs.lineHeight);
  if (Number.isFinite(lh) && lh > 0) return lh;
  return (parseFloat(cs.fontSize) || 16) * 1.5;
}
function runnable(leaf) {
  if (leaf.querySelector("br,img,svg,hr,input,canvas,video,iframe,object,embed")) return false;
  const t = leaf.textContent ?? "";
  return !/[\r\n\t]/.test(t) && !t.includes("  ");
}
function runsMounted(leaf) {
  return leaf.hasAttribute("data-orun");
}
function pseudoAdvance(leaf, cs) {
  if (getComputedStyle(leaf, "::before").content === "none" && getComputedStyle(leaf, "::after").content === "none") {
    return { pre: 0, post: 0 };
  }
  const tip = document.createElement("span");
  tip.setAttribute("aria-hidden", "true");
  tip.style.cssText = "display:inline-block;width:0;height:0;";
  leaf.appendChild(tip);
  const align = leaf.style.textAlign;
  leaf.style.textAlign = "left";
  const lr0 = leaf.getBoundingClientRect();
  const pre = tip.getBoundingClientRect().left - (lr0.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0));
  leaf.style.textAlign = "right";
  const lr1 = leaf.getBoundingClientRect();
  const post = lr1.right - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0) - tip.getBoundingClientRect().right;
  if (align) leaf.style.textAlign = align;
  else leaf.style.removeProperty("text-align");
  tip.remove();
  return { pre: Math.max(0, pre), post: Math.max(0, post) };
}
function mountRuns(leaf, exclusions, minRun) {
  if (runsMounted(leaf)) releaseRuns(leaf);
  if (!runnable(leaf)) return null;
  const cs = getComputedStyle(leaf);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const padB = parseFloat(cs.paddingBottom) || 0;
  const bT = parseFloat(cs.borderTopWidth) || 0;
  const bB = parseFloat(cs.borderBottomWidth) || 0;
  const measure = leaf.clientWidth - padL - padR;
  if (!(measure > 0)) return null;
  const lh = lineHeightOf(cs);
  const clone = leaf.cloneNode(true);
  const stash = document.createDocumentFragment();
  while (leaf.firstChild) stash.appendChild(leaf.firstChild);
  const gen = pseudoAdvance(leaf, cs);
  if (gen.post > 0.5) {
    leaf.appendChild(stash);
    return null;
  }
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;white-space:pre;width:max-content;max-width:none;pointer-events:none;";
  while (clone.firstChild) probe.appendChild(clone.firstChild);
  leaf.appendChild(probe);
  const nodes = [];
  const walk = document.createTreeWalker(probe, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) nodes.push(n);
  const text = nodes.map((n) => n.data).join("");
  const startPoint = (k) => {
    let acc = 0;
    for (const n of nodes) {
      if (k < acc + n.data.length) return [n, k - acc];
      acc += n.data.length;
    }
    const last = nodes[nodes.length - 1];
    return last ? [last, last.data.length] : [probe, 0];
  };
  const endPoint = (k) => {
    let acc = 0;
    for (const n of nodes) {
      if (k <= acc + n.data.length) return [n, k - acc];
      acc += n.data.length;
    }
    const last = nodes[nodes.length - 1];
    return last ? [last, last.data.length] : [probe, 0];
  };
  const range = document.createRange();
  const rangeOver = (a, b) => {
    const [sn, so] = startPoint(a);
    const [en, eo] = endPoint(b);
    range.setStart(sn, so);
    range.setEnd(en, eo);
    return range;
  };
  const cache = /* @__PURE__ */ new Map();
  const widthOf = (a, b) => {
    if (b <= a) return 0;
    const key = a * 1e6 + b;
    const hit = cache.get(key);
    if (hit !== void 0) return hit;
    const w = rangeOver(a, b).getBoundingClientRect().width;
    cache.set(key, w);
    return w;
  };
  const toks = tokenize(text);
  const lines = [];
  const mr = Math.min(minRun, measure);
  let ti = 0;
  let y = 0;
  let blocked = 0;
  let genX = -1;
  const firstW = toks.length ? widthOf(toks[0].start, toks[0].end) : 0;
  while (ti < toks.length) {
    let ivs = usable(freeIntervals(y, y + lh, 0, measure, exclusions), mr);
    if (gen.pre > 0 && y === 0) {
      const seated = [];
      for (const [a, b] of ivs) {
        if (genX < 0) {
          if (b - (a + gen.pre) >= firstW - 0.5) {
            genX = a;
            seated.push([a + gen.pre, b]);
          }
        } else seated.push([a, b]);
      }
      if (genX < 0) break;
      ivs = seated;
    }
    const runs = [];
    for (const [a, b] of ivs) {
      if (ti >= toks.length) break;
      const runStart = ti;
      let end = -1;
      while (ti < toks.length) {
        const w = widthOf(toks[runStart].start, toks[ti].end);
        if (a + w <= b + 0.5) {
          end = toks[ti].end;
          ti++;
        } else break;
      }
      if (end < 0) continue;
      runs.push({ s: toks[runStart].start, e: end, emitS: 0, emitE: 0, x: a });
    }
    if (runs.length) {
      lines.push({ y, runs });
      blocked = 0;
    } else {
      let wide = null;
      for (const iv of ivs) if (!wide || iv[1] - iv[0] > wide[1] - wide[0]) wide = iv;
      const full = wide !== null && wide[1] - wide[0] >= measure - 0.5;
      if (full || ++blocked > MAX_BLOCKED_RUN) {
        const t = toks[ti++];
        lines.push({ y, runs: [{ s: t.start, e: t.end, emitS: 0, emitE: 0, x: wide ? wide[0] : 0 }] });
        blocked = 0;
      }
    }
    y += lh;
  }
  if (gen.pre > 0 && !(lines.length && lines[0].y === 0 && Math.abs(lines[0].runs[0].x - (genX + gen.pre)) < 0.5)) {
    probe.remove();
    leaf.appendChild(stash);
    return null;
  }
  const height = lines.length ? lines[lines.length - 1].y + lh : lh;
  const flat = [];
  for (const ln of lines) for (const r of ln.runs) flat.push(r);
  for (let i2 = 0; i2 < flat.length; i2++) {
    flat[i2].emitS = i2 === 0 ? 0 : flat[i2].s;
    flat[i2].emitE = i2 === flat.length - 1 ? text.length : flat[i2 + 1].s;
  }
  if (flat.length) flat[0].x -= widthOf(0, flat[0].s);
  const frags = flat.map((r) => rangeOver(r.emitS, r.emitE).cloneContents());
  probe.remove();
  STASH.set(leaf, stash);
  const out = document.createDocumentFragment();
  let i = 0;
  for (const ln of lines) {
    for (const r of ln.runs) {
      const el6 = document.createElement("span");
      el6.className = "o-run";
      el6.style.cssText = `left:${r.x + padL}px;top:${ln.y + padT}px;height:${lh}px;line-height:${lh}px;`;
      el6.appendChild(frags[i++]);
      out.appendChild(el6);
    }
  }
  const border = cs.boxSizing === "border-box" ? padT + padB + bT + bB : 0;
  leaf.style.height = `${height + border}px`;
  if (gen.pre > 0) {
    leaf.style.textIndent = `${genX}px`;
    GEN_ALIGN.set(leaf, leaf.style.textAlign);
    leaf.style.textAlign = "left";
  }
  leaf.setAttribute("data-orun", "");
  leaf.appendChild(out);
  MOUNT_ARGS.set(leaf, { exclusions, minRun });
  armTripwire(leaf);
  return height;
}
function releaseRuns(leaf) {
  disarmTripwire(leaf);
  const stash = STASH.get(leaf);
  leaf.removeAttribute("data-orun");
  leaf.style.removeProperty("height");
  leaf.style.removeProperty("text-indent");
  const align = GEN_ALIGN.get(leaf);
  if (align !== void 0) {
    GEN_ALIGN.delete(leaf);
    if (align) leaf.style.textAlign = align;
    else leaf.style.removeProperty("text-align");
  }
  if (!stash) return;
  STASH.delete(leaf);
  while (leaf.firstChild) leaf.removeChild(leaf.firstChild);
  leaf.appendChild(stash);
}
function withSource(root, fn) {
  const mounted = runsMounted(root) ? [root] : [];
  for (const el6 of Array.from(root.querySelectorAll("[data-orun]"))) mounted.push(el6);
  if (mounted.length === 0) return fn();
  const args = mounted.map((leaf) => MOUNT_ARGS.get(leaf) ?? null);
  for (const leaf of mounted) releaseRuns(leaf);
  try {
    return fn();
  } finally {
    for (let i = 0; i < mounted.length; i++) {
      const leaf = mounted[i];
      const a = args[i];
      if (a && leaf.isConnected && root.contains(leaf) && !isRunsHeld(leaf)) mountRuns(leaf, a.exclusions, a.minRun);
    }
  }
}
function releaseRunsIn(root) {
  if (runsMounted(root)) releaseRuns(root);
  for (const leaf of Array.from(root.querySelectorAll("[data-orun]"))) releaseRuns(leaf);
}

// src/document.ts
function roman(n) {
  const T = [
    [1e3, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"]
  ];
  let out = "";
  for (const [v, s2] of T) while (n >= v) {
    out += s2;
    n -= v;
  }
  return out;
}
function alpha(n) {
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = (n - 1 - r) / 26;
  }
  return out;
}
function styled(n, style) {
  if (style === "upper-roman") return roman(n);
  if (style === "lower-roman") return roman(n).toLowerCase();
  if (style === "upper-alpha") return alpha(n);
  if (style === "lower-alpha") return alpha(n).toLowerCase();
  return String(n);
}
function renderDocToc(slide, interactive) {
  const mounts = slide.querySelectorAll("nav.o-toc[data-toc-mount]");
  if (mounts.length === 0) return;
  const heads = Array.from(slide.querySelectorAll(".o-doc h2, .o-doc h3"));
  let h2 = 0;
  let h3 = 0;
  const entries = heads.map((el6, idx) => {
    const isH2 = el6.tagName === "H2";
    const numbered = el6.getAttribute("data-onum") !== "off";
    if (isH2) {
      if (numbered) h2++;
      h3 = 0;
    } else if (numbered) {
      h3++;
    }
    const st = el6.getAttribute("data-onumst");
    const pre = el6.getAttribute("data-opre") ?? "";
    return {
      level: isH2 ? 2 : 3,
      num: numbered ? pre + (isH2 ? styled(h2, st) : `${styled(h2, st)}.${styled(h3, st)}`) : pre.trim(),
      text: (el6.textContent ?? "").trim(),
      el: el6,
      idx,
      listed: !el6.hasAttribute("data-onotoc")
    };
  });
  const groups = [];
  let open = null;
  for (const e of entries) {
    if (e.level === 2) {
      open = { row: e.listed ? e : null, kids: [] };
      groups.push(open);
    } else if (e.listed) {
      if (open) open.kids.push(e);
      else groups.push({ row: null, kids: [e] });
    }
  }
  const mkRow = (e, parent) => {
    const a = document.createElement("a");
    a.className = "o-toc-row o-toc-l" + e.level;
    a.setAttribute("data-oidx", String(e.idx));
    const label = document.createElement("span");
    label.className = "o-toc-label";
    label.textContent = e.num ? e.num + "  " + e.text : e.text;
    const page = document.createElement("span");
    page.className = "o-toc-pageno";
    a.appendChild(label);
    a.appendChild(page);
    if (interactive) {
      a.setAttribute("href", "#");
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        e.el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    parent.appendChild(a);
    return a;
  };
  for (const mount of mounts) {
    mount.textContent = "";
    for (const g of groups) {
      if (!g.row) {
        for (const k of g.kids) mkRow(k, mount);
        continue;
      }
      const grp = document.createElement("div");
      grp.className = "o-toc-grp";
      mount.appendChild(grp);
      const row = mkRow(g.row, grp);
      if (g.kids.length > 0) {
        const tw = document.createElement("button");
        tw.className = "o-toc-tw";
        tw.type = "button";
        tw.setAttribute("aria-label", "Fold this section");
        row.insertBefore(tw, row.firstChild);
        if (interactive) {
          tw.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            grp.classList.toggle("collapsed");
          });
        }
        const kids = document.createElement("div");
        kids.className = "o-toc-kids";
        grp.appendChild(kids);
        for (const k of g.kids) mkRow(k, kids);
      }
    }
  }
}
function lengthPx(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return v.trim().endsWith("mm") ? n * 96 / 25.4 : n;
}
var PGBG_HEX = /^#[0-9a-fA-F]{3,8}$/;
function pageBgEntries(doc) {
  let raw;
  try {
    raw = JSON.parse(doc.getAttribute("data-opgbg") || "{}");
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d{1,4}$/.test(k)) continue;
    if (typeof v !== "string" || !PGBG_HEX.test(v)) continue;
    out.push([Number(k), v]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
function applyPageBgLayer(doc, sheet) {
  const entries = pageBgEntries(doc);
  if (entries.length === 0 || !(sheet > 0)) {
    doc.style.removeProperty("--opgbg-layer");
    return;
  }
  const stops = ["transparent 0"];
  for (const [k, hex3] of entries) {
    const a = (k * sheet).toFixed(2);
    const b = ((k + 1) * sheet).toFixed(2);
    stops.push(`transparent ${a}px`, `${hex3} ${a}px ${b}px`, `transparent ${b}px`);
  }
  stops.push("transparent 100%");
  doc.style.setProperty("--opgbg-layer", `linear-gradient(to bottom, ${stops.join(", ")})`);
}
function cappable(b) {
  return b.classList.contains("o-text");
}
function pageRoomFor(b) {
  const doc = b.parentElement;
  if (!doc || !doc.classList.contains("o-doc") || !doc.hasAttribute("data-opage")) return Infinity;
  const cs = getComputedStyle(doc);
  const sheet = lengthPx(cs.getPropertyValue("--oph"));
  if (!(sheet > 20)) return Infinity;
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const top = b.offsetTop;
  return (Math.floor(top / sheet) + 1) * sheet - padBottom - top;
}
function lineHeightOf2(b) {
  const cs = getComputedStyle(b);
  const lh = parseFloat(cs.lineHeight);
  if (Number.isFinite(lh) && lh > 0) return lh;
  return (parseFloat(cs.fontSize) || 16) * 1.5;
}
function docBlockFull(b) {
  if (!cappable(b)) return false;
  const room = pageRoomFor(b);
  if (!Number.isFinite(room)) return false;
  return b.offsetHeight + lineHeightOf2(b) > room;
}
var BAND_GAP = 12;
var WRAP_MIN_DEFAULT = 56;
function wrapOptsOf(layer) {
  const num2 = (name, fallback) => {
    const v = parseFloat(layer.getAttribute(name) ?? "");
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  return {
    margin: num2("data-owm", BAND_GAP),
    minRun: num2("data-owmin", WRAP_MIN_DEFAULT),
    flow: layer.getAttribute("data-oflow")
  };
}
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
function wrapBoxOf(layer, frame, s2) {
  const fr = frame.getBoundingClientRect();
  const lr = layer.getBoundingClientRect();
  const box = {
    left: (lr.left - fr.left) / s2,
    top: (lr.top - fr.top) / s2,
    right: (lr.right - fr.left) / s2,
    bottom: (lr.bottom - fr.top) / s2,
    rows: null,
    rowH: 0,
    opaqueBottom: (lr.bottom - fr.top) / s2
  };
  const img = layer.matches("figure.o-img") ? layer.querySelector(":scope > img") : null;
  if (!img) return box;
  const ir = img.getBoundingClientRect();
  if (!(ir.width > 0 && ir.height > 0)) return box;
  const iL = (ir.left - fr.left) / s2;
  const iT = (ir.top - fr.top) / s2;
  const iW = ir.width / s2;
  const iH = ir.height / s2;
  box.left = iL;
  box.top = iT;
  box.right = iL + iW;
  box.bottom = iT + iH;
  const scan = alphaScanOf(img);
  if (scan) {
    box.left = iL + scan.l * iW;
    box.right = iL + scan.r * iW;
    box.top = iT + scan.t * iH;
    box.bottom = iT + scan.b * iH;
    if (scan.rows) {
      const rows = new Float64Array(scan.rows.length);
      for (let i = 0; i < scan.rows.length; i += 3) {
        rows[i] = iT + scan.rows[i] * iH;
        rows[i + 1] = iL + scan.rows[i + 1] * iW;
        rows[i + 2] = iL + scan.rows[i + 2] * iW;
      }
      box.rows = rows;
      box.rowH = scan.rowH * iH;
    }
  }
  box.opaqueBottom = box.bottom;
  const cap2 = layer.querySelector("figcaption");
  if (cap2 && (cap2.textContent ?? "").trim() !== "") {
    const cr = cap2.getBoundingClientRect();
    if (cr.height > 0) box.bottom = Math.max(box.bottom, (cr.bottom - fr.top) / s2);
  }
  return box;
}
function stampWrapBox(layer, ex, frame, s2) {
  const fr = frame.getBoundingClientRect();
  const lr = layer.getBoundingClientRect();
  const set = (name, v) => {
    if (v > 0.5) layer.style.setProperty(name, `${Math.round(v * 10) / 10}px`);
    else layer.style.removeProperty(name);
  };
  set("--owdb-t", ex.top - (lr.top - fr.top) / s2);
  set("--owdb-r", (lr.right - fr.left) / s2 - ex.right);
  set("--owdb-b", (lr.bottom - fr.top) / s2 - ex.bottom);
  set("--owdb-l", ex.left - (lr.left - fr.left) / s2);
}
function releaseWrapBox(layer) {
  layer.style.removeProperty("--owdb-t");
  layer.style.removeProperty("--owdb-r");
  layer.style.removeProperty("--owdb-b");
  layer.style.removeProperty("--owdb-l");
}
function wrappable(b) {
  const t = b.tagName;
  return t === "P" || t === "UL" || t === "OL" || t === "H1" || t === "H2" || t === "H3" || t === "H4" || t === "BLOCKQUOTE" || b.classList.contains("o-text") || b.classList.contains("o-callout") || b.classList.contains("o-tcols");
}
function wrapShapeFor(b, layer, frame, s2) {
  if (!wrappable(b)) return null;
  const w = wrapOptsOf(layer);
  const fr = frame.getBoundingClientRect();
  const fcs = getComputedStyle(frame);
  const colL = (parseFloat(fcs.borderLeftWidth) || 0) + (parseFloat(fcs.paddingLeft) || 0);
  const colR = frame.offsetWidth - (parseFloat(fcs.borderRightWidth) || 0) - (parseFloat(fcs.paddingRight) || 0);
  const ex = wrapBoxOf(layer, frame, s2);
  const roomLeft = Math.max(0, ex.left - colL - w.margin);
  const roomRight = Math.max(0, colR - ex.right - w.margin);
  const near = roomLeft <= roomRight ? "left" : "right";
  const bcs = getComputedStyle(b);
  const br = b.getBoundingClientRect();
  const blockL = (br.left - fr.left) / s2 + (parseFloat(bcs.borderLeftWidth) || 0) + (parseFloat(bcs.paddingLeft) || 0);
  const blockR = (br.right - fr.left) / s2 - (parseFloat(bcs.borderRightWidth) || 0) - (parseFloat(bcs.paddingRight) || 0);
  if (!(blockR - blockL > 0)) return null;
  const taken = near === "left" ? ex.right + w.margin - blockL : blockR - (ex.left - w.margin);
  if (!(taken > 0)) return null;
  return { ex, margin: w.margin, minRun: w.minRun, blocked: blockR - blockL - taken < w.minRun };
}
var LEAF_TAGS = /* @__PURE__ */ new Set(["P", "H1", "H2", "H3", "H4", "FOOTER"]);
function runLeaves(b) {
  const self = LEAF_TAGS.has(b.tagName);
  const kids = (el6) => Array.from(el6.children).filter((n) => n instanceof HTMLElement);
  let leaves;
  if (self) leaves = [b];
  else if (b.classList.contains("o-tcols")) {
    const cols = kids(b);
    if (!cols.length || !cols.every((c) => c.classList.contains("o-text"))) return null;
    leaves = cols.flatMap(kids);
  } else leaves = kids(b);
  if (!self && leaves.some((n) => !LEAF_TAGS.has(n.tagName))) return null;
  if (!leaves.length) return null;
  return leaves.every(runnable) ? leaves : null;
}
function leafOrigin(leaf, frame) {
  let x = 0;
  let y = 0;
  for (let el6 = leaf; el6 && el6 !== frame; el6 = el6.offsetParent) {
    if (el6.hasAttribute("data-ofloat")) {
      const fr = frame.getBoundingClientRect();
      const lr = el6.getBoundingClientRect();
      const raw = frame.offsetWidth > 0 ? fr.width / frame.offsetWidth : 1;
      const s2 = raw > 0.01 ? raw : 1;
      const lcs = getComputedStyle(el6);
      x += (lr.left - fr.left) / s2 + (parseFloat(lcs.borderLeftWidth) || 0);
      y += (lr.top - fr.top) / s2 + (parseFloat(lcs.borderTopWidth) || 0);
      break;
    }
    x += el6.offsetLeft;
    y += el6.offsetTop;
  }
  const cs = getComputedStyle(leaf);
  return {
    x: x + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0),
    y: y + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0)
  };
}
function toLeafExclusion(shape, band, lx, ly) {
  const cap2 = shape.ex.bottom > shape.ex.opaqueBottom + 0.5 ? shape.ex.opaqueBottom : null;
  const inf = inflate({ ...shape.ex, fullBelow: cap2 }, shape.margin);
  const dy = band.top - inf.top;
  const rows = inf.rows;
  let out = null;
  if (rows) {
    out = new Float64Array(rows.length);
    for (let i = 0; i < rows.length; i += 3) {
      out[i] = rows[i] + dy - ly;
      out[i + 1] = rows[i + 1] - lx;
      out[i + 2] = rows[i + 2] - lx;
    }
  }
  return {
    left: inf.left - lx,
    right: inf.right - lx,
    top: inf.top + dy - ly,
    bottom: inf.bottom + dy - ly,
    rows: out,
    fullBelow: inf.fullBelow == null ? null : inf.fullBelow + dy - ly
  };
}
function applyRuns(b, shape, band, bTop, frame) {
  const cs = getComputedStyle(b);
  const cTop = bTop + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
  if (!(band.bottom > cTop + 0.5 && band.top < bTop + b.offsetHeight - 0.5)) return false;
  if (shape.blocked && band.top - cTop < lineHeightOf2(b)) return false;
  const leaves = runLeaves(b);
  if (leaves === null) return false;
  let met = false;
  for (const leaf of leaves) {
    const o = leafOrigin(leaf, frame);
    if (!(band.bottom > o.y - 0.5 && band.top < o.y + leaf.offsetHeight - 0.5)) {
      releaseRunsIn(leaf);
      continue;
    }
    met = true;
    if (isRunsHeld(leaf)) continue;
    if (mountRuns(leaf, [toLeafExclusion(shape, band, o.x, o.y)], shape.minRun) === null) {
      releaseRunsIn(b);
      return false;
    }
  }
  return met;
}
function pinLayerWidth(el6) {
  if (el6.hasAttribute("data-obwpin")) return;
  const w = getComputedStyle(el6).width;
  if (!/^[\d.]+px$/.test(w)) return;
  el6.setAttribute("data-obwidth", el6.style.width);
  el6.style.width = w;
  el6.setAttribute("data-obwpin", el6.style.width);
}
function releaseLayerWidth(el6) {
  const pinned = el6.getAttribute("data-obwpin");
  if (pinned === null) return;
  if (el6.style.width === pinned) {
    const prev = el6.getAttribute("data-obwidth") ?? "";
    if (prev) el6.style.width = prev;
    else el6.style.removeProperty("width");
  }
  el6.removeAttribute("data-obwpin");
  el6.removeAttribute("data-obwidth");
}
function wrapLayerOnLayer(layers, frame, s2) {
  const pics = [];
  for (const el6 of layers) {
    if (!el6.matches("figure.o-img")) continue;
    const w = wrapOptsOf(el6);
    pics.push({ ex: wrapBoxOf(el6, frame, s2), margin: w.margin, minRun: w.minRun, blocked: false });
  }
  if (!pics.length) return;
  for (const layer of layers) {
    if (layer.matches("figure.o-img")) continue;
    const lb = wrapBoxOf(layer, frame, s2);
    const over = pics.filter(
      (p) => p.ex.right + p.margin > lb.left && p.ex.left - p.margin < lb.right && p.ex.bottom + p.margin > lb.top && p.ex.top - p.margin < lb.bottom
    );
    if (!over.length) continue;
    const leaves = runLeaves(layer);
    if (leaves === null) continue;
    const minRun = Math.max(...over.map((p) => p.minRun));
    const layerTop = (el6) => (el6.getBoundingClientRect().top - frame.getBoundingClientRect().top) / s2;
    const want = layerTop(layer);
    pinLayerWidth(layer);
    let placed = true;
    for (const leaf of leaves) {
      if (isRunsHeld(leaf)) continue;
      const o = leafOrigin(leaf, frame);
      const ex = over.map((p) => toLeafExclusion(p, { top: p.ex.top - p.margin, bottom: p.ex.bottom + p.margin }, o.x, o.y));
      if (mountRuns(leaf, ex, minRun) === null) {
        placed = false;
        break;
      }
      pinLayerTop(layer, want, layerTop);
    }
    if (!placed) {
      releaseRunsIn(layer);
      releaseLayerWidth(layer);
      releaseLayerTop(layer);
    }
  }
}
function prepareFloatBands(doc) {
  const kids = Array.from(doc.children).filter((n) => n instanceof HTMLElement);
  releaseFloatBands(doc);
  const dr = doc.getBoundingClientRect();
  const scale = doc.offsetWidth > 0 ? dr.width / doc.offsetWidth : 1;
  const s2 = scale > 0.01 ? scale : 1;
  const topOf = (el6) => (el6.getBoundingClientRect().top - dr.top) / s2;
  const layers = [];
  for (const el6 of kids) {
    if (!el6.hasAttribute("data-ofloat")) continue;
    if (wrapOptsOf(el6).flow) continue;
    const z = parseInt(getComputedStyle(el6).zIndex, 10);
    if (Number.isFinite(z) && z < 0) continue;
    if (el6.style.top.trim().endsWith("%")) continue;
    layers.push(el6);
  }
  if (layers.length === 0) return null;
  wrapLayerOnLayer(layers, doc, s2);
  const bands = layers.map((el6) => {
    const m = wrapOptsOf(el6).margin;
    const ex = wrapBoxOf(el6, doc, s2);
    stampWrapBox(el6, ex, doc, s2);
    return { top: ex.top - m, bottom: ex.bottom + m };
  });
  const flow = kids.filter((b) => !b.hasAttribute("data-ofloat") && !b.classList.contains("o-doc-bg"));
  return { kids, layers, bands, layerAt: layers.map((el6) => kids.indexOf(el6)), flow, s: s2, topOf };
}
function reserveFloatBands(doc) {
  const fb = prepareFloatBands(doc);
  if (fb === null) return;
  const active = [];
  let next = 0;
  for (const b of fb.flow) {
    const at = fb.kids.indexOf(b);
    while (next < fb.layers.length && fb.layerAt[next] < at) active.push(next++);
    if (active.length === 0) continue;
    settleBlock(b, splitFloor(b, active, fb.layers, fb.bands, doc, fb.s, fb.topOf), fb.bands, fb.topOf, doc);
  }
}
function splitFloor(b, active, layers, bands, frame, s2, topOf) {
  const top = topOf(b);
  const bottom = top + b.offsetHeight;
  let floor = -Infinity;
  let shape = null;
  let shapeAt = -1;
  for (const i of active) {
    if (shape === null && bands[i].bottom > top + 0.5 && bands[i].top < bottom - 0.5) {
      const c = wrapShapeFor(b, layers[i], frame, s2);
      if (c !== null) {
        shape = c;
        shapeAt = i;
        continue;
      }
    }
    if (bands[i].bottom > floor) floor = bands[i].bottom;
  }
  return { floor, shape, shapeAt };
}
function settleBlock(b, split, bands, topOf, frame) {
  const { floor, shape, shapeAt } = split;
  const top = floor === -Infinity ? topOf(b) : pushClear(b, floor, topOf);
  if (shape === null) return;
  if (applyRuns(b, shape, bands[shapeAt], top, frame)) return;
  pushClear(b, Math.max(floor, bands[shapeAt].bottom), topOf);
}
function pushClear(b, floor, topOf) {
  const top = topOf(b);
  if (top >= floor - 0.5) return top;
  b.setAttribute("data-oband", "");
  let gap = (parseFloat(getComputedStyle(b).marginTop) || 0) + (floor - top);
  b.style.setProperty("--obgap", `${gap}px`);
  const err = topOf(b) - floor;
  if (Math.abs(err) > 0.5) {
    gap -= err;
    b.style.setProperty("--obgap", `${gap}px`);
  }
  return topOf(b);
}
function releaseFloatBands(doc) {
  for (const k of Array.from(doc.children)) {
    if (!(k instanceof HTMLElement)) continue;
    k.removeAttribute("data-oband");
    k.removeAttribute("data-obfall");
    k.style.removeProperty("--obgap");
    releaseRunsIn(k);
    releaseLayerWidth(k);
    releaseLayerTop(k);
    releaseWrapBox(k);
  }
}
function reserveCardBands(inner) {
  const kids = Array.from(inner.children).filter((n) => n instanceof HTMLElement);
  releaseCardBands(inner);
  if (inner.classList.contains("o-doc")) return;
  if (inner.offsetWidth === 0 && inner.offsetHeight === 0) return;
  const layers = kids.filter((el6) => {
    if (!el6.hasAttribute("data-ofloat")) return false;
    if (wrapOptsOf(el6).flow) return false;
    const z = parseInt(getComputedStyle(el6).zIndex, 10);
    return !(Number.isFinite(z) && z < 0);
  });
  const flow = kids.filter((b) => !b.hasAttribute("data-ofloat") && !b.classList.contains("o-doc-bg"));
  if (layers.length === 0) return;
  const frameTop = (el6) => {
    const fr = inner.getBoundingClientRect();
    const scale = inner.offsetWidth > 0 ? fr.width / inner.offsetWidth : 1;
    return (el6.getBoundingClientRect().top - fr.top) / (scale > 0.01 ? scale : 1);
  };
  const fr0 = inner.getBoundingClientRect();
  const sc = inner.offsetWidth > 0 ? fr0.width / inner.offsetWidth : 1;
  const s2 = sc > 0.01 ? sc : 1;
  wrapLayerOnLayer(layers, inner, s2);
  if (flow.length === 0) return;
  const anchor = layers.map(frameTop);
  const bands = layers.map((el6) => {
    const m = wrapOptsOf(el6).margin;
    const ex = wrapBoxOf(el6, inner, s2);
    stampWrapBox(el6, ex, inner, s2);
    return { top: ex.top - m, bottom: ex.bottom + m };
  });
  const layerAt = layers.map((el6) => kids.indexOf(el6));
  const active = [];
  let next = 0;
  for (const b of flow) {
    const at = kids.indexOf(b);
    while (next < layers.length && layerAt[next] < at) active.push(next++);
    if (active.length === 0) continue;
    settleBlock(b, splitFloor(b, active, layers, bands, inner, s2, (el6) => el6.offsetTop), bands, (el6) => el6.offsetTop, inner);
  }
  layers.forEach((el6, i) => pinLayerTop(el6, anchor[i], frameTop));
}
function bandSlot(inner, layer) {
  const kids = Array.from(inner.children).filter((n) => n instanceof HTMLElement);
  const fr = inner.getBoundingClientRect();
  const scale = inner.offsetWidth > 0 ? fr.width / inner.offsetWidth : 1;
  const bandTop = wrapBoxOf(layer, inner, scale > 0.01 ? scale : 1).top - wrapOptsOf(layer).margin;
  const sibs = kids.filter((n) => n !== layer);
  const at = sibs.findIndex(
    (n) => !n.hasAttribute("data-ofloat") && !n.classList.contains("o-doc-bg") && n.offsetTop + n.offsetHeight > bandTop
  );
  return at === -1 ? Math.max(0, kids.length - 1) : at;
}
function releaseCardBands(inner) {
  for (const n of Array.from(inner.children)) {
    if (!(n instanceof HTMLElement)) continue;
    n.removeAttribute("data-oband");
    n.style.removeProperty("--obgap");
    releaseRunsIn(n);
    releaseLayerWidth(n);
    releaseWrapBox(n);
    releaseLayerTop(n);
  }
}
function pinLayerTop(el6, want, frameTop) {
  const now = frameTop(el6);
  if (Math.abs(now - want) <= 0.5) return;
  const cur = parseFloat(getComputedStyle(el6).top);
  if (!Number.isFinite(cur)) return;
  if (!el6.hasAttribute("data-obtop")) el6.setAttribute("data-obtop", el6.style.top);
  let v = cur + (want - now);
  el6.style.top = `${v}px`;
  const err = frameTop(el6) - want;
  if (Math.abs(err) > 0.5) {
    v -= err;
    el6.style.top = `${v}px`;
  }
  el6.setAttribute("data-obpin", el6.style.top);
}
function releaseLayerTop(el6) {
  const pinned = el6.getAttribute("data-obpin");
  if (pinned === null) return;
  if (el6.style.top === pinned) {
    const prev = el6.getAttribute("data-obtop") ?? "";
    if (prev) el6.style.top = prev;
    else el6.style.removeProperty("top");
  }
  el6.removeAttribute("data-obpin");
  el6.removeAttribute("data-obtop");
}
function reserveCardBandsWhenSettled(slide) {
  const inner = slide.querySelector(".slide-inner:not(.o-doc)");
  if (!inner) return;
  const run = () => reserveCardBands(inner);
  requestAnimationFrame(run);
  const fonts = document.fonts;
  fonts?.ready?.then(run).catch(() => {
  });
  for (const img of Array.from(slide.querySelectorAll("img"))) {
    if (!img.complete) img.addEventListener("load", run, { once: true });
  }
}
var SETTLE_PASSES = 3;
function paginateDoc(slide) {
  const doc = slide.querySelector(".o-doc");
  if (!doc) return 0;
  if (doc.offsetWidth === 0 && doc.offsetHeight === 0) return 0;
  if (!doc.hasAttribute("data-opage")) {
    for (const b of Array.from(doc.children)) {
      if (b instanceof HTMLElement) {
        b.removeAttribute("data-opagetop");
        b.style.removeProperty("--opgap");
        b.removeAttribute("data-ofull");
        b.style.removeProperty("--opfill");
      }
    }
    doc.style.removeProperty("--opgbg-layer");
    reserveFloatBands(doc);
    for (const cell of Array.from(slide.querySelectorAll("nav.o-toc .o-toc-pageno"))) {
      cell.textContent = "";
    }
    renderPageFurniture(slide, 0);
    return 0;
  }
  const cs = getComputedStyle(doc);
  const sheet = lengthPx(cs.getPropertyValue("--oph"));
  const padTop = parseFloat(cs.paddingTop) || 0;
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const usable2 = sheet - padTop - padBottom;
  applyPageBgLayer(doc, sheet);
  const blocks = Array.from(doc.children).filter(
    (n) => n instanceof HTMLElement && !n.classList.contains("o-doc-bg") && !n.hasAttribute("data-ofloat")
  );
  for (const b of blocks) {
    b.removeAttribute("data-opagetop");
    b.removeAttribute("data-opgbrk");
    b.style.removeProperty("--opgap");
    b.removeAttribute("data-ofull");
    b.style.removeProperty("--opfill");
    b.removeAttribute("data-obfall");
  }
  const fb = prepareFloatBands(doc);
  if (!(usable2 > 20) || blocks.length === 0) return 1;
  const pageOf = /* @__PURE__ */ new Map();
  let forceTop = false;
  const active = [];
  let nextLayer = 0;
  let prevActive = 0;
  const bandSettle = (b, list) => {
    if (fb === null || list.length === 0) return;
    settleBlock(b, splitFloor(b, list, fb.layers, fb.bands, doc, fb.s, fb.topOf), fb.bands, fb.topOf, doc);
  };
  const toPageLine = (b, target) => {
    const top = b.offsetTop;
    b.setAttribute("data-opagetop", "");
    const base = parseFloat(getComputedStyle(b).marginTop) || 0;
    b.style.setProperty("--opgap", `${target - top + base}px`);
    const err = b.offsetTop - target;
    if (Math.abs(err) > 0.5) b.style.setProperty("--opgap", `${target - top + base - err}px`);
    return b.offsetTop;
  };
  const pageSettle = (b, bi, wasForced) => {
    let top = b.offsetTop;
    let k = Math.floor(top / sheet);
    const textTop = k * sheet + padTop;
    if (top < textTop - 0.5) top = toPageLine(b, textTop);
    const h = b.offsetHeight;
    k = Math.floor(top / sheet);
    const bandBottom = (k + 1) * sheet - padBottom - PAGE_EPS;
    const atTop = Math.abs(top - (k * sheet + padTop)) < 1;
    const straddles = top + h > bandBottom && h <= usable2 && !cappable(b);
    const noRoom = cappable(b) && bandBottom - top < lineHeightOf2(b);
    if (!(wasForced && !atTop || !wasForced && (straddles || noRoom))) return false;
    const prev = bi > 0 ? blocks[bi - 1] : null;
    const keep = prev !== null && (prev.tagName === "H2" || prev.tagName === "H3") && !prev.hasAttribute("data-opagetop") && Math.floor(prev.offsetTop / sheet) === k;
    if (keep && prev) {
      toPageLine(prev, (k + 1) * sheet + padTop);
      bandSettle(prev, active.slice(0, prevActive));
      pageOf.set(prev, Math.floor(prev.offsetTop / sheet));
      return true;
    }
    if (wasForced) b.setAttribute("data-opgbrk", "");
    toPageLine(b, (k + 1) * sheet + padTop);
    return false;
  };
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    const wasForced = forceTop;
    forceTop = b.classList.contains("o-pagebreak");
    if (fb !== null) {
      const at = fb.kids.indexOf(b);
      while (nextLayer < fb.layers.length && fb.layerAt[nextLayer] < at) active.push(nextLayer++);
    }
    let kept = false;
    if (fb === null || active.length === 0) {
      kept = pageSettle(b, bi, wasForced);
    } else {
      for (let pass = 0; ; pass++) {
        const before = b.offsetTop;
        bandSettle(b, active);
        kept = pageSettle(b, bi, wasForced) || kept;
        if (Math.abs(b.offsetTop - before) < 0.5) break;
        if (pass >= SETTLE_PASSES) {
          b.setAttribute("data-obfall", "");
          releaseRunsIn(b);
          pushClear(b, Math.max(...active.map((i) => fb.bands[i].bottom)), fb.topOf);
          break;
        }
      }
    }
    prevActive = active.length;
    const top = b.offsetTop;
    if (!kept && docBlockFull(b)) {
      b.setAttribute("data-ofull", "");
      b.style.setProperty("--opfill", `${(Math.floor(top / sheet) + 1) * sheet - padBottom - PAGE_EPS - top}px`);
    }
    pageOf.set(b, Math.floor(top / sheet));
  }
  const heads = Array.from(slide.querySelectorAll(".o-doc h2, .o-doc h3"));
  for (const row of Array.from(slide.querySelectorAll("nav.o-toc .o-toc-row"))) {
    const head = heads[Number(row.getAttribute("data-oidx") ?? -1)];
    const cell = row.querySelector(".o-toc-pageno");
    if (cell) cell.textContent = head ? String((pageOf.get(head) ?? 0) + 1) : "";
  }
  const pages = Math.max(0, ...Array.from(pageOf.values())) + 1;
  renderPageFurniture(slide, pages);
  return pages;
}
function furnText(tpl2, page, pages, title) {
  return tpl2.replace(
    /\{(page|pages|title)\}/g,
    (_m, k) => k === "page" ? String(page) : k === "pages" ? String(pages) : title
  );
}
function placeFurnitureLayer(layer, doc) {
  layer.style.top = `${doc.offsetTop}px`;
  layer.style.left = `${doc.offsetLeft}px`;
  layer.style.width = `${doc.offsetWidth}px`;
}
function furnSlots(doc, which) {
  const base = which === "h" ? "data-ohdr" : "data-oftr";
  return [
    doc.getAttribute(base) ?? "",
    doc.getAttribute(base + "c") ?? "",
    doc.getAttribute(base + "r") ?? ""
  ];
}
var FURN_KEYS = ["l", "m", "r"];
var FURN_LEGACY = { "1": "l", "2": "lr", "3": "lmr" };
function furnCanon(raw) {
  const legacy = FURN_LEGACY[raw];
  if (legacy !== void 0) return legacy;
  if (!/^[lmr]*$/.test(raw)) return null;
  return FURN_KEYS.filter((k) => raw.includes(k)).join("");
}
function furnCols(doc, which, slots) {
  const raw = doc.getAttribute(which === "h" ? "data-ohdrcols" : "data-oftrcols");
  if (raw !== null) {
    const canon = furnCanon(raw.trim());
    if (canon !== null) return canon;
  }
  return FURN_KEYS.filter((_, i) => slots[i] !== "").join("") || "l";
}
function furnCells(cols) {
  return [0, 1, 2].filter((i) => cols.includes(FURN_KEYS[i]));
}
function furnMasked(slots, cols) {
  return [0, 1, 2].map((i) => cols.includes(FURN_KEYS[i]) ? slots[i] : "");
}
function inAuthoring(slide) {
  return slide.hasAttribute("data-oauthor");
}
var FURN_GHOST_H = 18;
function clearFurnitureLayers(slide) {
  const active = slide.ownerDocument.activeElement;
  if (active && slide.contains(active) && typeof active.blur === "function" && active.closest?.(".o-pagefurn")) {
    active.blur();
  }
  for (const old of Array.from(slide.querySelectorAll(":scope > .o-pagefurn"))) {
    const parent = old.parentNode;
    if (!parent) continue;
    try {
      parent.removeChild(old);
    } catch {
    }
  }
}
function renderPageFurniture(slide, pages) {
  clearFurnitureLayers(slide);
  const doc = slide.querySelector(".o-doc");
  if (!doc || !doc.hasAttribute("data-opage") || pages < 1) return;
  const hslotsRaw = furnSlots(doc, "h");
  const fslotsRaw = furnSlots(doc, "f");
  const hcols = furnCols(doc, "h", hslotsRaw);
  const fcols = furnCols(doc, "f", fslotsRaw);
  const hslots = furnMasked(hslotsRaw, hcols);
  const fslots = furnMasked(fslotsRaw, fcols);
  const hdr = hslotsRaw.some((s2) => s2 !== "");
  const ftr = fslotsRaw.some((s2) => s2 !== "");
  const author = inAuthoring(slide);
  if (!hdr && !ftr && !author) return;
  const cs = getComputedStyle(doc);
  const sheet = lengthPx(cs.getPropertyValue("--oph"));
  if (!(sheet > 20)) return;
  const legacyInset = lengthPx(cs.getPropertyValue("--opfd")) || 0;
  const legacyBandH = lengthPx(cs.getPropertyValue("--opfbh")) || 14;
  const rawH = doc.style.getPropertyValue("--opfh").trim();
  const rawF = doc.style.getPropertyValue("--opff").trim();
  const headerH = rawH ? lengthPx(rawH) || 0 : legacyInset + legacyBandH;
  const headerPad = rawH ? 0 : legacyInset;
  const headerTop = 0;
  const footerH = rawF ? lengthPx(rawF) || 0 : legacyInset + legacyBandH;
  const footerPad = rawF ? 0 : legacyInset;
  const footerTop = sheet - footerH;
  const title = (slide.querySelector(".o-doc-masthead h1")?.textContent ?? "").trim();
  let overrides = {};
  try {
    overrides = JSON.parse(doc.getAttribute("data-ofurno") || "{}");
  } catch {
    overrides = {};
  }
  const layer = document.createElement("div");
  layer.className = "o-pagefurn";
  layer.setAttribute("aria-hidden", "true");
  placeFurnitureLayer(layer, doc);
  layer.style.setProperty("--opmar", cs.paddingLeft);
  for (const name of ["--ohdr-size", "--ohdr-ink", "--ohdr-bg", "--oftr-size", "--oftr-ink", "--oftr-bg"]) {
    const v = doc.style.getPropertyValue(name).trim();
    if (v) layer.style.setProperty(name, v);
  }
  for (let i = 0; i < pages; i++) {
    const band = document.createElement("div");
    band.className = "o-pf";
    band.style.top = `${i * sheet}px`;
    band.style.height = "0";
    const ov = overrides[String(i)] ?? {};
    const mk = (cls, slots, top, h, pad2, which, cols) => {
      const el6 = document.createElement("div");
      el6.className = cls;
      el6.style.top = `${top}px`;
      el6.style.height = `${h}px`;
      if (pad2 > 0) el6.style[which === "h" ? "paddingTop" : "paddingBottom"] = `${pad2}px`;
      el6.setAttribute("data-opfwhich", which);
      el6.setAttribute("data-opfpage", String(i));
      const tplOver = overrides[String(i)]?.[which];
      if (tplOver !== void 0) {
        el6.setAttribute("data-opfover", "");
        el6.setAttribute("data-opfovertpl", tplOver);
      }
      const SLOT_CLASS = ["o-pf-l", "o-pf-c", "o-pf-r"];
      const SLOT_KEY = ["l", "c", "r"];
      for (let j = 0; j < 3; j++) {
        const s2 = document.createElement("span");
        const on = cols.includes(FURN_KEYS[j]);
        s2.className = `${on ? "o-pf-s" : "o-pf-sp"} ${SLOT_CLASS[j]}`;
        if (on) {
          s2.textContent = furnText(slots[j], i + 1, pages, title);
          if (author) {
            s2.setAttribute("data-opfslot", SLOT_KEY[j]);
            s2.setAttribute("data-opftpl", slots[j]);
            if (slots[j] === "") s2.setAttribute("data-opfhint", "Add text\u2026");
          }
        }
        el6.appendChild(s2);
      }
      band.appendChild(el6);
    };
    if (hdr && ov.h !== "") mk("o-pf-h", [ov.h ?? hslots[0], hslots[1], hslots[2]], headerTop, headerH, headerPad, "h", hcols);
    if (ftr && ov.f !== "") mk("o-pf-f", [ov.f ?? fslots[0], fslots[1], fslots[2]], footerTop, footerH, footerPad, "f", fcols);
    if (author && (!hdr || ov.h === "")) {
      const gh = Math.max(headerH, FURN_GHOST_H);
      ghost(band, "h", headerTop, gh, headerPad, i, ov.h === "", hcols);
    }
    if (author && (!ftr || ov.f === "")) {
      const gh = Math.max(footerH, FURN_GHOST_H);
      ghost(band, "f", footerTop + footerH - gh, gh, footerPad, i, ov.f === "", fcols);
    }
    layer.appendChild(band);
  }
  doc.insertAdjacentElement("afterend", layer);
  if (author) yieldGhostsToFloats(doc, layer);
}
var FURN_GHOST_MIN_HIT = 44;
function yieldGhostsToFloats(doc, layer) {
  const ghosts = Array.from(layer.querySelectorAll("[data-opfghost]"));
  if (ghosts.length === 0) return;
  const floats = Array.from(doc.querySelectorAll("[data-ofloat]")).map((f) => f.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  if (floats.length === 0) return;
  for (const g of ghosts) {
    const r = g.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const spans = floats.filter((f) => f.bottom > r.top && f.top < r.bottom).map((f) => [Math.max(r.left, f.left), Math.min(r.right, f.right)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
    if (spans.length === 0) continue;
    const merged = [];
    for (const s2 of spans) {
      const last = merged[merged.length - 1];
      if (last && s2[0] <= last[1]) last[1] = Math.max(last[1], s2[1]);
      else merged.push([s2[0], s2[1]]);
    }
    let best = [r.left, merged[0][0]];
    let edge = r.left;
    for (const [a, b] of merged) {
      if (a - edge > best[1] - best[0]) best = [edge, a];
      edge = b;
    }
    if (r.right - edge > best[1] - best[0]) best = [edge, r.right];
    if (best[1] - best[0] < FURN_GHOST_MIN_HIT) {
      g.style.clipPath = "inset(0 100% 0 0)";
      continue;
    }
    g.style.clipPath = `inset(0 ${Math.round(r.right - best[1])}px 0 ${Math.round(best[0] - r.left)}px)`;
    if (best[0] > r.left) g.style.paddingLeft = `${Math.round(best[0] - r.left)}px`;
  }
}
function ghost(band, which, top, h, pad2, page, removed, cols) {
  const el6 = document.createElement("div");
  el6.className = which === "h" ? "o-pf-h o-pf-ghost" : "o-pf-f o-pf-ghost";
  el6.style.top = `${top}px`;
  el6.style.height = `${h}px`;
  if (pad2 > 0 && h > pad2) el6.style[which === "h" ? "paddingTop" : "paddingBottom"] = `${pad2}px`;
  el6.setAttribute("data-opfwhich", which);
  el6.setAttribute("data-opfpage", String(page));
  el6.setAttribute("data-opfghost", "");
  if (removed) {
    el6.setAttribute("data-opfover", "");
    el6.setAttribute("data-opfovertpl", "");
  }
  const SLOT_CLASS = ["o-pf-l", "o-pf-c", "o-pf-r"];
  const SLOT_KEY = ["l", "c", "r"];
  const cells = furnCells(cols);
  const open = cells.length > 0 ? cells : [0];
  for (let j = 0; j < 3; j++) {
    const s2 = document.createElement("span");
    const on = open.includes(j);
    s2.className = `${on ? "o-pf-s" : "o-pf-sp"} ${SLOT_CLASS[j]}`;
    if (on) {
      s2.setAttribute("data-opfslot", SLOT_KEY[j]);
      s2.setAttribute("data-opftpl", "");
      s2.setAttribute("data-opfhint", j === open[0] ? which === "h" ? "+ Header" : "+ Footer" : "Add text\u2026");
    }
    el6.appendChild(s2);
  }
  band.appendChild(el6);
}
function paginateWhenSettled(slide) {
  requestAnimationFrame(() => paginateDoc(slide));
  const fonts = document.fonts;
  fonts?.ready?.then(() => paginateDoc(slide)).catch(() => {
  });
  for (const img of Array.from(slide.querySelectorAll("img"))) {
    if (!img.complete) img.addEventListener("load", () => paginateDoc(slide), { once: true });
  }
  const doc = slide.querySelector(".o-doc");
  const host = doc?.offsetParent;
  if (doc && host && !slide.hasAttribute("data-opf-observed") && typeof ResizeObserver !== "undefined") {
    slide.setAttribute("data-opf-observed", "");
    let lastW = doc.offsetWidth;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      const layer = slide.querySelector(":scope > .o-pagefurn");
      if (layer) placeFurnitureLayer(layer, doc);
      if (doc.offsetWidth === lastW || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        paginateDoc(slide);
        lastW = doc.offsetWidth;
      });
    });
    ro.observe(host);
  }
}
function cssStr(s2) {
  return '"' + s2.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function furnContent(tpl2, title) {
  const parts = [];
  const re = /\{(page|pages|title)\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(tpl2)) !== null) {
    if (m.index > last) parts.push(cssStr(tpl2.slice(last, m.index)));
    parts.push(m[1] === "page" ? "counter(page)" : m[1] === "pages" ? "counter(pages)" : cssStr(title));
    last = m.index + m[0].length;
  }
  if (last < tpl2.length) parts.push(cssStr(tpl2.slice(last)));
  return parts.length > 0 ? parts.join(" ") : '""';
}
var PAGE_EPS = 2;
var DOC_PAGES = ["docpage", "docpage-a3", "docpage-a2", "docpage-a5", "docpage-book", "docpage-custom"];
var PRINT_FONTS = {
  playfair: "'Playfair Display', Georgia, serif",
  lora: "'Lora', Georgia, serif",
  inter: "'Inter', 'Segoe UI', Arial, sans-serif",
  "source-serif": "'Source Serif 4', Georgia, serif"
};
function furnFace(doc, which) {
  const base = which === "h" ? "--ohdr" : "--oftr";
  const fam = PRINT_FONTS[doc.getAttribute(which === "h" ? "data-ohdrfont" : "data-oftrfont") ?? ""] ?? "sans-serif";
  const rawSize = doc.style.getPropertyValue(`${base}-size`).trim();
  const size = /^\d{1,3}(\.\d+)?px$/.test(rawSize) ? rawSize : "10.5px";
  const rawInk = doc.style.getPropertyValue(`${base}-ink`).trim();
  const ink = /^#[0-9a-fA-F]{6}$/.test(rawInk) ? rawInk : "#6b6b6b";
  return `font: ${size}/1.2 ${fam}; color: ${ink};`;
}
function syncPrintFurniture() {
  const ID = "o-print-furniture";
  document.getElementById(ID)?.remove();
  const doc = document.querySelector(
    ".o-doc[data-opage][data-ohdr], .o-doc[data-opage][data-ohdrc], .o-doc[data-opage][data-ohdrr],.o-doc[data-opage][data-oftr], .o-doc[data-opage][data-oftrc], .o-doc[data-opage][data-oftrr]"
  );
  if (!doc) return;
  const hslotsRaw = furnSlots(doc, "h");
  const fslotsRaw = furnSlots(doc, "f");
  const hslots = furnMasked(hslotsRaw, furnCols(doc, "h", hslotsRaw));
  const fslots = furnMasked(fslotsRaw, furnCols(doc, "f", fslotsRaw));
  const hdr = hslotsRaw.some((s2) => s2 !== "");
  const ftr = fslotsRaw.some((s2) => s2 !== "");
  if (!hdr && !ftr) return;
  const title = (doc.querySelector(".o-doc-masthead h1")?.textContent ?? "").trim();
  const cs = getComputedStyle(doc);
  const mar = cs.getPropertyValue("--opmar").trim();
  if (!/^\d{1,3}(\.\d+)?mm$/.test(mar)) return;
  const cs2 = getComputedStyle(doc);
  const legacyInset = lengthPx(cs2.getPropertyValue("--opfd"));
  const legacyBandH = lengthPx(cs2.getPropertyValue("--opfbh")) || 14;
  const rawH = doc.style.getPropertyValue("--opfh").trim();
  const rawF = doc.style.getPropertyValue("--opff").trim();
  const headerH = rawH ? lengthPx(rawH) || 0 : legacyInset + legacyBandH;
  const footerH = rawF ? lengthPx(rawF) || 0 : legacyInset + legacyBandH;
  const headerPad = rawH ? 0 : legacyInset;
  const footerPad = rawF ? 0 : legacyInset;
  const marPx = lengthPx(mar);
  const marTop = hdr ? Math.max(marPx, headerH) : marPx;
  const marBot = ftr ? Math.max(marPx, footerH) : marPx;
  const mm = (px) => `${(px * 25.4 / 96).toFixed(2)}mm`;
  const padTopMm = mm(Math.max(0, headerPad));
  const padBotMm = mm(Math.max(0, footerPad));
  const SIDE = ["left", "center", "right"];
  const slotBoxes = (edge, slots, face, pad2) => {
    const align = edge === "top" ? `vertical-align: top; padding-top: ${pad2};` : `vertical-align: bottom; padding-bottom: ${pad2};`;
    let css = "";
    for (let i = 0; i < 3; i++) {
      if (!slots[i]) continue;
      css += `@${edge}-${SIDE[i]} { content: ${furnContent(slots[i], title)}; ${face} ${align} }`;
    }
    return css;
  };
  const boxes = (hdr ? slotBoxes("top", hslots, furnFace(doc, "h"), padTopMm) : "") + (ftr ? slotBoxes("bottom", fslots, furnFace(doc, "f"), padBotMm) : "");
  const st = document.createElement("style");
  st.id = ID;
  st.textContent = DOC_PAGES.map((n) => `@page ${n} { margin: ${mm(marTop)} ${mar} ${mm(marBot)} ${mar}; ${boxes} }`).join("\n");
  document.head.appendChild(st);
}
function syncCustomPaper() {
  const ID = "o-custom-page";
  document.getElementById(ID)?.remove();
  const doc = document.querySelector('.o-doc[data-opage="custom"]');
  if (!doc) return;
  const w = doc.style.getPropertyValue("--opw").trim();
  const h = doc.style.getPropertyValue("--oph").trim();
  if (!/^\d{1,4}(\.\d+)?mm$/.test(w) || !/^\d{1,4}(\.\d+)?mm$/.test(h)) return;
  const st = document.createElement("style");
  st.id = ID;
  st.textContent = `@page docpage-custom { size: ${w} ${h}; margin: 14mm 12mm; }`;
  document.head.appendChild(st);
}
function docMount(slide) {
  renderDocToc(slide, true);
  syncCustomPaper();
  syncPrintFurniture();
  paginateWhenSettled(slide);
}
function docFinalize(slide) {
  renderDocToc(slide, false);
  syncCustomPaper();
  syncPrintFurniture();
  paginateWhenSettled(slide);
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
function applyBrandLogoVar(el6, assets) {
  const logo = assets["brand-logo"];
  if (logo) el6.style.setProperty("--brand-logo", `url("${logo}")`);
  else el6.style.removeProperty("--brand-logo");
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

// src/gantt.ts
var GANTT_LANE_PADDING = 8;
var GANTT_CARD_HEIGHT = 36;
var GANTT_CARD_VSPACING = 6;
var GANTT_LABEL_WIDTH = 230;
var GANTT_PX_PER_WEEK = 80;
var GANTT_PX_MIN = 24;
var GANTT_PX_MAX = 9e3;
var GANTT_CARD_INSET = 2;
var GANTT_CARD_GAP = 4;
var GANTT_CARD_MIN_PX = 36;
function ganttWeekIndex(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  if (v.startsWith("W")) return parseFloat(v.slice(1)) - 1;
  if (v.startsWith("M")) return (parseFloat(v.slice(1)) - 1) * 4;
  const n = parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}
function ganttLensColor(data, name) {
  return data.lenses.find((l) => l.name === name)?.color ?? "#8a8a9e";
}
function ganttAlpha(hex3, alpha2) {
  const h = hex3.trim();
  const a = Math.round(Math.max(0, Math.min(1, alpha2)) * 255).toString(16).padStart(2, "0");
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h + a;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}${a}`;
  return h;
}
function ganttZoneFill(z) {
  const a = ganttAlpha(z.color, 0.16);
  return z.color2 ? `linear-gradient(90deg, ${a}, ${ganttAlpha(z.color2, 0.16)})` : a;
}
function normalizeGanttData(raw) {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const arr = (x) => Array.isArray(x) ? x : [];
  const s2 = (x, fb = "") => typeof x === "string" ? x : fb;
  const n = (x, fb) => typeof x === "number" && Number.isFinite(x) ? x : fb;
  const lenses = arr(d.lenses).map((l) => ({ name: s2(l?.name), color: s2(l?.color, "#8a8a9e") })).filter((l) => l.name !== "");
  const swimlanes = arr(d.swimlanes).map((l) => ({ name: s2(l?.name), owner: s2(l?.owner) })).filter((l) => l.name !== "");
  const cards = arr(d.cards).map((c, i) => ({
    id: s2(c?.id, `C${i + 1}`),
    title: s2(c?.title, "Untitled"),
    swimlane: s2(c?.swimlane),
    start: typeof c?.start === "number" ? c.start : s2(c?.start, "W1"),
    durationWeeks: Math.max(0.25, n(c?.durationWeeks, 1)),
    lens: s2(c?.lens),
    type: ["Technical", "Process", "Cultural"].includes(s2(c?.type)) ? s2(c?.type) : "Process",
    effort: ["EASY", "MED", "DEFER"].includes(s2(c?.effort)) ? s2(c?.effort) : "MED",
    what: s2(c?.what),
    needs: s2(c?.needs),
    caveat: s2(c?.caveat),
    deliverable: s2(c?.deliverable),
    sources: s2(c?.sources),
    completed: c?.completed === true
  }));
  const milestones = arr(d.milestones).map((m) => ({
    label: s2(m?.label, "Milestone"),
    week: Math.max(1, n(m?.week, 1)),
    color: s2(m?.color, "#c64a4a")
  }));
  const zones = arr(d.zones).map((z) => {
    const startWeek = Math.max(1, n(z?.startWeek, 1));
    const endWeek = Math.max(startWeek, n(z?.endWeek, startWeek));
    const base = { label: s2(z?.label), startWeek, endWeek, color: s2(z?.color, "#8a8a9e") };
    return typeof z?.color2 === "string" ? { ...base, color2: s2(z?.color2) } : base;
  });
  const maxCardEnd = cards.reduce((mx, c) => Math.max(mx, ganttWeekIndex(c.start) + c.durationWeeks), 0);
  const maxMs = milestones.reduce((mx, m) => Math.max(mx, m.week), 0);
  const rawTw = n(d.totalWeeks, NaN);
  const totalWeeks = Number.isFinite(rawTw) && rawTw > 0 ? Math.min(520, rawTw) : Math.max(4, Math.round(Math.max(16, Math.ceil(Math.max(maxCardEnd, maxMs) / 4) * 4)));
  const startDate = typeof d.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.startDate) ? d.startDate : null;
  return { totalWeeks, startDate, lenses, swimlanes, cards, milestones, ...zones.length ? { zones } : {} };
}
function parseGanttSlideData(slide) {
  const block = slide.querySelector('script[data-odata="gantt"]');
  if (!block?.textContent) return null;
  try {
    return normalizeGanttData(JSON.parse(block.textContent));
  } catch {
    return null;
  }
}
function packLane(cards) {
  const sorted = [...cards].sort((a, b) => ganttWeekIndex(a.start) - ganttWeekIndex(b.start));
  const rowEnds = [];
  const rows = /* @__PURE__ */ new Map();
  for (const c of sorted) {
    const start = ganttWeekIndex(c.start);
    const end = start + c.durationWeeks;
    let row = 0;
    while (row < rowEnds.length && rowEnds[row] > start) row++;
    rowEnds[row] = end;
    rows.set(c.id, row);
  }
  return { rows, numRows: Math.max(1, rowEnds.length) };
}
function monthColumns(startDate, totalWeeks) {
  const cols = [];
  if (!startDate) {
    const months = Math.ceil(totalWeeks / 4);
    for (let m = 1; m <= months; m++) cols.push({ off: (m - 1) * 4, width: 4, name: `M${m}`, label: `Month ${m}` });
    return cols;
  }
  const start = /* @__PURE__ */ new Date(startDate + "T00:00:00");
  const startMs = start.getTime();
  const weekMs = 7 * 864e5;
  const fmt = (d) => d.toLocaleDateString(void 0, { month: "short", year: "numeric" });
  let off = 0;
  let label = fmt(start);
  let next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  let idx = 1;
  while (off < totalWeeks && idx <= Math.ceil(totalWeeks / 4) + 13) {
    const nextOff = Math.min(totalWeeks, (next.getTime() - startMs) / weekMs);
    cols.push({ off, width: nextOff - off, name: `M${idx}`, label });
    off = nextOff;
    label = fmt(next);
    next = new Date(next.getFullYear(), next.getMonth() + 1, 1);
    idx++;
  }
  return cols;
}
function dateAfter(startDate, days) {
  if (!startDate) return null;
  const d = /* @__PURE__ */ new Date(startDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d;
}
var DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var DOW_NARROW = ["S", "M", "T", "W", "T", "F", "S"];
function ganttAxisUnit(pxPerWeek) {
  const dayPx = pxPerWeek / 7;
  if (dayPx >= 96) return "hour";
  if (dayPx >= 22) return "day";
  if (pxPerWeek >= 44) return "week";
  return "month";
}
var el = (tag, className, parent) => {
  const e = document.createElement(tag);
  e.className = className;
  parent?.appendChild(e);
  return e;
};
function renderGantt(slide, data, opts = {}) {
  const mount = slide.querySelector("[data-gantt-mount]");
  if (!mount) return;
  mount.textContent = "";
  const ppw = opts.fitPx ? Math.max(4, Math.floor(opts.fitPx / data.totalWeeks)) : Math.min(GANTT_PX_MAX, Math.max(GANTT_PX_MIN, opts.pxPerWeek ?? GANTT_PX_PER_WEEK));
  const trackWidth = data.totalWeeks * ppw;
  let activeLens = opts.activeLens ?? "all";
  const bar = el("div", "o-gantt-bar", mount);
  const chips = el("span", "o-gantt-chips", bar);
  const drawChips = () => {
    chips.textContent = "";
    const mk = (label, val) => {
      const chip = el("button", "o-gantt-chip" + (activeLens === val ? " active" : ""), chips);
      chip.setAttribute("type", "button");
      chip.textContent = label;
      if (activeLens === val && val !== "all") {
        chip.style.background = ganttLensColor(data, val);
        chip.style.borderColor = ganttLensColor(data, val);
        chip.style.color = "#fff";
      }
      if (opts.interactive) {
        chip.addEventListener("click", () => {
          activeLens = val;
          drawChips();
          applyFilter();
        });
      }
    };
    mk("All", "all");
    for (const l of data.lenses) mk(l.name, l.name);
  };
  const wrap = el("div", "o-gantt-wrap", mount);
  const grid = el("div", "o-gantt-grid", wrap);
  grid.style.setProperty("--gantt-w", `${trackWidth}px`);
  const axis = el("div", "o-gantt-axis", grid);
  const corner = el("div", "o-gantt-corner", axis);
  corner.textContent = "Owner";
  const axisTrack = el("div", "o-gantt-axis-track", axis);
  const monthCols = monthColumns(data.startDate, data.totalWeeks);
  for (const c of monthCols) {
    const mDiv = el("div", "o-gantt-month", axisTrack);
    mDiv.style.left = `${c.off * ppw}px`;
    mDiv.style.width = `${c.width * ppw}px`;
    el("div", "o-gantt-month-name", mDiv).textContent = c.name;
    el("div", "o-gantt-month-range", mDiv).textContent = c.label;
  }
  const unit = ganttAxisUnit(ppw);
  const fine = unit === "day" || unit === "hour";
  if (fine) axis.classList.add("o-gantt-axis-fine");
  const addTick = (xWeeks, kind, label) => {
    const t = el("div", "o-gantt-tick" + kind, axisTrack);
    t.style.left = `${xWeeks * ppw}px`;
    if (label) el("span", "o-gantt-tick-label", t).textContent = label;
  };
  const addLabel = (xWeeks, widthWeeks, cls, text) => {
    const d = el("div", cls, axisTrack);
    d.style.left = `${xWeeks * ppw}px`;
    if (widthWeeks) d.style.width = `${widthWeeks * ppw}px`;
    d.textContent = text;
  };
  if (unit === "month") {
    for (const c of monthCols) addTick(c.off, " major");
    addTick(data.totalWeeks, " major");
  } else if (unit === "week") {
    for (let w = 0; w < data.totalWeeks; w++) addTick(w, w % 4 === 0 ? " major" : "");
  } else if (unit === "day") {
    const totalDays = Math.ceil(data.totalWeeks * 7);
    const narrow = ppw / 7 < 34;
    for (let dy = 0; dy < totalDays; dy++) {
      const weekStart = dy % 7 === 0;
      const dt = dateAfter(data.startDate, dy);
      addTick(dy / 7, weekStart ? " major" : " minor");
      const dow = dt ? dt.getDay() : (dy % 7 + 1) % 7;
      addLabel(dy / 7, 1 / 7, "o-gantt-axis-day", (narrow ? DOW_NARROW : DOW_SHORT)[dow]);
      if (weekStart) addLabel(dy / 7, 0, "o-gantt-axis-wk", dt ? dt.toLocaleDateString(void 0, { month: "short", day: "numeric" }) : `W${dy / 7 + 1}`);
    }
  } else {
    const totalDays = Math.ceil(data.totalWeeks * 7);
    const hourPx = ppw / 7 / 24;
    const hourStep = hourPx >= 26 ? 1 : hourPx >= 13 ? 3 : hourPx >= 7 ? 6 : 0;
    for (let dy = 0; dy < totalDays; dy++) {
      const dt = dateAfter(data.startDate, dy);
      addTick(dy / 7, " major");
      addLabel(dy / 7, 0, "o-gantt-axis-wk", dt ? dt.toLocaleDateString(void 0, { month: "short", day: "numeric" }) : `D${dy + 1}`);
      for (let h = 1; h < 24; h++) {
        const x = (dy + h / 24) / 7;
        addTick(x, " minor");
        if (hourStep && h % hourStep === 0) addLabel(x, 0, "o-gantt-axis-hr", `${String(h).padStart(2, "0")}:00`);
      }
    }
  }
  data.milestones.forEach((ms, idx) => {
    const tag = el("div", "o-gantt-ms-tag", axisTrack);
    tag.style.left = `${(ms.week - 1) * ppw}px`;
    tag.style.color = ms.color;
    tag.setAttribute("data-ms", String(idx));
    tag.textContent = ms.label;
  });
  (data.zones ?? []).forEach((z) => {
    if (!z.label) return;
    const zl = el("div", "o-gantt-zone-axis", axisTrack);
    zl.style.left = `${(z.startWeek - 1) * ppw}px`;
    zl.style.width = `${(z.endWeek - z.startWeek + 1) * ppw}px`;
    zl.style.color = z.color;
    zl.textContent = z.label;
  });
  const byLane = /* @__PURE__ */ new Map();
  for (const lane of data.swimlanes) byLane.set(lane.name, []);
  for (const c of data.cards) byLane.get(c.swimlane)?.push(c);
  for (const lane of data.swimlanes) {
    const cardsInLane = byLane.get(lane.name) ?? [];
    const { rows, numRows: numRows2 } = packLane(cardsInLane);
    const laneHeight = numRows2 * (GANTT_CARD_HEIGHT + GANTT_CARD_VSPACING) + 2 * GANTT_LANE_PADDING;
    const laneDiv = el("div", "o-gantt-lane", grid);
    laneDiv.setAttribute("data-lane", lane.name);
    const label = el("div", "o-gantt-label", laneDiv);
    label.style.minHeight = `${laneHeight}px`;
    el("div", "o-gantt-lane-name", label).textContent = lane.name;
    el("div", "o-gantt-lane-owner", label).textContent = lane.owner;
    el("div", "o-gantt-lane-count", label).textContent = `${cardsInLane.length} card${cardsInLane.length === 1 ? "" : "s"}`;
    const tracks = el("div", "o-gantt-tracks", laneDiv);
    tracks.style.minHeight = `${laneHeight}px`;
    tracks.setAttribute("data-lane-tracks", lane.name);
    (data.zones ?? []).forEach((z, zi) => {
      const band = el("div", "o-gantt-zone", tracks);
      band.setAttribute("data-zone", String(zi));
      band.style.left = `${(z.startWeek - 1) * ppw}px`;
      band.style.width = `${(z.endWeek - z.startWeek + 1) * ppw}px`;
      band.style.background = ganttZoneFill(z);
    });
    data.milestones.forEach((ms, mi) => {
      const line = el("div", "o-gantt-ms-line", tracks);
      line.setAttribute("data-ms", String(mi));
      line.style.left = `${(ms.week - 1) * ppw}px`;
      line.style.background = ms.color;
    });
    for (const c of cardsInLane) {
      const card = el("div", "o-gantt-card" + (c.completed ? " completed" : ""), tracks);
      card.setAttribute("data-card", c.id);
      card.setAttribute("data-lens", c.lens);
      card.style.background = ganttLensColor(data, c.lens);
      card.style.left = `${ganttWeekIndex(c.start) * ppw + GANTT_CARD_INSET}px`;
      card.style.width = `${Math.max(GANTT_CARD_MIN_PX, c.durationWeeks * ppw - GANTT_CARD_GAP)}px`;
      card.style.top = `${GANTT_LANE_PADDING + (rows.get(c.id) ?? 0) * (GANTT_CARD_HEIGHT + GANTT_CARD_VSPACING)}px`;
      el("span", "o-gantt-dot", card).title = c.type;
      el("span", "o-gantt-card-title", card).textContent = c.title;
      card.title = `${c.id} \u2014 ${c.title}
${c.lens} \xB7 ${c.type} \xB7 ${c.effort}
Start ${typeof c.start === "number" ? "W" + (Math.round(c.start * 100) / 100 + 1) : c.start} \xB7 ${c.durationWeeks}w`;
    }
  }
  if (data.swimlanes.length === 0) {
    el("div", "o-gantt-empty", grid).textContent = "No swimlanes yet.";
  }
  const legend = el("div", "o-gantt-legend", mount);
  for (const l of data.lenses) {
    const sw = el("span", "o-gantt-swatch", legend);
    const dot = el("span", "sw", sw);
    dot.style.background = l.color;
    sw.appendChild(document.createTextNode(" " + l.name));
  }
  const count = el("span", "o-gantt-count", legend);
  const applyFilter = () => {
    let visible = 0;
    let completed = 0;
    mount.querySelectorAll(".o-gantt-card").forEach((card) => {
      const ok = activeLens === "all" || card.getAttribute("data-lens") === activeLens;
      card.classList.toggle("faded", !ok);
      if (ok) visible++;
      if (card.classList.contains("completed")) completed++;
    });
    count.textContent = `Showing ${visible} of ${data.cards.length} cards` + (completed > 0 ? ` \xB7 ${completed} complete` : "");
  };
  drawChips();
  applyFilter();
}
function renderGanttError(slide) {
  const mount = slide.querySelector("[data-gantt-mount]");
  if (!mount) return;
  mount.textContent = "";
  el("div", "o-gantt-error", mount).textContent = "This roadmap\u2019s data block is missing or invalid \u2014 open the deck in Origami Folio to repair it.";
}
function ganttContainerOf(block) {
  return block.closest("figure, .o-gantt-shell") ?? block.parentElement;
}
function mountGantts(slide) {
  slide.querySelectorAll('script[data-odata="gantt"]').forEach((block) => {
    const root = ganttContainerOf(block);
    if (!root) return;
    const data = parseGanttSlideData(root);
    if (!data) return renderGanttError(root);
    renderGantt(root, data, { interactive: true });
  });
}
function finalizeGantts(slide) {
  slide.querySelectorAll('script[data-odata="gantt"]').forEach((block) => {
    const root = ganttContainerOf(block);
    if (!root) return;
    const data = parseGanttSlideData(root);
    if (!data) return renderGanttError(root);
    renderGantt(root, data, { interactive: false, fitPx: 1280 - 80 - GANTT_LABEL_WIDTH });
  });
}

// src/diagram.ts
var SVGNS = "http://www.w3.org/2000/svg";
var TONE_STROKE = {
  "": "var(--ink-soft)",
  accent: "var(--accent)",
  green: "#3D8B5A",
  amber: "#B07D2B",
  red: "#B3402A"
};
var DIAGRAM_ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  star: '<path d="M12 2 15.09 8.26 22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>',
  play: '<path d="M5 3 19 12 5 21z"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  circle: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  "arrow-right": '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  "arrow-up-right": '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>',
  "chevrons-right": '<polyline points="6 17 11 12 6 7"/><polyline points="13 17 18 12 13 7"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  "trending-up": '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  "alert-triangle": '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  "arrow-left": '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  "arrow-up": '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  "arrow-down": '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
  "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
  "refresh-cw": '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  "check-circle": '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  "x-circle": '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  "alert-circle": '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  "help-circle": '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  "thumbs-up": '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>',
  award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  "message-square": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  "share-2": '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  "file-text": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  "user-plus": '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  "dollar-sign": '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  "credit-card": '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  "shopping-cart": '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  "trending-down": '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  "bar-chart": '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  "pie-chart": '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  percent: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  droplet: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  "map-pin": '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  lightbulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  coffee: '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  package: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>'
};
var nodeStroke = (n) => n.color || TONE_STROKE[n.tone] || TONE_STROKE[""];
var nodeFill = (n) => n.fill || "var(--paper)";
function drawNodeIcon(parent, n, w, h, diamond) {
  const body = n.icon ? DIAGRAM_ICONS[n.icon] : void 0;
  if (!body) return;
  const sc = 14 / 24;
  const gx = diamond ? -7 : -w / 2 + 7;
  const gy = diamond ? -h / 2 - 6 : -h / 2 + 6;
  const g = svgEl("g", {
    class: "o-dicon",
    transform: `translate(${gx} ${gy}) scale(${sc})`,
    fill: "none",
    stroke: nodeStroke(n),
    "stroke-width": "2.4",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  }, parent);
  g.innerHTML = body;
}
var markerSeq = 0;
var s = (x) => typeof x === "string" ? x : "";
var tone = (x) => x === "accent" || x === "green" || x === "amber" || x === "red" ? x : "";
var HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
var deco = (o) => ({
  ...typeof o.icon === "string" && o.icon in DIAGRAM_ICONS ? { icon: o.icon } : {},
  ...typeof o.color === "string" && HEX_RE.test(o.color) ? { color: o.color } : {},
  ...typeof o.fill === "string" && HEX_RE.test(o.fill) ? { fill: o.fill } : {}
});
var DASH_RE = /^[0-9.,\s]{1,40}$/;
var dim = (x, min, max) => typeof x === "number" && Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : void 0;
function normalizeEdges(raw, ids) {
  return (Array.isArray(raw) ? raw : []).map((e) => {
    const o = e ?? {};
    return {
      from: s(o.from),
      to: s(o.to),
      label: s(o.label),
      ...typeof o.color === "string" && HEX_RE.test(o.color) ? { color: o.color } : {},
      ...typeof o.width === "number" && Number.isFinite(o.width) && o.width >= 1 && o.width <= 8 ? { width: o.width } : {},
      ...typeof o.dash === "string" && DASH_RE.test(o.dash) ? { dash: o.dash } : {},
      ...o.arrow === "none" || o.arrow === "end" || o.arrow === "both" ? { arrow: o.arrow } : {},
      ...o.style === "straight" || o.style === "curved" ? { style: o.style } : {}
    };
  }).filter((e) => ids.has(e.from) && ids.has(e.to));
}
function normalizeLanes(raw) {
  return (Array.isArray(raw) ? raw : []).map((l, i) => {
    const o = l ?? {};
    return {
      id: s(o.id) || `lane${i + 1}`,
      label: s(o.label),
      order: typeof o.order === "number" && Number.isFinite(o.order) ? o.order : i,
      ...typeof o.color === "string" && HEX_RE.test(o.color) ? { color: o.color } : {},
      ...typeof o.actor === "string" && o.actor ? { actor: o.actor } : {}
    };
  }).filter((l) => l.label.length > 0);
}
function laneKeyFor(value, lanes, laneIds) {
  if (lanes.length === 0) return {};
  return { lane: typeof value === "string" && laneIds.has(value) ? value : lanes[0].id };
}
function normalizeFlowData(raw) {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const lanes = normalizeLanes(d.lanes);
  const laneIds = new Set(lanes.map((l) => l.id));
  const optPct = (x) => typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(100, x)) : void 0;
  const nodes = (Array.isArray(d.nodes) ? d.nodes : []).map((n, i) => {
    const o = n ?? {};
    const x = optPct(o.x);
    const y = optPct(o.y);
    const width = dim(o.width, 60, 400);
    const height = dim(o.height, 30, 200);
    return {
      id: s(o.id) || `n${i + 1}`,
      label: s(o.label),
      shape: o.shape === "pill" || o.shape === "diamond" ? o.shape : "box",
      tone: tone(o.tone),
      ...deco(o),
      ...width !== void 0 ? { width } : {},
      ...height !== void 0 ? { height } : {},
      ...laneKeyFor(o.lane, lanes, laneIds),
      ...x !== void 0 && y !== void 0 ? { x, y } : {}
    };
  });
  return {
    nodes,
    edges: normalizeEdges(d.edges, new Set(nodes.map((n) => n.id))),
    ...lanes.length ? { lanes } : {}
  };
}
function normalizeGraphData(raw) {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const lanes = normalizeLanes(d.lanes);
  const laneIds = new Set(lanes.map((l) => l.id));
  const pct = (x, fallback) => typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(100, x)) : fallback;
  const nodes = (Array.isArray(d.nodes) ? d.nodes : []).map((n, i) => {
    const o = n ?? {};
    const width = dim(o.width, 60, 400);
    const height = dim(o.height, 30, 200);
    return {
      id: s(o.id) || `n${i + 1}`,
      label: s(o.label),
      x: pct(o.x, 15 + i % 4 * 23),
      y: pct(o.y, 20 + Math.floor(i / 4) * 25),
      tone: tone(o.tone),
      ...o.shape === "box" || o.shape === "diamond" || o.shape === "circle" || o.shape === "hexagon" ? { shape: o.shape } : {},
      ...width !== void 0 ? { width } : {},
      ...height !== void 0 ? { height } : {},
      ...laneKeyFor(o.lane, lanes, laneIds),
      ...deco(o)
    };
  });
  return {
    nodes,
    edges: normalizeEdges(d.edges, new Set(nodes.map((n) => n.id))),
    ...lanes.length ? { lanes } : {}
  };
}
function parseFlowSlideData(slide) {
  const block = slide.querySelector('script[data-odata="flow"]');
  if (!block?.textContent) return null;
  try {
    return normalizeFlowData(JSON.parse(block.textContent));
  } catch {
    return null;
  }
}
function parseGraphSlideData(slide) {
  const block = slide.querySelector('script[data-odata="graph"]');
  if (!block?.textContent) return null;
  try {
    return normalizeGraphData(JSON.parse(block.textContent));
  } catch {
    return null;
  }
}
function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}
function nodeLabel(parent, cx, cy, text, maxChars, fontSize) {
  const clip = (t2) => t2.length > maxChars ? t2.slice(0, maxChars - 1) + "\u2026" : t2;
  let lines;
  if (text.length <= maxChars) lines = [text];
  else {
    const mid = Math.floor(text.length / 2);
    let split = -1;
    for (let off = 0; off < mid; off++) {
      if (text[mid - off] === " ") {
        split = mid - off;
        break;
      }
      if (text[mid + off] === " ") {
        split = mid + off;
        break;
      }
    }
    lines = split === -1 ? [clip(text)] : [clip(text.slice(0, split)), clip(text.slice(split + 1))];
  }
  const t = svgEl("text", {
    x: String(cx),
    y: String(cy),
    "text-anchor": "middle",
    "dominant-baseline": "middle",
    fill: "var(--ink)",
    style: `font: 600 ${fontSize}px var(--font-body); pointer-events: none;`
  }, parent);
  lines.forEach((line, i) => {
    const span2 = document.createElementNS(SVGNS, "tspan");
    span2.setAttribute("x", String(cx));
    span2.setAttribute("dy", i === 0 ? String(lines.length > 1 ? -fontSize * 0.62 : 0) : String(fontSize * 1.24));
    span2.textContent = line;
    t.appendChild(span2);
  });
}
function edgeLabel(parent, x, y, text) {
  if (!text) return;
  const t = svgEl("text", {
    x: String(x),
    y: String(y - 6),
    "text-anchor": "middle",
    fill: "var(--ink-soft)",
    stroke: "var(--bg)",
    "stroke-width": "4",
    "paint-order": "stroke",
    style: "font: 600 12px var(--font-body); pointer-events: none;"
  }, parent);
  t.textContent = text;
}
function nodeBody(parent, shape, cx, cy, w, h, stroke, fill) {
  const base = { fill, stroke, "stroke-width": "2" };
  if (shape === "diamond") {
    return svgEl("polygon", {
      ...base,
      points: `${cx},${cy - h / 2 - 10} ${cx + w / 2 + 12},${cy} ${cx},${cy + h / 2 + 10} ${cx - w / 2 - 12},${cy}`
    }, parent);
  }
  if (shape === "circle") {
    return svgEl("ellipse", { ...base, cx: String(cx), cy: String(cy), rx: String(w / 2), ry: String(h / 2) }, parent);
  }
  if (shape === "hexagon") {
    const xo = Math.round(h / 2 / Math.sqrt(3) * 10) / 10;
    return svgEl("polygon", {
      ...base,
      points: `${cx - w / 2},${cy} ${cx - w / 2 + xo},${cy - h / 2} ${cx + w / 2 - xo},${cy - h / 2} ${cx + w / 2},${cy} ${cx + w / 2 - xo},${cy + h / 2} ${cx - w / 2 + xo},${cy + h / 2}`
    }, parent);
  }
  return svgEl("rect", {
    ...base,
    x: String(cx - w / 2),
    y: String(cy - h / 2),
    width: String(w),
    height: String(h),
    rx: shape === "pill" ? String(h / 2) : "10"
  }, parent);
}
function shapeFor(parent, n, cx, cy, w, h) {
  return nodeBody(parent, n.shape, cx, cy, w, h, nodeStroke(n), nodeFill(n));
}
var dmSelected = null;
var dmActive = null;
var dmKeysWired = false;
var dmSelectTimer = null;
function dmCancelPendingSelect() {
  if (dmSelectTimer !== null) {
    clearTimeout(dmSelectTimer);
    dmSelectTimer = null;
  }
}
var dmSnap = false;
var setDiagramSnap = (on) => {
  dmSnap = on;
};
function wireDmKeys() {
  if (dmKeysWired) return;
  dmKeysWired = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Delete") return;
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!dmActive || !dmSelected) return;
    const d = dmActive.data;
    if (d.nodes.length <= 1) return;
    e.preventDefault();
    const id = dmSelected;
    dmSelected = null;
    dmActive.commit({
      nodes: d.nodes.filter((n) => n.id !== id),
      edges: d.edges.filter((ed) => ed.from !== id && ed.to !== id),
      lanes: d.lanes
    });
  });
}
function wireNodeContextDelete(g, id, data, commit) {
  g.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (data.nodes.length <= 1) return;
    if (dmSelected === id) dmSelected = null;
    commit({
      nodes: data.nodes.filter((n) => n.id !== id),
      edges: data.edges.filter((ed) => ed.from !== id && ed.to !== id),
      lanes: data.lanes
    });
  });
}
function clientToVb(svg, clientX, clientY) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}
function dmFreshId(data) {
  for (let i = 1; ; i++) {
    const id = `n${i}`;
    if (!data.nodes.some((n) => n.id === id)) return id;
  }
}
function dmHalo(g, cx, cy, w, h) {
  svgEl("rect", {
    class: "o-dhalo",
    x: String(cx - w / 2 - 7),
    y: String(cy - h / 2 - 7),
    width: String(w + 14),
    height: String(h + 14),
    rx: "12",
    fill: "none",
    stroke: "var(--accent)",
    "stroke-width": "1.5",
    "stroke-dasharray": "5 4"
  }, g);
}
var dmLane = null;
function dmSyncLane(data) {
  if (dmLane && !(data.lanes ?? []).some((l) => l.id === dmLane)) dmLane = null;
}
function addDiagramLane(data) {
  const lanes = [...data.lanes ?? []].sort((a, b) => a.order - b.order);
  const open = () => {
    let n = 1;
    while (lanes.some((l) => l.id === `lane${n}`)) n++;
    lanes.push({ id: `lane${n}`, label: `Lane ${n}`, order: lanes.length });
  };
  const from = lanes.length;
  open();
  if (from === 0) open();
  lanes.forEach((l, i) => l.order = i);
  const ids = new Set(lanes.map((l) => l.id));
  for (const n of data.nodes) {
    if (n.lane !== void 0 && ids.has(n.lane)) continue;
    const y = n.y;
    const strip = from === 0 && typeof y === "number" && Number.isFinite(y) ? Math.min(lanes.length - 1, Math.max(0, Math.floor(y / 100 * lanes.length))) : 0;
    n.lane = lanes[strip].id;
  }
  data.lanes = lanes;
}
function removeDiagramLane(data, id, seat) {
  const lanes = [...data.lanes ?? []].sort((a, b) => a.order - b.order);
  const at = lanes.findIndex((l) => l.id === id);
  if (at < 0) return;
  const nodes = data.nodes;
  if (lanes.length <= 2) {
    for (const n of nodes) {
      delete n.lane;
      if (n.x === void 0 || n.y === void 0) {
        const p = seat?.(n.id);
        if (p) {
          n.x = p.x;
          n.y = p.y;
        }
      }
    }
    delete data.lanes;
    return;
  }
  const rest = lanes.filter((l) => l.id !== id);
  rest.forEach((l, i) => l.order = i);
  const nearest = rest[Math.min(at, rest.length - 1)].id;
  for (const n of nodes) if (n.lane === id) n.lane = nearest;
  data.lanes = rest;
}
function wireLaneBand(rect, layer, band, vw, vh, pos, data, commit) {
  if (!band.id) return;
  const id = band.id;
  rect.setAttribute("data-lane", id);
  rect.style.cursor = "pointer";
  rect.addEventListener("mousedown", (e) => e.stopPropagation());
  const paint = () => {
    if (dmLane !== id) return;
    const g = svgEl("g", { class: "o-dlane-x", "data-lane-close": id }, layer);
    g.style.cursor = "pointer";
    g.style.pointerEvents = "all";
    g.addEventListener("mousedown", (e) => e.stopPropagation());
    const cx = LANE_X_EDIT - 18;
    const cy = band.y + 22;
    svgEl("circle", { cx: `${cx}`, cy: `${cy}`, r: "12", fill: "var(--paper, #fff)", stroke: "var(--rule)" }, g);
    svgEl("path", {
      d: `M${cx - 4} ${cy - 4}L${cx + 4} ${cy + 4}M${cx + 4} ${cy - 4}L${cx - 4} ${cy + 4}`,
      stroke: "var(--ink)",
      "stroke-width": "1.7",
      "stroke-linecap": "round",
      fill: "none"
    }, g);
    g.addEventListener("click", (e) => {
      e.stopPropagation();
      dmLane = null;
      removeDiagramLane(data, id, (nodeId) => {
        const p = pos.get(nodeId);
        return p ? { x: Math.round(p.x / vw * 1e3) / 10, y: Math.round(p.y / vh * 1e3) / 10 } : void 0;
      });
      commit(data);
    });
  };
  rect.addEventListener("click", (e) => {
    e.stopPropagation();
    dmLane = dmLane === id ? null : id;
    layer.querySelectorAll(".o-dlane-x").forEach((n) => n.remove());
    paint();
  });
  paint();
}
function dmToggleSelect(svg, id, halo2) {
  const was = dmSelected === id;
  svg.querySelectorAll(".o-dhalo").forEach((h) => h.remove());
  dmSelected = was ? null : id;
  if (!was) halo2();
}
function dmTextInput(mount, left, top, current, apply) {
  mount.querySelector(".o-dmrename")?.remove();
  const input = document.createElement("input");
  input.className = "o-dmrename";
  input.value = current;
  input.style.left = `${left}px`;
  input.style.top = `${top}px`;
  mount.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    input.remove();
    if (save && v !== current) apply(v);
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") commit(true);
    if (e.key === "Escape") commit(false);
  });
  input.addEventListener("blur", () => commit(true));
  input.addEventListener("mousedown", (e) => e.stopPropagation());
}
function dmRename(mount, nodeEl, current, apply) {
  const r = nodeEl.getBoundingClientRect();
  const m = mount.getBoundingClientRect();
  dmTextInput(mount, r.left - m.left + r.width / 2 - 90, r.top - m.top + r.height / 2 - 14, current, apply);
}
function dmInputAt(mount, svg, vb, current, apply) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return;
  const p = new DOMPoint(vb.x, vb.y).matrixTransform(ctm);
  const m = mount.getBoundingClientRect();
  dmTextInput(mount, p.x - m.left - 90, p.y - m.top - 14, current, apply);
}
function wireEdgeHit(group, mount, svg, geom, mid, edge, data, edit) {
  const commit = edit.onCommit;
  const hit = geom.d ? svgEl("path", { d: geom.d, fill: "none", class: "o-ehit" }, group) : svgEl("line", {
    x1: String(geom.line.x1),
    y1: String(geom.line.y1),
    x2: String(geom.line.x2),
    y2: String(geom.line.y2),
    class: "o-ehit"
  }, group);
  hit.setAttribute("stroke", "rgba(0,0,0,0)");
  hit.setAttribute("stroke-width", "16");
  hit.setAttribute("pointer-events", "stroke");
  hit.style.cursor = "text";
  hit.addEventListener("mousedown", (e) => e.stopPropagation());
  hit.addEventListener("click", (e) => {
    e.stopPropagation();
    if (edit.onSelectEdge) {
      edit.onSelectEdge(edge, hit.getBoundingClientRect());
      return;
    }
    dmInputAt(
      mount,
      svg,
      mid,
      edge.label,
      (label) => commit({ nodes: data.nodes, edges: data.edges.map((x) => x === edge ? { ...x, label } : x) })
    );
  });
  hit.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    commit({ nodes: data.nodes, edges: data.edges.filter((x) => x !== edge) });
  });
}
function dmPort(svg, mount, source, kind, data, commit) {
  const g = svgEl("g", { class: "o-dport", transform: `translate(${source.vx} ${source.vy})` }, svg);
  svgEl("circle", { r: "9", fill: "var(--accent)", opacity: "0.9" }, g);
  svgEl("path", { d: "M -4 0 H 4 M 0 -4 V 4", stroke: "#fff", "stroke-width": "2", "stroke-linecap": "round" }, g);
  g.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    down.stopPropagation();
    const toVb = (e) => clientToVb(svg, e.clientX, e.clientY);
    let moved = false;
    let ghost2 = null;
    const move = (e) => {
      const p = toVb(e);
      if (!moved && Math.hypot(p.x - source.vx, p.y - source.vy) < 14) return;
      moved = true;
      ghost2 ??= svgEl("path", {
        fill: "none",
        stroke: "var(--accent)",
        "stroke-width": "2",
        "stroke-dasharray": "6 5",
        // the ghost ends AT the cursor — it must never eat the drop target's
        // elementFromPoint hit
        "pointer-events": "none"
      }, svg);
      ghost2.setAttribute("d", `M ${source.vx} ${source.vy} L ${p.x} ${p.y}`);
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      ghost2?.remove();
      if (moved) {
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node]");
        const targetId = hit?.getAttribute("data-node");
        if (targetId && targetId !== source.id && !data.edges.some((ed) => ed.from === source.id && ed.to === targetId)) {
          commit({ nodes: data.nodes, edges: [...data.edges, { from: source.id, to: targetId, label: "" }], lanes: data.lanes });
        }
        return;
      }
      openSpawnMenu(mount, svg, source, kind, data, commit);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}
function openSpawnMenu(mount, svg, source, kind, data, commit) {
  mount.querySelector(".o-dmenu")?.remove();
  const menu = document.createElement("div");
  menu.className = "o-dmenu";
  const m = mount.getBoundingClientRect();
  const ctm = svg.getScreenCTM();
  if (ctm) {
    const p = new DOMPoint(source.vx, source.vy).matrixTransform(ctm);
    menu.style.left = `${p.x - m.left + 12}px`;
    menu.style.top = `${p.y - m.top - 10}px`;
  } else {
    const rect = svg.getBoundingClientRect();
    menu.style.left = `${rect.left - m.left + source.vx / Number(svg.viewBox.baseVal.width) * rect.width + 12}px`;
    menu.style.top = `${rect.top - m.top + source.vy / Number(svg.viewBox.baseVal.height) * rect.height - 10}px`;
  }
  const choices = kind === "flow" ? [["Step", "box"], ["Decision", "diamond"], ["Terminal", "pill"]] : [["New node", ""]];
  const vbW = Number(svg.viewBox.baseVal.width);
  const vbH = Number(svg.viewBox.baseVal.height);
  const sx = Math.round(Math.max(2, Math.min(98, source.vx / vbW * 100 + 15)) * 10) / 10;
  const sy = Math.round(Math.max(4, Math.min(96, source.vy / vbH * 100 + 7)) * 10) / 10;
  for (const [label, shape] of choices) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `+ ${label}`;
    b.addEventListener("mousedown", (e) => e.stopPropagation());
    b.addEventListener("click", () => {
      menu.remove();
      const id = dmFreshId(data);
      const node = kind === "flow" ? { id, label, shape, tone: "", x: sx, y: sy } : { id, label: "New node", x: sx, y: sy, tone: "" };
      commit({ nodes: [...data.nodes, node], edges: [...data.edges, { from: source.id, to: id, label: "" }], lanes: data.lanes });
    });
    menu.appendChild(b);
  }
  const closer = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener("mousedown", closer);
    }
  };
  document.addEventListener("mousedown", closer);
  mount.appendChild(menu);
}
function editButton(mount, onOpen) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "o-diagram-edit";
  b.textContent = "\u270E Edit diagram";
  b.addEventListener("mousedown", (e) => e.stopPropagation());
  b.addEventListener("click", onOpen);
  mount.appendChild(b);
}
function renderDiagramError(slide, kind) {
  const mount = slide.querySelector(`[data-${kind}-mount]`);
  if (mount) mount.textContent = `${kind} data block missing or unparseable`;
}
var FW = 176;
var FH = 60;
var FGY = 34;
var FVW = 1200;
var FVH = 660;
function flowAutoPositions(data) {
  const depth = new Map(data.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < data.nodes.length; pass++) {
    let moved = false;
    for (const e of data.edges) {
      const want = (depth.get(e.from) ?? 0) + 1;
      if (want > (depth.get(e.to) ?? 0) && want < data.nodes.length + 1) {
        depth.set(e.to, want);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const cols = [];
  for (const n of data.nodes) (cols[depth.get(n.id) ?? 0] ??= []).push(n);
  const colCount = Math.max(1, cols.length);
  const pos = /* @__PURE__ */ new Map();
  cols.forEach((col, ci) => {
    col.forEach((n, ri) => {
      pos.set(n.id, {
        x: (ci + 0.5) / colCount * (FVW - 120) + 60,
        y: FVH / 2 + (ri - (col.length - 1) / 2) * (FH + FGY + 14)
      });
    });
  });
  return pos;
}
var LHW = 140;
var LANE_TOP = 16;
var LANE_X_VIEW = 12;
var LANE_X_EDIT = 40;
var LANE_GAP = 20;
var LANE_MIN_H = 72;
var FLOW_ROW_H = FH + FGY + 14;
function laneDepthMap(laneNodes, edges) {
  const ids = new Set(laneNodes.map((n) => n.id));
  const depth = new Map(laneNodes.map((n) => [n.id, 0]));
  const internal = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  for (let pass = 0; pass < laneNodes.length; pass++) {
    let moved = false;
    for (const e of internal) {
      const want = (depth.get(e.from) ?? 0) + 1;
      if (want > (depth.get(e.to) ?? 0) && want < laneNodes.length + 1) {
        depth.set(e.to, want);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return depth;
}
function flowLanePositions(data) {
  const lanes = [...data.lanes ?? []].sort((a, b) => a.order - b.order);
  const buckets = lanes.map((l) => ({ id: l.id, label: l.label, color: l.color, actor: l.actor, nodes: [] }));
  for (const n of data.nodes) (buckets.find((b) => b.id === n.lane) ?? buckets[0]).nodes.push(n);
  const pos = /* @__PURE__ */ new Map();
  const bands = [];
  let y = LANE_TOP;
  for (const bucket of buckets) {
    const depth = laneDepthMap(bucket.nodes, data.edges);
    const cols = [];
    for (const n of bucket.nodes) (cols[depth.get(n.id) ?? 0] ??= []).push(n);
    const colCount = Math.max(1, cols.length);
    const rows = Math.max(1, ...cols.map((c) => c.length));
    const bandH = Math.max(LANE_MIN_H, rows * FLOW_ROW_H + 24);
    const contentLeft = LHW + 24;
    const contentRight = FVW - 24;
    cols.forEach((col, ci) => {
      col.forEach((n, ri) => {
        pos.set(n.id, {
          x: contentLeft + (ci + 0.5) / colCount * (contentRight - contentLeft),
          y: y + bandH / 2 + (ri - (col.length - 1) / 2) * FLOW_ROW_H
        });
      });
    });
    bands.push({ id: bucket.id, label: bucket.label, color: bucket.color, actor: bucket.actor, y, h: bandH });
    y += bandH + LANE_GAP;
  }
  return { pos, bands, vh: y + LANE_TOP };
}
function flowEdgePath(a, b, aw, ah, bw, bh) {
  const dx0 = b.x - a.x;
  const dy0 = b.y - a.y;
  if (Math.abs(dx0) >= Math.abs(dy0)) {
    const sgn2 = dx0 >= 0 ? 1 : -1;
    const x1 = a.x + sgn2 * (aw / 2 + 6);
    const x2 = b.x - sgn2 * (bw / 2 + 8);
    const hh2 = Math.max(30, Math.abs(x2 - x1) / 2);
    return {
      d: `M ${x1} ${a.y} C ${x1 + sgn2 * hh2} ${a.y}, ${x2 - sgn2 * hh2} ${b.y}, ${x2} ${b.y}`,
      mid: { x: (x1 + x2) / 2, y: (a.y + b.y) / 2 }
    };
  }
  const sgn = dy0 >= 0 ? 1 : -1;
  const y1 = a.y + sgn * (ah / 2 + 6);
  const y2 = b.y - sgn * (bh / 2 + 12);
  const hh = Math.max(24, Math.abs(y2 - y1) / 2);
  return {
    d: `M ${a.x} ${y1} C ${a.x} ${y1 + sgn * hh}, ${b.x} ${y2 - sgn * hh}, ${b.x} ${y2}`,
    mid: { x: (a.x + b.x) / 2, y: (y1 + y2) / 2 }
  };
}
function straightEdgePath(a, b, aw, ah, bw, bh) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const ahW = aw / 2 + 6;
  const ahH = ah / 2 + 6;
  const bhW = bw / 2 + 6;
  const bhH = bh / 2 + 6;
  let tA = dist;
  let tB = dist;
  if (Math.abs(ux) > 1e-9) {
    tA = Math.min(tA, ahW / Math.abs(ux));
    tB = Math.min(tB, bhW / Math.abs(ux));
  }
  if (Math.abs(uy) > 1e-9) {
    tA = Math.min(tA, ahH / Math.abs(uy));
    tB = Math.min(tB, bhH / Math.abs(uy));
  }
  const x1 = a.x + ux * tA;
  const y1 = a.y + uy * tA;
  const x2 = b.x - ux * tB;
  const y2 = b.y - uy * tB;
  return { x1, y1, x2, y2, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
}
var edgeStyle = (e, kind) => e.style === "straight" || e.style === "curved" ? e.style : kind === "flow" ? "curved" : "straight";
var edgeArrow = (e, kind) => e.arrow === "none" || e.arrow === "end" || e.arrow === "both" ? e.arrow : kind === "flow" ? "end" : "none";
var edgeStroke = (e, kind) => e.color || (kind === "flow" ? "var(--ink-soft)" : "var(--rule)");
var edgeWidth = (e, kind) => e.width ?? (kind === "flow" ? 1.6 : 2);
function drawEdge(o) {
  const { parent, mount, svg, markerId, e, a, b, aw, ah, bw, bh, kind, cross, edit, data } = o;
  const attrs = {
    fill: "none",
    stroke: edgeStroke(e, kind),
    "stroke-width": String(edgeWidth(e, kind))
  };
  if (e.dash) attrs["stroke-dasharray"] = e.dash;
  else if (cross) attrs["stroke-dasharray"] = "6 4";
  const arrow = edgeArrow(e, kind);
  if (arrow === "end" || arrow === "both") attrs["marker-end"] = `url(#${markerId})`;
  if (arrow === "both") attrs["marker-start"] = `url(#${markerId})`;
  let geom;
  let mid;
  if (edgeStyle(e, kind) === "curved") {
    const r = flowEdgePath(a, b, aw, ah, bw, bh);
    svgEl("path", { ...attrs, d: r.d }, parent);
    geom = { d: r.d };
    mid = r.mid;
  } else {
    const r = straightEdgePath(a, b, aw, ah, bw, bh);
    svgEl("line", { ...attrs, x1: String(r.x1), y1: String(r.y1), x2: String(r.x2), y2: String(r.y2) }, parent);
    geom = { line: { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 } };
    mid = r.mid;
  }
  edgeLabel(parent, mid.x, mid.y, e.label);
  if (edit) wireEdgeHit(parent, mount, svg, geom, mid, e, data, edit);
}
function addEdgeMarker(svg) {
  const markerId = `o-arrow-${++markerSeq}`;
  const defs = svgEl("defs", {}, svg);
  const marker = svgEl("marker", {
    id: markerId,
    viewBox: "0 0 10 10",
    refX: "9",
    refY: "5",
    markerWidth: "7",
    markerHeight: "7",
    orient: "auto-start-reverse"
  }, defs);
  svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "context-stroke" }, marker);
  return markerId;
}
function flowContentExtent(data, pos) {
  let maxX = 0;
  let maxY = 0;
  for (const n of data.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const w = n.width ?? FW;
    const h = n.height ?? FH;
    const dx = n.shape === "diamond" ? 12 : 0;
    const dy = n.shape === "diamond" ? 10 : 0;
    maxX = Math.max(maxX, p.x + w / 2 + dx);
    maxY = Math.max(maxY, p.y + h / 2 + dy);
  }
  return { w: maxX + 24, h: maxY + 24 };
}
function renderFlow(slide, data, opts = {}) {
  const mount = slide.querySelector("[data-flow-mount]");
  if (!mount) return;
  dmCancelPendingSelect();
  dmSyncLane(data);
  mount.textContent = "";
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const hasLanes = !!(data.lanes && data.lanes.length > 0);
  let vh = FVH;
  let bands = [];
  let laneOf = /* @__PURE__ */ new Map();
  const pos = /* @__PURE__ */ new Map();
  if (hasLanes) {
    const layout2 = flowLanePositions(data);
    layout2.pos.forEach((p, id) => pos.set(id, p));
    vh = layout2.vh;
    bands = layout2.bands;
    laneOf = new Map(data.nodes.map((n) => [n.id, n.lane ?? null]));
    for (const n of data.nodes) {
      if (n.x !== void 0 && n.y !== void 0) pos.set(n.id, { x: n.x / 100 * FVW, y: n.y / 100 * vh });
    }
  } else {
    const auto = flowAutoPositions(data);
    for (const n of data.nodes) {
      pos.set(
        n.id,
        n.x !== void 0 && n.y !== void 0 ? { x: n.x / 100 * FVW, y: n.y / 100 * FVH } : auto.get(n.id)
      );
    }
  }
  const extent = flowContentExtent(data, pos);
  const vw = Math.max(FVW, extent.w);
  vh = Math.max(vh, extent.h);
  const svg = svgEl("svg", { viewBox: `0 0 ${vw} ${vh}`, class: "o-flow-svg", role: "img" });
  const markerId = addEdgeMarker(svg);
  if (hasLanes) {
    const laneLayer = svgEl("g", { class: "o-flow-lanes" }, svg);
    bands.forEach((band, i) => {
      const rect = svgEl("rect", {
        x: "0",
        y: String(band.y),
        width: String(vw),
        height: String(band.h),
        rx: "12",
        fill: band.color ?? "var(--ink)",
        "fill-opacity": band.color ? "0.10" : i % 2 ? "0.03" : "0.06",
        stroke: "var(--rule)",
        "stroke-opacity": "0.25"
      }, laneLayer);
      if (band.label) {
        const hx = String(opts.edit ? LANE_X_EDIT : LANE_X_VIEW);
        const t = svgEl("text", {
          x: hx,
          y: String(band.y + 26),
          "text-anchor": "start",
          fill: "var(--ink)",
          style: "font: 600 13px var(--font-body); pointer-events: none;"
        }, laneLayer);
        t.textContent = band.label;
        if (band.actor) {
          const a = svgEl("text", {
            x: hx,
            y: String(band.y + 44),
            "text-anchor": "start",
            fill: "var(--ink-soft)",
            style: "font: 600 11px var(--font-body); pointer-events: none;"
          }, laneLayer);
          a.textContent = band.actor;
        }
      }
      if (opts.edit) wireLaneBand(rect, laneLayer, band, vw, vh, pos, data, opts.edit.onCommit);
    });
  }
  const edges = svgEl("g", {}, svg);
  for (const e of data.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const an = byId.get(e.from);
    const bn = byId.get(e.to);
    const cross = hasLanes && laneOf.get(e.from) !== laneOf.get(e.to);
    drawEdge({ parent: edges, mount, svg, markerId, e, a, b, aw: an.width ?? FW, ah: an.height ?? FH, bw: bn.width ?? FW, bh: bn.height ?? FH, kind: "flow", cross, edit: opts.edit, data });
  }
  if (opts.edit && dmSelected && !data.nodes.some((n) => n.id === dmSelected)) dmSelected = null;
  const nodes = svgEl("g", {}, svg);
  for (const n of data.nodes) {
    const p = pos.get(n.id);
    const w = n.width ?? FW;
    const h = n.height ?? FH;
    const g = svgEl("g", { "data-node": n.id, transform: `translate(${p.x} ${p.y})` }, nodes);
    shapeFor(g, n, 0, 0, w, h);
    nodeLabel(g, 0, 0, n.label, n.shape === "diamond" ? 18 : 22, 13.5);
    drawNodeIcon(g, n, w, h, n.shape === "diamond");
    if (opts.edit) {
      const ed = opts.edit;
      const commitXY = (x, y) => ed.onCommit({ nodes: data.nodes.map((m) => m.id === n.id ? { ...m, x, y } : m), edges: data.edges, lanes: data.lanes });
      const suppress = wireNodeDrag(svg, g, { x: p.x / vw * 100, y: p.y / vh * 100 }, vw, vh, commitXY);
      wireNodeContextDelete(g, n.id, data, ed.onCommit);
      const halo2 = () => dmHalo(g, 0, 0, w + (n.shape === "diamond" ? 24 : 0), h + (n.shape === "diamond" ? 20 : 0));
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        if (suppress.dragged) {
          suppress.dragged = false;
          return;
        }
        if (e.detail > 1) return;
        dmCancelPendingSelect();
        dmSelectTimer = setTimeout(() => {
          dmSelectTimer = null;
          dmToggleSelect(svg, n.id, halo2);
          ed.onSelectNode?.(
            dmSelected === n.id ? n.id : null,
            dmSelected === n.id ? g.getBoundingClientRect() : null
          );
        }, 280);
      });
      g.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        e.preventDefault();
        dmCancelPendingSelect();
        ed.onSelectNode?.(null, null);
        dmRename(
          mount,
          g,
          n.label,
          (label) => ed.onCommit({ nodes: data.nodes.map((m) => m.id === n.id ? { ...m, label } : m), edges: data.edges, lanes: data.lanes })
        );
      });
      if (dmSelected === n.id) halo2();
    }
  }
  if (opts.edit) {
    const ed = opts.edit;
    for (const n of data.nodes) {
      const p = pos.get(n.id);
      dmPort(svg, mount, { id: n.id, vx: p.x + (n.width ?? FW) / 2 + (n.shape === "diamond" ? 14 : 2), vy: p.y }, "flow", data, ed.onCommit);
    }
    dmActive = { data, commit: ed.onCommit };
    wireDmKeys();
  }
  mount.appendChild(svg);
  if (opts.edit) editButton(mount, opts.edit.onOpenEditor);
}
var GVW = 1e3;
var GVH = 600;
var GW = 150;
var GH = 50;
function fitPositions(pts, ids) {
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const scale = Math.min(92 / Math.max(1, maxX - minX), 92 / Math.max(1, maxY - minY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const out = /* @__PURE__ */ new Map();
  pts.forEach((p, i) => {
    out.set(ids[i], {
      x: Math.max(4, Math.min(96, 50 + (p.x - cx) * scale)),
      y: Math.max(4, Math.min(96, 50 + (p.y - cy) * scale))
    });
  });
  return out;
}
function forceLayout(data) {
  const ids = data.nodes.map((node) => node.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const pos = data.nodes.map((node) => ({ x: node.x, y: node.y }));
  const adj = /* @__PURE__ */ new Map();
  for (const e of data.edges) {
    const a = idx.get(e.from);
    const b = idx.get(e.to);
    if (a === void 0 || b === void 0 || a === b) continue;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const k = Math.sqrt(100 * 100 / n);
  const ITER = 80;
  const t0 = 12;
  for (let iter = 0; iter < ITER; iter++) {
    const t = t0 * (1 - iter / ITER);
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 0.01) continue;
        const d = Math.sqrt(d2);
        const f = k * k / d2;
        const fx = dx / d * f;
        const fy = dy / d * f;
        disp[i].x += fx;
        disp[i].y += fy;
        disp[j].x -= fx;
        disp[j].y -= fy;
      }
    }
    for (const [a, bs] of adj) {
      for (const b of bs) {
        if (b <= a) continue;
        const dx = pos[a].x - pos[b].x;
        const dy = pos[a].y - pos[b].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = d * d / k;
        const fx = dx / d * f;
        const fy = dy / d * f;
        disp[a].x -= fx;
        disp[a].y -= fy;
        disp[b].x += fx;
        disp[b].y += fy;
      }
    }
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(disp[i].x * disp[i].x + disp[i].y * disp[i].y) || 0.01;
      const capped = Math.min(d, t);
      pos[i].x += disp[i].x / d * capped;
      pos[i].y += disp[i].y / d * capped;
    }
  }
  return fitPositions(pos, ids);
}
function radialLayout(data) {
  const adj = /* @__PURE__ */ new Map();
  for (const node of data.nodes) adj.set(node.id, []);
  for (const e of data.edges) {
    if (adj.has(e.from)) adj.get(e.from).push(e.to);
    if (adj.has(e.to)) adj.get(e.to).push(e.from);
  }
  let center = data.nodes[0].id;
  let maxDeg = -1;
  for (const node of data.nodes) {
    const deg = adj.get(node.id).length;
    if (deg > maxDeg) {
      maxDeg = deg;
      center = node.id;
    }
  }
  const dist = /* @__PURE__ */ new Map([[center, 0]]);
  const queue = [center];
  while (queue.length) {
    const u = queue.shift();
    for (const v of adj.get(u)) {
      if (!dist.has(v)) {
        dist.set(v, (dist.get(u) ?? 0) + 1);
        queue.push(v);
      }
    }
  }
  const rings = /* @__PURE__ */ new Map();
  for (const node of data.nodes) {
    const d = dist.get(node.id) ?? 1;
    if (!rings.has(d)) rings.set(d, []);
    rings.get(d).push(node.id);
  }
  const maxRing = Math.max(...rings.keys());
  const pos = /* @__PURE__ */ new Map();
  rings.forEach((ringNodes, ring) => {
    const radius = ring === 0 ? 0 : ring / Math.max(1, maxRing) * 42;
    const yRadius = radius * 0.62;
    const step = Math.PI * 2 / Math.max(1, ringNodes.length);
    ringNodes.forEach((id, i) => {
      const angle = i * step - Math.PI / 2;
      pos.set(id, {
        x: 50 + Math.cos(angle) * radius,
        y: 50 + Math.sin(angle) * yRadius
      });
    });
  });
  return pos;
}
function treeLayout(data) {
  const depth = new Map(data.nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < data.nodes.length; pass++) {
    let moved = false;
    for (const e of data.edges) {
      const want = (depth.get(e.from) ?? 0) + 1;
      if (want > (depth.get(e.to) ?? 0) && want < data.nodes.length + 1) {
        depth.set(e.to, want);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const rows = [];
  for (const node of data.nodes) {
    const r = depth.get(node.id) ?? 0;
    if (!rows[r]) rows[r] = [];
    rows[r].push(node.id);
  }
  const rowCount = Math.max(1, rows.length);
  const pos = /* @__PURE__ */ new Map();
  rows.forEach((row, ri) => {
    row.forEach((id, ci) => {
      pos.set(id, {
        x: (ci + 0.5) / Math.max(1, row.length) * 90 + 5,
        y: (ri + 0.5) / rowCount * 90 + 5
      });
    });
  });
  return pos;
}
function graphLayout(data, mode) {
  if (mode === "force") return forceLayout(data);
  if (mode === "radial") return radialLayout(data);
  return treeLayout(data);
}
var GLANE_MIN_H = 90;
var GLANE_ROW_H = 70;
function graphLanePositions(data) {
  const lanes = [...data.lanes ?? []].sort((a, b) => a.order - b.order);
  const byLane = new Map(lanes.map((l) => [l.id, []]));
  for (const n of data.nodes) (byLane.get(n.lane ?? "") ?? byLane.get(lanes[0].id)).push(n);
  const pos = /* @__PURE__ */ new Map();
  const bands = [];
  let y = LANE_TOP;
  for (const l of lanes) {
    const nodes = byLane.get(l.id);
    const cols = Math.max(1, Math.min(4, nodes.length));
    const rows = Math.max(1, Math.ceil(nodes.length / cols));
    const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(GLANE_ROW_H, ...nodes.filter((_2, i) => Math.floor(i / cols) === row).map((n) => (n.height ?? GH) + 20)));
    const bandH = Math.max(GLANE_MIN_H, rowHeights.reduce((a, b) => a + b, 0) + 24);
    const rowY = [];
    let cursor = y + 12;
    for (const rh of rowHeights) {
      rowY.push(cursor + rh / 2);
      cursor += rh;
    }
    nodes.forEach((n, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      pos.set(n.id, {
        x: (col + 0.5) / cols * (GVW - 80) + 40,
        y: rowY[row]
      });
    });
    bands.push({ id: l.id, label: l.label, color: l.color, actor: l.actor, y, h: bandH });
    y += bandH + LANE_GAP;
  }
  return { pos, bands, vh: Math.max(GVH, y + LANE_TOP) };
}
function renderGraph(slide, data, opts = {}) {
  const mount = slide.querySelector("[data-graph-mount]");
  if (!mount) return;
  dmCancelPendingSelect();
  dmSyncLane(data);
  mount.textContent = "";
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const hasLanes = !!(data.lanes && data.lanes.length > 0);
  let vh = GVH;
  let bands = [];
  if (hasLanes) {
    const layout2 = graphLanePositions(data);
    vh = layout2.vh;
    bands = layout2.bands;
  }
  const px = (n) => ({ x: n.x / 100 * GVW, y: n.y / 100 * vh });
  const nodePos = (n) => px(n);
  const svg = svgEl("svg", { viewBox: `0 0 ${GVW} ${vh}`, class: "o-graph-svg", role: "img" });
  const markerId = addEdgeMarker(svg);
  if (hasLanes) {
    const laneLayer = svgEl("g", { class: "o-flow-lanes" }, svg);
    const laneGeom = new Map(data.nodes.map((n) => [n.id, nodePos(n)]));
    bands.forEach((band, i) => {
      const rect = svgEl("rect", {
        x: "0",
        y: String(band.y),
        width: String(GVW),
        height: String(band.h),
        rx: "12",
        fill: band.color ?? "var(--ink)",
        "fill-opacity": band.color ? "0.10" : i % 2 ? "0.03" : "0.06",
        stroke: "var(--rule)",
        "stroke-opacity": "0.25"
      }, laneLayer);
      if (band.label) {
        const hx = String(opts.edit ? LANE_X_EDIT : LANE_X_VIEW);
        const t = svgEl("text", {
          x: hx,
          y: String(band.y + 26),
          "text-anchor": "start",
          fill: "var(--ink)",
          style: "font: 600 13px var(--font-body); pointer-events: none;"
        }, laneLayer);
        t.textContent = band.label;
        if (band.actor) {
          const a = svgEl("text", {
            x: hx,
            y: String(band.y + 44),
            "text-anchor": "start",
            fill: "var(--ink-soft)",
            style: "font: 600 11px var(--font-body); pointer-events: none;"
          }, laneLayer);
          a.textContent = band.actor;
        }
      }
      if (opts.edit) wireLaneBand(rect, laneLayer, band, GVW, vh, laneGeom, data, opts.edit.onCommit);
    });
  }
  const edges = svgEl("g", {}, svg);
  for (const e of data.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    drawEdge({ parent: edges, mount, svg, markerId, e, a: nodePos(a), b: nodePos(b), aw: a.width ?? GW, ah: a.height ?? GH, bw: b.width ?? GW, bh: b.height ?? GH, kind: "graph", edit: opts.edit, data });
  }
  if (opts.edit && dmSelected && !data.nodes.some((n) => n.id === dmSelected)) dmSelected = null;
  const nodes = svgEl("g", {}, svg);
  for (const n of data.nodes) {
    const p = nodePos(n);
    const shape = n.shape ?? "pill";
    const w = n.width ?? GW;
    const h = n.height ?? GH;
    const g = svgEl("g", { "data-node": n.id, transform: `translate(${p.x} ${p.y})` }, nodes);
    nodeBody(g, shape, 0, 0, w, h, nodeStroke(n), nodeFill(n));
    nodeLabel(g, 0, 0, n.label, shape === "diamond" ? 16 : 18, 13.5);
    drawNodeIcon(g, n, w, h, shape === "diamond");
    if (opts.edit) {
      const ed = opts.edit;
      const suppress = wireNodeDrag(
        svg,
        g,
        { x: p.x / GVW * 100, y: p.y / vh * 100 },
        GVW,
        vh,
        (x, y) => ed.onCommit({ nodes: data.nodes.map((m) => m.id === n.id ? { ...m, x, y } : m), edges: data.edges, lanes: data.lanes })
      );
      wireNodeContextDelete(g, n.id, data, ed.onCommit);
      const halo2 = () => dmHalo(g, 0, 0, w + (shape === "diamond" ? 24 : 0), h + (shape === "diamond" ? 20 : 0));
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        if (suppress.dragged) {
          suppress.dragged = false;
          return;
        }
        if (e.detail > 1) return;
        dmCancelPendingSelect();
        dmSelectTimer = setTimeout(() => {
          dmSelectTimer = null;
          dmToggleSelect(svg, n.id, halo2);
          ed.onSelectNode?.(
            dmSelected === n.id ? n.id : null,
            dmSelected === n.id ? g.getBoundingClientRect() : null
          );
        }, 280);
      });
      g.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        e.preventDefault();
        dmCancelPendingSelect();
        ed.onSelectNode?.(null, null);
        dmRename(
          mount,
          g,
          n.label,
          (label) => ed.onCommit({ nodes: data.nodes.map((m) => m.id === n.id ? { ...m, label } : m), edges: data.edges, lanes: data.lanes })
        );
      });
      if (dmSelected === n.id) halo2();
    }
  }
  if (opts.edit) {
    const ed = opts.edit;
    for (const n of data.nodes) {
      const p = nodePos(n);
      const shape = n.shape ?? "pill";
      dmPort(svg, mount, { id: n.id, vx: p.x + (n.width ?? GW) / 2 + (shape === "diamond" ? 14 : 2), vy: p.y }, "graph", data, ed.onCommit);
    }
    dmActive = { data, commit: ed.onCommit };
    wireDmKeys();
  }
  mount.appendChild(svg);
  if (opts.edit) editButton(mount, opts.edit.onOpenEditor);
}
function wireNodeDrag(svg, g, start, vw, vh, commitXY) {
  const flag = { dragged: false };
  g.style.cursor = "grab";
  g.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    down.stopPropagation();
    let nx = start.x;
    let ny = start.y;
    const move = (e) => {
      const p = clientToVb(svg, e.clientX, e.clientY);
      nx = p.x / vw * 100;
      ny = p.y / vh * 100;
      if (dmSnap) {
        nx = Math.round(nx / 5) * 5;
        ny = Math.round(ny / 5) * 5;
      }
      nx = Math.max(2, Math.min(98, nx));
      ny = Math.max(4, Math.min(96, ny));
      g.setAttribute("transform", `translate(${nx / 100 * vw} ${ny / 100 * vh})`);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (nx === start.x && ny === start.y) return;
      flag.dragged = true;
      commitXY(Math.round(nx * 10) / 10, Math.round(ny * 10) / 10);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  return flag;
}
function flowContainerOf(block) {
  return block.closest("figure, .o-flow-shell") ?? block.parentElement;
}
function graphContainerOf(block) {
  return block.closest("figure, .o-graph-shell") ?? block.parentElement;
}
function mountFlows(slide) {
  slide.querySelectorAll('script[data-odata="flow"]').forEach((block) => {
    const root = flowContainerOf(block);
    if (!root) return;
    const data = parseFlowSlideData(root);
    if (data) renderFlow(root, data);
    else renderDiagramError(root, "flow");
  });
}
function mountGraphs(slide) {
  slide.querySelectorAll('script[data-odata="graph"]').forEach((block) => {
    const root = graphContainerOf(block);
    if (!root) return;
    const data = parseGraphSlideData(root);
    if (data) renderGraph(root, data);
    else renderDiagramError(root, "graph");
  });
}
var finalizeFlows = mountFlows;
var finalizeGraphs = mountGraphs;

// ../format/dist/types.js
var FormatError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "FormatError";
  }
};

// ../format/dist/parse.js
var MANIFEST_OPEN = /<script\s+type="application\/json"\s+id="origami-manifest"\s*>/;
var ASSETS_OPEN = /<script\s+type="application\/json"\s+id="origami-assets"\s*>/;
var TEMPLATE_OPEN = "<template";
var TEMPLATE_CLOSE = "</template>";
function parseDeck(text) {
  if (!/^<!DOCTYPE html>/i.test(text.trimStart())) {
    throw new FormatError("not an HTML document");
  }
  if (!/<html[^>]*\bdata-origami="[^"]+"/.test(text)) {
    throw new FormatError("missing data-origami attribute on <html>");
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const mOpen = MANIFEST_OPEN.exec(text);
  if (!mOpen)
    throw new FormatError("missing origami-manifest script");
  const mStart = mOpen.index + mOpen[0].length;
  const mEnd = text.indexOf("<\/script>", mStart);
  if (mEnd === -1)
    throw new FormatError("unterminated manifest script");
  let manifest;
  try {
    manifest = JSON.parse(text.slice(mStart, mEnd));
  } catch (e) {
    throw new FormatError("manifest is not valid JSON: " + e.message);
  }
  let assets = {};
  let assetsRegion = null;
  const aOpen = ASSETS_OPEN.exec(text);
  if (aOpen) {
    const aStart = aOpen.index + aOpen[0].length;
    const aEnd = text.indexOf("<\/script>", aStart);
    if (aEnd === -1)
      throw new FormatError("unterminated origami-assets script");
    let parsed;
    try {
      parsed = JSON.parse(text.slice(aStart, aEnd));
    } catch (e) {
      throw new FormatError("origami-assets is not valid JSON: " + e.message);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new FormatError("origami-assets must be a JSON object");
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== "string")
        throw new FormatError(`origami-assets: asset "${k}" is not a string`);
    }
    assets = parsed;
    assetsRegion = { start: aStart, end: aEnd };
  }
  const scriptRegions = [];
  let sPos = 0;
  for (; ; ) {
    const sStart = text.indexOf("<script", sPos);
    if (sStart === -1)
      break;
    const sOpen = text.indexOf(">", sStart);
    if (sOpen === -1)
      break;
    const sClose = text.indexOf("<\/script>", sOpen);
    if (sClose === -1)
      break;
    const end = sClose + "<\/script>".length;
    scriptRegions.push({ start: sStart, end });
    sPos = end;
  }
  const inScript = (i) => scriptRegions.find((r) => i >= r.start && i < r.end);
  const slides = [];
  let pos = 0;
  for (; ; ) {
    const tStart = text.indexOf(TEMPLATE_OPEN, pos);
    if (tStart === -1)
      break;
    const region = inScript(tStart);
    if (region) {
      pos = region.end;
      continue;
    }
    const tagEnd = findTagEnd(text, tStart);
    const tag = text.slice(tStart, tagEnd + 1);
    const idMatch = /\bdata-origami-slide="([^"]*)"/.exec(tag);
    if (!idMatch) {
      const skipTo = text.indexOf(TEMPLATE_CLOSE, tagEnd);
      if (skipTo === -1)
        throw new FormatError("unterminated <template>");
      pos = skipTo + TEMPLATE_CLOSE.length;
      continue;
    }
    const id = idMatch[1];
    const kindMatch = /\bdata-kind="([^"]*)"/.exec(tag);
    if (!kindMatch)
      throw new FormatError(`slide "${id}": missing data-kind`);
    const innerStart = tagEnd + 1;
    const innerEnd = text.indexOf(TEMPLATE_CLOSE, innerStart);
    if (innerEnd === -1)
      throw new FormatError(`slide "${id}": unterminated template`);
    const nested = text.indexOf(TEMPLATE_OPEN, innerStart);
    if (nested !== -1 && nested < innerEnd) {
      throw new FormatError(`slide "${id}": nested <template> is not allowed`);
    }
    slides.push({
      id,
      kind: kindMatch[1],
      element: { start: tStart, end: innerEnd + TEMPLATE_CLOSE.length },
      inner: { start: innerStart, end: innerEnd }
    });
    pos = innerEnd + TEMPLATE_CLOSE.length;
  }
  const slideById = /* @__PURE__ */ new Map();
  for (const s2 of slides) {
    if (slideById.has(s2.id))
      throw new FormatError(`duplicate slide id "${s2.id}"`);
    slideById.set(s2.id, s2);
  }
  return {
    text,
    eol,
    manifest,
    manifestRegion: { start: mStart, end: mEnd },
    slides,
    slideById,
    assets,
    assetsRegion
  };
}
function findTagEnd(text, tagStart) {
  let i = tagStart;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (c === quote)
        quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
    i++;
  }
  throw new FormatError("unterminated tag");
}
function slideInner(deck, slideId) {
  const s2 = deck.slideById.get(slideId);
  if (!s2)
    throw new FormatError(`unknown slide "${slideId}"`);
  return deck.text.slice(s2.inner.start, s2.inner.end);
}

// ../format/dist/splice.js
function spliceText(text, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end)
      throw new FormatError("overlapping edits");
  }
  let out = text;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}
function normalizeEol(content, eol) {
  const lf = content.replace(/\r\n/g, "\n");
  return eol === "\n" ? lf : lf.replace(/\n/g, "\r\n");
}
function replaceSlideInner(deck, slideId, newInner) {
  const s2 = deck.slideById.get(slideId);
  if (!s2)
    throw new FormatError(`unknown slide "${slideId}"`);
  const out = spliceText(deck.text, [
    { start: s2.inner.start, end: s2.inner.end, replacement: normalizeEol(newInner, deck.eol) }
  ]);
  return parseDeck(out);
}

// ../format/dist/theme.js
var TOKEN_KEY_RE = /^[a-z][a-z0-9-]*$/;
var TOKEN_VALUE_BAD = /[<>{};\\]|url\s*\(|\/\*|@/i;
function validateThemeTokens(tokens) {
  const v = [];
  if (tokens === null || typeof tokens !== "object" || Array.isArray(tokens)) {
    return [{ rule: "theme.tokens", detail: "theme tokens must be an object of css custom property values" }];
  }
  for (const [key, value] of Object.entries(tokens)) {
    if (!TOKEN_KEY_RE.test(key)) {
      v.push({ rule: "theme.token-key", detail: `token "${key}": keys are lowercase [a-z0-9-], starting with a letter` });
    }
    if (typeof value !== "string" || value.length === 0 || value.length > 300) {
      v.push({ rule: "theme.token-value", detail: `token "${key}": value must be a non-empty string (max 300)` });
    } else if (TOKEN_VALUE_BAD.test(value)) {
      v.push({
        rule: "theme.token-value",
        detail: `token "${key}": value may not contain braces, semicolons, angle brackets, comments, @, or url()`
      });
    }
  }
  return v;
}
function themeCssFromTokens(tokens) {
  const violations = validateThemeTokens(tokens);
  if (violations.length > 0)
    throw new FormatError("theme: " + violations[0].detail);
  const lines = Object.entries(tokens).map(([k, v]) => `  --${k}: ${v};`);
  return "\n:root {\n" + lines.join("\n") + "\n}\n";
}

// ../format/dist/chart-data.js
var TREEMAP_MAX_NODES = 60;
var SANKEY_MAX_NODES = 60;
var SANKEY_MAX_LINKS = 120;
var CHART_PLOT_H_MIN = 180;
var CHART_PLOT_H_MAX = 1200;
var TEXT_SCALE_MIN = 0.75;
var TEXT_SCALE_MAX = 1.5;
var WATERFALL_KINDS = ["total", "increase", "decrease"];

// ../format/dist/video-data.js
var VIDEO_PROVIDERS = ["youtube", "vimeo", "loom"];
var VIDEO_PROVIDER_SPECS = {
  youtube: {
    label: "YouTube",
    host: "www.youtube-nocookie.com",
    idRe: /^[A-Za-z0-9_-]{11}$/,
    embedUrl: (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
    needsReferrer: true
  },
  vimeo: {
    label: "Vimeo",
    host: "player.vimeo.com",
    idRe: /^\d{1,12}$/,
    embedUrl: (id) => `https://player.vimeo.com/video/${id}?autoplay=1`,
    needsReferrer: false
    // verified live from file:// 2026-06-10
  },
  loom: {
    label: "Loom",
    host: "www.loom.com",
    idRe: /^[a-f0-9]{32}$/,
    embedUrl: (id) => `https://www.loom.com/embed/${id}`,
    needsReferrer: false
    // not live-verified yet — flip if a real share 153s
  }
};
function videoCapability(provider) {
  return provider === "link" ? null : `embed:${VIDEO_PROVIDER_SPECS[provider].host}`;
}
function videoEmbedUrl(data) {
  if (data.provider === "link")
    return null;
  const spec = VIDEO_PROVIDER_SPECS[data.provider];
  if (!spec || !spec.idRe.test(data.videoId))
    return null;
  return spec.embedUrl(data.videoId);
}

// ../format/dist/table-core.js
var A1_RE = /^([A-Z]+)([0-9]+)$/;
var colA1 = (c) => {
  let s2 = "", n = c + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s2 = String.fromCharCode(65 + r) + s2;
    n = Math.floor((n - 1) / 26);
  }
  return s2;
};
var a1 = (r, c) => colA1(c) + (r + 1);
function colIdx(letters) {
  let c = 0;
  for (const ch of letters.toUpperCase())
    c = c * 26 + (ch.charCodeAt(0) - 64);
  return c - 1;
}
function a1ToRC(key) {
  const m = A1_RE.exec(key);
  return m ? { r: parseInt(m[2], 10) - 1, c: colIdx(m[1]) } : null;
}
function a1RangeToRect(range) {
  const parts = range.trim().split(":");
  if (parts.length < 1 || parts.length > 2)
    return null;
  const a = a1ToRC(parts[0].trim());
  const b = a1ToRC((parts[1] ?? parts[0]).trim());
  if (!a || !b)
    return null;
  return { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) };
}
var isNumeric = (s2) => s2.trim() !== "" && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s2.trim());
var isErrStr = (s2) => s2.charCodeAt(0) === 35;
var trimNum = (n) => String(Math.round(n * 1e6) / 1e6);
var FILL_TOKEN = /^fill-[a-z0-9-]{1,27}$/;
var FILL_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function fmtAt(d, r, c) {
  return d.cellFormats?.[a1(r, c)] ?? d.columns[c]?.format;
}
function gridWidth(d) {
  return d.rows.reduce((m, r) => Math.max(m, r.length), d.columns.length);
}
function aggregateNumbers(fn, nums) {
  if (!nums.length)
    return null;
  if (fn === "COUNT")
    return { fn, text: String(nums.length) };
  let v;
  if (fn === "AVG")
    v = nums.reduce((a, b) => a + b, 0) / nums.length;
  else if (fn === "MIN")
    v = nums.reduce((a, b) => b < a ? b : a);
  else if (fn === "MAX")
    v = nums.reduce((a, b) => b > a ? b : a);
  else
    v = nums.reduce((a, b) => a + b, 0);
  return { fn, text: trimNum(v) };
}
function mergeRects(merges) {
  if (!merges)
    return [];
  const out = [];
  for (const m of merges) {
    const r = a1RangeToRect(m);
    if (r && !(r.r0 === r.r1 && r.c0 === r.c1))
      out.push(r);
  }
  return out;
}
function mergeAt(rects, r, c) {
  for (const m of rects)
    if (r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1)
      return m;
  return null;
}
function clipMergesToCrop(rects, r0, c0, r1, c1) {
  const out = [];
  for (const m of rects) {
    if (m.r0 < r0 || m.c0 < c0 || m.r0 > r1 || m.c0 > c1)
      continue;
    out.push({ r0: m.r0, c0: m.c0, r1: Math.min(m.r1, r1), c1: Math.min(m.c1, c1) });
  }
  return out;
}
var hex6 = (s2) => s2.length === 4 ? "#" + s2[1] + s2[1] + s2[2] + s2[2] + s2[3] + s2[3] : s2;
function lerpHex(from, to, t) {
  const a = hex6(from), b = hex6(to);
  const ch = (i) => {
    const av = parseInt(a.slice(1 + i * 2, 3 + i * 2), 16);
    const bv = parseInt(b.slice(1 + i * 2, 3 + i * 2), 16);
    const v = Math.round(av + (bv - av) * t);
    return (v < 16 ? "0" : "") + v.toString(16);
  };
  return "#" + ch(0) + ch(1) + ch(2);
}
function evaluateCondFmt(values, rules, merges) {
  const out = /* @__PURE__ */ new Map();
  if (!rules || !rules.length)
    return out;
  const rects = merges ?? [];
  const covered = (r, c) => {
    for (const m of rects)
      if (r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1 && !(m.r0 === r && m.c0 === c))
        return true;
    return false;
  };
  const put = (r, c, fill, color) => {
    if (!fill && !color)
      return;
    const key = a1(r, c);
    const cur = out.get(key) ?? {};
    if (fill)
      cur.fill = fill;
    if (color)
      cur.color = color;
    out.set(key, cur);
  };
  for (const rule of rules) {
    const rect = a1RangeToRect(rule.range);
    if (!rect)
      continue;
    const cells = [];
    const rEnd = Math.min(rect.r1, values.length - 1);
    for (let r = rect.r0; r <= rEnd; r++) {
      const row = values[r];
      if (!row)
        continue;
      const cEnd = Math.min(rect.c1, row.length - 1);
      for (let c = rect.c0; c <= cEnd; c++) {
        if (covered(r, c))
          continue;
        cells.push({ r, c, s: row[c] ?? "" });
      }
    }
    if (rule.kind === "dupes") {
      const counts = /* @__PURE__ */ new Map();
      for (const cell of cells) {
        const s2 = cell.s.trim();
        if (s2 !== "")
          counts.set(s2, (counts.get(s2) ?? 0) + 1);
      }
      for (const cell of cells) {
        const s2 = cell.s.trim();
        if (s2 !== "" && (counts.get(s2) ?? 0) >= 2)
          put(cell.r, cell.c, rule.fill, rule.color);
      }
    } else if (rule.kind === "eq") {
      const target = (rule.text ?? "").trim();
      if (target === "")
        continue;
      const targetIsNum = isNumeric(target);
      const numTarget = targetIsNum ? Number(target) : 0;
      const targetLower = target.toLowerCase();
      for (const cell of cells) {
        const s2 = cell.s.trim();
        if (s2 === "")
          continue;
        const match = targetIsNum ? isNumeric(s2) && Number(s2) === numTarget : s2.toLowerCase() === targetLower;
        if (match)
          put(cell.r, cell.c, rule.fill, rule.color);
      }
    } else if (rule.kind === "gt" || rule.kind === "lt") {
      const th = rule.value ?? 0;
      for (const cell of cells) {
        if (!isNumeric(cell.s))
          continue;
        const v = Number(cell.s);
        if (rule.kind === "gt" ? v > th : v < th)
          put(cell.r, cell.c, rule.fill, rule.color);
      }
    } else if (rule.kind === "top" || rule.kind === "bot") {
      const nums = cells.filter((x) => isNumeric(x.s)).map((x) => Number(x.s));
      if (!nums.length)
        continue;
      const n = Math.max(1, Math.floor(rule.n ?? 1));
      const sorted = nums.slice().sort((x, y) => rule.kind === "top" ? y - x : x - y);
      const cutoff = sorted[Math.min(n, sorted.length) - 1];
      for (const cell of cells) {
        if (!isNumeric(cell.s))
          continue;
        const v = Number(cell.s);
        if (rule.kind === "top" ? v >= cutoff : v <= cutoff)
          put(cell.r, cell.c, rule.fill, rule.color);
      }
    } else if (rule.kind === "scale") {
      if (!rule.from || !rule.to)
        continue;
      const nums = cells.filter((x) => isNumeric(x.s)).map((x) => Number(x.s));
      if (!nums.length)
        continue;
      let mn = nums[0], mx = nums[0];
      for (const v of nums) {
        if (v < mn)
          mn = v;
        if (v > mx)
          mx = v;
      }
      const span2 = mx - mn;
      for (const cell of cells) {
        if (!isNumeric(cell.s))
          continue;
        const t = span2 === 0 ? 1 : (Number(cell.s) - mn) / span2;
        put(cell.r, cell.c, lerpHex(rule.from, rule.to, t));
      }
    }
  }
  return out;
}

// ../format/dist/draw-data.js
var DRAW_MAX_ELEMENTS = 200;
var DRAW_MAX_POINTS = 1200;
var DRAW_TYPES = ["rect", "diamond", "ellipse", "arrow", "line", "freedraw", "text"];

// ../format/dist/venn-data.js
var VENN_SIZE_MIN = 0.5;
var VENN_SIZE_MAX = 2;
var VENN_NUDGE_MAX = 60;

// ../format/dist/cell-format.js
var ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
var NUMRE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function typedFromBaked(s2) {
  if (s2 === "")
    return { kind: "blank" };
  if (s2.charCodeAt(0) === 35)
    return { kind: "err", code: s2 };
  if (s2 === "TRUE")
    return { kind: "bool", b: true };
  if (s2 === "FALSE")
    return { kind: "bool", b: false };
  const iso = ISO.exec(s2);
  if (iso)
    return { kind: "date", y: +iso[1], m: +iso[2], d: +iso[3] };
  if (NUMRE.test(s2)) {
    const n = Number(s2);
    if (Number.isFinite(n))
      return { kind: "num", n };
  }
  return { kind: "text", text: s2 };
}
var pad = (n) => n < 10 ? "0" + n : String(n);
var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var MONF = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function dateDisplay(y, m, d, df) {
  switch (df) {
    case "yyyy-mm-dd":
      return y + "-" + pad(m) + "-" + pad(d);
    case "dd/mm/yyyy":
      return pad(d) + "/" + pad(m) + "/" + y;
    case "mm/dd/yyyy":
      return pad(m) + "/" + pad(d) + "/" + y;
    case "d mmmm yyyy":
      return d + " " + MONF[m - 1] + " " + y;
    case "d mmm yyyy":
    default:
      return d + " " + MON[m - 1] + " " + y;
  }
}
function numFmt(x, dp, sep, thou) {
  if (!Number.isFinite(x))
    return "";
  const neg = x < 0;
  const [intRaw, frac] = Math.abs(x).toFixed(dp).split(".");
  const intPart = thou ? intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, sep === "," ? "." : ",") : intRaw;
  const out = dp > 0 ? intPart + (sep === "," ? "," : ".") + frac : intPart;
  return (neg ? "-" : "") + out;
}
var commas = (x, dp) => Number(x).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
function formatCell(baked, fmt) {
  if (baked === "")
    return "";
  const kind = fmt?.kind;
  if (!kind || kind === "general")
    return baked;
  const v = typedFromBaked(baked);
  if (v.kind === "err")
    return v.code;
  if (kind === "text") {
    if (v.kind === "text")
      return v.text;
    if (v.kind === "bool")
      return v.b ? "TRUE" : "FALSE";
    if (v.kind === "date")
      return `${v.y}-${pad(v.m)}-${pad(v.d)}`;
    if (v.kind === "num")
      return String(v.n);
    return baked;
  }
  if (v.kind === "text")
    return v.text;
  if (v.kind === "bool")
    return v.b ? "TRUE" : "FALSE";
  if (kind === "date") {
    return v.kind === "date" ? dateDisplay(v.y, v.m, v.d, fmt?.dateFmt ?? "d mmm yyyy") : baked;
  }
  if (v.kind !== "num")
    return baked;
  const n = v.n;
  if (kind === "number")
    return numFmt(n, fmt?.decimals ?? 2, fmt?.sep ?? ".", fmt?.thou ?? true);
  if (kind === "currency") {
    const sym = fmt?.currency ?? "$";
    const dp = fmt?.decimals ?? (Math.abs(n) % 1 ? 2 : 0);
    return (n < 0 ? "-" + sym : sym) + commas(Math.abs(n), dp);
  }
  if (kind === "percent")
    return commas(n * 100, fmt?.decimals ?? 0) + "%";
  return baked;
}
function formatTone(fmt) {
  const k = fmt?.kind;
  return k === "currency" ? "cur" : k === "percent" ? "pct" : k === "date" ? "date" : "num";
}

// src/chart/core.ts
var SVG_NS = "http://www.w3.org/2000/svg";
var svgEl2 = (tag, attrs, parent) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
};
var CHART_PALETTE = ["#4a8cc4", "#d9a520", "#3d8b5a", "#c64a4a", "#9333ea", "#0d9488", "#db2777", "#65a30d"];
var HEX_RE2 = /^#[0-9a-fA-F]{3,8}$/;
function sliceColor(data, i) {
  const c = data.sliceColors?.[i];
  return typeof c === "string" && HEX_RE2.test(c) ? c : CHART_PALETTE[i % CHART_PALETTE.length];
}
function altColor(base, i) {
  const b = base.toLowerCase();
  const want = CHART_PALETTE[i % CHART_PALETTE.length];
  if (want.toLowerCase() !== b) return want;
  return CHART_PALETTE.find((c) => c.toLowerCase() !== b) ?? want;
}
function xLabels(svg, labels, plotW, lay) {
  const groupW = plotW / labels.length;
  const y = lay.mT + lay.plotH + 18;
  labels.forEach((label, i) => {
    const t = svgEl2("text", { x: lay.mL + groupW * (i + 0.5), y, "text-anchor": "middle", class: "o-chart-tick" }, svg);
    t.textContent = label;
  });
}
var FULLWIDTH = [
  [4352, 4447],
  // Hangul Jamo
  [11904, 12350],
  // CJK radicals, Kangxi, CJK symbols and punctuation
  [12353, 13311],
  // kana, Hangul compatibility jamo, CJK compatibility
  [13312, 19903],
  // CJK Unified Ideographs Extension A
  [19968, 40959],
  // CJK Unified Ideographs
  [40960, 42191],
  // Yi
  [44032, 55203],
  // Hangul syllables
  [63744, 64255],
  // CJK compatibility ideographs
  [65072, 65135],
  // CJK compatibility forms
  [65280, 65376],
  // fullwidth forms
  [65504, 65510]
];
var NARROW = new Set("iljItf.,:;'`|!()[]{} ");
var WIDE = new Set("MWmw@%\u2014\u2026");
var EXACT = /* @__PURE__ */ new Map([
  ["\u0152", 0.95],
  ["\u0153", 0.95],
  ["\xC6", 0.92],
  ["\xE6", 0.85],
  ["\xD8", 0.78],
  ["&", 0.73],
  ["+", 0.71],
  ["<", 0.71],
  ["=", 0.71],
  [">", 0.71],
  ["^", 0.71],
  ["~", 0.71],
  ["/", 0.45],
  ["\\", 0.45]
]);
function charEm(cp) {
  if (cp > 65535) return 1.2;
  for (const [lo2, hi2] of FULLWIDTH) if (cp >= lo2 && cp <= hi2) return 1.08;
  const ch = String.fromCharCode(cp);
  const exact = EXACT.get(ch);
  if (exact !== void 0) return exact;
  if (WIDE.has(ch)) return 1.05;
  if (NARROW.has(ch)) return 0.4;
  if (cp >= 48 && cp <= 57) return 0.6;
  if (cp >= 65 && cp <= 90) return 0.78;
  return 0.62;
}
function estTextWidth(text, fontSize) {
  let em = 0;
  for (const ch of text) em += charEm(ch.codePointAt(0) ?? 0);
  return em * fontSize;
}
function fitPrefix(text, fontSize, avail) {
  let out = "";
  let used = 0;
  for (const ch of text) {
    const cw = charEm(ch.codePointAt(0) ?? 0) * fontSize;
    if (used + cw > avail) break;
    out += ch;
    used += cw;
  }
  return out;
}
var extendMax = (hi2, yMax) => typeof yMax === "number" && yMax > hi2 ? yMax : hi2;
function sumScale(max, count) {
  if (!Number.isFinite(max) || !(max > 0) || !(count >= 1)) return 1;
  const limit = Number.MAX_VALUE / (count * 4);
  if (!(max > limit)) return 1;
  let s2 = 1;
  while (max * s2 > limit) s2 /= 2;
  return s2;
}
function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  for (const m of [1, 2, 5, 10]) {
    if (v <= m * base) return m * base;
  }
  return 10 * base;
}
function axisTitles(svg, data, plotW, lay) {
  if (data.xTitle) {
    const t = svgEl2(
      "text",
      { x: lay.mL + plotW / 2, y: lay.mT + lay.plotH + 34, "text-anchor": "middle", class: "o-chart-axistitle" },
      svg
    );
    t.textContent = data.xTitle;
  }
  if (data.yTitle) {
    const cx = 14;
    const cy = lay.mT + lay.plotH / 2;
    const t = svgEl2(
      "text",
      { x: cx, y: cy, "text-anchor": "middle", transform: `rotate(-90 ${cx} ${cy})`, class: "o-chart-axistitle" },
      svg
    );
    t.textContent = data.yTitle;
  }
}

// src/chart/axis.ts
var R = (v) => +v.toPrecision(15);
var SPAN_CAP = Number.MAX_VALUE / 4;
var MIN_SPAN = 2e-322;
function niceStep(span2, div) {
  const raw = span2 / div;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  for (const m of [1, 2, 2.5, 5]) {
    if (raw <= m * base) return m * base;
  }
  return 10 * base;
}
function niceRange(lo2, hi2, div = 5) {
  if (!Number.isFinite(lo2) || !Number.isFinite(hi2)) {
    lo2 = 0;
    hi2 = 1;
  }
  lo2 = Math.max(-SPAN_CAP, Math.min(SPAN_CAP, lo2));
  hi2 = Math.max(-SPAN_CAP, Math.min(SPAN_CAP, hi2));
  if (hi2 - lo2 <= MIN_SPAN) {
    const pad2 = Math.abs(lo2) * 0.5 || 1;
    lo2 -= pad2;
    hi2 += pad2;
  }
  const step = niceStep(hi2 - lo2, div);
  return { min: R(Math.floor(lo2 / step) * step), max: R(Math.ceil(hi2 / step) * step), step };
}
function numScale(lo2, hi2, p0, p1, div = 5) {
  const { min, max, step } = niceRange(lo2, hi2, div);
  const span2 = max - min || 1;
  return { min, max, step, at: (v) => p0 + (v - min) / span2 * (p1 - p0) };
}
var steps = (s2) => Math.min(24, Math.max(1, Math.round((s2.max - s2.min) / s2.step)));
function valueAxisY(svg, sy, lay, plotW) {
  const n = steps(sy);
  for (let i = 0; i <= n; i++) {
    const v = R(sy.min + sy.step * i);
    const y = sy.at(v);
    svgEl2("line", { x1: lay.mL, y1: y, x2: lay.mL + plotW, y2: y, class: "o-chart-grid" }, svg);
    const t = svgEl2("text", { x: lay.mL - 6, y: y + 4, "text-anchor": "end", class: "o-chart-tick" }, svg);
    t.textContent = String(v);
  }
}
function valueAxisX(svg, sx, lay) {
  const n = steps(sx);
  for (let i = 0; i <= n; i++) {
    const v = R(sx.min + sx.step * i);
    const x = sx.at(v);
    svgEl2("line", { x1: x, y1: lay.mT, x2: x, y2: lay.mT + lay.plotH, class: "o-chart-grid" }, svg);
    const t = svgEl2("text", { x, y: lay.mT + lay.plotH + 16, "text-anchor": "middle", class: "o-chart-tick" }, svg);
    t.textContent = String(v);
  }
}
function numericAxes(svg, sx, sy, lay, plotW) {
  valueAxisY(svg, sy, lay, plotW);
  valueAxisX(svg, sx, lay);
}
function rightValueAxis(svg, lay, plotW, min, max, color, suffix = "", div = 4) {
  const x = lay.mL + plotW;
  const span2 = max - min || 1;
  const at = (v) => lay.mT + lay.plotH - (v - min) / span2 * lay.plotH;
  svgEl2("line", { x1: x, y1: lay.mT, x2: x, y2: lay.mT + lay.plotH, class: "o-chart-axis2", stroke: color }, svg);
  for (let i = 0; i <= div; i++) {
    const v = R(min + span2 * i / div);
    const y = at(v);
    svgEl2("line", { x1: x, y1: y, x2: x + 4, y2: y, class: "o-chart-axis2", stroke: color }, svg);
    const t = svgEl2("text", { x: x + 7, y: y + 4, "text-anchor": "start", class: "o-chart-tick2", fill: color }, svg);
    t.textContent = String(v) + suffix;
  }
  return at;
}

// src/chart/box.ts
function quantile(a, p) {
  const h = p * (a.length - 1);
  const i = Math.floor(h);
  const j = Math.ceil(h);
  return a[i] + (a[j] - a[i]) * (h - i);
}
function fromSamples(raw) {
  const a = raw.slice().sort((p, q) => p - q);
  if (a.length === 0) return { box: [0, 0, 0, 0, 0], out: [] };
  const q1 = quantile(a, 0.25);
  const q3 = quantile(a, 0.75);
  const fence = 1.5 * (q3 - q1);
  const inside = a.filter((v) => v >= q1 - fence && v <= q3 + fence);
  const lo2 = inside.length ? inside[0] : a[0];
  const hi2 = inside.length ? inside[inside.length - 1] : a[a.length - 1];
  return { box: [lo2, q1, quantile(a, 0.5), q3, hi2], out: a.filter((v) => v < lo2 || v > hi2) };
}
function summaryAt(data, i) {
  const s2 = data.series[0];
  const extra = s2?.outliers?.[i] ?? [];
  const pre = s2?.boxes?.[i];
  if (pre && pre.length === 5) return { box: pre, out: extra };
  if (s2?.samples?.[i]) {
    const d = fromSamples(s2.samples[i]);
    return { box: d.box, out: d.out.concat(extra) };
  }
  const v = s2?.values[i] ?? 0;
  return { box: [v, v, v, v, v], out: extra };
}
function renderBox(svg, data, w, lay) {
  const plotW = w - lay.mL - lay.mR;
  const cells = data.labels.map((_l, i) => summaryAt(data, i));
  const all = cells.flatMap((c) => c.box.concat(c.out));
  const lo2 = all.reduce((m, v) => Math.min(m, v), all[0] ?? 0);
  const hi2 = extendMax(all.reduce((m, v) => Math.max(m, v), all[0] ?? 1), data.yMax);
  const sy = numScale(lo2, hi2, lay.mT + lay.plotH, lay.mT);
  valueAxisY(svg, sy, lay, plotW);
  xLabels(svg, data.labels, plotW, lay);
  axisTitles(svg, data, plotW, lay);
  const color = data.series[0]?.color ?? altColor("", 0);
  const dot = altColor(color, 3);
  const groupW = plotW / data.labels.length;
  const bw = Math.min(46, groupW * 0.5);
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  cells.forEach((c, i) => {
    const cx = lay.mL + groupW * (i + 0.5);
    if (data.highlightIndex === i) {
      svgEl2("rect", { x: lay.mL + groupW * i, y: lay.mT, width: groupW, height: lay.plotH, class: "o-chart-hiband" }, g);
    }
    const [wLo, q1, med, q3, wHi] = c.box;
    const yLo = sy.at(wLo);
    const yHi = sy.at(wHi);
    svgEl2("line", { x1: cx, y1: yHi, x2: cx, y2: yLo, stroke: color, "stroke-width": 1.5 }, g);
    svgEl2("line", { x1: cx - bw / 4, y1: yHi, x2: cx + bw / 4, y2: yHi, stroke: color, "stroke-width": 1.5 }, g);
    svgEl2("line", { x1: cx - bw / 4, y1: yLo, x2: cx + bw / 4, y2: yLo, stroke: color, "stroke-width": 1.5 }, g);
    const yQ3 = sy.at(q3);
    const h = sy.at(q1) - yQ3;
    svgEl2(
      "rect",
      // a zero IQR is a real distribution (every observation equal); 1 unit keeps it visible
      { x: cx - bw / 2, y: yQ3, width: bw, height: Math.max(h, 1), fill: color, "fill-opacity": 0.35, stroke: color, "stroke-width": 1.5, "data-label": i },
      g
    );
    const yMed = sy.at(med);
    svgEl2("line", { x1: cx - bw / 2, y1: yMed, x2: cx + bw / 2, y2: yMed, stroke: color, "stroke-width": 2.5, "data-median": i }, g);
    c.out.forEach((v) => svgEl2("circle", { cx, cy: sy.at(v), r: 3, fill: dot, "data-outlier": i }, g));
    if (data.showValues) {
      const t = svgEl2("text", { x: cx + bw / 2 + 3, y: yMed + 3.5, "text-anchor": "start", class: "o-chart-datalabel" }, g);
      t.textContent = String(Math.round(med * 100) / 100);
    }
  });
}

// src/chart/colorscale.ts
var VIRIDIS = ["#440154", "#472d7b", "#3b528b", "#2c728e", "#21918c", "#28ae80", "#5ec962", "#addc30", "#fde725"];
function parseHex(c) {
  const s2 = c.replace("#", "");
  const w = s2.length < 6 ? 1 : 2;
  const at = (i) => {
    const h = s2.substr(i * w, w);
    const n = parseInt(w === 1 ? h + h : h, 16);
    return Number.isFinite(n) ? n : 0;
  };
  return [at(0), at(1), at(2)];
}
var STOPS = VIRIDIS.map(parseHex);
var hex2 = (n) => (n < 16 ? "0" : "") + n.toString(16);
var toHex = (c) => "#" + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
function rampColor(t) {
  const u = !Number.isFinite(t) ? 0 : t < 0 ? 0 : t > 1 ? 1 : t;
  const p = u * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(p));
  const f = p - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return toHex([
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f)
  ]);
}
var INK_LIGHT = "#ffffff";
var INK_DARK = "#000000";
var linear = (v) => {
  const s2 = v / 255;
  return s2 <= 0.04045 ? s2 / 12.92 : Math.pow((s2 + 0.055) / 1.055, 2.4);
};
var luminance = (c) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
var contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
var L_LIGHT = luminance(parseHex(INK_LIGHT));
var L_DARK = luminance(parseHex(INK_DARK));
function inkOn(bg) {
  const L = luminance(parseHex(bg));
  return contrast(L, L_LIGHT) >= contrast(L, L_DARK) ? INK_LIGHT : INK_DARK;
}
var SLICES = 48;
var STRIP_W = 14;
var SEAM = 0.6;
var SCALE_LEGEND_W = 72;
var LEGEND_GAP = 12;
var TICK_GAP = 6;
var TICK_BOX = 15;
var MAX_DIV = 4;
var tidy = (n) => Math.round(n * 100) / 100;
var SI = [
  [1e18, "E"],
  [1e15, "P"],
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"]
];
var SI_FROM = 1e4;
var EXP_BELOW = 1e-3;
var MAX_DP = 6;
var trim = (s2) => s2.includes(".") ? s2.replace(/0+$/, "").replace(/\.$/, "") : s2;
var dpFor = (n) => Math.max(2, 2 - Math.floor(Math.log10(Math.abs(n))));
function expForm(v) {
  const s2 = v.toExponential(2);
  const e = s2.indexOf("e");
  return trim(s2.slice(0, e)) + s2.slice(e);
}
function scaleFormat(hi2) {
  const top = Number.isFinite(hi2) ? Math.abs(hi2) : 0;
  const compact = top >= SI_FROM;
  const tiny = top > 0 && top < EXP_BELOW;
  return (v) => {
    if (!Number.isFinite(v) || v === 0) return "0";
    if (tiny) return expForm(v);
    let i = compact ? SI.findIndex(([m]) => Math.abs(v) >= m) : -1;
    for (; ; ) {
      const unit = i >= 0 ? SI[i] : void 0;
      const n = unit ? v / unit[0] : v;
      const dp = dpFor(n);
      if (dp > MAX_DP || Math.abs(n) >= 1e21) return expForm(v);
      const s2 = trim(n.toFixed(dp));
      if (compact && Math.abs(Number(s2)) >= 1e3) {
        if (i === 0) return expForm(v);
        i = i < 0 ? SI.length - 1 : i - 1;
        continue;
      }
      return s2 + (unit ? unit[1] : "");
    }
  };
}
function scaleLegend(svg, x, y, h, lo2, hi2, fmt = scaleFormat(hi2), snap) {
  const sliceH = h / SLICES;
  for (let i = 0; i < SLICES; i++) {
    const t = 1 - i / (SLICES - 1);
    svgEl2(
      "rect",
      { x, y: tidy(y + sliceH * i), width: STRIP_W, height: tidy(sliceH + (i < SLICES - 1 ? SEAM : 0)), fill: rampColor(t) },
      svg
    );
  }
  svgEl2("rect", { x, y, width: STRIP_W, height: h, class: "o-chart-scaleframe" }, svg);
  const div = Math.max(1, Math.min(MAX_DIV, Math.floor(h / TICK_BOX)));
  const span2 = hi2 - lo2 || 1;
  let last = null;
  for (let i = 0; i <= div; i++) {
    const raw = lo2 + (hi2 - lo2) * (div - i) / div;
    const v = snap ? snap(raw) : raw;
    const label = fmt(v);
    if (label === last) continue;
    last = label;
    const ty = snap ? y + h * (hi2 - v) / span2 : y + h * i / div;
    svgEl2("line", { x1: x + STRIP_W, y1: tidy(ty), x2: x + STRIP_W + 3, y2: tidy(ty), class: "o-chart-scaleframe" }, svg);
    const t = svgEl2(
      "text",
      { x: x + STRIP_W + TICK_GAP, y: tidy(ty + 3.5), "text-anchor": "start", class: "o-chart-tick" },
      svg
    );
    t.textContent = label;
  }
}

// src/chart/defs.ts
var FADE_TOP = 0.38;
var FADE_BOTTOM = 0.02;
function fillGradient(svg, color, ns = "") {
  const id = "ocg" + ns + color.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS(SVG_NS, "defs");
    svg.insertBefore(defs, svg.firstChild);
  }
  if (!defs.querySelector("#" + id)) {
    const g = svgEl2("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    svgEl2("stop", { offset: 0, "stop-color": color, "stop-opacity": FADE_TOP }, g);
    svgEl2("stop", { offset: 1, "stop-color": color, "stop-opacity": FADE_BOTTOM }, g);
  }
  return `url(#${id})`;
}

// src/chart/funnel.ts
var LABEL_GUTTER = 150;
var GAP = 4;
var NAME_FONT = 10;
var EDGE_PAD = 4;
function fitStageLabel(name, value, avail) {
  const tail = ` \u2014 ${value}`;
  const tailW = estTextWidth(tail, NAME_FONT);
  if (estTextWidth(name, NAME_FONT) + tailW <= avail) return name + tail;
  const room = avail - tailW - estTextWidth("\u2026", NAME_FONT);
  const kept = room > 0 ? fitPrefix(name, NAME_FONT, room) : "";
  return kept ? kept + "\u2026" + tail : String(value);
}
function renderFunnel(svg, data, w, lay) {
  const values = (data.series[0]?.values ?? []).map((v) => v > 0 ? v : 0);
  const n = Math.max(1, values.length);
  const plotW = w - lay.mL - lay.mR;
  const bodyW = Math.max(80, plotW - LABEL_GUTTER);
  const cx = lay.mL + bodyW / 2;
  const peak = Math.max(data.yMax ?? 0, ...values, 0) || 1;
  const labelX = lay.mL + bodyW + 10;
  const avail = Math.max(0, w - labelX - EDGE_PAD);
  const bandH = (lay.plotH - GAP * (n - 1)) / n;
  const half = (v) => Math.max(bodyW / 2 * (v / peak), 0.5);
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  values.forEach((v, i) => {
    const y0 = lay.mT + i * (bandH + GAP);
    const y1 = y0 + bandH;
    const hTop = half(v);
    const hBot = half(i + 1 < values.length ? values[i + 1] : v);
    const color = sliceColor(data, i);
    svgEl2(
      "path",
      {
        d: `M ${cx - hTop} ${y0} L ${cx + hTop} ${y0} L ${cx + hBot} ${y1} L ${cx - hBot} ${y1} Z`,
        fill: color,
        "data-label": i,
        "data-stage": i
      },
      g
    );
    const t = svgEl2("text", { x: labelX, y: (y0 + y1) / 2 + 3.5, "text-anchor": "start", class: "o-chart-name" }, g);
    t.textContent = fitStageLabel(data.labels[i] ?? "", v, avail);
  });
}

// src/chart/arc.ts
var TOP = -Math.PI / 2;
var FULL_TURN = Math.PI * 2;
var EPS = 1e-9;
function polarPt(cx, cy, r, a) {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function arcPath(cx, cy, rIn, rOut, a0, a12) {
  const rO = Math.max(0, rOut);
  const rI = Math.max(0, Math.min(rIn, rO));
  const sweep = a12 - a0;
  const span2 = Math.abs(sweep);
  if (rO <= 0 || span2 < EPS) return "";
  const cw = sweep > 0 ? 1 : 0;
  const P = (r, a) => polarPt(cx, cy, r, a);
  if (span2 >= FULL_TURN - EPS) {
    const ring = (r, dir) => {
      const s2 = P(r, a0);
      const m = P(r, a0 + (dir === 1 ? Math.PI : -Math.PI));
      return `M ${s2.x} ${s2.y} A ${r} ${r} 0 0 ${dir} ${m.x} ${m.y} A ${r} ${r} 0 0 ${dir} ${s2.x} ${s2.y} Z`;
    };
    return rI > 0 ? `${ring(rO, cw)} ${ring(rI, cw === 1 ? 0 : 1)}` : ring(rO, cw);
  }
  const large = span2 > Math.PI ? 1 : 0;
  const oA = P(rO, a0);
  const oB = P(rO, a12);
  if (rI <= 0) return `M ${cx} ${cy} L ${oA.x} ${oA.y} A ${rO} ${rO} 0 ${large} ${cw} ${oB.x} ${oB.y} Z`;
  const iA = P(rI, a0);
  const iB = P(rI, a12);
  return `M ${oA.x} ${oA.y} A ${rO} ${rO} 0 ${large} ${cw} ${oB.x} ${oB.y} L ${iB.x} ${iB.y} A ${rI} ${rI} 0 ${large} ${cw === 1 ? 0 : 1} ${iA.x} ${iA.y} Z`;
}
function areaRadius(frac, rIn, rOut) {
  const f = frac > 1 ? 1 : frac > 0 ? frac : 0;
  return Math.sqrt(rIn * rIn + f * (rOut * rOut - rIn * rIn));
}

// src/chart/polar.ts
function polarBox(w, lay, pad2) {
  return {
    cx: w / 2,
    cy: lay.mT + lay.plotH / 2,
    r: Math.max(10, Math.min(w - lay.mL - lay.mR, lay.plotH) / 2 - pad2)
  };
}
var spokeAngle = (i, n) => TOP + FULL_TURN * i / (n || 1);
function polarGrid(svg, box, spokes, rings, ringLabel2, web, namePad = 12) {
  const n = spokes.length;
  for (let k = 1; k <= rings; k++) {
    const rr = box.r * k / rings;
    if (web && n >= 3) {
      const pts = spokes.map((_s, i) => {
        const p = polarPt(box.cx, box.cy, rr, spokeAngle(i, n));
        return `${p.x},${p.y}`;
      });
      svgEl2("polygon", { points: pts.join(" "), fill: "none", class: "o-chart-grid" }, svg);
    } else {
      svgEl2("circle", { cx: box.cx, cy: box.cy, r: rr, fill: "none", class: "o-chart-grid" }, svg);
    }
  }
  spokes.forEach((name, i) => {
    const a = spokeAngle(i, n);
    const tip = polarPt(box.cx, box.cy, box.r, a);
    svgEl2("line", { x1: box.cx, y1: box.cy, x2: tip.x, y2: tip.y, class: "o-chart-grid" }, svg);
    const lp = polarPt(box.cx, box.cy, box.r + namePad, a);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const t = svgEl2(
      "text",
      {
        x: lp.x,
        y: lp.y + (sin > 0.4 ? 9 : sin < -0.4 ? -2 : 4),
        "text-anchor": cos > 0.2 ? "start" : cos < -0.2 ? "end" : "middle",
        class: "o-chart-tick"
      },
      svg
    );
    t.textContent = name;
  });
  for (let k = 1; k <= rings; k++) {
    const t = svgEl2(
      "text",
      { x: box.cx + 4, y: box.cy - box.r * k / rings + 4, "text-anchor": "start", class: "o-chart-tick" },
      svg
    );
    t.textContent = ringLabel2(k);
  }
}

// src/chart/gauge.ts
var A0 = 150 * Math.PI / 180;
var SPAN = 240 * Math.PI / 180;
var BAND = 16;
var TICKS = 5;
var tidy2 = (n) => Math.round(n * 100) / 100;
function gaugeRange(data) {
  return {
    value: data.series[0]?.values[0] ?? 0,
    min: data.gaugeMin ?? 0,
    max: data.gaugeMax ?? 100
  };
}
function renderGauge(svg, data, w, lay) {
  const { value, min, max } = gaugeRange(data);
  const box = polarBox(w, lay, 26);
  const frac = Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
  const color = data.series[0]?.color ?? CHART_PALETTE[0];
  const unit = data.unit ?? "";
  const rIn = box.r - BAND;
  svgEl2("path", { d: arcPath(box.cx, box.cy, rIn, box.r, A0, A0 + SPAN), class: "o-chart-track" }, svg);
  for (let k = 0; k <= TICKS; k++) {
    const a = A0 + SPAN * k / TICKS;
    const p1 = polarPt(box.cx, box.cy, rIn - 2, a);
    const p2 = polarPt(box.cx, box.cy, rIn - 9, a);
    svgEl2("line", { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: "o-chart-grid" }, svg);
    const lp = polarPt(box.cx, box.cy, rIn - 20, a);
    const cos = Math.cos(a);
    const t2 = svgEl2(
      "text",
      { x: lp.x, y: lp.y + 4, "text-anchor": cos > 0.2 ? "start" : cos < -0.2 ? "end" : "middle", class: "o-chart-tick" },
      svg
    );
    t2.textContent = String(tidy2(min + (max - min) * k / TICKS));
  }
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  if (frac > 0) {
    svgEl2("path", { d: arcPath(box.cx, box.cy, rIn, box.r, A0, A0 + SPAN * frac), fill: color, "data-gauge": "progress" }, g);
  }
  const tip = polarPt(box.cx, box.cy, box.r * 0.62, A0 + SPAN * frac);
  svgEl2(
    "line",
    { x1: box.cx, y1: box.cy, x2: tip.x, y2: tip.y, "stroke-width": 4, "stroke-linecap": "round", class: "o-chart-needle", "data-gauge": "needle" },
    g
  );
  svgEl2("circle", { cx: box.cx, cy: box.cy, r: 5, class: "o-chart-needle" }, g);
  const t = svgEl2("text", { x: box.cx, y: box.cy + 48, "text-anchor": "middle", class: "o-chart-centre" }, g);
  t.textContent = tidy2(value) + unit;
  const name = data.labels[0] ?? "";
  if (name) {
    const c = svgEl2("text", { x: box.cx, y: box.cy + 68, "text-anchor": "middle", class: "o-chart-sub" }, g);
    c.textContent = name;
  }
}

// src/chart/heatmap.ts
var VAL_FONT = 10;
var VAL_PAD = 3;
var NAME_FONT2 = 10;
var NAME_GAP = 8;
function renderHeatmap(svg, data, w, lay) {
  const plotW = w - lay.mL - lay.mR;
  const cols = Math.max(1, data.labels.length);
  const rows = Math.max(1, data.series.length);
  const cellW = plotW / cols;
  const cellH = lay.plotH / rows;
  const peak = Math.max(0, ...data.series.flatMap((s2) => s2.values));
  const hi2 = extendMax(peak, data.yMax) || 1;
  const fmt = scaleFormat(hi2);
  const nameAvail = Math.max(0, lay.mL - NAME_GAP - (data.yTitle ? 24 : 4));
  xLabels(svg, data.labels, plotW, lay);
  axisTitles(svg, data, plotW, lay);
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  data.series.forEach((s2, ri) => {
    const y = lay.mT + cellH * ri;
    data.labels.forEach((_l, ci) => {
      const v = s2.values[ci] ?? 0;
      const fill = rampColor(v / hi2);
      const x = lay.mL + cellW * ci;
      svgEl2("rect", { x, y, width: cellW, height: cellH, fill, "data-series": ri, "data-label": ci }, g);
      const txt = fmt(v);
      if (estTextWidth(txt, VAL_FONT) + VAL_PAD * 2 <= cellW) {
        const t = svgEl2(
          "text",
          {
            x: x + cellW / 2,
            y: y + cellH / 2 + VAL_FONT * 0.35,
            "text-anchor": "middle",
            class: "o-chart-cellvalue",
            fill: inkOn(fill)
          },
          g
        );
        t.textContent = txt;
      }
    });
    const nm = svgEl2(
      "text",
      { x: lay.mL - NAME_GAP, y: y + cellH / 2 + 3.5, "text-anchor": "end", class: "o-chart-name" },
      g
    );
    nm.textContent = fitPrefix(s2.name, NAME_FONT2, nameAvail);
  });
  scaleLegend(g, lay.mL + plotW + LEGEND_GAP, lay.mT, lay.plotH, 0, hi2, fmt);
}

// src/chart/hexbin.ts
var SQRT3 = Math.sqrt(3);
var DEFAULT_HEX_BINS = 20;
var VAL_FONT2 = 10;
var VAL_PAD2 = 2;
var MAX_INSET = 0.42;
var PAD_TRIES = 12;
var tidy3 = (n) => Math.round(n * 100) / 100;
function hexRound(q, r) {
  const x = q;
  const z = r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx === 0 ? 0 : rx, rz === 0 ? 0 : rz];
}
var hexAxial = (px, py, R2) => [
  (SQRT3 / 3 * px - 1 / 3 * py) / R2,
  2 / 3 * py / R2
];
var hexCentre = (q, r, R2) => [SQRT3 * R2 * (q + r / 2), 1.5 * R2 * r];
function binPoints(pxs, pys, R2) {
  const cells = /* @__PURE__ */ new Map();
  const n = Math.min(pxs.length, pys.length);
  for (let i = 0; i < n; i++) {
    const [fq, fr] = hexAxial(pxs[i], pys[i], R2);
    const [q, r] = hexRound(fq, fr);
    const key = q + "," + r;
    const c = cells.get(key);
    if (c) c.count++;
    else cells.set(key, { q, r, count: 1 });
  }
  return [...cells.values()].sort((a, b) => a.r - b.r || a.q - b.q);
}
function hexPoints(cx, cy, R2) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = (30 + 60 * i) * Math.PI / 180;
    out.push(`${tidy3(cx + R2 * Math.cos(a))},${tidy3(cy + R2 * Math.sin(a))}`);
  }
  return out.join(" ");
}
var cap = (v) => Math.max(-SPAN_CAP, Math.min(SPAN_CAP, v));
function padded(lo2, hi2, p0, p1, want) {
  const px = Math.abs(p1 - p0);
  const dir = p1 >= p0 ? 1 : -1;
  const target = Math.min(want, px * MAX_INSET);
  const clear = (s2) => Math.min((s2.at(lo2) - p0) * dir, (p1 - s2.at(hi2)) * dir);
  let best = numScale(lo2, hi2, p0, p1);
  let bLo = lo2;
  let bHi = hi2;
  let pad2 = target / px * (best.max - best.min);
  for (let i = 0; i < PAD_TRIES && clear(best) < target; i++) {
    const l = cap(lo2 - pad2);
    const h = cap(hi2 + pad2);
    const s2 = numScale(l, h, p0, p1);
    if (clear(s2) > clear(best)) {
      best = s2;
      bLo = l;
      bHi = h;
    }
    pad2 = Math.min(pad2 * 2, SPAN_CAP);
  }
  let inset = target - clear(best);
  for (let i = 0; i < PAD_TRIES && clear(best) < target; i++) {
    const held = Math.min(inset, px * MAX_INSET);
    const s2 = numScale(bLo, bHi, p0 + held * dir, p1 - held * dir);
    if (clear(s2) > clear(best)) best = s2;
    if (held >= px * MAX_INSET) break;
    inset *= 2;
  }
  return best;
}
function renderHexbin(svg, data, w, lay) {
  const plotW = w - lay.mL - lay.mR;
  const bins = data.hexBins ?? DEFAULT_HEX_BINS;
  const R2 = plotW / (SQRT3 * bins);
  const pxs = [];
  const pys = [];
  for (const s2 of data.series) {
    const xs = s2.xs ?? [];
    for (let i = 0; i < xs.length; i++) {
      const y = s2.values[i];
      if (typeof y === "number" && Number.isFinite(y) && Number.isFinite(xs[i])) {
        pxs.push(cap(xs[i]));
        pys.push(cap(y));
      }
    }
  }
  const lo2 = (a) => a.length ? a.reduce((m, v) => v < m ? v : m, a[0]) : 0;
  const hi2 = (a) => a.length ? a.reduce((m, v) => v > m ? v : m, a[0]) : 1;
  const yTop = cap(data.yMax != null ? Math.max(data.yMax, hi2(pys)) : hi2(pys));
  const sx = padded(lo2(pxs), hi2(pxs), lay.mL, lay.mL + plotW, 2 * R2);
  const sy = padded(lo2(pys), yTop, lay.mT + lay.plotH, lay.mT, 2 * R2);
  numericAxes(svg, sx, sy, lay, plotW);
  axisTitles(svg, data, plotW, lay);
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  const ax = lay.mL + plotW / 2;
  const ay = lay.mT + lay.plotH / 2;
  const cells = binPoints(
    pxs.map((v) => sx.at(v) - ax),
    pys.map((v) => sy.at(v) - ay),
    R2
  );
  const peak = cells.reduce((m, c) => c.count > m ? c.count : m, 0);
  for (const c of cells) {
    const [qx, qy] = hexCentre(c.q, c.r, R2);
    const cx = qx + ax;
    const cy = qy + ay;
    const fill = rampColor(c.count / (peak || 1));
    svgEl2("polygon", { points: hexPoints(cx, cy, R2), fill, class: "o-chart-hexedge", "data-count": c.count }, g);
    if (data.showValues) {
      const txt = String(c.count);
      if (R2 >= VAL_FONT2 && estTextWidth(txt, VAL_FONT2) + VAL_PAD2 * 2 <= SQRT3 * R2) {
        const t = svgEl2(
          "text",
          { x: tidy3(cx), y: tidy3(cy + VAL_FONT2 * 0.35), "text-anchor": "middle", class: "o-chart-cellvalue", fill: inkOn(fill) },
          g
        );
        t.textContent = txt;
      }
    }
  }
  scaleLegend(g, lay.mL + plotW + LEGEND_GAP, lay.mT, lay.plotH, 0, peak, (v) => String(v), Math.round);
}

// src/chart/pareto.ts
var PARETO_AXIS_W = 34;
var paretoColor = (data) => altColor(data.series[0]?.color ?? "", 3);
var PARETO_LEGEND = "Cumulative %";
function renderPareto(svg, data, lay, plotW) {
  const values = (data.series[0]?.values ?? []).map((v) => Math.max(0, v));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return;
  const color = paretoColor(data);
  const at = rightValueAxis(svg, lay, plotW, 0, 100, color, "%");
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  const groupW = plotW / data.labels.length;
  let run = 0;
  const pts = data.labels.map((_l, i) => {
    run += values[i] ?? 0;
    return { x: lay.mL + groupW * (i + 0.5), y: at(run / total * 100), pct: run / total * 100 };
  });
  svgEl2(
    "polyline",
    {
      points: pts.map((p) => `${p.x},${p.y}`).join(" "),
      fill: "none",
      stroke: color,
      "stroke-width": 2.5,
      "stroke-linejoin": "round",
      "data-pareto": "cumulative"
    },
    g
  );
  pts.forEach((p, i) => {
    svgEl2("circle", { cx: p.x, cy: p.y, r: 3.5, fill: color, "data-label": i }, g);
    if (data.showValues) {
      const t = svgEl2("text", { x: p.x, y: p.y - 7, "text-anchor": "middle", class: "o-chart-datalabel" }, g);
      t.textContent = `${Math.round(p.pct * 10) / 10}%`;
    }
  });
}

// src/chart/pie.ts
var DONUT_RATIO = 0.58;
var NAME_FONT3 = 10;
var NAME_PAD = 3;
var LABEL_R = 0.62;
var MIN_BAND = NAME_FONT3 + 2;
var GLYPH_UP = NAME_FONT3 * 1.15 - 3.5;
var GLYPH_DN = NAME_FONT3 * 0.35 + 3.5;
var GEO_EPS = 1e-9;
function inWedge(x, y, a0, a12, rIn, rOut) {
  const rad = Math.hypot(x, y);
  if (rad < rIn - GEO_EPS || rad > rOut + GEO_EPS) return false;
  const span2 = a12 - a0;
  if (span2 >= FULL_TURN - GEO_EPS) return true;
  let d = Math.atan2(y, x) - a0;
  d -= Math.floor(d / FULL_TURN) * FULL_TURN;
  return d <= span2 + GEO_EPS;
}
function halfRuns(x, y, a0, a12, rIn, rOut) {
  if (!inWedge(x, y, a0, a12, rIn, rOut)) return { l: 0, r: 0 };
  const xs = [];
  const arc = (rad) => {
    const dx2 = rad * rad - y * y;
    if (dx2 >= 0) {
      const dx = Math.sqrt(dx2);
      xs.push(-dx, dx);
    }
  };
  arc(rOut);
  if (rIn > 0) arc(rIn);
  for (const a of [a0, a12]) {
    const sy = Math.sin(a);
    if (Math.abs(sy) < GEO_EPS) continue;
    const t = y / sy;
    if (t >= rIn - GEO_EPS && t <= rOut + GEO_EPS) xs.push(t * Math.cos(a));
  }
  let l = Infinity;
  let r = Infinity;
  for (const c of xs) {
    if (c <= x) l = Math.min(l, x - c);
    else r = Math.min(r, c - x);
  }
  return { l: Number.isFinite(l) ? l : 0, r: Number.isFinite(r) ? r : 0 };
}
function horizRun(a0, a12, rIn, rOut, rLab) {
  const p = polarPt(0, 0, rLab, (a0 + a12) / 2);
  const ys = [p.y - GLYPH_UP, p.y, p.y + GLYPH_DN];
  if (p.y - GLYPH_UP < 0 && p.y + GLYPH_DN > 0) ys.push(0);
  let l = Infinity;
  let r = Infinity;
  for (const y of ys) {
    const run = halfRuns(p.x, y, a0, a12, rIn, rOut);
    l = Math.min(l, run.l);
    r = Math.min(r, run.r);
  }
  return { l, r };
}
function sliceLabel(name, a0, a12, rIn, rOut) {
  const NONE = { text: "", dx: 0 };
  const band = rOut - rIn;
  if (name.length === 0 || band < MIN_BAND) return NONE;
  const rLab = rIn + band * LABEL_R;
  const chord = 2 * rLab * Math.sin(Math.min(Math.abs(a12 - a0), Math.PI) / 2);
  const run = horizRun(a0, a12, rIn, rOut, rLab);
  const room = Math.min(chord, run.l + run.r) - NAME_PAD * 2;
  if (room <= 0) return NONE;
  let text = fitPrefix(name, NAME_FONT3, room);
  if (text !== name) {
    const shown = fitPrefix(name, NAME_FONT3, room - estTextWidth("\u2026", NAME_FONT3));
    if (shown.length < 2) return NONE;
    text = shown + "\u2026";
  }
  const half = estTextWidth(text, NAME_FONT3) / 2;
  const lo2 = half + NAME_PAD - run.l;
  const hi2 = run.r - NAME_PAD - half;
  return { text, dx: lo2 > 0 ? lo2 : hi2 < 0 ? hi2 : 0 };
}
function renderPie(svg, data, w, lay) {
  const values = data.series[0]?.values ?? [];
  const total = values.reduce((a, b) => a + b, 0);
  const cx = w / 2;
  const cy = lay.mT + lay.plotH / 2;
  const r = Math.min(w - lay.mL - lay.mR, lay.plotH) / 2 - 4;
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  if (total <= 0) {
    svgEl2("circle", { cx, cy, r, fill: "none", stroke: "#ccc", "stroke-width": 1.5 }, g);
    return;
  }
  const rose = data.rose === true;
  const donut = data.donut === true;
  const rIn = donut ? r * DONUT_RATIO : 0;
  const n = values.length;
  const peak = rose ? values.reduce((a, b) => b > a ? b : a, 0) : 0;
  let angle = TOP;
  values.forEach((v, i) => {
    const frac = rose ? 1 / n : v / total;
    const a2 = angle + frac * FULL_TURN;
    if (v > 0) {
      const color = sliceColor(data, i);
      const rOut = rose ? areaRadius(v / (peak || 1), rIn, r) : r;
      if (!rose && rIn <= 0 && frac >= 0.999999) {
        svgEl2("circle", { cx, cy, r, fill: color, "data-label": i }, g);
      } else {
        svgEl2("path", { d: arcPath(cx, cy, rIn, rOut, angle, a2), fill: color, "data-label": i }, g);
      }
      if ((rose || donut) && data.showValues) {
        const lp = polarPt(cx, cy, rOut + 11, angle + (a2 - angle) / 2);
        const cos = Math.cos(angle + (a2 - angle) / 2);
        const t = svgEl2(
          "text",
          { x: lp.x, y: lp.y + 3.5, "text-anchor": cos > 0.2 ? "start" : cos < -0.2 ? "end" : "middle", class: "o-chart-datalabel" },
          g
        );
        t.textContent = String(v);
      }
      if (data.pieLabels) {
        const rLab = rIn + (rOut - rIn) * LABEL_R;
        const shown = sliceLabel(data.labels[i] ?? "", angle, a2, rIn, rOut);
        if (shown.text) {
          const lp = polarPt(cx, cy, rLab, angle + (a2 - angle) / 2);
          const t = svgEl2(
            // the ink beats `.o-chart-name`'s own fill only as an attribute — see the header
            "text",
            { x: lp.x + shown.dx, y: lp.y + 3.5, "text-anchor": "middle", fill: inkOn(color), class: "o-chart-name", "data-label": i },
            g
          );
          t.textContent = shown.text;
        }
      }
    }
    angle = a2;
  });
  if (donut) {
    const t = svgEl2("text", { x: cx, y: cy + 4, "text-anchor": "middle", class: "o-chart-centre" }, g);
    t.textContent = String(Math.round(total * 100) / 100);
    const name = data.series[0]?.name ?? "";
    if (name) {
      const c = svgEl2("text", { x: cx, y: cy + 22, "text-anchor": "middle", class: "o-chart-sub" }, g);
      c.textContent = name;
    }
  }
}

// src/chart/radar.ts
var RINGS = 4;
var FILL = 0.18;
var LABEL_OUT = 14;
var VALUE_FONT = 10;
var NAME_GAP2 = 8;
var BASE_NAME_PAD = 12;
var RING_GUTTER = 4;
var tidy4 = (n) => Math.round(n * 100) / 100;
function spokeMaxes(data) {
  const shared = data.yMax ?? niceMax(Math.max(0, ...data.series.flatMap((s2) => s2.values)));
  return data.labels.map((_l, i) => {
    const m = data.maxes?.[i];
    return typeof m === "number" && m > 0 ? m : shared;
  });
}
function renderRadar(svg, data, w, lay) {
  const n = data.labels.length;
  const widest = data.showValues ? data.series.reduce(
    (mx, s2) => data.labels.reduce((m, _l, i) => Math.max(m, estTextWidth(String(s2.values[i] ?? 0), VALUE_FONT)), mx),
    0
  ) : 0;
  const MAX_EXTRA = 26;
  const wanted = LABEL_OUT + widest + NAME_GAP2;
  const namePad = data.showValues ? BASE_NAME_PAD + Math.min(wanted, MAX_EXTRA) : BASE_NAME_PAD;
  const box = polarBox(w, lay, 34 + (namePad - BASE_NAME_PAD));
  const maxes = spokeMaxes(data);
  const uniform = maxes.every((m) => m === maxes[0]);
  const spokes = uniform ? data.labels : data.labels.map((l, i) => `${l} /${tidy4(maxes[i])}`);
  polarGrid(svg, box, spokes, RINGS, (k) => uniform ? String(tidy4(maxes[0] * k / RINGS)) : `${100 * k / RINGS}%`, true, namePad);
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  data.series.forEach((s2, si) => {
    const rs = data.labels.map((_l, i) => box.r * Math.min(1, Math.max(0, (s2.values[i] ?? 0) / (maxes[i] || 1))));
    const pts = rs.map((r, i) => polarPt(box.cx, box.cy, r, spokeAngle(i, n)));
    svgEl2(
      "polygon",
      {
        points: pts.map((p) => `${p.x},${p.y}`).join(" "),
        fill: s2.color,
        "fill-opacity": FILL,
        stroke: s2.color,
        "stroke-width": 2.5,
        "stroke-linejoin": "round",
        "data-series": si
      },
      g
    );
    pts.forEach((p, i) => svgEl2("circle", { cx: p.x, cy: p.y, r: 3, fill: s2.color, "data-label": i }, g));
    if (data.showValues) {
      rs.forEach((r, i) => {
        const a = spokeAngle(i, n);
        const lp = polarPt(box.cx, box.cy, r + LABEL_OUT, a);
        const cos = Math.cos(a);
        const upright = Math.abs(cos) <= 0.2 && Math.sin(a) < 0;
        const t = svgEl2(
          "text",
          {
            x: upright ? lp.x - RING_GUTTER : lp.x,
            y: lp.y + 3.5,
            "text-anchor": cos > 0.2 ? "start" : cos < -0.2 ? "end" : upright ? "end" : "middle",
            class: "o-chart-datalabel"
          },
          g
        );
        t.textContent = String(s2.values[i] ?? 0);
      });
    }
  });
}

// src/chart/radial.ts
var RINGS2 = 4;
var FILL_RATIO = 0.7;
var NAME_FONT4 = 11;
var NAME_GAP3 = 12;
var tidy5 = (n) => Math.round(n * 100) / 100;
function renderRadialBar(svg, data, w, lay) {
  const values = (data.series[0]?.values ?? []).map((v) => v > 0 ? v : 0);
  const n = Math.max(1, data.labels.length);
  const box = polarBox(w, lay, 30);
  const peak = Math.max(data.yMax ?? 0, niceMax(Math.max(0, ...values))) || 1;
  const spokes = data.showValues ? data.labels.map((l, i) => {
    const tail = ` \u2014 ${values[i] ?? 0}`;
    const avail = w - (box.cx + box.r + NAME_GAP3) - 4 - estTextWidth(tail, NAME_FONT4);
    return fitPrefix(l, NAME_FONT4, Math.max(0, avail)) + tail;
  }) : data.labels;
  polarGrid(svg, box, spokes, RINGS2, (k) => String(tidy5(peak * k / RINGS2)), false);
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  const halfW = FULL_TURN / n * FILL_RATIO / 2;
  values.forEach((v, i) => {
    const a = spokeAngle(i, n);
    const rr = box.r * (v / peak);
    if (rr <= 0) return;
    const color = sliceColor(data, i);
    svgEl2(
      "path",
      {
        d: arcPath(box.cx, box.cy, 0, rr, a - halfW, a + halfW),
        fill: color,
        stroke: color,
        "stroke-width": 2,
        "stroke-linejoin": "round",
        "data-label": i
      },
      g
    );
  });
}

// src/chart/sankey.ts
var NAME_FONT5 = 10;
var PAD = 4;
var NODE_W = 16;
var NODE_GAP = 14;
var CURVE = 0.5;
var SWEEPS = 32;
var RIBBON_ALPHA = 0.45;
var GAP_BUDGET = 0.4;
function rgba(hex3, a) {
  const s2 = hex3.replace("#", "");
  const w = s2.length < 6 ? 1 : 2;
  const at = (i) => {
    const h = s2.substr(i * w, w);
    const n = parseInt(w === 1 ? h + h : h, 16);
    return Number.isFinite(n) ? n : 0;
  };
  return `rgba(${at(0)},${at(1)},${at(2)},${a})`;
}
function readFlows(data) {
  const n = data.labels.length;
  const raw = Array.isArray(data.links) ? data.links : [];
  const clean = [];
  for (const l of raw) {
    if (!l || typeof l !== "object") continue;
    const o = l;
    const from = o.from;
    const to = o.to;
    const value = o.value;
    if (typeof from !== "number" || !Number.isInteger(from) || from < 0 || from >= n) continue;
    if (typeof to !== "number" || !Number.isInteger(to) || to < 0 || to >= n || to === from) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    clean.push({ from, to, value });
  }
  clean.sort((a, b) => a.from - b.from || a.to - b.to || a.value - b.value);
  const capped = clean.slice(0, SANKEY_MAX_LINKS);
  const out = Array.from({ length: n }, () => []);
  const kept = [];
  const reaches = (start, target) => {
    const seen = new Array(n).fill(false);
    const stack = [start];
    seen[start] = true;
    while (stack.length) {
      const u = stack.pop();
      if (u === target) return true;
      for (const v of out[u]) {
        if (!seen[v]) {
          seen[v] = true;
          stack.push(v);
        }
      }
    }
    return false;
  };
  for (const f of capped) {
    if (reaches(f.to, f.from)) continue;
    out[f.from].push(f.to);
    kept.push(f);
  }
  return kept;
}
function layerColumns(n, flows) {
  const indeg = new Array(n).fill(0);
  const out = Array.from({ length: n }, () => []);
  for (const f of flows) {
    out[f.from].push(f.to);
    indeg[f.to]++;
  }
  const col = new Array(n).fill(0);
  const queue = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q];
    for (const v of out[u]) {
      if (col[u] + 1 > col[v]) col[v] = col[u] + 1;
      if (--indeg[v] === 0) queue.push(v);
    }
  }
  return col;
}
function emptyFrame(svg, r) {
  svgEl2("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "none", stroke: "#ccc", "stroke-width": 1.5 }, svg);
}
function caption(name, value, room) {
  if (room <= 0 || name.length === 0) return "";
  const cut = fitPrefix(name, NAME_FONT5, room);
  const head = cut === name ? name : fitPrefix(name, NAME_FONT5, room - estTextWidth("\u2026", NAME_FONT5));
  if (cut !== name && [...head].length < 2) return "";
  const shown = cut === name ? name : `${head}\u2026`;
  if (value.length === 0) return shown;
  const both = `${shown} ${value}`;
  return cut === name && estTextWidth(both, NAME_FONT5) <= room ? both : shown;
}
var INK_PLAIN = [0.8, 0.2];
var INK_TALL = [1.15, 0.35];
function inkBox(text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 126 && cp !== 8230) return INK_TALL;
  }
  return INK_PLAIN;
}
var printable = (v, fmt) => Number.isFinite(v) ? fmt(v) : "";
function renderSankey(svg, data, w, lay) {
  const box = { x: lay.mL, y: lay.mT, w: w - lay.mL - lay.mR, h: lay.plotH };
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  const n = data.labels.length;
  const flows = readFlows(data);
  const vScale = sumScale(
    flows.reduce((a, f) => f.value > a ? f.value : a, 0),
    flows.length * 2
  );
  if (vScale !== 1) for (const f of flows) f.value *= vScale;
  const unit = 1 / vScale;
  const col = layerColumns(n, flows);
  const C2 = col.reduce((a, c) => c > a ? c : a, 0) + 1;
  const inSum = new Array(n).fill(0);
  const outSum = new Array(n).fill(0);
  const inFlows = Array.from({ length: n }, () => []);
  const outFlows = Array.from({ length: n }, () => []);
  flows.forEach((f, k) => {
    outSum[f.from] += f.value;
    inSum[f.to] += f.value;
    outFlows[f.from].push(k);
    inFlows[f.to].push(k);
  });
  const through = Array.from({ length: n }, (_x, i) => inSum[i] > outSum[i] ? inSum[i] : outSum[i]);
  const cols = Array.from({ length: C2 }, () => []);
  for (let i = 0; i < n; i++) cols[col[i]].push(i);
  const drawnPer = cols.map((c) => c.filter((i) => through[i] > 0).length);
  const widest = drawnPer.reduce((a, c) => c > a ? c : a, 0);
  if (widest === 0) {
    emptyFrame(g, box);
    return;
  }
  const gap = widest > 1 ? Math.min(NODE_GAP, box.h * GAP_BUDGET / (widest - 1)) : 0;
  let scale = Infinity;
  for (let c = 0; c < C2; c++) {
    const sum = cols[c].reduce((a, i) => a + through[i], 0);
    if (!(sum > 0)) continue;
    const room = box.h - (drawnPer[c] - 1) * gap;
    const s2 = room / sum;
    if (s2 < scale) scale = s2;
  }
  if (!(scale > 0) || !Number.isFinite(scale)) {
    emptyFrame(g, box);
    return;
  }
  const nodeW = Math.min(NODE_W, box.w / (C2 * 2));
  const pitch = C2 > 1 ? (box.w - nodeW) / (C2 - 1) : 0;
  const gapW = C2 > 1 ? pitch - nodeW : box.w - nodeW;
  const xAt = (c) => C2 > 1 ? box.x + pitch * c : box.x + (box.w - nodeW) / 2;
  const y = new Array(n).fill(box.y);
  const h = Array.from({ length: n }, (_x, i) => through[i] * scale);
  const centre = (i) => y[i] + h[i] / 2;
  const place = () => {
    for (let c = 0; c < C2; c++) {
      const used = cols[c].reduce((a, i) => a + h[i], 0) + Math.max(0, drawnPer[c] - 1) * gap;
      let cur = box.y + (box.h - used) / 2;
      for (const i of cols[c]) {
        y[i] = cur;
        if (h[i] > 0) cur += h[i] + gap;
      }
    }
  };
  place();
  const bary = (i, ks, other) => {
    let wsum = 0;
    let acc = 0;
    for (const k of ks) {
      const f = flows[k];
      wsum += f.value;
      acc += f.value * centre(other(f));
    }
    return wsum > 0 ? acc / wsum : centre(i);
  };
  for (let s2 = 0; s2 < SWEEPS; s2++) {
    if (s2 % 2 === 0) {
      for (let c = 1; c < C2; c++) {
        const b = new Map(cols[c].map((i) => [i, bary(i, inFlows[i], (f) => f.from)]));
        cols[c].sort((p, q) => b.get(p) - b.get(q) || p - q);
      }
    } else {
      for (let c = C2 - 2; c >= 0; c--) {
        const b = new Map(cols[c].map((i) => [i, bary(i, outFlows[i], (f) => f.to)]));
        cols[c].sort((p, q) => b.get(p) - b.get(q) || p - q);
      }
    }
    place();
  }
  const srcY = new Array(flows.length).fill(0);
  const dstY = new Array(flows.length).fill(0);
  for (let i = 0; i < n; i++) {
    let cur = y[i];
    for (const k of outFlows[i].slice().sort((a, b) => centre(flows[a].to) - centre(flows[b].to) || flows[a].to - flows[b].to || a - b)) {
      srcY[k] = cur;
      cur += flows[k].value * scale;
    }
    cur = y[i];
    for (const k of inFlows[i].slice().sort((a, b) => centre(flows[a].from) - centre(flows[b].from) || flows[a].from - flows[b].from || a - b)) {
      dstY[k] = cur;
      cur += flows[k].value * scale;
    }
  }
  const color = (i) => CHART_PALETTE[i % CHART_PALETTE.length];
  flows.forEach((f, k) => {
    const x0 = xAt(col[f.from]) + nodeW;
    const x1 = xAt(col[f.to]);
    const t = f.value * scale;
    if (!(t > 0) || !(x1 > x0)) return;
    const cx0 = x0 + (x1 - x0) * CURVE;
    const cx1 = x1 - (x1 - x0) * CURVE;
    const a0 = srcY[k];
    const a12 = a0 + t;
    const b0 = dstY[k];
    const b1 = b0 + t;
    const d = `M ${x0} ${a0} C ${cx0} ${a0} ${cx1} ${b0} ${x1} ${b0} L ${x1} ${b1} C ${cx1} ${b1} ${cx0} ${a12} ${x0} ${a12} Z`;
    svgEl2("path", { d, fill: rgba(color(f.from), RIBBON_ALPHA), "data-from": f.from, "data-to": f.to }, g);
  });
  for (let i = 0; i < n; i++) {
    if (!(h[i] > 0)) continue;
    svgEl2("rect", { x: xAt(col[i]), y: y[i], width: nodeW, height: h[i], fill: color(i), "data-label": i }, g);
  }
  const top = through.reduce((a, v) => v > a ? v : a, 0) * unit;
  const fmt = scaleFormat(Number.isFinite(top) ? top : Number.MAX_VALUE);
  for (let i = 0; i < n; i++) {
    if (h[i] < NAME_FONT5) continue;
    const c = col[i];
    const last = c === C2 - 1 && C2 > 1;
    const shared = C2 > 2 ? c === C2 - 2 || last : true;
    const room = (shared ? gapW / 2 : gapW) - PAD * 2;
    const name = data.labels[i] ?? "";
    const value = printable(through[i] * unit, fmt);
    const text = caption(name, value, room);
    if (!text) {
      vertical(g, name, value, xAt(c), nodeW, y[i], h[i], color(i), i);
      continue;
    }
    const x = last ? xAt(c) - PAD : xAt(c) + nodeW + PAD;
    const t = svgEl2(
      "text",
      { x, y: centre(i) + NAME_FONT5 * 0.35, "text-anchor": last ? "end" : "start", class: "o-chart-name", "data-label": i },
      g
    );
    t.textContent = text;
  }
}
function vertical(svg, name, value, x, nodeW, barY, barH, fill, idx) {
  const text = caption(name, value, barH - PAD * 2);
  if (!text) return;
  const [asc, desc] = inkBox(text);
  if (nodeW < (asc + desc) * NAME_FONT5) return;
  const ax = x + nodeW / 2 + (asc - desc) / 2 * NAME_FONT5;
  const ay = barY + barH / 2;
  const t = svgEl2(
    "text",
    { x: ax, y: ay, "text-anchor": "middle", transform: `rotate(-90 ${ax} ${ay})`, class: "o-chart-cellvalue", fill: inkOn(fill), "data-label": idx },
    svg
  );
  t.textContent = text;
}

// src/chart/scatter.ts
var R_DOT = 5;
var R_QUAD = 9;
var R_MIN = 4;
var R_MAX = 26;
var lo = (a) => a.length ? a.reduce((m, v) => v < m ? v : m, a[0]) : 0;
var hi = (a) => a.length ? a.reduce((m, v) => v > m ? v : m, a[0]) : 1;
function renderScatter(svg, data, w, lay) {
  const plotW = w - lay.mL - lay.mR;
  const q = data.quadrant;
  const xsAll = data.series.flatMap((s2) => s2.xs ?? []);
  const ysAll = data.series.flatMap((s2) => s2.values);
  const xs = q ? xsAll.concat(q.x) : xsAll;
  const ys = q ? ysAll.concat(q.y) : ysAll;
  const sx = numScale(lo(xs), hi(xs), lay.mL, lay.mL + plotW);
  const yHi = data.yMax != null ? Math.max(data.yMax, hi(ys)) : hi(ys);
  const sy = numScale(lo(ys), yHi, lay.mT + lay.plotH, lay.mT);
  numericAxes(svg, sx, sy, lay, plotW);
  axisTitles(svg, data, plotW, lay);
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  if (q) {
    svgEl2("line", { x1: sx.at(q.x), y1: lay.mT, x2: sx.at(q.x), y2: lay.mT + lay.plotH, class: "o-chart-split" }, g);
    svgEl2("line", { x1: lay.mL, y1: sy.at(q.y), x2: lay.mL + plotW, y2: sy.at(q.y), class: "o-chart-split" }, g);
    const cs = q.corners ?? [];
    const xL = lay.mL + 10;
    const xR = lay.mL + plotW - 10;
    const yT = lay.mT + 16;
    const yB = lay.mT + lay.plotH - 8;
    [[cs[0], xL, yT, "start"], [cs[1], xR, yT, "end"], [cs[2], xL, yB, "start"], [cs[3], xR, yB, "end"]].forEach(
      ([text, x, y, anchor]) => {
        if (!text) return;
        const t = svgEl2("text", { x, y, "text-anchor": anchor, class: "o-chart-corner" }, g);
        t.textContent = text;
      }
    );
  }
  const szMax = hi(data.series.flatMap((s2) => s2.sizes ?? []));
  data.series.forEach((s2, si) => {
    const pxs = s2.xs ?? [];
    const sizes = s2.sizes;
    pxs.forEach((x, i) => {
      const cx = sx.at(x);
      const cy = sy.at(s2.values[i] ?? 0);
      const r = sizes ? Math.max(R_MIN, R_MAX * Math.sqrt(Math.max(0, sizes[i] ?? 0) / (szMax || 1))) : q ? R_QUAD : R_DOT;
      const attrs = { cx, cy, r, fill: s2.color, "data-series": si, "data-label": i };
      if (sizes) attrs["fill-opacity"] = 0.72;
      svgEl2("circle", attrs, g);
      const name = s2.pointLabels?.[i];
      if (name) {
        const t = svgEl2("text", { x: cx, y: cy - r - 4, "text-anchor": "middle", class: "o-chart-datalabel" }, g);
        t.textContent = name;
      }
    });
  });
}

// src/chart/stack.ts
var limitFor = (n) => SPAN_CAP / Math.max(1, n);
var clamp = (v, lim) => v > lim ? lim : v < -lim ? -lim : v;
function stackSegments(values, mode = "cumulative") {
  const signed = mode !== "cumulative";
  const lim = limitFor(values.length);
  const contrib = (v) => clamp(signed ? v : Math.max(0, v), lim);
  let acc = 0;
  if (mode === "centred") {
    for (const v of values) acc += contrib(v);
    acc = -acc / 2;
  }
  return values.map((v) => {
    const from = acc;
    acc += contrib(v);
    return { from, to: acc };
  });
}
function stackTotal(values) {
  const lim = limitFor(values.length);
  let t = 0;
  for (const v of values) t += clamp(Math.max(0, v), lim);
  return t;
}

// src/chart/curve.ts
var C = (v) => Math.round(v * 100) / 100;
function monotoneTangents(xs, ys) {
  const n = ys.length;
  const m = new Array(n).fill(0);
  if (n < 2) return m;
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i];
    d[i] = h === 0 ? 0 : (ys[i + 1] - ys[i]) / h;
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s2 = a * a + b * b;
    if (s2 > 9) {
      const t = 3 / Math.sqrt(s2);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return m;
}
function seg(x0, y0, m0, x1, y1, m1) {
  const h = (x1 - x0) / 3;
  return `C ${C(x0 + h)} ${C(y0 + m0 * h)} ${C(x1 - h)} ${C(y1 - m1 * h)} ${C(x1)} ${C(y1)}`;
}
function curveForward(xs, ys, m) {
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) out.push(seg(xs[i], ys[i], m[i], xs[i + 1], ys[i + 1], m[i + 1]));
  return out.join(" ");
}
function curveBack(xs, ys, m) {
  const out = [];
  for (let i = xs.length - 1; i > 0; i--) {
    const h = (xs[i] - xs[i - 1]) / 3;
    out.push(
      `C ${C(xs[i] - h)} ${C(ys[i] - m[i] * h)} ${C(xs[i - 1] + h)} ${C(ys[i - 1] + m[i - 1] * h)} ${C(xs[i - 1])} ${C(ys[i - 1])}`
    );
  }
  return out.join(" ");
}
var curveStart = (x, y) => `M ${C(x)} ${C(y)}`;
var curveLine = (x, y) => `L ${C(x)} ${C(y)}`;

// src/chart/stream.ts
var MIN_LABEL_H = 16;
function renderStream(svg, data, w, lay, ns) {
  const plotW = w - lay.mL - lay.mR;
  const n = data.labels.length;
  const S = data.series.length;
  xLabels(svg, data.labels, plotW, lay);
  axisTitles(svg, { ...data, yTitle: void 0 }, plotW, lay);
  if (S === 0 || n === 0) return;
  const T = data.series.map((s2) => data.labels.map((_l, i) => Math.max(0, s2.values[i] ?? 0)));
  const peak = data.labels.reduce((mx, _l, i) => Math.max(mx, T.reduce((a, t) => a + t[i], 0)), 0);
  if (peak <= 0) return;
  const scale = lay.plotH / peak;
  const cy = lay.mT + lay.plotH / 2;
  const idx = n > 1 ? data.labels.map((_l, i) => i) : [0, 0];
  const K = idx.length;
  const xs = n > 1 ? idx.map((i) => lay.mL + plotW / n * (i + 0.5)) : [lay.mL, lay.mL + plotW];
  const Tp = T.map((t) => idx.map((i) => t[i] * scale));
  const tang = Tp.map((t) => monotoneTangents(xs, t));
  const by = [];
  const bm = [];
  for (let k = 0; k <= S; k++) {
    by.push([]);
    bm.push([]);
  }
  for (let j = 0; j < K; j++) {
    const segs = stackSegments(
      Tp.map((t) => t[j]),
      "centred"
    );
    let slope = -tang.reduce((a, m) => a + m[j], 0) / 2;
    for (let k = 0; k <= S; k++) {
      const off = k === 0 ? segs[0]?.from ?? 0 : segs[k - 1].to;
      by[k].push(cy - off);
      bm[k].push(-slope);
      if (k < S) slope += tang[k][j];
    }
  }
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  data.series.forEach((s2, si) => {
    const d = [
      curveStart(xs[0], by[si][0]),
      curveForward(xs, by[si], bm[si]),
      curveLine(xs[K - 1], by[si + 1][K - 1]),
      curveBack(xs, by[si + 1], bm[si + 1]),
      "Z"
    ].join(" ");
    svgEl2(
      "path",
      { d, fill: fillGradient(svg, s2.color, ns), stroke: s2.color, "stroke-width": 1, "stroke-linejoin": "round", "data-series": si },
      g
    );
  });
  data.series.forEach((s2, si) => {
    let best = 0;
    for (let j = 1; j < K; j++) {
      if (Tp[si][j] > Tp[si][best]) best = j;
    }
    if (Tp[si][best] < MIN_LABEL_H) return;
    const lx = n > 1 ? xs[best] : lay.mL + plotW / 2;
    const t = svgEl2(
      "text",
      { x: lx, y: (by[si][best] + by[si + 1][best]) / 2 + 4, "text-anchor": "middle", class: "o-chart-bandlabel" },
      g
    );
    t.textContent = data.showValues ? `${s2.name} ${T[si][idx[best]]}` : s2.name;
  });
}

// src/chart/treemap.ts
var NAME_FONT6 = 10;
var VAL_FONT3 = 10;
var PAD2 = 3;
var SIDE_CLEAR = 0.5;
var ONE_LINE_H = 15;
var TWO_LINE_H = 27;
var GAP2 = 3;
var RADIUS = 8;
var TINT_STEP = 0.18;
var TINT_MAX = 0.66;
var HOLE = 0.12;
function channels(hex3) {
  const s2 = hex3.replace("#", "");
  const w = s2.length < 6 ? 1 : 2;
  const at = (i) => {
    const h = s2.substr(i * w, w);
    const n = parseInt(w === 1 ? h + h : h, 16);
    return Number.isFinite(n) ? n : 0;
  };
  return [at(0), at(1), at(2)];
}
var hex22 = (n) => (n < 16 ? "0" : "") + n.toString(16);
function tint(hex3, amount) {
  if (amount <= 0) return hex3;
  const c = channels(hex3);
  return "#" + c.map((v) => hex22(Math.round(v + (255 - v) * amount))).join("");
}
function readTree(data) {
  const n = data.labels.length;
  const raw = data.parents ?? [];
  const parents = Array.from({ length: n }, (_x, i) => {
    const p = raw[i];
    return typeof p === "number" && Number.isInteger(p) && p >= 0 && p < n && p !== i ? p : -1;
  });
  for (let i = 0; i < n; i++) {
    let at = parents[i];
    for (let steps2 = 0; at >= 0; steps2++) {
      if (steps2 >= n) {
        parents[i] = -1;
        break;
      }
      at = parents[at];
    }
  }
  const kids = Array.from({ length: n }, () => []);
  const roots = [];
  for (let i = 0; i < n; i++) {
    const p = parents[i];
    if (p < 0) roots.push(i);
    else kids[p].push(i);
  }
  const depth = new Array(n).fill(0);
  const order = [];
  const walk = (i, d) => {
    depth[i] = d;
    order.push(i);
    for (const k of kids[i]) walk(k, d + 1);
  };
  for (const r of roots) walk(r, 0);
  const values = data.series[0]?.values ?? [];
  const leaf = (i) => {
    const v = values[i];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  };
  let biggest = 0;
  for (let i = 0; i < n; i++) if (leaf(i) > biggest) biggest = leaf(i);
  const scale = sumScale(biggest, n);
  const own = new Array(n).fill(0);
  const total = new Array(n).fill(0);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    own[i] = leaf(i) * scale;
    total[i] = own[i] + kids[i].reduce((a, c) => a + total[c], 0);
  }
  const color = new Array(n).fill(CHART_PALETTE[0]);
  const selfColor = new Array(n).fill(CHART_PALETTE[0]);
  roots.forEach((r, ri) => {
    const base = CHART_PALETTE[ri % CHART_PALETTE.length];
    const paint = (i) => {
      color[i] = tint(base, Math.min(TINT_MAX, depth[i] * TINT_STEP));
      selfColor[i] = tint(base, Math.min(TINT_MAX, (depth[i] + 1) * TINT_STEP));
      for (const k of kids[i]) paint(k);
    };
    paint(r);
  });
  return {
    kids,
    roots,
    depth,
    own,
    total,
    color,
    selfColor,
    // over the DRAWABLE nodes only: a branch that totals zero paints nothing, so reserving a
    // sunburst ring for its depth would thin every other ring to make room for empty space
    maxDepth: depth.reduce((a, d, i) => total[i] > 0 && d > a ? d : a, 0),
    grand: roots.reduce((a, r) => a + total[r], 0),
    unit: 1 / scale
  };
}
function worstRatio(items, from, to, rowV, restV, area, short) {
  const t = rowV / restV * area / short;
  if (!(t > 0)) return Infinity;
  let worst = 0;
  for (let i = from; i < to; i++) {
    const ext = items[i].value / restV * area / t;
    if (!(ext > 0)) return Infinity;
    const r = ext > t ? ext / t : t / ext;
    if (r > worst) worst = r;
  }
  return worst;
}
function squarify(items, rect, out) {
  let { x, y, w, h } = rect;
  let restV = items.reduce((a, it) => a + it.value, 0);
  let k = 0;
  while (k < items.length) {
    if (!(w > 0) || !(h > 0) || !(restV > 0)) return;
    const area = w * h;
    const short = w <= h ? w : h;
    let rowV = 0;
    let best = Infinity;
    let end = k;
    while (end < items.length) {
      const trialV = rowV + items[end].value;
      const trial = worstRatio(items, k, end + 1, trialV, restV, area, short);
      if (end > k && trial > best) break;
      rowV = trialV;
      best = trial;
      end++;
    }
    const t = rowV / restV * area / short;
    let along = 0;
    for (let i = k; i < end; i++) {
      const ext = items[i].value / restV * area / t;
      const { idx, self } = items[i];
      out.push(w <= h ? { idx, self, x: x + along, y, w: ext, h: t } : { idx, self, x, y: y + along, w: t, h: ext });
      along += ext;
    }
    if (w <= h) {
      y += t;
      h -= t;
    } else {
      x += t;
      w -= t;
    }
    restV -= rowV;
    k = end;
  }
}
function layoutTree(t, rect) {
  const cells = [];
  const place = (idxs, r, self) => {
    const items = idxs.filter((i) => t.total[i] > 0).map((i) => ({ idx: i, value: t.total[i], self: false }));
    if (self >= 0 && t.own[self] > 0) items.push({ idx: self, value: t.own[self], self: true });
    items.sort((a, b) => b.value - a.value || a.idx - b.idx);
    const out = [];
    squarify(items, r, out);
    for (const c of out) {
      cells.push(c);
      if (!c.self && t.kids[c.idx].length) place(t.kids[c.idx], c, c.idx);
    }
  };
  place(t.roots, rect, -1);
  return cells;
}
function cellLabel(name, value, w, h) {
  const room = w - PAD2 * 2;
  if (room <= 0 || h < ONE_LINE_H || name.length === 0) return [];
  const cut = fitPrefix(name, NAME_FONT6, room);
  const shown = cut === name ? name : fitPrefix(name, NAME_FONT6, room - estTextWidth("\u2026", NAME_FONT6)) + "\u2026";
  if (shown === "\u2026") return [];
  if (value.length > 0 && h >= TWO_LINE_H && estTextWidth(value, VAL_FONT3) <= room) return [shown, value];
  return [shown];
}
var printable2 = (v, fmt) => Number.isFinite(v) ? fmt(v) : "";
function drawLines(svg, lines, cx, cy, fill, idx) {
  const top = cy - (lines.length - 1) * (NAME_FONT6 + 2) / 2 + NAME_FONT6 * 0.35;
  const ink = [];
  lines.forEach((line, li) => {
    const y = top + li * (NAME_FONT6 + 2);
    const t = svgEl2("text", { x: cx, y, "text-anchor": "middle", class: "o-chart-cellvalue", fill: inkOn(fill), "data-label": idx }, svg);
    t.textContent = line;
    const half = estTextWidth(line, NAME_FONT6) / 2;
    ink.push({ x: cx - half, y: y - NAME_FONT6 * INK_ASC, w: half * 2, h: NAME_FONT6 * (INK_ASC + INK_DESC) });
  });
  return ink;
}
var overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function emptyFrame2(svg, r) {
  svgEl2("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "none", stroke: "#ccc", "stroke-width": 1.5 }, svg);
}
function renderRects(svg, data, t, box) {
  const cells = layoutTree(t, box);
  if (cells.length === 0) {
    emptyFrame2(svg, box);
    return;
  }
  const convex = data.convex === true;
  const g = t.grand * t.unit;
  const fmt = scaleFormat(Number.isFinite(g) ? g : Number.MAX_VALUE);
  const taken = [];
  const painted = [];
  for (const c of cells) {
    if (!c.self && t.kids[c.idx].length) continue;
    const inset = convex ? GAP2 / 2 : 0;
    const w = c.w - inset * 2;
    const h = c.h - inset * 2;
    if (!(w > 0) || !(h > 0)) continue;
    const fill = c.self ? t.selfColor[c.idx] : t.color[c.idx];
    const figure = c.self ? t.own[c.idx] : t.total[c.idx];
    const attrs = { x: c.x + inset, y: c.y + inset, width: w, height: h, fill };
    if (convex) attrs.rx = Math.min(RADIUS, w / 2, h / 2);
    else attrs.class = "o-chart-cellsep";
    attrs["data-label"] = c.idx;
    svgEl2("rect", attrs, svg);
    painted.push({ x: c.x + inset, y: c.y + inset, w, h, fill });
    for (const b of drawLines(svg, cellLabel(data.labels[c.idx] ?? "", printable2(figure * t.unit, fmt), w, h), c.x + inset + w / 2, c.y + inset + h / 2, fill, c.idx)) {
      taken.push(b);
    }
  }
  for (const c of cells) {
    if (c.self || t.kids[c.idx].length === 0) continue;
    svgEl2("rect", { x: c.x, y: c.y, width: c.w, height: c.h, fill: "none", class: "o-chart-branch", "data-label": c.idx }, svg);
    const name = data.labels[c.idx] ?? "";
    const room = c.w - PAD2 * 2;
    if (name.length === 0 || room <= 0 || c.h < ONE_LINE_H) continue;
    const cut = fitPrefix(name, NAME_FONT6, room);
    const shown = cut === name ? name : fitPrefix(name, NAME_FONT6, room - estTextWidth("\u2026", NAME_FONT6)) + "\u2026";
    if (shown === "\u2026") continue;
    const figure = t.own[c.idx] > 0 ? printable2(t.total[c.idx] * t.unit, fmt) : "";
    const both = `${shown} ${figure}`;
    const label = figure.length > 0 && cut === name && estTextWidth(both, NAME_FONT6) <= room ? both : shown;
    const band = { x: c.x + PAD2, y: c.y + PAD2, w: estTextWidth(label, NAME_FONT6), h: NAME_FONT6 * (INK_ASC + INK_DESC) };
    if (taken.some((o) => overlaps(band, o))) continue;
    const under = new Set(painted.filter((p) => overlaps(band, p)).map((p) => p.fill));
    if (under.size !== 1) continue;
    const t2 = svgEl2(
      "text",
      { x: band.x, y: band.y + NAME_FONT6 * INK_ASC, "text-anchor": "start", class: "o-chart-cellvalue", fill: inkOn([...under][0]), "data-label": c.idx },
      svg
    );
    t2.textContent = label;
    taken.push(band);
  }
}
function renderSun(svg, data, t, box) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rOut = Math.min(box.w, box.h) / 2 - 4;
  if (!(t.grand > 0) || !(rOut > 0)) {
    emptyFrame2(svg, box);
    return;
  }
  const r0 = rOut * HOLE;
  const ring = (rOut - r0) / (t.maxDepth + 1);
  const g = t.grand * t.unit;
  const fmt = scaleFormat(Number.isFinite(g) ? g : Number.MAX_VALUE);
  const wedge = (i, a0, a12) => {
    if (!(t.total[i] > 0)) return;
    const rIn = r0 + t.depth[i] * ring;
    const rHi = rIn + ring;
    const d = arcPath(cx, cy, rIn, rHi, a0, a12);
    if (!d) return;
    const fill = t.color[i];
    svgEl2("path", { d, fill, class: "o-chart-cellsep", "data-label": i }, svg);
    ringLabel(svg, data.labels[i] ?? "", printable2(t.total[i] * t.unit, fmt), cx, cy, (rIn + rHi) / 2, ring, a0, a12, fill, i);
    let a = a0;
    for (const k of t.kids[i]) {
      const span2 = t.total[k] / t.total[i] * (a12 - a0);
      wedge(k, a, a + span2);
      a += span2;
    }
  };
  let angle = TOP;
  for (const r of t.roots) {
    const span2 = t.total[r] / t.grand * FULL_TURN;
    wedge(r, angle, angle + span2);
    angle += span2;
  }
}
var INK_ASC = 0.7;
var INK_DESC = 0.2;
var INK_HALF = 0.6;
function ringRoom(tangential, rMid, thickness, span2) {
  const H = NAME_FONT6 * INK_HALF;
  const rIn = rMid - thickness / 2;
  const rOut = rMid + thickness / 2;
  if (tangential) {
    if (rMid - H < rIn + PAD2) return 0;
    const far2 = rOut - PAD2 - H;
    if (!(far2 > rMid)) return 0;
    let half2 = Math.sqrt(far2 * far2 - rMid * rMid);
    const inner = rMid - H;
    const halfSpan2 = span2 / 2 - PAD2 / inner;
    if (!(halfSpan2 > 0)) return 0;
    if (halfSpan2 < Math.PI / 2) half2 = Math.min(half2, inner * Math.tan(halfSpan2));
    return half2 > 0 ? half2 * 2 : 0;
  }
  let half = Math.min(rOut - PAD2 - rMid, rMid - (rIn + PAD2));
  if (!(half > 0)) return 0;
  const far = rOut - PAD2;
  half = Math.min(half, Math.sqrt(Math.max(0, far * far - H * H)) - rMid);
  const halfSpan = span2 / 2;
  if (halfSpan < Math.PI / 2) half = Math.min(half, rMid - (H + SIDE_CLEAR) / Math.tan(halfSpan));
  if (!(half > 0)) return 0;
  return half * 2;
}
function ringLabel(svg, name, value, cx, cy, rMid, thickness, a0, a12, fill, idx) {
  if (name.length === 0) return;
  const span2 = Math.abs(a12 - a0);
  const arc = span2 * rMid;
  let tangential = arc >= thickness;
  let room = ringRoom(tangential, rMid, thickness, span2);
  if (room <= 0) {
    tangential = !tangential;
    room = ringRoom(tangential, rMid, thickness, span2);
  }
  if (room <= 0) return;
  const cut = fitPrefix(name, NAME_FONT6, room);
  const shown = cut === name ? name : fitPrefix(name, NAME_FONT6, room - estTextWidth("\u2026", NAME_FONT6)) + "\u2026";
  if (shown === "\u2026") return;
  const both = `${shown} ${value}`;
  const text = value.length > 0 && cut === name && estTextWidth(both, NAME_FONT6) <= room ? both : shown;
  const mid = (a0 + a12) / 2;
  const p = polarPt(cx, cy, rMid, mid);
  let deg = mid * 180 / Math.PI + (tangential ? 90 : 0);
  if (Math.cos(deg * Math.PI / 180) < 0) deg += 180;
  const t = svgEl2(
    "text",
    {
      x: p.x,
      y: p.y + NAME_FONT6 * 0.35,
      "text-anchor": "middle",
      transform: `rotate(${deg} ${p.x} ${p.y})`,
      class: "o-chart-cellvalue",
      // the one text class that declares no fill — see drawLines
      fill: inkOn(fill),
      "data-label": idx
    },
    svg
  );
  t.textContent = text;
}
function renderTreemap(svg, data, w, lay) {
  const t = readTree(data);
  const box = { x: lay.mL, y: lay.mT, w: w - lay.mL - lay.mR, h: lay.plotH };
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  if (data.sunburst === true) renderSun(g, data, t, box);
  else renderRects(g, data, t, box);
}
function treemapLegend(data) {
  const t = readTree(data);
  if (t.roots.length > CHART_PALETTE.length) return [];
  return t.roots.filter((r) => t.total[r] > 0).map((r) => ({ label: data.labels[r] ?? "", color: t.color[r] }));
}

// src/chart/waterfall.ts
var TOTAL_GREY = "#5c6470";
var kindAt = (data, i) => data.kinds?.[i] ?? ((data.series[0]?.values[i] ?? 0) >= 0 ? "increase" : "decrease");
function waterfallColors(data) {
  const inc = data.series[0]?.color ?? altColor("", 0);
  return {
    increase: inc,
    decrease: altColor(inc, 3),
    total: inc.toLowerCase() === TOTAL_GREY ? altColor(inc, 4) : TOTAL_GREY
  };
}
function waterfallLegend(data) {
  const c = waterfallColors(data);
  const seen = data.labels.map((_l, i) => kindAt(data, i));
  return [
    ["increase", "Increase"],
    ["decrease", "Decrease"],
    ["total", "Total"]
  ].filter(([k]) => seen.includes(k)).map(([k, label]) => ({ label, color: c[k] }));
}
function renderWaterfall(svg, data, w, lay) {
  const plotW = w - lay.mL - lay.mR;
  const vals = data.series[0]?.values ?? [];
  const kinds = data.labels.map((_l, i) => kindAt(data, i));
  let run = 0;
  const deltas = data.labels.map((_l, i) => {
    const v = vals[i] ?? 0;
    if (kinds[i] === "total") {
      const d2 = v - run;
      run = v;
      return d2;
    }
    const d = kinds[i] === "decrease" ? -Math.abs(v) : Math.abs(v);
    run += d;
    return d;
  });
  const segs = stackSegments(deltas, "signed");
  const lo2 = segs.reduce((m, s2) => Math.min(m, s2.from, s2.to), 0);
  const hi2 = extendMax(segs.reduce((m, s2) => Math.max(m, s2.from, s2.to), 0), data.yMax);
  const sy = numScale(lo2, hi2, lay.mT + lay.plotH, lay.mT);
  valueAxisY(svg, sy, lay, plotW);
  xLabels(svg, data.labels, plotW, lay);
  axisTitles(svg, data, plotW, lay);
  const colors = waterfallColors(data);
  const groupW = plotW / data.labels.length;
  const barW = Math.min(46, groupW * 0.6);
  const zero = sy.at(0);
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  for (let i = 0; i < segs.length - 1; i++) {
    const y = sy.at(segs[i].to);
    svgEl2(
      "line",
      { x1: lay.mL + groupW * (i + 0.5) + barW / 2, y1: y, x2: lay.mL + groupW * (i + 1.5) - barW / 2, y2: y, class: "o-chart-connector" },
      g
    );
  }
  segs.forEach((sg, i) => {
    const cx = lay.mL + groupW * (i + 0.5);
    if (data.highlightIndex === i) {
      svgEl2("rect", { x: lay.mL + groupW * i, y: lay.mT, width: groupW, height: lay.plotH, class: "o-chart-hiband" }, g);
    }
    const yA = kinds[i] === "total" ? zero : sy.at(sg.from);
    const yB = sy.at(sg.to);
    const h = Math.abs(yB - yA);
    const hh = Math.max(h, 1);
    const top = Math.min(yA, yB) - (hh - h) / 2;
    svgEl2(
      "rect",
      { x: cx - barW / 2, y: top, width: barW, height: hh, rx: 2, fill: colors[kinds[i]], "data-series": 0, "data-label": i, "data-kind": kinds[i] },
      g
    );
    if (data.showValues) {
      const t = svgEl2("text", { x: cx, y: top - 4, "text-anchor": "middle", class: "o-chart-datalabel" }, g);
      t.textContent = String(Math.round((kinds[i] === "total" ? sg.to : deltas[i]) * 100) / 100);
    }
  });
}

// src/chart.ts
var CHART_W = 640;
var CHART_H = 360;
var M = { left: 46, right: 12, top: 12, bottom: 30 };
var COL_W = 150;
var TITLE_BAND = 40;
var AXIS_TITLE_H = 20;
var AXIS_TITLE_W = 18;
var CAT_LABEL_W = 120;
var ROW_PITCH_H = 26;
var HBAR_W = 680;
var TS_W = 720;
var HEAT_LABEL_W = 96;
var HEAT_ROW_H = 34;
var SPARK_W = 240;
var SPARK_H = 60;
var SPARK_PAD = 4;
function isHorizontal(data) {
  return data.type === "bar" && data.orientation === "horizontal";
}
function axisFree(data) {
  return data.type === "pie" || data.type === "radar" || data.type === "gauge" || // …and a TREEMAP: its cells are nested AREAS, not positions on a pair of scales, so there is no
  // axis anywhere on the picture for a title to name. The schema rejects xTitle/yTitle on it.
  data.type === "treemap" || // …and a SANKEY, whose columns LOOK like an axis and are not one: a column is a position in a
  // topological order, and the vertical extent is a stack of throughputs with no origin.
  data.type === "sankey" || data.funnel === true || data.polar === true;
}
function isFixedWidth(data) {
  return axisFree(data);
}
function isPolarDisc(data) {
  return data.type === "pie" || data.type === "radar" || data.type === "gauge" || data.type === "bar" && data.polar === true;
}
function plotHeightOr(data, fallback) {
  const h = data.plotHeight;
  if (typeof h !== "number" || !Number.isFinite(h)) return fallback;
  return Math.min(CHART_PLOT_H_MAX, Math.max(CHART_PLOT_H_MIN, h));
}
function layout(data) {
  const hasHead = !!(data.title || data.subtitle);
  const axed = !axisFree(data);
  const hasX = axed && !!data.xTitle;
  const hasY = axed && !!data.yTitle && data.stream !== true;
  const addTop = hasHead ? TITLE_BAND : 0;
  const addBottom = hasX ? AXIS_TITLE_H : 0;
  const mT = M.top + addTop;
  const mB = M.bottom + addBottom;
  if (isHorizontal(data)) {
    const mL2 = CAT_LABEL_W + (hasY ? AXIS_TITLE_W : 0);
    const plotH = Math.max(1, data.labels.length) * ROW_PITCH_H;
    return { mL: mL2, mR: M.right + 8, mT, mB, chartH: mT + plotH + mB, plotH, horizontal: true };
  }
  if (data.type === "heatmap") {
    const mL2 = HEAT_LABEL_W + (hasY ? AXIS_TITLE_W : 0);
    const plotH = Math.max(1, data.series.length) * HEAT_ROW_H;
    return { mL: mL2, mR: M.right + SCALE_LEGEND_W, mT, mB, chartH: mT + plotH + mB, plotH, horizontal: false };
  }
  if (data.type === "treemap" || data.type === "sankey") {
    const m = M.right;
    const chartH2 = plotHeightOr(data, CHART_H - M.top - m) + mT + m;
    return { mL: m, mR: m, mT, mB: m, chartH: chartH2, plotH: chartH2 - mT - m, horizontal: false };
  }
  const mL = M.left + (hasY ? AXIS_TITLE_W : 0);
  const chartH = plotHeightOr(data, CHART_H - M.top - M.bottom) + mT + mB;
  const mR = M.right + (data.pareto ? PARETO_AXIS_W : 0) + (data.hexbin ? SCALE_LEGEND_W : 0);
  return { mL, mR, mT, mB, chartH, plotH: chartH - mT - mB, horizontal: false };
}
function chartWidth(n) {
  return Math.max(440, M.left + M.right + Math.max(1, n) * COL_W);
}
function viewWidth(data, lay) {
  if (isFixedWidth(data)) return CHART_W;
  if (lay.horizontal) return HBAR_W;
  if (data.type === "timeseries" || data.type === "scatter" || data.type === "heatmap") return TS_W;
  return chartWidth(data.labels.length);
}
var PRINT_COLUMN_H = 547;
function plotHeightBounds(data) {
  const lay = layout(data);
  const sheet = PRINT_COLUMN_H - lay.mT - lay.mB;
  const polar = isPolarDisc(data) ? viewWidth(data, lay) - lay.mL - lay.mR : Infinity;
  return {
    min: CHART_PLOT_H_MIN,
    max: Math.max(CHART_PLOT_H_MIN, Math.min(CHART_PLOT_H_MAX, sheet, polar)),
    current: lay.plotH
  };
}
var HEX_RE3 = /^#[0-9a-fA-F]{3,8}$/;
function readLink(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return void 0;
  const l = raw;
  if (typeof l.ledgerId !== "string" || l.ledgerId.length === 0) return void 0;
  if (typeof l.range !== "string" || l.range.length === 0) return void 0;
  const tab = typeof l.tab === "string" && l.tab.length > 0 ? l.tab : void 0;
  const orient = l.orient === "col" ? "col" : void 0;
  return { ledgerId: l.ledgerId, ...tab ? { tab } : {}, range: l.range, header: l.header === true, ...orient ? { orient } : {} };
}
function numRow(raw, width) {
  const a = (Array.isArray(raw) ? raw : []).filter((n) => typeof n === "number" && Number.isFinite(n));
  if (width <= 0) return a;
  const out = a.slice(0, width);
  if (out.length === 0) out.push(0);
  while (out.length < width) out.push(out[out.length - 1]);
  return out.sort((p, q) => p - q);
}
function numRows(raw, n, width) {
  if (!Array.isArray(raw)) return void 0;
  return Array.from({ length: n }, (_x, i) => numRow(raw[i], width));
}
var readLegend = (d) => typeof d.legend === "boolean" ? d.legend : void 0;
var readPlotHeight = (d) => typeof d.plotHeight === "number" && Number.isFinite(d.plotHeight) ? d.plotHeight : void 0;
var CURATED_FONT_KEYS = /* @__PURE__ */ new Set(["playfair", "lora", "inter", "source-serif"]);
var readTextColor = (d) => typeof d.textColor === "string" && HEX_RE3.test(d.textColor) ? d.textColor : void 0;
var readTextFont = (d) => typeof d.textFont === "string" && CURATED_FONT_KEYS.has(d.textFont) ? d.textFont : void 0;
var readTextScale = (d) => typeof d.textScale === "number" && Number.isFinite(d.textScale) ? d.textScale : void 0;
var readText = (d) => ({
  ...readTextColor(d) !== void 0 ? { textColor: readTextColor(d) } : {},
  ...readTextFont(d) !== void 0 ? { textFont: readTextFont(d) } : {},
  ...readTextScale(d) !== void 0 ? { textScale: readTextScale(d) } : {}
});
var CHART_FONT_STACK = {
  playfair: "'Playfair Display', Georgia, serif",
  lora: "'Lora', Georgia, serif",
  inter: `'Inter', "Segoe UI", Arial, sans-serif`,
  "source-serif": "'Source Serif 4', Georgia, serif",
  caveat: `'Caveat', "Segoe Script", cursive`
};
function normalizeChartData(raw) {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (d.type === "timeseries") return normalizeTimeseries(d);
  if (d.type === "scatter") return normalizeScatter(d);
  if (d.type === "gauge") return normalizeGauge(d);
  if (d.type === "heatmap") return normalizeHeatmap(d);
  if (d.type === "treemap") return normalizeTreemap(d);
  if (d.type === "sankey") return normalizeSankey(d);
  const type = d.type === "line" || d.type === "pie" || d.type === "waterfall" || d.type === "boxplot" || d.type === "radar" ? d.type : "bar";
  const signed = type === "waterfall" || type === "boxplot";
  const maxLabels = d.orientation === "horizontal" ? 60 : 24;
  const labels = (Array.isArray(d.labels) ? d.labels : []).map((l) => typeof l === "string" ? l : "").slice(0, maxLabels);
  if (labels.length === 0) labels.push("\u2014");
  const series = (Array.isArray(d.series) ? d.series : []).slice(0, 6).map((s2, i) => {
    const o = s2 ?? {};
    const values = (Array.isArray(o.values) ? o.values : []).map(
      (n) => typeof n === "number" && Number.isFinite(n) && (signed || n >= 0) ? n : 0
    );
    while (values.length < labels.length) values.push(0);
    const dash = typeof o.dash === "boolean" ? o.dash : void 0;
    const markers = typeof o.markers === "boolean" ? o.markers : void 0;
    const fill = type === "line" && typeof o.fill === "boolean" ? o.fill : void 0;
    const boxes = type === "boxplot" ? numRows(o.boxes, labels.length, 5) : void 0;
    const samples = type === "boxplot" ? numRows(o.samples, labels.length, 0) : void 0;
    const outliers = type === "boxplot" ? numRows(o.outliers, labels.length, 0) : void 0;
    return {
      name: typeof o.name === "string" ? o.name : `Series ${i + 1}`,
      color: typeof o.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(o.color) ? o.color : CHART_PALETTE[i % CHART_PALETTE.length],
      values: values.slice(0, labels.length),
      ...dash !== void 0 ? { dash } : {},
      ...markers !== void 0 ? { markers } : {},
      ...fill !== void 0 ? { fill } : {},
      ...boxes ? { boxes } : {},
      ...samples ? { samples } : {},
      ...outliers ? { outliers } : {}
    };
  });
  if (series.length === 0) series.push({ name: "Series 1", color: CHART_PALETTE[0], values: labels.map(() => 0) });
  const yMax = typeof d.yMax === "number" && Number.isFinite(d.yMax) && d.yMax > 0 ? d.yMax : null;
  const rawSC = Array.isArray(d.sliceColors) ? d.sliceColors : null;
  const sliceColors = rawSC ? labels.map((_, i) => typeof rawSC[i] === "string" && HEX_RE3.test(rawSC[i]) ? rawSC[i] : CHART_PALETTE[i % CHART_PALETTE.length]) : void 0;
  const showValues = typeof d.showValues === "boolean" ? d.showValues : void 0;
  const str = (v) => typeof v === "string" && v.length > 0 ? v : void 0;
  const title = str(d.title);
  const subtitle = str(d.subtitle);
  const xTitle = str(d.xTitle);
  const yTitle = str(d.yTitle);
  const donut = type === "pie" && typeof d.donut === "boolean" ? d.donut : void 0;
  const rose = type === "pie" && typeof d.rose === "boolean" ? d.rose : void 0;
  const funnel = type === "bar" && typeof d.funnel === "boolean" ? d.funnel : void 0;
  const polar = type === "bar" && funnel !== true && typeof d.polar === "boolean" ? d.polar : void 0;
  const shaped = funnel === true || polar === true;
  const orientation = type === "bar" && !shaped && d.orientation === "horizontal" ? "horizontal" : void 0;
  const barMode = type === "bar" && !shaped && (d.barMode === "overlaid" || d.barMode === "stacked") ? d.barMode : void 0;
  const spark = type === "line" && typeof d.spark === "boolean" ? d.spark : void 0;
  const histogram = type === "bar" && !shaped && typeof d.histogram === "boolean" ? d.histogram : void 0;
  const pareto = type === "bar" && !shaped && orientation !== "horizontal" && typeof d.pareto === "boolean" ? d.pareto : void 0;
  const stream = type === "line" && spark !== true && typeof d.stream === "boolean" ? d.stream : void 0;
  const rawKinds = Array.isArray(d.kinds) ? d.kinds : null;
  const kinds = type === "waterfall" && rawKinds && rawKinds.length === labels.length ? rawKinds.map(
    (k, i) => WATERFALL_KINDS.includes(k) ? k : (series[0].values[i] ?? 0) >= 0 ? "increase" : "decrease"
  ) : void 0;
  const hi2 = !shaped && typeof d.highlightIndex === "number" && Number.isInteger(d.highlightIndex) && d.highlightIndex >= 0 && d.highlightIndex < labels.length ? d.highlightIndex : void 0;
  const rawMaxes = Array.isArray(d.maxes) ? d.maxes : null;
  const maxes = type === "radar" && rawMaxes && rawMaxes.length === labels.length && rawMaxes.every((m) => typeof m === "number" && Number.isFinite(m) && m > 0) ? rawMaxes : void 0;
  const axeless = type === "radar" || shaped;
  const link = readLink(d.link);
  const one = type === "pie" || type === "waterfall" || type === "boxplot" || pareto === true || shaped;
  return {
    type,
    labels,
    series: one ? series.slice(0, 1) : series,
    yMax,
    ...orientation ? { orientation } : {},
    ...barMode ? { barMode } : {},
    ...hi2 !== void 0 ? { highlightIndex: hi2 } : {},
    // a funnel names and values every stage on its own, so the flag has nothing left to switch
    ...showValues !== void 0 && funnel !== true ? { showValues } : {},
    ...title ? { title } : {},
    ...subtitle ? { subtitle } : {},
    ...xTitle && !axeless ? { xTitle } : {},
    ...yTitle && !axeless ? { yTitle } : {},
    ...sliceColors ? { sliceColors } : {},
    ...link ? { link } : {},
    ...spark !== void 0 ? { spark } : {},
    ...histogram !== void 0 ? { histogram } : {},
    ...pareto !== void 0 ? { pareto } : {},
    ...stream !== void 0 ? { stream } : {},
    ...kinds ? { kinds } : {},
    ...donut !== void 0 ? { donut } : {},
    ...rose !== void 0 ? { rose } : {},
    ...funnel !== void 0 ? { funnel } : {},
    ...polar !== void 0 ? { polar } : {},
    ...maxes ? { maxes } : {},
    // 0.4.1 wave 6. Every type this branch produces — bar, line, pie, waterfall, box plot, radar —
    // draws a swatch row, so the switch is kept on all of them; `pieLabels` needs slices, so it is
    // a pie's alone and is dropped on the rest, exactly as `donut` and `rose` are.
    ...readLegend(d) !== void 0 ? { legend: readLegend(d) } : {},
    ...type === "pie" && typeof d.pieLabels === "boolean" ? { pieLabels: d.pieLabels } : {},
    // …and the plot box's height, kept on EVERY type — see readPlotHeight for why this one is spread
    // into all seven normalizers where `legend` is spread into four.
    ...readPlotHeight(d) !== void 0 ? { plotHeight: readPlotHeight(d) } : {},
    ...readText(d)
    // 1/7 — see readText
  };
}
function normalizeGauge(d) {
  const str = (v) => typeof v === "string" && v.length > 0 ? v : void 0;
  const num2 = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
  const label = typeof d.labels === "object" && Array.isArray(d.labels) && typeof d.labels[0] === "string" ? d.labels[0] : "\u2014";
  const s2 = Array.isArray(d.series) ? d.series[0] : null;
  const rawVals = s2 && Array.isArray(s2.values) ? s2.values : [];
  const value = num2(rawVals[0]) ?? 0;
  const min = num2(d.gaugeMin);
  const max = num2(d.gaugeMax);
  const ok = (min ?? 0) < (max ?? 100);
  const title = str(d.title);
  const subtitle = str(d.subtitle);
  const unit = typeof d.unit === "string" ? d.unit.slice(0, 8) : void 0;
  return {
    type: "gauge",
    labels: [label],
    series: [
      {
        name: s2 && typeof s2.name === "string" ? s2.name : "Series 1",
        color: s2 && typeof s2.color === "string" && HEX_RE3.test(s2.color) ? s2.color : CHART_PALETTE[0],
        values: [value]
      }
    ],
    yMax: null,
    // a gauge's ceiling is gaugeMax — yMax would be a second, contradicting one
    ...title ? { title } : {},
    ...subtitle ? { subtitle } : {},
    ...ok && min !== void 0 ? { gaugeMin: min } : {},
    ...ok && max !== void 0 ? { gaugeMax: max } : {},
    ...unit ? { unit } : {},
    ...readPlotHeight(d) !== void 0 ? { plotHeight: readPlotHeight(d) } : {},
    // 2/7 — see readPlotHeight
    ...readText(d)
    // 2/7 — see readText
  };
}
function normalizeHeatmap(d) {
  const labels = (Array.isArray(d.labels) ? d.labels : []).map((l) => typeof l === "string" ? l : "").slice(0, 24);
  if (labels.length === 0) labels.push("\u2014");
  const series = (Array.isArray(d.series) ? d.series : []).slice(0, 24).map((s2, i) => {
    const o = s2 ?? {};
    const values = (Array.isArray(o.values) ? o.values : []).map(
      (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0
    );
    while (values.length < labels.length) values.push(0);
    return {
      name: typeof o.name === "string" ? o.name : `Row ${i + 1}`,
      color: typeof o.color === "string" && HEX_RE3.test(o.color) ? o.color : CHART_PALETTE[i % CHART_PALETTE.length],
      values: values.slice(0, labels.length)
    };
  });
  if (series.length === 0) series.push({ name: "Row 1", color: CHART_PALETTE[0], values: labels.map(() => 0) });
  const str = (v) => typeof v === "string" && v.length > 0 ? v : void 0;
  const title = str(d.title);
  const subtitle = str(d.subtitle);
  const xTitle = str(d.xTitle);
  const yTitle = str(d.yTitle);
  const link = readLink(d.link);
  return {
    type: "heatmap",
    labels,
    series,
    // the colour ramp's CEILING, under the same extend-only rule as every other pinned axis; its
    // floor is always zero (chart/heatmap.ts says why)
    yMax: typeof d.yMax === "number" && Number.isFinite(d.yMax) && d.yMax > 0 ? d.yMax : null,
    ...title ? { title } : {},
    ...subtitle ? { subtitle } : {},
    ...xTitle ? { xTitle } : {},
    ...yTitle ? { yTitle } : {},
    ...link ? { link } : {},
    /* 3/7 — and a HEATMAP is one of the three the control is withheld on (its plot is rowCount x
       pitch), which is exactly why the value has to be kept here: withhold the control, keep the
       value, so a height set on a bar chart is still there after a trip through this type. */
    ...readPlotHeight(d) !== void 0 ? { plotHeight: readPlotHeight(d) } : {},
    ...readText(d)
    // 3/7 — see readText
  };
}
function normalizeTreemap(d) {
  const labels = (Array.isArray(d.labels) ? d.labels : []).map((l) => typeof l === "string" ? l : "").slice(0, TREEMAP_MAX_NODES);
  if (labels.length === 0) labels.push("\u2014");
  const n = labels.length;
  const rawParents = Array.isArray(d.parents) ? d.parents : null;
  let parents;
  if (rawParents) {
    const p = Array.from({ length: n }, (_x, i) => {
      const v = rawParents[i];
      return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < n && v !== i ? v : -1;
    });
    for (let i = 0; i < n; i++) {
      let at = p[i];
      for (let steps2 = 0; at >= 0; steps2++) {
        if (steps2 >= n) {
          p[i] = -1;
          break;
        }
        at = p[at];
      }
    }
    parents = p;
  }
  const s2 = Array.isArray(d.series) ? d.series[0] : null;
  const rawVals = s2 && Array.isArray(s2.values) ? s2.values : [];
  const values = labels.map((_l, i) => {
    const v = rawVals[i];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  });
  const str = (v) => typeof v === "string" && v.length > 0 ? v : void 0;
  const title = str(d.title);
  const subtitle = str(d.subtitle);
  const convex = typeof d.convex === "boolean" ? d.convex : void 0;
  const asked = typeof d.sunburst === "boolean" ? d.sunburst : void 0;
  const sunburst = convex === true && asked === true ? void 0 : asked;
  return {
    type: "treemap",
    labels,
    series: [
      {
        name: s2 && typeof s2.name === "string" ? s2.name : "Series 1",
        color: s2 && typeof s2.color === "string" && HEX_RE3.test(s2.color) ? s2.color : CHART_PALETTE[0],
        values
      }
    ],
    /* Kept rather than nulled, and it is INERT: a treemap has no value axis, and chart/treemap.ts
       reads nothing from it. The editor withholds the control (chart-fields.ts) and the schema
       accepts the key, so the rule is the one the whole editor obeys — WITHHOLD THE CONTROL, KEEP
       THE VALUE — and an author who pinned a ceiling on a bar finds it intact on the way back. */
    yMax: typeof d.yMax === "number" && Number.isFinite(d.yMax) && d.yMax > 0 ? d.yMax : null,
    ...title ? { title } : {},
    ...subtitle ? { subtitle } : {},
    ...parents ? { parents } : {},
    ...sunburst !== void 0 ? { sunburst } : {},
    ...convex !== void 0 ? { convex } : {},
    /* 0.4.1 wave 6 — a treemap DOES draw a swatch row: it keys the top-level BRANCHES, whose names
       exist nowhere else on the picture (chart/treemap.ts). It draws none above eight roots, where
       the palette starts repeating, so the switch is inert on a wide tree — kept all the same, and
       the panel is what withholds the control there (chart-fields.ts). */
    ...readLegend(d) !== void 0 ? { legend: readLegend(d) } : {},
    ...readPlotHeight(d) !== void 0 ? { plotHeight: readPlotHeight(d) } : {},
    // 4/7 — see readPlotHeight
    ...readText(d)
    // 4/7 — see readText
  };
}
function normalizeSankey(d) {
  const labels = (Array.isArray(d.labels) ? d.labels : []).map((l) => typeof l === "string" ? l : "").slice(0, SANKEY_MAX_NODES);
  if (labels.length === 0) labels.push("\u2014");
  const n = labels.length;
  const raw = Array.isArray(d.links) ? d.links : [];
  const clean = [];
  for (const l of raw) {
    if (!l || typeof l !== "object" || Array.isArray(l)) continue;
    const o = l;
    const from = o.from;
    const to = o.to;
    const value = o.value;
    if (typeof from !== "number" || !Number.isInteger(from) || from < 0 || from >= n) continue;
    if (typeof to !== "number" || !Number.isInteger(to) || to < 0 || to >= n || to === from) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    clean.push({ from, to, value });
  }
  clean.sort((a, b) => a.from - b.from || a.to - b.to || a.value - b.value);
  const capped = clean.slice(0, SANKEY_MAX_LINKS);
  const out = Array.from({ length: n }, () => []);
  const links = [];
  const reaches = (start, target) => {
    const seen = new Array(n).fill(false);
    const stack = [start];
    seen[start] = true;
    while (stack.length) {
      const u = stack.pop();
      if (u === target) return true;
      for (const v of out[u]) {
        if (!seen[v]) {
          seen[v] = true;
          stack.push(v);
        }
      }
    }
    return false;
  };
  for (const f of capped) {
    if (reaches(f.to, f.from)) continue;
    out[f.from].push(f.to);
    links.push(f);
  }
  const s2 = Array.isArray(d.series) ? d.series[0] : null;
  const str = (v) => typeof v === "string" && v.length > 0 ? v : void 0;
  const title = str(d.title);
  const subtitle = str(d.subtitle);
  return {
    type: "sankey",
    labels,
    series: [
      {
        name: s2 && typeof s2.name === "string" ? s2.name : "Series 1",
        color: s2 && typeof s2.color === "string" && HEX_RE3.test(s2.color) ? s2.color : CHART_PALETTE[0],
        values: labels.map(() => 0)
        // ballast — see the header
      }
    ],
    /* Kept rather than nulled, and INERT, exactly as on a treemap: a sankey has no value axis, and
       chart/sankey.ts reads nothing from it. The editor withholds the control and the schema accepts
       the key, so the rule is the one the whole editor obeys — WITHHOLD THE CONTROL, KEEP THE VALUE. */
    yMax: typeof d.yMax === "number" && Number.isFinite(d.yMax) && d.yMax > 0 ? d.yMax : null,
    ...title ? { title } : {},
    ...subtitle ? { subtitle } : {},
    // ALWAYS emitted on this type, empty array included: `links` is required by the schema, so an
    // absent array is not a plainer sankey but a broken one, and the editor needs a row list to grow.
    links,
    ...readPlotHeight(d) !== void 0 ? { plotHeight: readPlotHeight(d) } : {},
    // 5/7 — see readPlotHeight
    ...readText(d)
    // 5/7 — see readText
  };
}
function readQuadrant(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return void 0;
  const q = raw;
  if (typeof q.x !== "number" || !Number.isFinite(q.x) || typeof q.y !== "number" || !Number.isFinite(q.y)) return void 0;
  const corners = Array.isArray(q.corners) ? q.corners.slice(0, 4).map((c) => typeof c === "string" ? c : "") : void 0;
  return { x: q.x, y: q.y, ...corners ? { corners } : {} };
}
function normalizeScatter(d) {
  const labels = (Array.isArray(d.labels) ? d.labels : []).map((l) => typeof l === "string" ? l : "").slice(0, 60);
  const series = (Array.isArray(d.series) ? d.series : []).slice(0, 6).map((s2, i) => {
    const o = s2 ?? {};
    const rawXs = Array.isArray(o.xs) ? o.xs : [];
    const rawVals = Array.isArray(o.values) ? o.values : [];
    const rawSizes = Array.isArray(o.sizes) ? o.sizes : null;
    const rawNames = Array.isArray(o.pointLabels) ? o.pointLabels : null;
    const n = Math.min(rawXs.length, rawVals.length);
    const xs = [];
    const values = [];
    const sizes = [];
    const pointLabels = [];
    for (let k = 0; k < n; k++) {
      const x = rawXs[k];
      const y = rawVals[k];
      if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
        xs.push(x);
        values.push(y);
        if (rawSizes) {
          const z = rawSizes[k];
          sizes.push(typeof z === "number" && Number.isFinite(z) && z >= 0 ? z : 0);
        }
        if (rawNames) {
          const t = rawNames[k];
          pointLabels.push(typeof t === "string" ? t : "");
        }
      }
    }
    return {
      name: typeof o.name === "string" ? o.name : `Series ${i + 1}`,
      color: typeof o.color === "string" && HEX_RE3.test(o.color) ? o.color : CHART_PALETTE[i % CHART_PALETTE.length],
      values,
      xs,
      ...rawSizes ? { sizes } : {},
      ...rawNames ? { pointLabels } : {}
    };
  });
  if (series.length === 0) series.push({ name: "Series 1", color: CHART_PALETTE[0], values: [0], xs: [0] });
  const yMax = typeof d.yMax === "number" && Number.isFinite(d.yMax) && d.yMax > 0 ? d.yMax : null;
  const str = (v) => typeof v === "string" && v.length > 0 ? v : void 0;
  const title = str(d.title);
  const subtitle = str(d.subtitle);
  const xTitle = str(d.xTitle);
  const yTitle = str(d.yTitle);
  const hexbin = typeof d.hexbin === "boolean" ? d.hexbin : void 0;
  const quadrant = hexbin === true ? void 0 : readQuadrant(d.quadrant);
  const rawBins = d.hexBins;
  const hexBins = hexbin === true && typeof rawBins === "number" && Number.isInteger(rawBins) && rawBins >= 4 && rawBins <= 60 ? rawBins : void 0;
  const showValues = hexbin === true && typeof d.showValues === "boolean" ? d.showValues : void 0;
  return {
    type: "scatter",
    labels,
    series: hexbin === true ? series.map(({ sizes: _s, pointLabels: _p, ...rest }) => rest) : series,
    yMax,
    ...showValues !== void 0 ? { showValues } : {},
    ...title ? { title } : {},
    ...subtitle ? { subtitle } : {},
    ...xTitle ? { xTitle } : {},
    ...yTitle ? { yTitle } : {},
    ...quadrant ? { quadrant } : {},
    ...hexbin !== void 0 ? { hexbin } : {},
    ...hexBins !== void 0 ? { hexBins } : {},
    /* 0.4.1 wave 6 — and the hexbin takes the swatch switch away again, the same way it takes away
       `sizes`, `pointLabels` and `quadrant`. A plain scatter keys its point colours by series and
       draws the row; a hexbin pools every point into one lattice decoded by the colour SCALE it
       draws inside its own SVG, so there is no row for the switch to act on. */
    ...hexbin !== true && readLegend(d) !== void 0 ? { legend: readLegend(d) } : {},
    ...readPlotHeight(d) !== void 0 ? { plotHeight: readPlotHeight(d) } : {},
    // 6/7 — see readPlotHeight
    ...readText(d)
    // 6/7 — see readText
  };
}
function normalizeTimeseries(d) {
  const labels = (Array.isArray(d.labels) ? d.labels : []).map((l) => typeof l === "string" ? l : "").slice(0, 60);
  const series = (Array.isArray(d.series) ? d.series : []).slice(0, 6).map((s2, i) => {
    const o = s2 ?? {};
    const rawXs = Array.isArray(o.xs) ? o.xs : [];
    const rawVals = Array.isArray(o.values) ? o.values : [];
    const n = Math.min(rawXs.length, rawVals.length);
    const xs = [];
    const values = [];
    for (let k = 0; k < n; k++) {
      const x = rawXs[k];
      const y = rawVals[k];
      if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) && y >= 0) {
        xs.push(x);
        values.push(y);
      }
    }
    const dash = typeof o.dash === "boolean" ? o.dash : void 0;
    const markers = typeof o.markers === "boolean" ? o.markers : void 0;
    return {
      name: typeof o.name === "string" ? o.name : `Series ${i + 1}`,
      color: typeof o.color === "string" && HEX_RE3.test(o.color) ? o.color : CHART_PALETTE[i % CHART_PALETTE.length],
      values,
      xs,
      ...dash !== void 0 ? { dash } : {},
      ...markers !== void 0 ? { markers } : {}
    };
  });
  if (series.length === 0) series.push({ name: "Series 1", color: CHART_PALETTE[0], values: [0, 0], xs: [0, 1] });
  const yMax = typeof d.yMax === "number" && Number.isFinite(d.yMax) && d.yMax > 0 ? d.yMax : null;
  const showValues = typeof d.showValues === "boolean" ? d.showValues : void 0;
  const str = (v) => typeof v === "string" && v.length > 0 ? v : void 0;
  const title = str(d.title);
  const subtitle = str(d.subtitle);
  const xTitle = str(d.xTitle);
  const yTitle = str(d.yTitle);
  return {
    type: "timeseries",
    labels,
    series,
    yMax,
    ...showValues !== void 0 ? { showValues } : {},
    ...title ? { title } : {},
    ...subtitle ? { subtitle } : {},
    ...xTitle ? { xTitle } : {},
    ...yTitle ? { yTitle } : {},
    // 0.4.1 wave 6 — a timeseries keys its lines by series and draws the row like any line chart
    ...readLegend(d) !== void 0 ? { legend: readLegend(d) } : {},
    ...readPlotHeight(d) !== void 0 ? { plotHeight: readPlotHeight(d) } : {},
    // 7/7 — see readPlotHeight
    ...readText(d)
    // 7/7 — see readText
  };
}
function axes(svg, max, plotW, lay) {
  for (let i = 0; i <= 4; i++) {
    const y = lay.mT + lay.plotH * i / 4;
    svgEl2("line", { x1: lay.mL, y1: y, x2: lay.mL + plotW, y2: y, class: "o-chart-grid" }, svg);
    const lbl = svgEl2("text", { x: lay.mL - 6, y: y + 4, "text-anchor": "end", class: "o-chart-tick" }, svg);
    lbl.textContent = String(Math.round(max * (1 - i / 4) * 100) / 100);
  }
}
function column(data, li) {
  return data.series.map((s2) => s2.values[li] ?? 0);
}
function axisMax(data, stacked, peak) {
  if (stacked && data.yMax != null) return Math.max(data.yMax, peak);
  return data.yMax ?? niceMax(peak);
}
function renderBar(svg, data, w, lay) {
  const plotW = w - lay.mL - lay.mR;
  const stacked = data.barMode === "stacked";
  const peak = stacked ? Math.max(...data.labels.map((_, li) => stackTotal(column(data, li)))) : Math.max(...data.series.flatMap((s2) => s2.values));
  const max = axisMax(data, stacked, peak);
  axes(svg, max, plotW, lay);
  xLabels(svg, data.labels, plotW, lay);
  axisTitles(svg, data, plotW, lay);
  const groupW = plotW / data.labels.length;
  const overlaid = data.barMode === "overlaid";
  const gapless = data.histogram === true;
  const rx = gapless ? 0 : 2;
  const barW = gapless ? overlaid || stacked ? groupW : groupW / data.series.length : overlaid || stacked ? Math.min(46, groupW * 0.7) : Math.min(40, groupW * 0.7 / data.series.length);
  const barH = (v) => Math.min(v, max) / max * lay.plotH;
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  data.labels.forEach((_, li) => {
    const colX = lay.mL + groupW * li;
    if (data.highlightIndex === li) {
      svgEl2("rect", { x: colX, y: lay.mT, width: groupW, height: lay.plotH, class: "o-chart-hiband" }, g);
    }
    if (stacked) {
      const segs = stackSegments(column(data, li));
      const cx = colX + groupW / 2;
      segs.forEach((sg, si) => {
        const y1 = lay.mT + lay.plotH - barH(sg.to);
        const h = barH(sg.to) - barH(sg.from);
        if (h <= 0) return;
        svgEl2("rect", { x: cx - barW / 2, y: y1, width: barW, height: h, fill: data.series[si].color, "data-series": si, "data-label": li }, g);
      });
      if (data.showValues) {
        const total = segs.length ? segs[segs.length - 1].to : 0;
        const t = svgEl2("text", { x: cx, y: lay.mT + lay.plotH - barH(total) - 4, "text-anchor": "middle", class: "o-chart-datalabel" }, g);
        t.textContent = String(Math.round(total * 100) / 100);
      }
    } else if (overlaid) {
      const order = data.series.map((s2, si) => ({ si, v: s2.values[li] ?? 0 })).sort((a, b) => b.v - a.v);
      const cx = colX + groupW / 2;
      order.forEach((o, rank) => {
        const s2 = data.series[o.si];
        const bw = barW * (1 - rank * 0.28);
        const h = barH(o.v);
        svgEl2(
          "rect",
          { x: cx - bw / 2, y: lay.mT + lay.plotH - h, width: bw, height: h, rx, fill: s2.color, class: rank > 0 ? "o-chart-inner-ring" : "", "data-series": o.si, "data-label": li },
          g
        );
      });
      if (data.showValues) {
        const top = order[0];
        const t = svgEl2("text", { x: cx, y: lay.mT + lay.plotH - barH(top.v) - 4, "text-anchor": "middle", class: "o-chart-datalabel" }, g);
        t.textContent = String(top.v);
      }
    } else {
      const groupX = colX + (groupW - barW * data.series.length) / 2;
      data.series.forEach((s2, si) => {
        const v = s2.values[li] ?? 0;
        const h = barH(v);
        const bx = groupX + barW * si;
        const by = lay.mT + lay.plotH - h;
        svgEl2("rect", { x: bx, y: by, width: barW, height: h, rx, fill: s2.color, "data-series": si, "data-label": li }, g);
        if (data.showValues) {
          const t = svgEl2("text", { x: bx + barW / 2, y: by - 4, "text-anchor": "middle", class: "o-chart-datalabel" }, g);
          t.textContent = String(v);
        }
      });
    }
  });
  if (data.pareto) renderPareto(svg, data, lay, plotW);
}
function renderBarH(svg, data, w, lay) {
  const plotW = w - lay.mL - lay.mR;
  const stacked = data.barMode === "stacked";
  const peak = stacked ? Math.max(...data.labels.map((_, li) => stackTotal(column(data, li)))) : Math.max(...data.series.flatMap((s2) => s2.values));
  const max = axisMax(data, stacked, peak);
  const xAt = (v) => lay.mL + Math.min(v, max) / max * plotW;
  for (let i = 0; i <= 4; i++) {
    const gx = lay.mL + plotW * i / 4;
    svgEl2("line", { x1: gx, y1: lay.mT, x2: gx, y2: lay.mT + lay.plotH, class: "o-chart-grid" }, svg);
    const t = svgEl2("text", { x: gx, y: lay.mT + lay.plotH + 16, "text-anchor": "middle", class: "o-chart-tick" }, svg);
    t.textContent = String(Math.round(max * i / 4 * 100) / 100);
  }
  axisTitles(svg, data, plotW, lay);
  const pitch = lay.plotH / data.labels.length;
  const overlaid = data.barMode === "overlaid";
  const gapless = data.histogram === true;
  const rx = gapless ? 0 : 2;
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  data.labels.forEach((label, li) => {
    const rowTop = lay.mT + pitch * li;
    const cy = rowTop + pitch / 2;
    if (data.highlightIndex === li) {
      svgEl2("rect", { x: lay.mL, y: rowTop, width: plotW, height: pitch, class: "o-chart-hiband" }, g);
    }
    const nameEl = svgEl2(
      "text",
      { x: lay.mL - 8, y: cy + 3.5, "text-anchor": "end", class: "o-chart-name" + (data.highlightIndex === li ? " hi" : "") },
      g
    );
    nameEl.textContent = label;
    if (stacked) {
      const segs = stackSegments(column(data, li));
      const bandH = gapless ? pitch : Math.min(18, pitch * 0.72);
      segs.forEach((sg, si) => {
        const bw = xAt(sg.to) - xAt(sg.from);
        if (bw <= 0) return;
        svgEl2("rect", { x: xAt(sg.from), y: cy - bandH / 2, width: bw, height: bandH, fill: data.series[si].color, "data-series": si, "data-label": li }, g);
      });
      if (data.showValues) {
        const total = segs.length ? segs[segs.length - 1].to : 0;
        const t = svgEl2("text", { x: xAt(total) + 4, y: cy + 3.2, "text-anchor": "start", class: "o-chart-datalabel" }, g);
        t.textContent = String(Math.round(total * 100) / 100);
      }
    } else if (overlaid) {
      const order = data.series.map((s2, si) => ({ si, v: s2.values[li] ?? 0 })).sort((a, b) => b.v - a.v);
      const bandH = gapless ? pitch : Math.min(18, pitch * 0.72);
      order.forEach((o, rank) => {
        const s2 = data.series[o.si];
        const h = bandH * (1 - rank * 0.3);
        const bw = Math.max(1, xAt(o.v) - lay.mL);
        svgEl2(
          "rect",
          { x: lay.mL, y: cy - h / 2, width: bw, height: h, rx, fill: s2.color, class: rank > 0 ? "o-chart-inner-ring" : "", "data-series": o.si, "data-label": li },
          g
        );
      });
      if (data.showValues) {
        const top = order[0];
        const t = svgEl2("text", { x: xAt(top.v) + 4, y: cy + 3.2, "text-anchor": "start", class: "o-chart-datalabel" }, g);
        t.textContent = String(top.v);
      }
    } else {
      const n = data.series.length;
      const bh = gapless ? pitch / n : Math.min(14, pitch * 0.74 / n);
      data.series.forEach((s2, si) => {
        const v = s2.values[li] ?? 0;
        const by = cy - bh * n / 2 + bh * si;
        const bw = Math.max(1, xAt(v) - lay.mL);
        svgEl2("rect", { x: lay.mL, y: by, width: bw, height: bh, rx, fill: s2.color, "data-series": si, "data-label": li }, g);
        if (data.showValues) {
          const t = svgEl2("text", { x: lay.mL + bw + 4, y: by + bh - 1.5, "text-anchor": "start", class: "o-chart-datalabel" }, g);
          t.textContent = String(v);
        }
      });
    }
  });
}
function areaBand(svg, target, pts, base, color, si, ns) {
  if (pts.length === 0) return;
  const d = `M ${pts[0].x} ${base} ` + pts.map((p) => `L ${p.x} ${p.y}`).join(" ") + ` L ${pts[pts.length - 1].x} ${base} Z`;
  svgEl2("path", { d, fill: fillGradient(svg, color, ns), "data-series": si }, target);
}
function renderLine(svg, data, w, lay, ns) {
  const plotW = w - lay.mL - lay.mR;
  const max = data.yMax ?? niceMax(Math.max(...data.series.flatMap((s2) => s2.values)));
  axes(svg, max, plotW, lay);
  xLabels(svg, data.labels, plotW, lay);
  axisTitles(svg, data, plotW, lay);
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  const groupW = plotW / data.labels.length;
  const all = data.series.map(
    (s2) => s2.values.map((v, i) => ({
      x: lay.mL + groupW * (i + 0.5),
      y: lay.mT + lay.plotH - Math.min(v, max) / max * lay.plotH
    }))
  );
  data.series.forEach((s2, si) => {
    if (s2.fill) areaBand(svg, g, all[si], lay.mT + lay.plotH, s2.color, si, ns);
  });
  data.series.forEach((s2, si) => {
    const pts = all[si];
    const attrs = {
      points: pts.map((p) => `${p.x},${p.y}`).join(" "),
      fill: "none",
      stroke: s2.color,
      "stroke-width": 2.5,
      "stroke-linejoin": "round",
      "data-series": si
    };
    if (s2.dash) attrs["stroke-dasharray"] = "6 5";
    svgEl2("polyline", attrs, g);
    if (s2.markers !== false) {
      pts.forEach((p, i) => svgEl2("circle", { cx: p.x, cy: p.y, r: 3.5, fill: s2.color, "data-label": i }, g));
    }
    if (data.showValues) {
      pts.forEach((p, i) => {
        const t = svgEl2("text", { x: p.x, y: p.y - 6, "text-anchor": "middle", class: "o-chart-datalabel" }, g);
        t.textContent = String(s2.values[i] ?? 0);
      });
    }
  });
}
function renderSpark(svg, data, ns) {
  const vals = data.series.flatMap((s2) => s2.values);
  let lo2 = vals.length ? vals.reduce((a, b) => b < a ? b : a, Infinity) : 0;
  let hi2 = vals.length ? vals.reduce((a, b) => b > a ? b : a, -Infinity) : 1;
  if (hi2 <= lo2) {
    lo2 -= 0.5;
    hi2 += 0.5;
  }
  const x0 = SPARK_PAD;
  const x1 = SPARK_W - SPARK_PAD;
  const y0 = SPARK_H - SPARK_PAD;
  const y1 = SPARK_PAD;
  const g = svgEl2("g", { class: "o-chart-marks" }, svg);
  data.series.forEach((s2, si) => {
    const n = s2.values.length;
    const pts = s2.values.map((v, i) => ({
      x: n > 1 ? x0 + (x1 - x0) * i / (n - 1) : (x0 + x1) / 2,
      y: y0 - (v - lo2) / (hi2 - lo2) * (y0 - y1)
    }));
    if (s2.fill) areaBand(svg, g, pts, y0, s2.color, si, ns);
    const attrs = {
      points: pts.map((p) => `${p.x},${p.y}`).join(" "),
      fill: "none",
      stroke: s2.color,
      "stroke-width": 2,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
      "data-series": si
    };
    if (s2.dash) attrs["stroke-dasharray"] = "6 5";
    svgEl2("polyline", attrs, g);
  });
}
function renderTimeseries(svg, data, w, lay) {
  const plotW = w - lay.mL - lay.mR;
  const xsAll = data.series.flatMap((s2) => s2.xs ?? []);
  const ysAll = data.series.flatMap((s2) => s2.values);
  const xMin = xsAll.length ? xsAll.reduce((a, b) => b < a ? b : a, Infinity) : 0;
  const xMax = xsAll.length ? xsAll.reduce((a, b) => b > a ? b : a, -Infinity) : 1;
  const xSpan = xMax - xMin || 1;
  const max = data.yMax ?? niceMax(ysAll.length ? ysAll.reduce((a, b) => b > a ? b : a, 0) : 1);
  const xAt = (x) => lay.mL + (x - xMin) / xSpan * plotW;
  const yAt = (y) => lay.mT + lay.plotH - Math.min(y, max) / max * lay.plotH;
  for (let i = 0; i <= 4; i++) {
    const gy = lay.mT + lay.plotH * i / 4;
    svgEl2("line", { x1: lay.mL, y1: gy, x2: lay.mL + plotW, y2: gy, class: "o-chart-grid" }, svg);
    const lbl = svgEl2("text", { x: lay.mL - 6, y: gy + 4, "text-anchor": "end", class: "o-chart-tick" }, svg);
    lbl.textContent = String(Math.round(max * (1 - i / 4) * 100) / 100);
  }
  for (let i = 0; i <= 5; i++) {
    const xv = xMin + xSpan * i / 5;
    const gx = xAt(xv);
    svgEl2("line", { x1: gx, y1: lay.mT, x2: gx, y2: lay.mT + lay.plotH, class: "o-chart-grid" }, svg);
    const t = svgEl2("text", { x: gx, y: lay.mT + lay.plotH + 16, "text-anchor": "middle", class: "o-chart-tick" }, svg);
    t.textContent = String(Math.round(xv * 100) / 100);
  }
  axisTitles(svg, data, plotW, lay);
  const g = svgEl2("g", { class: "ts-series" }, svg);
  data.series.forEach((s2, si) => {
    const xs = s2.xs ?? [];
    if (xs.length < 1) return;
    const pts = xs.map((x, i) => ({ x: xAt(x), y: yAt(s2.values[i] ?? 0) }));
    const attrs = {
      points: pts.map((p) => `${p.x},${p.y}`).join(" "),
      fill: "none",
      stroke: s2.color,
      "stroke-width": 2.5,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
      "data-series": si
    };
    if (s2.dash) attrs["stroke-dasharray"] = "6 5";
    svgEl2("polyline", attrs, g);
    if (s2.markers === true) {
      pts.forEach((p, i) => svgEl2("circle", { cx: p.x, cy: p.y, r: 3, fill: s2.color, "data-label": i }, g));
    }
  });
}
function renderChart(figure, data, forPrint = false) {
  const mount = figure.querySelector("[data-chart-mount]");
  if (!mount) return;
  mount.textContent = "";
  const ns = forPrint ? "p" : "";
  if (data.spark && data.type === "line") {
    const sp = document.createElementNS(SVG_NS, "svg");
    sp.setAttribute("viewBox", `0 0 ${SPARK_W} ${SPARK_H}`);
    sp.setAttribute("role", "img");
    sp.style.maxWidth = `${SPARK_W}px`;
    mount.appendChild(sp);
    renderSpark(sp, data, ns);
    return;
  }
  const lay = layout(data);
  const w = viewWidth(data, lay);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${lay.chartH}`);
  svg.setAttribute("role", "img");
  svg.style.maxWidth = `${w}px`;
  mount.appendChild(svg);
  const fig = figure;
  if (typeof data.textColor === "string") mount.style.setProperty("--chart-ink", data.textColor);
  else mount.style.removeProperty("--chart-ink");
  const fontStack = data.textFont ? CHART_FONT_STACK[data.textFont] : void 0;
  if (fontStack) {
    mount.style.setProperty("--chart-font", fontStack);
    fig.style.setProperty("--chart-font", fontStack);
  } else {
    mount.style.removeProperty("--chart-font");
    fig.style.removeProperty("--chart-font");
  }
  if (typeof data.textScale === "number") {
    const scale = Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, data.textScale));
    mount.style.setProperty("--chart-tsz", String(scale));
  } else {
    mount.style.removeProperty("--chart-tsz");
  }
  if (data.title) {
    const t = svgEl2("text", { x: w / 2, y: 22, "text-anchor": "middle", class: "o-chart-title" }, svg);
    t.textContent = data.title;
  }
  if (data.subtitle) {
    const st = svgEl2("text", { x: w / 2, y: data.title ? 38 : 24, "text-anchor": "middle", class: "o-chart-sub" }, svg);
    st.textContent = data.subtitle;
  }
  if (data.type === "bar") (data.funnel ? renderFunnel : data.polar ? renderRadialBar : lay.horizontal ? renderBarH : renderBar)(svg, data, w, lay);
  else if (data.type === "line") (data.stream ? renderStream : renderLine)(svg, data, w, lay, ns);
  else if (data.type === "timeseries") renderTimeseries(svg, data, w, lay);
  else if (data.type === "scatter") (data.hexbin ? renderHexbin : renderScatter)(svg, data, w, lay);
  else if (data.type === "heatmap") renderHeatmap(svg, data, w, lay);
  else if (data.type === "treemap") renderTreemap(svg, data, w, lay);
  else if (data.type === "sankey") renderSankey(svg, data, w, lay);
  else if (data.type === "waterfall") renderWaterfall(svg, data, w, lay);
  else if (data.type === "boxplot") renderBox(svg, data, w, lay);
  else if (data.type === "radar") renderRadar(svg, data, w, lay);
  else if (data.type === "gauge") renderGauge(svg, data, w, lay);
  else renderPie(svg, data, w, lay);
  if (data.legend === false) return;
  const legend = document.createElement("div");
  legend.className = "o-chart-legend";
  mount.appendChild(legend);
  const byCategory = data.type === "pie" || data.funnel === true || data.polar === true;
  const entries = data.type === "gauge" || data.type === "heatmap" || data.type === "sankey" || data.hexbin === true ? [] : data.type === "treemap" ? treemapLegend(data) : byCategory ? data.labels.map((l, i) => ({ label: l, color: sliceColor(data, i) })) : data.type === "waterfall" ? waterfallLegend(data) : data.series.map((s2) => ({ label: s2.name, color: s2.color })).concat(data.pareto ? [{ label: PARETO_LEGEND, color: paretoColor(data) }] : []);
  for (const e of entries) {
    const sw = document.createElement("span");
    sw.className = "o-chart-swatch";
    const dot = document.createElement("span");
    dot.className = "sw";
    dot.style.background = e.color;
    sw.appendChild(dot);
    sw.appendChild(document.createTextNode(" " + e.label));
    legend.appendChild(sw);
  }
}
function parseChartFigureData(figure) {
  const block = figure.querySelector('script[data-odata="chart"]');
  if (!block?.textContent) return null;
  try {
    return normalizeChartData(JSON.parse(block.textContent));
  } catch {
    return null;
  }
}
function mountCharts(slide, forPrint = false) {
  slide.querySelectorAll('script[data-odata="chart"]').forEach((block) => {
    const figure = block.closest(".o-chartfig") ?? block.parentElement;
    if (!figure) return;
    const data = parseChartFigureData(figure);
    const mount = figure.querySelector("[data-chart-mount]");
    if (!mount) return;
    if (!data) {
      mount.textContent = "";
      const err = document.createElement("div");
      err.className = "o-chart-error";
      err.textContent = "This chart\u2019s data block is invalid \u2014 open the deck in Origami Folio to repair it.";
      mount.appendChild(err);
      return;
    }
    renderChart(figure, data, forPrint);
  });
}

// src/video.ts
function normalizeVideoData(raw) {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const provider = VIDEO_PROVIDERS.includes(d.provider) ? d.provider : "link";
  return {
    provider,
    videoId: typeof d.videoId === "string" ? d.videoId : "",
    url: typeof d.url === "string" ? d.url : "",
    title: typeof d.title === "string" ? d.title : ""
  };
}
var span = (cls, text, parent) => {
  const s2 = document.createElement("span");
  s2.className = cls;
  s2.textContent = text;
  parent.appendChild(s2);
  return s2;
};
function buildVideoIframe(data, embedUrl) {
  const f = document.createElement("iframe");
  f.className = "o-vd-frame";
  f.src = embedUrl;
  f.title = data.title || "Video";
  f.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture");
  f.setAttribute("allowfullscreen", "");
  f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-popups");
  return f;
}
function renderVideo(figure, data, opts = {}) {
  const mount = figure.querySelector("[data-video-mount]");
  if (!mount) return;
  mount.textContent = "";
  const interactive = opts.interactive ?? false;
  const embedUrl = videoEmbedUrl(data);
  const cap2 = videoCapability(data.provider);
  const declared = embedUrl !== null && cap2 !== null && (opts.capabilities ?? []).includes(cap2);
  const spec = data.provider !== "link" ? VIDEO_PROVIDER_SPECS[data.provider] : null;
  const referrerBlocked = declared && !!spec?.needsReferrer && !!opts.referrerless;
  const canEmbed = declared && !referrerBlocked;
  if (canEmbed && spec) {
    const card2 = document.createElement("div");
    card2.className = "o-vd o-vd-play";
    span("o-vd-badge", spec.label, card2);
    span("o-vd-btn", "\u25B6", card2);
    span("o-vd-title", data.title || "Untitled video", card2);
    span("o-vd-hint", `Click to play \u2014 loads from ${spec.host}`, card2);
    if (interactive) {
      card2.setAttribute("role", "button");
      card2.setAttribute("tabindex", "0");
      card2.setAttribute("aria-label", `Play video: ${data.title || "untitled"}`);
      const play = () => {
        mount.textContent = "";
        mount.appendChild(buildVideoIframe(data, embedUrl));
      };
      card2.addEventListener("click", play);
      card2.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          play();
        }
      });
    }
    mount.appendChild(card2);
    return;
  }
  if (!data.url) {
    const card2 = document.createElement("div");
    card2.className = "o-vd o-vd-empty";
    span("o-vd-btn", "\u25B6", card2);
    span("o-vd-title", data.title || "No video link set", card2);
    span("o-vd-hint", "Open in Origami Folio to add one", card2);
    mount.appendChild(card2);
    return;
  }
  const card = document.createElement(interactive ? "a" : "div");
  card.className = "o-vd o-vd-link";
  if (interactive) {
    card.href = data.url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
  }
  span("o-vd-btn", "\u25B6", card);
  const meta = document.createElement("span");
  meta.className = "o-vd-meta";
  card.appendChild(meta);
  span("o-vd-title", data.title || "Watch video", meta);
  span("o-vd-url", data.url, meta);
  if (referrerBlocked) span("o-vd-note", "To play it here, serve the deck from your own machine \u2014 Origami Folio\u2019s Go Live does that.", meta);
  span(
    "o-vd-hint",
    referrerBlocked && spec ? `${spec.label} can\u2019t play inside a local file \u2014 opens in a browser tab` : "Opens in a browser tab",
    card
  );
  mount.appendChild(card);
}
function parseVideoFigureData(figure) {
  const block = figure.querySelector('script[data-odata="video"]');
  if (!block?.textContent) return null;
  try {
    return normalizeVideoData(JSON.parse(block.textContent));
  } catch {
    return null;
  }
}
function mountVideos(slide, opts = {}) {
  slide.querySelectorAll('script[data-odata="video"]').forEach((block) => {
    const figure = block.closest(".o-videofig") ?? block.parentElement;
    if (!figure) return;
    const mount = figure.querySelector("[data-video-mount]");
    if (!mount) return;
    const data = parseVideoFigureData(figure);
    if (!data) {
      mount.textContent = "";
      const err = document.createElement("div");
      err.className = "o-video-error";
      err.textContent = "This video\u2019s data block is invalid \u2014 open the deck in Origami Folio to repair it.";
      mount.appendChild(err);
      return;
    }
    renderVideo(figure, data, opts);
  });
}

// src/table.ts
var el2 = (tag, className, parent) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  parent?.appendChild(e);
  return e;
};
var isMap = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var FORMAT_KINDS = /* @__PURE__ */ new Set(["general", "number", "currency", "percent", "date", "text"]);
function cleanFormat(raw) {
  if (!isMap(raw) || typeof raw.kind !== "string" || !FORMAT_KINDS.has(raw.kind)) return void 0;
  const f = { kind: raw.kind };
  if (typeof raw.decimals === "number" && Number.isInteger(raw.decimals) && raw.decimals >= 0 && raw.decimals <= 10) f.decimals = raw.decimals;
  if (raw.sep === "." || raw.sep === ",") f.sep = raw.sep;
  if (typeof raw.thou === "boolean") f.thou = raw.thou;
  if (typeof raw.currency === "string" && raw.currency.length <= 8) f.currency = raw.currency;
  if (typeof raw.dateFmt === "string" && raw.dateFmt.length <= 32) f.dateFmt = raw.dateFmt;
  return f;
}
function cleanStyle(raw) {
  if (!isMap(raw)) return void 0;
  const s2 = {};
  if (raw.b === 1) s2.b = 1;
  if (raw.i === 1) s2.i = 1;
  if (raw.u === 1) s2.u = 1;
  if (raw.s === 1) s2.s = 1;
  if (raw.align === "left" || raw.align === "center" || raw.align === "right") s2.align = raw.align;
  if (typeof raw.fill === "string" && (FILL_TOKEN.test(raw.fill) || FILL_HEX.test(raw.fill))) s2.fill = raw.fill;
  if (raw.wrap === true) s2.wrap = true;
  if (typeof raw.color === "string" && (FILL_TOKEN.test(raw.color) || FILL_HEX.test(raw.color))) s2.color = raw.color;
  if (typeof raw.indent === "number" && Number.isInteger(raw.indent) && raw.indent >= 0 && raw.indent <= 15) s2.indent = raw.indent;
  if (raw.orient === "up" || raw.orient === "down" || raw.orient === "stack") s2.orient = raw.orient;
  else if (typeof raw.orient === "number" && Number.isInteger(raw.orient) && raw.orient >= -90 && raw.orient <= 90 && raw.orient !== 0) s2.orient = raw.orient;
  return Object.keys(s2).length ? s2 : void 0;
}
var COND_KINDS = /* @__PURE__ */ new Set(["dupes", "gt", "lt", "eq", "top", "bot", "scale"]);
var okColour = (x) => typeof x === "string" && (FILL_TOKEN.test(x) || FILL_HEX.test(x));
function cleanCondRule(raw) {
  if (!isMap(raw)) return void 0;
  if (typeof raw.range !== "string" || !a1RangeToRect(raw.range)) return void 0;
  const kind = raw.kind;
  if (typeof kind !== "string" || !COND_KINDS.has(kind)) return void 0;
  const rule = { range: raw.range, kind };
  const fill = okColour(raw.fill) ? raw.fill : void 0;
  const color = okColour(raw.color) ? raw.color : void 0;
  if (kind === "scale") {
    if (!(typeof raw.from === "string" && FILL_HEX.test(raw.from)) || !(typeof raw.to === "string" && FILL_HEX.test(raw.to))) return void 0;
    rule.from = raw.from;
    rule.to = raw.to;
    return rule;
  }
  if (!fill && !color) return void 0;
  if (fill) rule.fill = fill;
  if (color) rule.color = color;
  if (kind === "gt" || kind === "lt") {
    if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) return void 0;
    rule.value = raw.value;
  } else if (kind === "eq") {
    if (typeof raw.text !== "string" || raw.text.trim() === "") return void 0;
    rule.text = raw.text;
  } else if (kind === "top" || kind === "bot") {
    if (typeof raw.n !== "number" || !Number.isInteger(raw.n) || raw.n < 1) return void 0;
    rule.n = raw.n;
  }
  return rule;
}
function cleanCondFmt(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    const c = cleanCondRule(r);
    if (c) out.push(c);
  }
  return out;
}
function cleanA1Map(raw, clean) {
  const out = {};
  if (isMap(raw)) for (const [k, v] of Object.entries(raw)) {
    const c = clean(v);
    if (c !== void 0) out[k] = c;
  }
  return out;
}
function readLedger(raw) {
  if (!isMap(raw)) return null;
  const columns = (Array.isArray(raw.columns) ? raw.columns : []).map((c) => {
    const o = isMap(c) ? c : {};
    const col = { label: typeof o.label === "string" ? o.label : "" };
    if (o.align === "left" || o.align === "right" || o.align === "center") col.align = o.align;
    const cf = cleanFormat(o.format);
    if (cf) col.format = cf;
    if (typeof o.width === "number" && o.width > 0) col.width = o.width;
    return col;
  });
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).map(
    (r) => (Array.isArray(r) ? r : []).map((v) => typeof v === "string" ? v : v == null ? "" : String(v))
  );
  const kpis = (Array.isArray(raw.kpis) ? raw.kpis : []).filter(isMap).map((k) => {
    const pin = { name: typeof k.name === "string" ? k.name : "", ref: typeof k.ref === "string" ? k.ref : "" };
    if (typeof k.value === "string") pin.value = k.value;
    return pin;
  }).filter((k) => k.ref !== "");
  const led = {
    columns,
    rows,
    cellFormats: cleanA1Map(raw.cellFormats, cleanFormat),
    cellStyles: cleanA1Map(raw.cellStyles, cleanStyle),
    cellNames: isMap(raw.cellNames) ? raw.cellNames : {},
    rowHeights: isMap(raw.rowHeights) ? raw.rowHeights : {},
    totals: isMap(raw.totals) ? raw.totals : void 0,
    kpis,
    orefreshed: typeof raw.orefreshed === "string" ? raw.orefreshed : void 0,
    merges: Array.isArray(raw.merges) ? raw.merges.filter((m) => typeof m === "string") : [],
    condFmt: cleanCondFmt(raw.condFmt)
  };
  const rect = bakeRectOf(raw.bake, led.rows.length, gridWidth(led));
  if (rect) led.bakeRect = rect;
  const vinfo = readViews(raw.bake, led.rows.length, gridWidth(led));
  if (vinfo) {
    led.views = vinfo.views;
    led.activeView = vinfo.active;
  }
  const f = raw.filter;
  if (isMap(f) && typeof f.row === "number" && Number.isInteger(f.row) && f.row >= 0 && f.row < led.rows.length && Array.isArray(f.cols)) {
    const nc = Math.max(gridWidth(led), 0);
    const cols = [];
    for (const c of f.cols) if (typeof c === "number" && Number.isInteger(c) && c >= 0 && c < nc && !cols.includes(c)) cols.push(c);
    if (cols.length) led.filter = { row: f.row, cols };
  }
  return led;
}
function displayedBakeRect(bake) {
  if (!isMap(bake.rect)) return null;
  const views = bake.views;
  if (Array.isArray(views) && views.length) {
    const active = typeof bake.active === "string" ? bake.active : null;
    const chosen = (active != null ? views.find((v) => isMap(v) && v.name === active) : void 0) ?? views[0];
    if (isMap(chosen) && isMap(chosen.rect)) return chosen.rect;
  }
  return isMap(bake.rect) ? bake.rect : null;
}
function rectInGrid(r, nr, nc) {
  if (!r) return null;
  const int = (x) => typeof x === "number" && Number.isInteger(x) && x >= 0;
  if (!["r0", "c0", "r1", "c1"].every((k) => int(r[k]))) return null;
  const r0 = r.r0, c0 = r.c0, r1 = r.r1, c1 = r.c1;
  if (r0 > r1 || c0 > c1 || r1 >= nr || c1 >= nc) return null;
  return { r0, c0, r1, c1 };
}
function bakeRectOf(bake, nr, nc) {
  return isMap(bake) ? rectInGrid(displayedBakeRect(bake), nr, nc) : null;
}
function readViews(bake, nr, nc) {
  if (!isMap(bake) || !isMap(bake.rect) || !Array.isArray(bake.views)) return null;
  const views = [];
  for (const v of bake.views) {
    if (!isMap(v) || typeof v.name !== "string" || !v.name) continue;
    const rect = rectInGrid(isMap(v.rect) ? v.rect : null, nr, nc);
    if (rect) views.push({ name: v.name, rect });
  }
  if (views.length < 2) return null;
  const active = typeof bake.active === "string" && views.some((v) => v.name === bake.active) ? bake.active : views[0].name;
  return { views, active };
}
function parseTableSlideData(slide) {
  const block = slide.querySelector('script[data-odata="table"]');
  if (!block?.textContent) return null;
  try {
    return readLedger(JSON.parse(block.textContent));
  } catch {
    return null;
  }
}
function shownSheetIndices(sheets, activeIndex) {
  const out = [];
  for (let i = 0; i < sheets.length; i++) {
    const s2 = sheets[i];
    const hidden = isMap(s2) && s2.hidden === true;
    const baked = isMap(s2) && isMap(s2.bake) && isMap(s2.bake.rect);
    if (!hidden || baked) out.push(i);
  }
  if (!out.length) out.push(Math.min(Math.max(activeIndex, 0), Math.max(sheets.length - 1, 0)));
  return out;
}
function parseTableDoc(slide) {
  const block = slide.querySelector('script[data-odata="table"]');
  if (!block?.textContent) return null;
  let raw;
  try {
    raw = JSON.parse(block.textContent);
  } catch {
    return null;
  }
  if (!isMap(raw)) return null;
  const tabs = Array.isArray(raw.tabs) ? raw.tabs : [];
  const strip = tabs.map((t) => ({
    name: isMap(t) && typeof t.name === "string" ? t.name : "",
    raw: isMap(t) ? t.data : null
  }));
  const pos = Math.min(Math.max(typeof raw.tabPos === "number" ? raw.tabPos : 0, 0), strip.length);
  strip.splice(pos, 0, { name: typeof raw.tabName === "string" ? raw.tabName : "", raw });
  const sheets = [];
  let active = 0;
  for (const i of shownSheetIndices(strip.map((s2) => s2.raw), pos)) {
    const led = readLedger(strip[i].raw);
    if (!led) continue;
    if (i === pos) active = sheets.length;
    sheets.push({ name: strip[i].name, led });
  }
  if (!sheets.length) {
    const led = readLedger(raw);
    return led ? { sheets: [{ name: "", led }], active: 0 } : null;
  }
  return { sheets, active };
}
function colIsNumeric(led, c) {
  let num2 = 0, tot = 0;
  for (const row of led.rows) {
    const v = (row[c] ?? "").trim();
    if (v === "") continue;
    tot++;
    if (isNumeric(v)) num2++;
  }
  return tot > 0 && num2 * 2 >= tot;
}
var filterPop = null;
var filterPopDown = null;
var filterPopKey = null;
function closeFilterPop() {
  if (!filterPop) return;
  filterPop.remove();
  filterPop = null;
  if (filterPopDown) document.removeEventListener("mousedown", filterPopDown, true);
  if (filterPopKey) document.removeEventListener("keydown", filterPopKey, true);
  filterPopDown = null;
  filterPopKey = null;
}
function openFilterPop(anchor, f, onChange) {
  closeFilterPop();
  const pop = el2("div", "lv-filterpop");
  filterPop = pop;
  const search = f.values.length > 12 ? el2("input", "lv-filter-search", pop) : null;
  if (search) {
    search.type = "text";
    search.placeholder = "Search values\u2026";
  }
  const acts = el2("div", "lv-filter-acts", pop);
  const allBtn = el2("button", "lv-filter-act", acts);
  allBtn.type = "button";
  allBtn.textContent = "Select all";
  const clrBtn = el2("button", "lv-filter-act", acts);
  clrBtn.type = "button";
  clrBtn.textContent = "Clear";
  const list = el2("div", "lv-filter-list", pop);
  const items = [];
  for (const v of f.values) {
    const row = el2("label", "lv-filter-item", list);
    const cb = el2("input", "", row);
    cb.type = "checkbox";
    cb.checked = f.allowed.has(v);
    el2("span", "lv-filter-vlabel", row).textContent = v === "" ? "(blank)" : v;
    cb.addEventListener("change", () => {
      if (cb.checked) f.allowed.add(v);
      else f.allowed.delete(v);
      onChange();
    });
    items.push({ row, cb, v });
  }
  allBtn.addEventListener("click", () => {
    for (const it of items) {
      it.cb.checked = true;
      f.allowed.add(it.v);
    }
    onChange();
  });
  clrBtn.addEventListener("click", () => {
    for (const it of items) it.cb.checked = false;
    f.allowed.clear();
    onChange();
  });
  if (search) search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    for (const it of items) it.row.style.display = (it.v === "" ? "(blank)" : it.v).toLowerCase().includes(q) ? "" : "none";
  });
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 40) + "px";
  pop.style.left = Math.max(8, Math.min(r.left - 40, window.innerWidth - 250)) + "px";
  filterPopDown = (e) => {
    const t = e.target;
    if (filterPop && !filterPop.contains(t) && t !== anchor && !anchor.contains(t)) closeFilterPop();
  };
  filterPopKey = (e) => {
    if (!filterPop) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      closeFilterPop();
      return;
    }
    if (filterPop.contains(e.target)) e.stopPropagation();
  };
  setTimeout(() => {
    document.addEventListener("mousedown", filterPopDown, true);
    document.addEventListener("keydown", filterPopKey, true);
  }, 0);
  search?.focus();
}
function renderTable(slide, led, doc) {
  const mount = slide.querySelector("[data-table-mount]");
  if (!mount) return;
  closeFilterPop();
  mount.textContent = "";
  const fullNc = Math.max(1, gridWidth(led));
  const fullNr = led.rows.length;
  const rect = led.bakeRect;
  const r0 = rect ? rect.r0 : 0, r1 = rect ? rect.r1 : fullNr - 1;
  const c0 = rect ? rect.c0 : 0, c1 = rect ? rect.c1 : fullNc - 1;
  const allMerges = mergeRects(led.merges);
  const merges = rect ? clipMergesToCrop(allMerges, r0, c0, r1, c1) : allMerges;
  const overlays = led.condFmt.length ? evaluateCondFmt(led.rows, led.condFmt, allMerges) : null;
  const root = el2("div", "o-ledger", mount);
  const card = el2("div", "lv", root);
  if (doc && doc.sheets.length >= 2) buildTabPills(slide, doc, card);
  if (led.views && led.views.length >= 2) buildViewPills(slide, led, card, doc);
  if (led.kpis.length) buildKpis(led, card);
  if (led.orefreshed) el2("div", "lv-asof", card).textContent = "as of " + led.orefreshed.slice(0, 10);
  const wrap = el2("div", "lv-wrap", card);
  const table = el2("table", "lv-table", wrap);
  const colgroup = document.createElement("colgroup");
  for (let c = c0; c <= c1; c++) {
    const col = document.createElement("col");
    const w = led.columns[c]?.width;
    if (w && Number.isFinite(w)) col.style.width = w + "px";
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);
  const thead = el2("thead", "", table);
  const hr = el2("tr", "", thead);
  const funnelBtns = /* @__PURE__ */ new Map();
  let openColFilter;
  for (let c = c0; c <= c1; c++) {
    const align = led.columns[c]?.align ?? (colIsNumeric(led, c) ? "right" : "left");
    const th = el2("th", "lv-h a-" + align, hr);
    th.textContent = led.columns[c]?.label ?? "";
  }
  const filter = led.filter;
  const filterRow = filter && filter.row >= r0 && filter.row <= r1 ? filter.row : -1;
  const filterColSet = new Set(filterRow >= 0 ? filter.cols.filter((c) => c >= c0 && c <= c1) : []);
  const tbody = el2("tbody", "", table);
  const bodyRows = [];
  if (fullNr === 0 || r1 < r0) {
    const tr = el2("tr", "", tbody);
    const td = el2("td", "lv-empty", tr);
    td.setAttribute("colspan", String(c1 - c0 + 1));
    td.textContent = "No rows.";
  } else {
    for (let r = r0; r <= r1; r++) {
      const tr = el2("tr", "", tbody);
      bodyRows.push({ tr, r });
      const h = led.rowHeights[String(r)];
      if (typeof h === "number" && h > 0) tr.style.height = h + "px";
      for (let c = c0; c <= c1; c++) {
        const m = merges.length ? mergeAt(merges, r, c) : null;
        if (m && !(m.r0 === r && m.c0 === c)) continue;
        const span2 = m ? { rowspan: m.r1 - m.r0 + 1, colspan: m.c1 - m.c0 + 1 } : null;
        const td = renderCell(led, tr, r, c, span2, overlays?.get(a1(r, c)));
        if (r === filterRow && filterColSet.has(c)) {
          const b = el2("button", "lv-funnel", td);
          b.type = "button";
          b.setAttribute("aria-label", "Filter the rows below");
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            openColFilter?.(c, b);
          });
          funnelBtns.set(c, b);
        }
      }
    }
  }
  let totHint = null;
  if (led.totals?.on && !rect) {
    buildFooter(led, table, fullNc);
    totHint = el2("div", "lv-tothint", card);
    totHint.textContent = "\u03A3 totals reflect all rows";
    totHint.style.display = "none";
  }
  if (funnelBtns.size) {
    const dispAt = (r, c) => {
      const baked = led.rows[r]?.[c] ?? "";
      return baked === "" ? "" : formatCell(baked, fmtAt(led, r, c));
    };
    const belowRows = bodyRows.filter((br) => br.r > filterRow);
    const filters = /* @__PURE__ */ new Map();
    for (const c of funnelBtns.keys()) {
      const disp = /* @__PURE__ */ new Map();
      const seen = /* @__PURE__ */ new Set();
      for (const { r } of belowRows) {
        const v = dispAt(r, c);
        disp.set(r, v);
        seen.add(v);
      }
      filters.set(c, { allowed: new Set(seen), values: [...seen], disp });
    }
    const applyFilters = () => {
      for (const { tr, r } of belowRows) {
        let show = true;
        for (const f of filters.values()) {
          if (!f.allowed.has(f.disp.get(r) ?? "")) {
            show = false;
            break;
          }
        }
        tr.style.display = show ? "" : "none";
      }
      let anyActive = false;
      for (const [c, f] of filters) {
        const active = f.allowed.size < f.values.length;
        funnelBtns.get(c)?.classList.toggle("on", active);
        if (active) anyActive = true;
      }
      if (totHint) totHint.style.display = anyActive ? "" : "none";
    };
    openColFilter = (c, anchor) => {
      const f = filters.get(c);
      if (f) openFilterPop(anchor, f, applyFilters);
    };
  }
}
function renderCell(led, tr, r, c, span2, overlay) {
  const baked = led.rows[r]?.[c] ?? "";
  const fmt = fmtAt(led, r, c);
  const td = el2("td", "cell", tr);
  if (span2 && (span2.rowspan > 1 || span2.colspan > 1)) {
    td.setAttribute("colspan", String(span2.colspan));
    td.setAttribute("rowspan", String(span2.rowspan));
    td.classList.add("merged");
  }
  el2("span", "v", td).textContent = baked === "" ? "" : formatCell(baked, fmt);
  if (baked !== "" && isNumeric(baked)) td.classList.add("num");
  if (baked !== "" && isErrStr(baked)) td.classList.add("err");
  const style = led.cellStyles[a1(r, c)];
  if (style) {
    if (style.b) td.classList.add("bold");
    if (style.i) td.classList.add("italic");
    if (style.u) td.classList.add("underline");
    if (style.s) td.classList.add("strike");
    if (style.align) td.classList.add("al-" + style.align);
    if (typeof style.fill === "string") {
      if (FILL_TOKEN.test(style.fill)) td.classList.add(style.fill);
      else if (FILL_HEX.test(style.fill)) td.style.background = style.fill;
    }
    if (style.wrap) td.classList.add("wrap");
    if (typeof style.color === "string") {
      if (FILL_TOKEN.test(style.color)) td.classList.add("clr-" + style.color);
      else if (FILL_HEX.test(style.color)) td.style.color = style.color;
    }
    if (typeof style.indent === "number" && style.indent > 0) {
      td.classList.add("indent");
      td.style.setProperty("--ind", String(style.indent));
    }
    if (style.orient) {
      if (typeof style.orient === "number") {
        td.classList.add("orient-rot");
        td.style.setProperty("--orient-deg", style.orient + "deg");
      } else td.classList.add("orient-" + style.orient);
    }
  }
  if (overlay) applyCondOverlay(td, overlay, typeof style?.fill === "string", typeof style?.color === "string");
  if (baked !== "" && !isErrStr(baked) && fmt && (fmt.kind === "currency" || fmt.kind === "percent" || fmt.kind === "date")) {
    td.classList.add("v-" + formatTone(fmt));
  }
  return td;
}
function applyCondOverlay(td, overlay, userFill, userColor) {
  if (overlay.fill && !userFill) {
    if (FILL_TOKEN.test(overlay.fill)) td.classList.add(overlay.fill);
    else if (FILL_HEX.test(overlay.fill)) td.style.background = overlay.fill;
  }
  if (overlay.color && !userColor) {
    if (FILL_TOKEN.test(overlay.color)) td.classList.add("clr-" + overlay.color);
    else if (FILL_HEX.test(overlay.color)) td.style.color = overlay.color;
  }
}
function aggregate(led, c) {
  const fn = led.totals?.fns?.[String(c)] ?? "SUM";
  const nums = [];
  for (const row of led.rows) {
    const v = row[c] ?? "";
    if (isNumeric(v)) nums.push(Number(v));
  }
  return aggregateNumbers(fn, nums);
}
function buildFooter(led, table, nc) {
  const tfoot = el2("tfoot", "", table);
  const tr = el2("tr", "", tfoot);
  for (let c = 0; c < nc; c++) {
    const td = el2("td", "aggc lv-agg", tr);
    const agg = aggregate(led, c);
    if (agg) {
      el2("span", "fn", td).textContent = agg.fn;
      el2("span", "v", td).textContent = agg.fn === "COUNT" ? agg.text : formatCell(agg.text, led.columns[c]?.format);
    } else {
      el2("span", "v", td);
    }
  }
}
function resolveKpiRC(led, ref) {
  const rc = a1ToRC(ref);
  if (rc) return rc;
  for (const [addr, name] of Object.entries(led.cellNames)) if (name === ref) return a1ToRC(addr);
  return null;
}
function buildViewPills(slide, led, card, doc) {
  const strip = el2("div", "lv-views", card);
  el2("span", "lv-views-lead", strip).textContent = "Views";
  for (const v of led.views) {
    const pill = el2("button", "lv-view", strip);
    pill.type = "button";
    pill.textContent = v.name;
    if (v.name === led.activeView) pill.classList.add("on");
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      if (v.name === led.activeView) return;
      led.activeView = v.name;
      led.bakeRect = { ...v.rect };
      renderTable(slide, led, doc);
    });
  }
}
function buildTabPills(slide, doc, card) {
  const strip = el2("div", "lv-tabs", card);
  doc.sheets.forEach((sh, i) => {
    const pill = el2("button", "lv-tab", strip);
    pill.type = "button";
    pill.textContent = sh.name;
    if (i === doc.active) pill.classList.add("on");
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      if (i === doc.active) return;
      doc.active = i;
      renderTable(slide, doc.sheets[i].led, doc);
    });
  });
}
function buildKpis(led, card) {
  const strip = el2("div", "kpis has-kpis", card);
  el2("span", "kpi-lead", strip).textContent = "Metrics";
  for (const pin of led.kpis) {
    const kp = el2("div", "kpi", strip);
    if (pin.value != null) {
      el2("div", "k-name", kp).textContent = pin.name;
      const val2 = el2("div", "k-val", kp);
      val2.textContent = pin.value;
      if (pin.value !== "" && isErrStr(pin.value)) val2.classList.add("err");
      continue;
    }
    const rc = resolveKpiRC(led, pin.ref);
    el2("div", "k-name", kp).textContent = rc && led.cellNames[a1(rc.r, rc.c)] || pin.name;
    const val = el2("div", "k-val", kp);
    if (rc) {
      const baked = led.rows[rc.r]?.[rc.c] ?? "";
      val.textContent = baked === "" ? "\u2014" : formatCell(baked, fmtAt(led, rc.r, rc.c));
      if (baked !== "" && isErrStr(baked)) val.classList.add("err");
    } else {
      val.textContent = "#REF!";
      val.classList.add("err");
    }
  }
}
function renderTableError(slide) {
  const mount = slide.querySelector("[data-table-mount]");
  if (!mount) return;
  mount.textContent = "";
  el2("div", "o-table-error", mount).textContent = "This table\u2019s data block is missing or invalid \u2014 open the deck in Origami Folio to repair it.";
}
function tableContainerOf(block) {
  return block.closest("figure, .o-table-shell") ?? block.parentElement;
}
function mountTables(slide) {
  slide.querySelectorAll('script[data-odata="table"]').forEach((block) => {
    const root = tableContainerOf(block);
    if (!root) return;
    const doc = parseTableDoc(root);
    if (!doc) return renderTableError(root);
    renderTable(root, doc.sheets[doc.active].led, doc.sheets.length >= 2 ? doc : void 0);
  });
}
var finalizeTables = mountTables;

// src/grid.ts
var ALIGNS = /* @__PURE__ */ new Set(["left", "right", "center"]);
var TONES = /* @__PURE__ */ new Set(["", "accent", "green", "amber", "red"]);
function normalizeGridData(raw) {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const cols = (Array.isArray(d.columns) ? d.columns : []).map((c) => {
    const o = c ?? {};
    const col = { label: typeof o.label === "string" ? o.label : "" };
    if (ALIGNS.has(o.align)) col.align = o.align;
    const tone2 = normalizeTone(o.tone);
    if (tone2) col.tone = tone2;
    return col;
  });
  const rows = (Array.isArray(d.rows) ? d.rows : []).map(
    (r) => (Array.isArray(r) ? r : []).map((cell) => typeof cell === "string" ? cell : cell == null ? "" : String(cell))
  );
  return { columns: cols.length ? cols : [{ label: "Column" }], rows };
}
function normalizeTone(t) {
  if (!t || typeof t !== "object") return void 0;
  const o = t;
  if (o.type === "status" && o.map && typeof o.map === "object" && !Array.isArray(o.map)) {
    const map = {};
    for (const [k, v] of Object.entries(o.map)) if (TONES.has(v)) map[k] = v;
    return { type: "status", map };
  }
  if (o.type === "scale" && typeof o.min === "number" && typeof o.max === "number") {
    return { type: "scale", min: o.min, max: o.max, reverse: o.reverse === true };
  }
  return void 0;
}
function parseGridSlideData(slide) {
  const block = slide.querySelector('script[data-odata="grid"]');
  if (!block?.textContent) return null;
  try {
    return normalizeGridData(JSON.parse(block.textContent));
  } catch {
    return null;
  }
}
var el3 = (tag, className, parent) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  parent?.appendChild(e);
  return e;
};
var TONE_FIXED = {
  accent: { bg: "var(--tint-a, rgba(85,122,78,.06))", fg: "var(--accent, #3F7268)" },
  green: { bg: "rgba(61,139,90,0.15)", fg: "#2f6b43" },
  amber: { bg: "rgba(176,125,43,0.17)", fg: "#8a5a12" },
  red: { bg: "rgba(179,64,42,0.15)", fg: "#8f2f1f" }
};
var HEAT = [[179, 64, 42], [200, 147, 46], [61, 139, 90]];
function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}
function heat(t) {
  t = Math.max(0, Math.min(1, t));
  const seg2 = t < 0.5 ? 0 : 1, lt = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const a = HEAT[seg2], b = HEAT[seg2 + 1];
  return [lerp(a[0], b[0], lt), lerp(a[1], b[1], lt), lerp(a[2], b[2], lt)];
}
function toneStyle(rule, value) {
  if (!rule) return null;
  if (rule.type === "status") {
    const t2 = rule.map[value.trim()];
    return t2 ? TONE_FIXED[t2] ?? null : null;
  }
  const n = Number(value.replace(/[^0-9.eE+-]/g, ""));
  if (!Number.isFinite(n) || rule.max === rule.min) return null;
  let t = (n - rule.min) / (rule.max - rule.min);
  if (rule.reverse) t = 1 - t;
  const [r, g, b] = heat(t);
  return { bg: `rgba(${r},${g},${b},0.18)`, fg: `rgb(${lerp(r, 30, 0.55)},${lerp(g, 30, 0.55)},${lerp(b, 30, 0.55)})` };
}
function renderGrid(slide, data, opts = {}) {
  const mount = slide.querySelector("[data-grid-mount]");
  if (!mount) return;
  closeTonePopover();
  mount.textContent = "";
  mount.classList.toggle("editing", !!opts.edit);
  const view = { search: "", sortCol: -1, sortDir: 1 };
  const rerender = () => renderGridBody(slide, data, opts, view);
  if (opts.interactive) {
    const bar = el3("div", "o-grid-filterbar", mount);
    const input = el3("input", "o-grid-search", bar);
    input.setAttribute("type", "text");
    input.placeholder = "Search\u2026";
    input.addEventListener("input", () => {
      view.search = input.value;
      rerender();
    });
    const clear = el3("button", "o-grid-clear", bar);
    clear.setAttribute("type", "button");
    clear.textContent = "Clear";
    clear.addEventListener("click", () => {
      view.search = "";
      input.value = "";
      rerender();
    });
  }
  if (opts.edit) {
    const toolbar = el3("div", "o-grid-toolbar", mount);
    const addRow = el3("button", "o-grid-add", toolbar);
    addRow.setAttribute("type", "button");
    addRow.textContent = "+ Row";
    addRow.addEventListener("click", () => {
      data.rows.push(Array.from({ length: data.columns.length }, () => ""));
      opts.edit.onCommit(data);
      rerender();
    });
    const addCol = el3("button", "o-grid-add", toolbar);
    addCol.setAttribute("type", "button");
    addCol.textContent = "+ Column";
    addCol.addEventListener("click", () => {
      data.columns.push({ label: "Column " + (data.columns.length + 1) });
      data.rows.forEach((r) => {
        while (r.length < data.columns.length) r.push("");
      });
      opts.edit.onCommit(data);
      rerender();
    });
  }
  const wrap = el3("div", "o-grid-wrap", mount);
  const table = el3("table", "o-grid-table", wrap);
  el3("thead", "", table);
  el3("tbody", "", table);
  el3("div", "o-grid-count", mount);
  renderGridHead(slide, data, opts, view);
  rerender();
}
function renderGridHead(slide, data, opts, view) {
  const mount = slide.querySelector("[data-grid-mount]");
  const thead = mount?.querySelector("thead");
  if (!mount || !thead) return;
  thead.textContent = "";
  const hr = el3("tr", "", thead);
  data.columns.forEach((col, c) => {
    const th = el3("th", "o-grid-th" + (col.align ? " a-" + col.align : ""), hr);
    const label = el3("span", "o-grid-thlabel", th);
    label.textContent = col.label;
    if (opts.edit) {
      label.setAttribute("contenteditable", "plaintext-only");
      label.addEventListener("blur", () => {
        const next = (label.textContent ?? "").trim();
        if (next === col.label) return;
        col.label = next;
        opts.edit.onCommit(data);
      });
      const tg = el3("button", "o-grid-tone" + (col.tone ? " on" : ""), th);
      tg.setAttribute("type", "button");
      tg.title = "Conditional colour for this column";
      tg.textContent = "\u25A6";
      tg.addEventListener("click", (e) => {
        e.stopPropagation();
        openTonePopover(tg, c, slide, data, opts, view);
      });
      const del = el3("button", "o-grid-delcol", th);
      del.setAttribute("type", "button");
      del.title = "Delete column";
      del.textContent = "\xD7";
      del.addEventListener("click", () => {
        data.columns.splice(c, 1);
        data.rows.forEach((r) => r.splice(c, 1));
        if (view.sortCol === c) view.sortCol = -1;
        opts.edit.onCommit(data);
        renderGridHead(slide, data, opts, view);
        renderGridBody(slide, data, opts, view);
      });
    } else if (opts.interactive) {
      th.classList.add("sortable");
      if (view.sortCol === c) th.classList.add(view.sortDir === 1 ? "sort-asc" : "sort-desc");
      th.addEventListener("click", () => {
        if (view.sortCol === c) view.sortDir = view.sortDir === 1 ? -1 : 1;
        else {
          view.sortCol = c;
          view.sortDir = 1;
        }
        renderGridHead(slide, data, opts, view);
        renderGridBody(slide, data, opts, view);
      });
    }
  });
  if (opts.edit) el3("th", "o-grid-th", hr).style.width = "34px";
}
function renderGridBody(slide, data, opts, view) {
  const mount = slide.querySelector("[data-grid-mount]");
  const body = mount?.querySelector("tbody");
  if (!mount || !body) return;
  body.textContent = "";
  const q = view.search.trim().toLowerCase();
  let order = data.rows.map((_, i) => i);
  if (q) order = order.filter((i) => data.rows[i].join(" ").toLowerCase().includes(q));
  if (view.sortCol >= 0) {
    const c = view.sortCol;
    order.sort((ia, ib) => {
      const a = data.rows[ia][c] ?? "", b = data.rows[ib][c] ?? "";
      const na = Number(a.replace(/[^0-9.eE+-]/g, "")), nb = Number(b.replace(/[^0-9.eE+-]/g, ""));
      const cmp = Number.isFinite(na) && Number.isFinite(nb) && a.trim() && b.trim() ? na - nb : a.localeCompare(b);
      return cmp * view.sortDir;
    });
  }
  for (const i of order) {
    const row = data.rows[i];
    const tr = el3("tr", "", body);
    data.columns.forEach((col, c) => {
      const value = row[c] ?? "";
      const td = el3("td", "o-grid-cell" + (col.align ? " a-" + col.align : ""), tr);
      const tone2 = toneStyle(col.tone, value);
      if (tone2) {
        td.style.background = tone2.bg;
        td.style.color = tone2.fg;
        td.style.fontWeight = "600";
      }
      td.textContent = value;
      if (opts.edit) {
        td.setAttribute("contenteditable", "plaintext-only");
        td.addEventListener("blur", () => {
          const next = (td.textContent ?? "").trim();
          if (next === value) return;
          while (row.length <= c) row.push("");
          row[c] = next;
          opts.edit.onCommit(data);
          renderGridBody(slide, data, opts, view);
        });
      }
    });
    if (opts.edit) {
      const delTd = el3("td", "o-grid-delrow-td", tr);
      const del = el3("button", "o-grid-del", delTd);
      del.setAttribute("type", "button");
      del.title = "Delete row (Ctrl+Z undoes)";
      del.textContent = "\u{1F5D1}";
      del.addEventListener("click", () => {
        data.rows.splice(i, 1);
        opts.edit.onCommit(data);
        renderGridBody(slide, data, opts, view);
      });
    }
  }
  if (order.length === 0) {
    const tr = el3("tr", "", body);
    const td = el3("td", "o-grid-empty", tr);
    td.setAttribute("colspan", String(data.columns.length + (opts.edit ? 1 : 0)));
    td.textContent = data.rows.length === 0 ? "No rows yet." : "No rows match your search.";
  }
  const count = mount.querySelector(".o-grid-count");
  if (count) {
    let txt = `${data.rows.length} row${data.rows.length === 1 ? "" : "s"}`;
    if (q) txt += ` \xB7 ${order.length} shown`;
    count.textContent = txt;
  }
}
var tonePop = null;
var tonePopDown = null;
function closeTonePopover(commit) {
  if (!tonePop) return;
  tonePop.remove();
  tonePop = null;
  if (tonePopDown) document.removeEventListener("mousedown", tonePopDown, true);
  tonePopDown = null;
  commit?.();
}
function openTonePopover(anchor, c, slide, data, opts, view) {
  closeTonePopover();
  const col = data.columns[c];
  const local = () => {
    renderGridHead(slide, data, opts, view);
    renderGridBody(slide, data, opts, view);
  };
  const commit = () => opts.edit?.onCommit(data);
  const pop = el3("div", "o-grid-tonepop");
  tonePop = pop;
  el3("div", "o-grid-tp-head", pop).textContent = "Colour: " + (col.label || "column");
  const modes = el3("div", "o-grid-tp-modes", pop);
  const body = el3("div", "o-grid-tp-body", pop);
  const colNums = () => data.rows.map((r2) => Number((r2[c] ?? "").replace(/[^0-9.eE+-]/g, ""))).filter((n) => Number.isFinite(n));
  const distinct = () => {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const r2 of data.rows) {
      const v = (r2[c] ?? "").trim();
      if (v && !seen.has(v)) {
        seen.add(v);
        out.push(v);
        if (out.length >= 50) break;
      }
    }
    return out;
  };
  const setMode = (m) => {
    if (m === "off") delete col.tone;
    else if (m === "scale") {
      const n = colNums();
      col.tone = { type: "scale", min: n.length ? Math.min(...n) : 0, max: n.length ? Math.max(...n) : 100 };
    } else col.tone = { type: "status", map: {} };
    local();
    render();
  };
  const SWATCHES = [["", ""], ["green", "#3D8B5A"], ["amber", "#B07D2B"], ["red", "#B3402A"], ["accent", "var(--accent)"]];
  function render() {
    const cur = col.tone?.type ?? "off";
    modes.textContent = "";
    [["Off", "off"], ["Heatmap", "scale"], ["By value", "status"]].forEach(([label, m]) => {
      const b = el3("button", "o-grid-tp-chip" + (cur === m ? " on" : ""), modes);
      b.setAttribute("type", "button");
      b.textContent = label;
      b.addEventListener("click", () => setMode(m));
    });
    body.textContent = "";
    const t = col.tone;
    if (!t) {
      el3("p", "o-grid-tp-note", body).textContent = "No colour. Heatmap shades numbers low\u2192high; By value paints chosen values.";
      return;
    }
    if (t.type === "scale") {
      const row = el3("div", "o-grid-tp-row", body);
      const num2 = (label, val, set) => {
        const w = el3("label", "o-grid-tp-num", row);
        w.append(document.createTextNode(label));
        const inp = el3("input", "", w);
        inp.type = "number";
        inp.value = String(val);
        inp.addEventListener("change", () => {
          const v = Number(inp.value);
          if (Number.isFinite(v)) {
            set(v);
            local();
          }
        });
      };
      num2("Low", t.min, (v) => t.min = v);
      num2("High", t.max, (v) => t.max = v);
      const rev = el3("label", "o-grid-tp-rev", body);
      const cb = el3("input", "", rev);
      cb.type = "checkbox";
      cb.checked = !!t.reverse;
      rev.append(document.createTextNode(" High value is bad (red at top)"));
      cb.addEventListener("change", () => {
        t.reverse = cb.checked;
        local();
      });
    } else {
      const vals = distinct();
      if (!vals.length) {
        el3("p", "o-grid-tp-note", body).textContent = "No values in this column yet.";
        return;
      }
      const list = el3("div", "o-grid-tp-list", body);
      for (const v of vals) {
        const r2 = el3("div", "o-grid-tp-vrow", list);
        el3("span", "o-grid-tp-vlabel", r2).textContent = v;
        const sw = el3("span", "o-grid-tp-sw", r2);
        for (const [tone2, color] of SWATCHES) {
          const b = el3("button", "o-grid-tp-dot" + ((t.map[v] ?? "") === tone2 ? " on" : ""), sw);
          b.setAttribute("type", "button");
          b.title = tone2 || "none";
          if (color) b.style.background = color;
          else b.textContent = "\xD7";
          b.addEventListener("click", () => {
            if (tone2) t.map[v] = tone2;
            else delete t.map[v];
            local();
            render();
          });
        }
      }
    }
  }
  render();
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 40) + "px";
  pop.style.left = Math.max(8, Math.min(r.left - 40, window.innerWidth - 280)) + "px";
  tonePopDown = (e) => {
    if (tonePop && !tonePop.contains(e.target)) closeTonePopover(commit);
  };
  setTimeout(() => document.addEventListener("mousedown", tonePopDown, true), 0);
}
function renderGridError(slide) {
  const mount = slide.querySelector("[data-grid-mount]");
  if (!mount) return;
  mount.textContent = "";
  el3("div", "o-grid-error", mount).textContent = "This grid\u2019s data block is missing or invalid \u2014 open the deck in Origami Folio to repair it.";
}
function gridContainerOf(block) {
  return block.closest("figure, .o-grid-shell") ?? block.parentElement;
}
function mountGrids(slide) {
  slide.querySelectorAll('script[data-odata="grid"]').forEach((block) => {
    const root = gridContainerOf(block);
    if (!root) return;
    const data = parseGridSlideData(root);
    if (!data) return renderGridError(root);
    renderGrid(root, data, { interactive: true });
  });
}
function finalizeGrids(slide) {
  slide.querySelectorAll('script[data-odata="grid"]').forEach((block) => {
    const root = gridContainerOf(block);
    if (!root) return;
    const data = parseGridSlideData(root);
    if (!data) return renderGridError(root);
    renderGrid(root, data, {});
  });
}

// src/tracker.ts
var TRACKER_STATUSES = ["Open", "In progress", "Blocked", "Closed"];
function trackerStatuses(data) {
  return data.statuses && data.statuses.length > 0 ? data.statuses : TRACKER_STATUSES;
}
function normalizeTrackerData(raw) {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const s2 = (x) => typeof x === "string" ? x : "";
  const statuses = Array.isArray(d.statuses) && d.statuses.length > 0 && d.statuses.every((x) => typeof x === "string") ? d.statuses.map((x) => x.slice(0, 40)) : void 0;
  const allowed = statuses ?? TRACKER_STATUSES;
  const rows = (Array.isArray(d.rows) ? d.rows : []).map((r) => {
    const o = r ?? {};
    return {
      action: s2(o.action),
      owner: s2(o.owner),
      comments: s2(o.comments),
      due: s2(o.due),
      status: allowed.includes(s2(o.status)) ? s2(o.status) : allowed[0],
      done: o.done === true
    };
  });
  return statuses ? { rows, statuses } : { rows };
}
function parseTrackerSlideData(slide) {
  const block = slide.querySelector('script[data-odata="tracker"]');
  if (!block?.textContent) return null;
  try {
    return normalizeTrackerData(JSON.parse(block.textContent));
  } catch {
    return null;
  }
}
var el4 = (tag, className, parent) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  parent?.appendChild(e);
  return e;
};
function renderTracker(slide, data, opts = {}) {
  const mount = slide.querySelector("[data-tracker-mount]");
  if (!mount) return;
  mount.textContent = "";
  mount.classList.toggle("editing", !!opts.edit);
  let search = "";
  let hideDone = false;
  const rerender = () => renderTrackerBody(slide, data, opts, { search, hideDone });
  if (opts.interactive) {
    const bar = el4("div", "o-tracker-filterbar", mount);
    const input = el4("input", "o-tracker-search", bar);
    input.setAttribute("type", "text");
    input.placeholder = "Search actions, owners, comments\u2026";
    const toggle = el4("label", "o-tracker-toggle", bar);
    const check = el4("input", "", toggle);
    check.setAttribute("type", "checkbox");
    toggle.appendChild(document.createTextNode(" Hide completed"));
    const clear = el4("button", "o-tracker-clear", bar);
    clear.setAttribute("type", "button");
    clear.textContent = "Clear";
    input.addEventListener("input", () => {
      search = input.value;
      rerender();
    });
    check.addEventListener("change", () => {
      hideDone = check.checked;
      rerender();
    });
    clear.addEventListener("click", () => {
      search = "";
      hideDone = false;
      input.value = "";
      check.checked = false;
      rerender();
    });
  }
  if (opts.edit) {
    const toolbar = el4("div", "o-tracker-toolbar", mount);
    const add = el4("button", "o-tracker-add", toolbar);
    add.setAttribute("type", "button");
    add.textContent = "+ Add action";
    add.addEventListener("click", () => {
      data.rows.push({ action: "New action", owner: "", comments: "", due: "", status: trackerStatuses(data)[0], done: false });
      opts.edit.onCommit(data);
      rerender();
      const cells = mount.querySelectorAll('.o-tracker-cell[data-f="action"]');
      cells[cells.length - 1]?.focus();
    });
    const editBtn = el4("button", "o-tracker-editstatuses", toolbar);
    editBtn.setAttribute("type", "button");
    editBtn.textContent = "\u2699 Statuses";
    const pop = el4("div", "o-tracker-statuses", toolbar);
    pop.style.display = "none";
    const commitStatuses = (next) => {
      data.statuses = next;
      data.rows.forEach((r) => {
        if (!next.includes(r.status)) r.status = next[0];
      });
      opts.edit.onCommit(data);
      rerender();
    };
    const buildPop = () => {
      pop.textContent = "";
      const list = trackerStatuses(data).slice();
      list.forEach((s2, i) => {
        const row = el4("div", "o-tracker-status-row", pop);
        const inp = document.createElement("input");
        inp.type = "text";
        inp.value = s2;
        inp.maxLength = 40;
        inp.addEventListener("change", () => {
          const next = trackerStatuses(data).slice();
          next[i] = inp.value.trim() || next[i];
          commitStatuses(next);
        });
        row.appendChild(inp);
        const del = document.createElement("button");
        del.setAttribute("type", "button");
        del.textContent = "\xD7";
        del.title = "Remove this status";
        del.addEventListener("click", () => {
          const next = trackerStatuses(data).slice();
          if (next.length <= 1) return;
          next.splice(i, 1);
          commitStatuses(next);
          buildPop();
        });
        row.appendChild(del);
      });
      const addS = document.createElement("button");
      addS.setAttribute("type", "button");
      addS.textContent = "+ status";
      addS.addEventListener("click", () => {
        commitStatuses([...trackerStatuses(data), "New status"]);
        buildPop();
      });
      pop.appendChild(addS);
    };
    editBtn.addEventListener("click", () => {
      const open = pop.style.display === "none";
      pop.style.display = open ? "" : "none";
      if (open) buildPop();
    });
  }
  const wrap = el4("div", "o-tracker-wrap", mount);
  const table = el4("table", "o-tracker-table", wrap);
  const thead = el4("thead", "", table);
  const hr = el4("tr", "", thead);
  const heads = [
    ["Action", "26%"],
    ["Owner", "12%"],
    ["Comments", ""],
    ["Due", "9%"],
    ["Status", "12%"],
    ["Done", "64px"]
  ];
  if (opts.edit) heads.push(["", "72px"]);
  for (const [label, width] of heads) {
    const th = el4("th", "", hr);
    th.textContent = label;
    if (width) th.style.width = width;
  }
  el4("tbody", "", table);
  el4("div", "o-tracker-count", mount);
  rerender();
}
function renderTrackerBody(slide, data, opts, filter) {
  const mount = slide.querySelector("[data-tracker-mount]");
  const body = mount?.querySelector("tbody");
  if (!mount || !body) return;
  body.textContent = "";
  const q = filter.search.trim().toLowerCase();
  let shown = 0;
  const allowed = trackerStatuses(data);
  const doneStatus = allowed[allowed.length - 1];
  const openStatus = allowed[0];
  data.rows.forEach((row, i) => {
    if (filter.hideDone && row.done) return;
    if (q) {
      const hay = [row.action, row.owner, row.comments, row.due, row.status].join(" ").toLowerCase();
      if (!hay.includes(q)) return;
    }
    shown++;
    const tr = el4("tr", (row.done ? "done " : "") + (row.status === "Blocked" ? "blocked" : ""), body);
    const commit = () => opts.edit.onCommit(data);
    const rerenderBody = () => renderTrackerBody(slide, data, opts, filter);
    for (const f of ["action", "owner", "comments", "due"]) {
      const td = el4("td", "", tr);
      const cell = el4("div", "o-tracker-cell", td);
      cell.setAttribute("data-f", f);
      cell.textContent = row[f];
      if (opts.edit) {
        cell.setAttribute("contenteditable", "plaintext-only");
        cell.addEventListener("blur", () => {
          const next = (cell.textContent ?? "").trim();
          if (next === row[f]) return;
          row[f] = next;
          commit();
          rerenderBody();
        });
      }
    }
    const statusTd = el4("td", "", tr);
    if (opts.edit) {
      const sel = el4("select", "o-tracker-status", statusTd);
      for (const s2 of allowed) {
        const opt = document.createElement("option");
        opt.textContent = s2;
        opt.selected = s2 === row.status;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => {
        row.status = sel.value;
        if (row.status === doneStatus) row.done = true;
        commit();
        rerenderBody();
      });
    } else {
      el4("span", "o-tracker-status-text", statusTd).textContent = row.status;
    }
    const doneTd = el4("td", "o-tracker-done-td", tr);
    if (opts.edit) {
      const check = el4("button", "o-tracker-check" + (row.done ? " on" : ""), doneTd);
      check.setAttribute("type", "button");
      check.title = "Mark complete";
      check.textContent = "\u2713";
      check.addEventListener("click", () => {
        row.done = !row.done;
        if (row.done && row.status !== doneStatus) row.status = doneStatus;
        if (!row.done && row.status === doneStatus) row.status = openStatus;
        commit();
        rerenderBody();
      });
    } else if (row.done) {
      doneTd.textContent = "\u2713";
    }
    if (opts.edit) {
      const opsTd = el4("td", "o-tracker-ops-td", tr);
      const grip = el4("button", "o-tracker-grip", opsTd);
      grip.setAttribute("type", "button");
      grip.setAttribute("draggable", "true");
      grip.title = "Drag to reorder";
      grip.textContent = "\u283F";
      grip.addEventListener("dragstart", (e) => {
        const dt = e.dataTransfer;
        if (dt) {
          dt.setData("text/plain", String(i));
          dt.effectAllowed = "move";
        }
        tr.classList.add("o-tracker-dragging");
      });
      grip.addEventListener("dragend", () => tr.classList.remove("o-tracker-dragging"));
      tr.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        tr.classList.add("o-tracker-drop");
      });
      tr.addEventListener("dragleave", () => tr.classList.remove("o-tracker-drop"));
      tr.addEventListener("drop", (e) => {
        e.preventDefault();
        tr.classList.remove("o-tracker-drop");
        const src = Number(e.dataTransfer?.getData("text/plain"));
        if (!Number.isInteger(src) || src < 0 || src >= data.rows.length || src === i) return;
        const [moved] = data.rows.splice(src, 1);
        data.rows.splice(i, 0, moved);
        commit();
        rerenderBody();
      });
      const del = el4("button", "o-tracker-del", opsTd);
      del.setAttribute("type", "button");
      del.title = "Delete row (Ctrl+Z undoes)";
      del.textContent = "\u{1F5D1}";
      del.addEventListener("click", () => {
        data.rows.splice(i, 1);
        commit();
        rerenderBody();
      });
    }
  });
  if (shown === 0) {
    const tr = el4("tr", "", body);
    const td = el4("td", "o-tracker-empty", tr);
    td.setAttribute("colspan", opts.edit ? "7" : "6");
    td.textContent = data.rows.length === 0 ? "No actions yet." : "No actions match the current filters.";
  }
  const count = mount.querySelector(".o-tracker-count");
  if (count) {
    const open = data.rows.filter((r) => !r.done).length;
    let txt = `${data.rows.length} action${data.rows.length === 1 ? "" : "s"} \xB7 ${open} open`;
    if (q || filter.hideDone) txt += ` \xB7 ${shown} shown`;
    count.textContent = txt;
  }
}
function renderTrackerError(slide) {
  const mount = slide.querySelector("[data-tracker-mount]");
  if (!mount) return;
  mount.textContent = "";
  el4("div", "o-tracker-error", mount).textContent = "This tracker\u2019s data block is missing or invalid \u2014 open the deck in Origami Folio to repair it.";
}
function trackerContainerOf(block) {
  return block.closest("figure, .o-tracker-shell") ?? block.parentElement;
}
function mountTrackers(slide) {
  slide.querySelectorAll('script[data-odata="tracker"]').forEach((block) => {
    const root = trackerContainerOf(block);
    if (!root) return;
    const data = parseTrackerSlideData(root);
    if (!data) return renderTrackerError(root);
    renderTracker(root, data, { interactive: true });
  });
}
function finalizeTrackers(slide) {
  slide.querySelectorAll('script[data-odata="tracker"]').forEach((block) => {
    const root = trackerContainerOf(block);
    if (!root) return;
    const data = parseTrackerSlideData(root);
    if (!data) return renderTrackerError(root);
    renderTracker(root, data, {});
  });
}

// src/notes.ts
var NOTE_SWATCHES = ["", "#C8A04A", "#2F4A6B", "#557A4E", "#B0506A", "#5A5752"];
function normalizeNotesData(raw) {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const s2 = (x) => typeof x === "string" ? x : "";
  const notes = (Array.isArray(d.notes) ? d.notes : []).map((n, i) => {
    const o = n ?? {};
    const note = {
      id: s2(o.id) || "n" + i,
      title: s2(o.title),
      body: s2(o.body),
      color: /^#[0-9a-fA-F]{3,8}$/.test(s2(o.color)) ? s2(o.color) : "",
      pinned: o.pinned === true
    };
    if (s2(o.date)) note.date = s2(o.date);
    if (s2(o.image)) note.image = s2(o.image);
    return note;
  });
  return { notes };
}
function parseNotesSlideData(slide) {
  const block = slide.querySelector('script[data-odata="notes"]');
  if (!block?.textContent) return null;
  try {
    return normalizeNotesData(JSON.parse(block.textContent));
  } catch {
    return null;
  }
}
var el5 = (tag, className, parent) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  parent?.appendChild(e);
  return e;
};
function freshId() {
  return "n" + Math.random().toString(36).slice(2, 10);
}
function today() {
  try {
    return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}
function renderNotes(slide, data, opts = {}) {
  const mount = slide.querySelector("[data-notes-mount]");
  if (!mount) return;
  mount.textContent = "";
  mount.classList.toggle("editing", !!opts.edit);
  let search = "";
  const grid = document.createElement("div");
  grid.className = "o-notes-grid";
  const rerender = () => renderNotesGrid(grid, slide, data, opts, search);
  const bar = el5("div", "o-notes-bar", mount);
  if (opts.interactive) {
    const input = el5("input", "o-notes-search", bar);
    input.setAttribute("type", "text");
    input.placeholder = "Search notes\u2026";
    input.addEventListener("input", () => {
      search = input.value;
      rerender();
    });
  }
  if (opts.edit) {
    const add = el5("button", "o-notes-add", bar);
    add.setAttribute("type", "button");
    add.textContent = "+ New note";
    add.addEventListener("click", () => {
      const id = freshId();
      data.notes.unshift({ id, title: "", body: "", color: "", pinned: false, date: today() });
      opts.edit.onCommit(data);
      rerender();
      mount.querySelector(`.o-note[data-note-id="${id}"] .o-note-title`)?.focus();
    });
  }
  el5("span", "o-notes-count", bar);
  mount.appendChild(grid);
  rerender();
}
function displayOrder(notes, editing) {
  if (editing) return notes;
  return notes.map((n, i) => ({ n, i })).sort((a, b) => Number(b.n.pinned) - Number(a.n.pinned) || a.i - b.i).map((x) => x.n);
}
function renderNotesGrid(grid, slide, data, opts, search) {
  grid.textContent = "";
  const q = search.trim().toLowerCase();
  const commit = () => opts.edit?.onCommit(data);
  const rerender = () => renderNotesGrid(grid, slide, data, opts, search);
  let shown = 0;
  for (const note of displayOrder(data.notes, !!opts.edit)) {
    if (q && !(note.title + " " + note.body).toLowerCase().includes(q)) continue;
    shown++;
    grid.appendChild(noteCard(note, data, opts, commit, rerender));
  }
  if (shown === 0) {
    const empty = el5("div", "o-notes-empty", grid);
    empty.textContent = data.notes.length === 0 ? "No notes yet." : "No notes match your search.";
  }
  const count = grid.parentElement?.querySelector(".o-notes-count");
  if (count) {
    const n = data.notes.length;
    let txt = `${n} note${n === 1 ? "" : "s"}`;
    if (q) txt += ` \xB7 ${shown} shown`;
    count.textContent = txt;
  }
  opts.onResolve?.(grid);
}
function noteCard(note, data, opts, commit, rerender) {
  const card = el5("article", "o-note" + (note.pinned ? " pinned" : ""));
  card.setAttribute("data-note-id", note.id);
  if (note.color) card.style.setProperty("--note-color", note.color);
  const edit = opts.edit;
  if (edit) {
    card.setAttribute("draggable", "true");
    card.addEventListener("dragstart", (e) => {
      const dt = e.dataTransfer;
      if (dt) {
        dt.setData("text/plain", note.id);
        dt.effectAllowed = "move";
      }
      card.classList.add("o-note-dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("o-note-dragging"));
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      card.classList.add("o-note-drop");
    });
    card.addEventListener("dragleave", () => card.classList.remove("o-note-drop"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("o-note-drop");
      const srcId = e.dataTransfer?.getData("text/plain");
      const from = data.notes.findIndex((n) => n.id === srcId);
      const to = data.notes.findIndex((n) => n.id === note.id);
      if (from < 0 || to < 0 || from === to) return;
      const [moved] = data.notes.splice(from, 1);
      data.notes.splice(to, 0, moved);
      commit();
      rerender();
    });
  }
  const head = el5("div", "o-note-head", card);
  const title = el5("div", "o-note-title", head);
  title.textContent = note.title;
  if (edit) {
    title.setAttribute("contenteditable", "plaintext-only");
    title.setAttribute("data-ph", "Title");
    title.addEventListener("blur", () => {
      const next = (title.textContent ?? "").trim();
      if (next === note.title) return;
      note.title = next;
      commit();
    });
    title.addEventListener("mousedown", () => card.setAttribute("draggable", "false"));
    title.addEventListener("blur", () => card.setAttribute("draggable", "true"));
    const tools = el5("div", "o-note-tools", head);
    const pin = el5("button", "o-note-pin" + (note.pinned ? " on" : ""), tools);
    pin.setAttribute("type", "button");
    pin.title = note.pinned ? "Unpin" : "Pin to top";
    pin.textContent = "\u2605";
    pin.addEventListener("click", () => {
      note.pinned = !note.pinned;
      commit();
      rerender();
    });
    if (edit.onPickImage) {
      const img = el5("button", "o-note-imgbtn", tools);
      img.setAttribute("type", "button");
      img.title = "Add an image";
      img.textContent = "\u{1F5BC}";
      img.addEventListener("click", () => edit.onPickImage(note.id));
    }
    const del = el5("button", "o-note-del", tools);
    del.setAttribute("type", "button");
    del.title = "Delete note";
    del.textContent = "\u{1F5D1}";
    del.addEventListener("click", () => {
      const i = data.notes.findIndex((n) => n.id === note.id);
      if (i >= 0) data.notes.splice(i, 1);
      commit();
      rerender();
    });
  } else if (note.pinned) {
    el5("span", "o-note-pinmark", head).textContent = "\u2605";
  }
  if (note.image) {
    const wrap = el5("div", "o-note-imgwrap", card);
    const img = el5("img", "o-note-img", wrap);
    img.setAttribute("data-oasset", note.image);
    img.setAttribute("alt", "");
    if (edit) {
      const rm = el5("button", "o-note-imgrm", wrap);
      rm.setAttribute("type", "button");
      rm.title = "Remove image";
      rm.textContent = "\u2715";
      rm.addEventListener("click", () => {
        delete note.image;
        commit();
        rerender();
      });
    }
  }
  if (edit) {
    const body = el5("div", "o-note-body", card);
    body.setAttribute("contenteditable", "plaintext-only");
    body.setAttribute("data-omultiline", "");
    body.setAttribute("data-ph", "Add a line per bullet\u2026");
    body.textContent = note.body;
    body.addEventListener("blur", () => {
      const next = (body.innerText ?? "").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
      if (next === note.body) return;
      note.body = next;
      commit();
    });
    body.addEventListener("mousedown", () => card.setAttribute("draggable", "false"));
    body.addEventListener("blur", () => card.setAttribute("draggable", "true"));
  } else {
    const lines = note.body.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length) {
      const ul = el5("ul", "o-note-bullets", card);
      for (const line of lines) el5("li", "", ul).textContent = line;
    }
  }
  if (edit) {
    const sw = el5("div", "o-note-swatches", card);
    for (const c of NOTE_SWATCHES) {
      const dot = el5("button", "o-note-swatch" + ((note.color || "") === c ? " on" : ""), sw);
      dot.setAttribute("type", "button");
      dot.title = c ? c : "Default";
      dot.style.setProperty("--sw", c || "var(--rule, #ccc)");
      dot.addEventListener("click", () => {
        note.color = c;
        commit();
        rerender();
      });
    }
  }
  if (note.date) el5("div", "o-note-date", card).textContent = note.date;
  return card;
}
function renderNotesError(slide) {
  const mount = slide.querySelector("[data-notes-mount]");
  if (!mount) return;
  mount.textContent = "";
  el5("div", "o-notes-error", mount).textContent = "This scratch pad\u2019s data block is missing or invalid \u2014 open the deck in Origami Folio to repair it.";
}
function notesContainerOf(block) {
  return block.closest("figure") ?? block.parentElement;
}
function mountNotes(slide, assets) {
  slide.querySelectorAll('script[data-odata="notes"]').forEach((block) => {
    const root = notesContainerOf(block);
    if (!root) return;
    const data = parseNotesSlideData(root);
    if (!data) return renderNotesError(root);
    renderNotes(root, data, {
      interactive: true,
      onResolve: assets ? (scope) => resolveAssetRefs(scope, assets) : void 0
    });
  });
}
function finalizeNotes(slide) {
  slide.querySelectorAll('script[data-odata="notes"]').forEach((block) => {
    const root = notesContainerOf(block);
    if (!root) return;
    const data = parseNotesSlideData(root);
    if (!data) return renderNotesError(root);
    renderNotes(root, data, {});
  });
}

// src/draw.ts
var SVGNS2 = "http://www.w3.org/2000/svg";
var ROUGH_JITTER = [0, 2.2, 4.5];
var HACHURE_ANGLE = -41;
var HACHURE_CROSS_DELTA = 90;
var svgEl3 = (tag, attrs, parent) => {
  const e = document.createElementNS(SVGNS2, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
};
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var f2 = (n) => (Math.round(n * 100) / 100).toString();
function jitteredLinePath(x1, y1, x2, y2, rand, jit) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return "";
  const px = -dy / len;
  const py = dx / len;
  const steps2 = Math.min(12, Math.max(1, Math.round(len / 24)));
  const o1 = (rand() - 0.5) * jit;
  const o2 = (rand() - 0.5) * jit;
  let d = "";
  for (let i = 0; i <= steps2; i++) {
    const t = i / steps2;
    const mid = i > 0 && i < steps2 ? (rand() - 0.5) * jit * 0.7 : 0;
    const off = o1 + (o2 - o1) * t + mid;
    d += (i === 0 ? "M" : "L") + f2(x1 + dx * t + px * off) + " " + f2(y1 + dy * t + py * off);
  }
  return d;
}
function sketchyLine(x1, y1, x2, y2, rand, jit, overshoot = 0) {
  if (jit <= 0) {
    return [`M${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}`];
  }
  const out = [];
  for (let pass = 0; pass < 2; pass++) {
    let ax = x1;
    let ay = y1;
    let bx = x2;
    let by = y2;
    if (overshoot > 0) {
      const ol = overshoot * (0.4 + rand() * 0.6);
      const or_ = overshoot * (0.4 + rand() * 0.6);
      const len = Math.hypot(bx - ax, by - ay) || 1;
      ax -= (bx - ax) / len * ol;
      ay -= (by - ay) / len * ol;
      bx += (bx - ax) / len * or_;
      by += (by - ay) / len * or_;
    }
    const d = jitteredLinePath(ax, ay, bx, by, rand, jit);
    if (d) out.push(d);
  }
  return out;
}
function smoothPath(pts) {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M${f2(pts[0][0])} ${f2(pts[0][1])}L${f2(pts[1][0])} ${f2(pts[1][1])}`;
  let d = `M${f2(pts[0][0])} ${f2(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${f2(c1x)} ${f2(c1y)} ${f2(c2x)} ${f2(c2y)} ${f2(p2[0])} ${f2(p2[1])}`;
  }
  return d;
}
function simplifyPoints(pts, epsilon = 0.8) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s2, e] = stack.pop();
    const [ax, ay] = pts[s2];
    const [bx, by] = pts[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let maxD = -1;
    let maxI = -1;
    for (let i = s2 + 1; i < e; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > epsilon && maxI > 0) {
      keep[maxI] = 1;
      stack.push([s2, maxI], [maxI, e]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}
function shapePolygon(e) {
  const { x, y, width: w, height: h } = e;
  if (e.type === "diamond") {
    return [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
  }
  if (e.type === "ellipse") {
    const pts = [];
    const cx = x + w / 2;
    const cy = y + h / 2;
    const n = Math.min(32, Math.max(12, Math.round(Math.hypot(w, h) / 4)));
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      pts.push([cx + Math.cos(a) * w / 2, cy + Math.sin(a) * h / 2]);
    }
    return pts;
  }
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
function polygonPath(poly) {
  return "M" + poly.map((p) => `${f2(p[0])} ${f2(p[1])}`).join("L") + "Z";
}
function ellipsePaths(e, rand, jit) {
  const out = [];
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height / 2;
  const rx = e.width / 2;
  const ry = e.height / 2;
  const n = Math.min(28, Math.max(10, Math.round((rx + ry) / 6)));
  const passes = jit <= 0 ? 1 : 2;
  for (let pass = 0; pass < passes; pass++) {
    const pts = [];
    const a0 = pass === 0 ? 0 : rand() * Math.PI;
    for (let i = 0; i <= n; i++) {
      const a = a0 + i / n * Math.PI * 2;
      const wobble = jit > 0 ? (rand() - 0.5) * jit * 0.6 : 0;
      pts.push([cx + Math.cos(a) * (rx + wobble), cy + Math.sin(a) * (ry + wobble)]);
    }
    out.push(smoothPath(pts) + "Z");
  }
  return out;
}
function hachureLines(poly, angleDeg, gap, rand, jit) {
  if (poly.length < 3 || gap <= 0) return [];
  const cx = poly.reduce((s2, p) => s2 + p[0], 0) / poly.length;
  const cy = poly.reduce((s2, p) => s2 + p[1], 0) / poly.length;
  const a = angleDeg * Math.PI / 180;
  const cos = Math.cos(-a);
  const sin = Math.sin(-a);
  const rot = poly.map((p) => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    return [dx * cos - dy * sin + cx, dx * sin + dy * cos + cy];
  });
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of rot) {
    yMin = Math.min(yMin, p[1]);
    yMax = Math.max(yMax, p[1]);
  }
  const out = [];
  const backCos = Math.cos(a);
  const backSin = Math.sin(a);
  for (let y = yMin + gap / 2; y < yMax; y += gap) {
    const xs = [];
    for (let i = 0; i < rot.length; i++) {
      const [x1, y1] = rot[i];
      const [x2, y2] = rot[(i + 1) % rot.length];
      if (y1 === y2) continue;
      if (y >= Math.min(y1, y2) && y < Math.max(y1, y2)) {
        xs.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1));
      }
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const r1x = xs[i] - cx;
      const r1y = y - cy;
      const r2x = xs[i + 1] - cx;
      const wx1 = r1x * backCos - r1y * backSin + cx;
      const wy1 = r1x * backSin + r1y * backCos + cy;
      const wx2 = r2x * backCos - r1y * backSin + cx;
      const wy2 = r2x * backSin + r1y * backCos + cy;
      const d = jit > 0 ? jitteredLinePath(wx1, wy1, wx2, wy2, rand, jit * 0.5) : `M${f2(wx1)} ${f2(wy1)}L${f2(wx2)} ${f2(wy2)}`;
      if (d) out.push(d);
    }
  }
  return out;
}
function arrowHeadPaths(tipX, tipY, fromX, fromY, rand, jit, sw) {
  const angle = Math.atan2(tipY - fromY, tipX - fromX);
  const hl = 7 + sw * 2.2;
  const out = [];
  for (const s2 of [-1, 1]) {
    const a = angle + Math.PI + s2 * (0.42 + rand() * 0.14);
    const d = sketchyLine(tipX, tipY, tipX + Math.cos(a) * hl, tipY + Math.sin(a) * hl, rand, jit * 0.6);
    out.push(...d);
  }
  return out;
}
function sceneBounds(data) {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  let maxSw = 0;
  const eat = (x, y) => {
    xMin = Math.min(xMin, x);
    yMin = Math.min(yMin, y);
    xMax = Math.max(xMax, x);
    yMax = Math.max(yMax, y);
  };
  for (const e of data.elements) {
    maxSw = Math.max(maxSw, e.strokeWidth ?? 2);
    if (e.points && e.points.length) {
      for (const p of e.points) eat(e.x + p[0], e.y + p[1]);
    } else {
      eat(e.x, e.y);
      eat(e.x + e.width, e.y + e.height);
      if (e.type === "text") eat(e.x + e.width, e.y + (e.fontSize ?? 16) * 1.3 * Math.max(1, (e.text ?? "").split("\n").length));
    }
  }
  if (!Number.isFinite(xMin)) return null;
  const pad2 = 4 + maxSw;
  return { x: xMin - pad2, y: yMin - pad2, w: xMax - xMin + pad2 * 2, h: yMax - yMin + pad2 * 2 };
}
function strokePathsFor(e, rand, jit) {
  if (e.type === "rect") {
    const o = jit > 0 ? 1.5 + rand() * 1.5 : 0;
    return [
      ...sketchyLine(e.x, e.y, e.x + e.width, e.y, rand, jit, o),
      ...sketchyLine(e.x + e.width, e.y, e.x + e.width, e.y + e.height, rand, jit, o),
      ...sketchyLine(e.x + e.width, e.y + e.height, e.x, e.y + e.height, rand, jit, o),
      ...sketchyLine(e.x, e.y + e.height, e.x, e.y, rand, jit, o)
    ];
  }
  if (e.type === "diamond") {
    const [top, right, bottom, left] = shapePolygon(e);
    return [
      ...sketchyLine(top[0], top[1], right[0], right[1], rand, jit, jit > 0 ? 1.5 : 0),
      ...sketchyLine(right[0], right[1], bottom[0], bottom[1], rand, jit, jit > 0 ? 1.5 : 0),
      ...sketchyLine(bottom[0], bottom[1], left[0], left[1], rand, jit, jit > 0 ? 1.5 : 0),
      ...sketchyLine(left[0], left[1], top[0], top[1], rand, jit, jit > 0 ? 1.5 : 0)
    ];
  }
  if (e.type === "ellipse") return ellipsePaths(e, rand, jit);
  if (e.type === "freedraw") {
    const wob = jit * 0.55;
    const pts = simplifyPoints(e.points ?? []).map(
      (p) => [e.x + p[0] + (rand() - 0.5) * wob, e.y + p[1] + (rand() - 0.5) * wob]
    );
    const d = smoothPath(pts);
    return d ? [d] : [];
  }
  if (e.type === "arrow" || e.type === "line") {
    const pts = e.points ?? [];
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      out.push(...sketchyLine(e.x + pts[i][0], e.y + pts[i][1], e.x + pts[i + 1][0], e.y + pts[i + 1][1], rand, jit));
    }
    if (e.type === "arrow" && pts.length >= 2) {
      const n = pts.length;
      out.push(...arrowHeadPaths(e.x + pts[n - 1][0], e.y + pts[n - 1][1], e.x + pts[n - 2][0], e.y + pts[n - 2][1], rand, jit, e.strokeWidth ?? 2));
    }
    return out;
  }
  return [];
}
function fillPathsFor(e, rand, jit) {
  const fill = e.fill ?? "";
  if (!fill || e.type === "freedraw" || e.type === "text") return { hachure: [], solid: null };
  const style = e.fillStyle ?? "hachure";
  const poly = shapePolygon(e);
  if (style === "none" || style === "solid") return { hachure: [], solid: style === "solid" ? polygonPath(poly) : null };
  const gap = Math.min(14, Math.max(5, (e.strokeWidth ?? 2) * 4));
  const hachure = hachureLines(poly, HACHURE_ANGLE, gap, rand, jit);
  if (style === "cross") hachure.push(...hachureLines(poly, HACHURE_ANGLE + HACHURE_CROSS_DELTA, gap, rand, jit));
  return { hachure, solid: null };
}
function drawSceneSvg(data) {
  const box = data.w !== void 0 && data.h !== void 0 ? { x: 0, y: 0, w: data.w, h: data.h } : sceneBounds(data) ?? { x: 0, y: 0, w: 1e3, h: 600 };
  const svg = document.createElementNS(SVGNS2, "svg");
  svg.setAttribute("viewBox", `${f2(box.x)} ${f2(box.y)} ${f2(box.w)} ${f2(box.h)}`);
  svg.setAttribute("class", "o-draw-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const marks = svgEl3("g", { class: "o-draw-marks" }, svg);
  for (const e of data.elements) {
    const rand = mulberry32(e.seed ?? 1);
    const jit = ROUGH_JITTER[e.roughness ?? 1] ?? ROUGH_JITTER[1];
    const sw = e.strokeWidth ?? 2;
    const g = svgEl3("g", { class: "o-draw-el", "data-eid": e.id }, marks);
    if (e.opacity !== void 0 && e.opacity < 100) g.setAttribute("opacity", f2(e.opacity / 100));
    if (e.angle) {
      const cx = e.x + e.width / 2;
      const cy = e.y + e.height / 2;
      g.setAttribute("transform", `rotate(${f2(e.angle)} ${f2(cx)} ${f2(cy)})`);
    }
    const { hachure, solid } = fillPathsFor(e, rand, jit);
    const fill = e.fill ?? "";
    if (solid) svgEl3("path", { d: solid, fill, stroke: "none" }, g);
    for (const d of hachure) svgEl3("path", { d, fill: "none", stroke: fill, "stroke-width": f2(Math.max(1, sw * 0.6)), "stroke-linecap": "round" }, g);
    if (e.type === "text") {
      const lines = (e.text ?? "").split("\n");
      const fs = e.fontSize ?? 16;
      const anchor = e.textAlign === "center" ? "middle" : e.textAlign === "right" ? "end" : "start";
      const tx = e.textAlign === "center" ? e.x + e.width / 2 : e.textAlign === "right" ? e.x + e.width : e.x;
      const family = (e.roughness ?? 1) > 0 ? CHART_FONT_STACK.caveat : CHART_FONT_STACK[e.font ?? "inter"] ?? CHART_FONT_STACK.inter;
      lines.forEach((ln, i) => {
        const t = svgEl3("text", {
          x: f2(tx),
          y: f2(e.y + fs * 0.95 + i * fs * 1.3),
          fill: e.stroke,
          "font-size": f2(fs),
          "font-family": family,
          "text-anchor": anchor
        }, g);
        t.textContent = ln;
      });
      continue;
    }
    const dash = e.strokeStyle === "dashed" ? `${f2(sw * 3.5)} ${f2(sw * 2.5)}` : e.strokeStyle === "dotted" ? `0.1 ${f2(sw * 2.2)}` : void 0;
    for (const d of strokePathsFor(e, rand, jit)) {
      const attrs = { d, fill: "none", stroke: e.stroke, "stroke-width": f2(sw), "stroke-linecap": "round", "stroke-linejoin": "round" };
      if (dash) attrs["stroke-dasharray"] = dash;
      svgEl3("path", attrs, g);
    }
  }
  return svg;
}
var num = (x, fallback) => typeof x === "number" && Number.isFinite(x) ? x : fallback;
var clamp2 = (x, lo2, hi2) => Math.min(hi2, Math.max(lo2, x));
var hex = (x, fallback) => typeof x === "string" && /^#[0-9a-fA-F]{3,8}$/.test(x) ? x : fallback;
function normalizeElement(raw) {
  const e = raw ?? {};
  const type = DRAW_TYPES.includes(e.type) ? e.type : null;
  if (!type || typeof e.id !== "string" || !e.id) return null;
  const out = {
    id: e.id.slice(0, 40),
    type,
    x: clamp2(num(e.x, 0), -1e5, 1e5),
    y: clamp2(num(e.y, 0), -1e5, 1e5),
    width: Math.max(0, clamp2(num(e.width, 0), -1e5, 1e5)),
    height: Math.max(0, clamp2(num(e.height, 0), -1e5, 1e5)),
    stroke: hex(e.stroke, "#333333")
  };
  if (typeof e.name === "string" && e.name.trim()) out.name = e.name.trim().slice(0, 40);
  if (typeof e.angle === "number" && Number.isFinite(e.angle)) out.angle = e.angle;
  if (e.fill === "" || typeof e.fill === "string" && /^#[0-9a-fA-F]{3,8}$/.test(e.fill)) out.fill = e.fill;
  if (e.fillStyle === "none" || e.fillStyle === "hachure" || e.fillStyle === "cross" || e.fillStyle === "solid") out.fillStyle = e.fillStyle;
  if (e.strokeWidth !== void 0) out.strokeWidth = clamp2(Math.round(num(e.strokeWidth, 2)), 1, 8);
  if (e.strokeStyle === "solid" || e.strokeStyle === "dashed" || e.strokeStyle === "dotted") out.strokeStyle = e.strokeStyle;
  if (e.roughness === 0 || e.roughness === 1 || e.roughness === 2) out.roughness = e.roughness;
  if (e.opacity !== void 0) out.opacity = clamp2(Math.round(num(e.opacity, 100)), 0, 100);
  if (typeof e.seed === "number" && Number.isInteger(e.seed) && e.seed >= 1) out.seed = Math.min(e.seed, 2147483647);
  if (type === "arrow" || type === "line" || type === "freedraw") {
    const pts = Array.isArray(e.points) ? e.points : [];
    const clean = [];
    for (const p of pts.slice(0, DRAW_MAX_POINTS)) {
      if (Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && Number.isFinite(p[0]) && typeof p[1] === "number" && Number.isFinite(p[1])) {
        clean.push([clamp2(p[0], -1e5, 1e5), clamp2(p[1], -1e5, 1e5)]);
      }
    }
    if (clean.length < 2) return null;
    out.points = clean;
    if (e.attach && typeof e.attach === "object") {
      out.attach = e.attach;
    }
  }
  if (type === "text") {
    if (typeof e.text !== "string" || !e.text) return null;
    out.text = e.text.slice(0, 2e3);
    if (e.fontSize !== void 0) out.fontSize = clamp2(num(e.fontSize, 16), 6, 200);
    if (e.font === "playfair" || e.font === "lora" || e.font === "inter" || e.font === "source-serif" || e.font === "caveat") out.font = e.font;
    if (e.textAlign === "left" || e.textAlign === "center" || e.textAlign === "right") out.textAlign = e.textAlign;
  }
  return out;
}
function normalizeDrawData(raw) {
  const d = raw ?? {};
  const els = d.elements;
  const elements = [];
  if (Array.isArray(els)) {
    for (const e of els.slice(0, DRAW_MAX_ELEMENTS)) {
      const n = normalizeElement(e);
      if (n) elements.push(n);
    }
  }
  const out = { elements };
  if (typeof d.wpct === "number" && Number.isFinite(d.wpct)) out.wpct = clamp2(Math.round(d.wpct), 10, 100);
  if (typeof d.replay === "boolean") out.replay = d.replay;
  if (Array.isArray(d.replayOrder)) {
    const ids2 = new Set(elements.map((x) => x.id));
    const order = [];
    for (const id of d.replayOrder.slice(0, DRAW_MAX_ELEMENTS)) {
      if (typeof id === "string" && ids2.has(id) && !order.includes(id)) order.push(id);
    }
    if (order.length) out.replayOrder = order;
  }
  const ids = new Set(elements.map((x) => x.id));
  for (const n of elements) {
    const a = n.attach;
    if (!a) continue;
    if (n.type !== "arrow" && n.type !== "line") {
      delete n.attach;
      continue;
    }
    const from = typeof a.from === "string" && ids.has(a.from) ? a.from : void 0;
    const to = typeof a.to === "string" && ids.has(a.to) ? a.to : void 0;
    if (from || to) n.attach = { ...from ? { from } : {}, ...to ? { to } : {} };
    else delete n.attach;
  }
  for (const k of ["w", "h"]) {
    const v = d[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = clamp2(v, 50, 1e5);
  }
  return out;
}
function drawContainerOf(block) {
  return block.closest("figure") ?? block.parentElement;
}
function parseDrawFigureData(figure) {
  const block = figure.querySelector('script[data-odata="draw"]');
  if (!block?.textContent) return null;
  try {
    return normalizeDrawData(JSON.parse(block.textContent));
  } catch {
    return null;
  }
}
function renderDraw(figure, data) {
  const mount = figure.querySelector("[data-draw-mount]");
  if (!mount) return;
  mount.textContent = "";
  mount.appendChild(drawSceneSvg(data));
  applyDrawLayout(figure, mount, data);
}
function applyDrawLayout(figure, mount, data) {
  if (!figure.hasAttribute("data-ofloat")) {
    figure.style.width = data.wpct !== void 0 ? `${data.wpct}%` : "";
  }
  if (data.w !== void 0 && data.h !== void 0) mount.style.setProperty("--odraw-ar", `${data.w} / ${data.h}`);
  else mount.style.removeProperty("--odraw-ar");
}
function mountDraws(slide) {
  slide.querySelectorAll('script[data-odata="draw"]').forEach((block) => {
    const root = drawContainerOf(block);
    if (!root) return;
    const data = parseDrawFigureData(root);
    if (data) renderDraw(root, data);
    else {
      const mount = root.querySelector("[data-draw-mount]");
      if (mount) mount.textContent = "draw data block missing or unparseable";
    }
  });
  armDrawReplay(slide);
}
var finalizeDraws = mountDraws;
function replayDrawInks(svg, order) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const groups = Array.from(svg.querySelectorAll(":scope > .o-draw-marks > .o-draw-el"));
  if (order?.length) {
    const rank = new Map(order.map((id, i) => [id, i]));
    const key = (g) => rank.get(g.getAttribute("data-eid") ?? "");
    groups.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka !== void 0 && kb !== void 0) return ka - kb;
      if (ka !== void 0) return -1;
      if (kb !== void 0) return 1;
      return 0;
    });
  }
  for (const g of groups) {
    const paths = Array.from(g.querySelectorAll("path"));
    const isText = g.querySelector("text") !== null;
    for (const p of paths) {
      const len = typeof p.getTotalLength === "function" ? p.getTotalLength() : 0;
      if (len && Number.isFinite(len) && !p.hasAttribute("stroke-dasharray")) {
        p.style.strokeDasharray = `${len}`;
        p.style.strokeDashoffset = `${len}`;
      } else {
        p.style.opacity = "0";
      }
    }
    if (isText) g.style.opacity = "0";
  }
  const cleanup = [];
  let maxEnd = 0;
  groups.forEach((g, gi) => {
    const delay = gi * 0.22;
    const paths = Array.from(g.querySelectorAll("path"));
    const isText = g.querySelector("text") !== null;
    const run = () => {
      for (const p of paths) {
        const len = typeof p.getTotalLength === "function" ? p.getTotalLength() : 0;
        const dashed = p.hasAttribute("stroke-dasharray");
        if (!len || !Number.isFinite(len) || dashed) {
          p.style.opacity = "0";
          p.getBoundingClientRect();
          p.style.transition = `opacity 0.3s ease ${delay.toFixed(2)}s`;
          p.style.opacity = "1";
          cleanup.push(() => {
            p.style.opacity = "";
            p.style.transition = "";
          });
          maxEnd = Math.max(maxEnd, delay + 0.3);
          continue;
        }
        p.getBoundingClientRect();
        const dur = Math.min(0.9, 0.18 + len / 900);
        p.style.transition = `stroke-dashoffset ${dur.toFixed(2)}s ease-out ${delay.toFixed(2)}s`;
        p.style.strokeDashoffset = "0";
        cleanup.push(() => {
          p.style.strokeDasharray = "";
          p.style.strokeDashoffset = "";
          p.style.transition = "";
        });
        maxEnd = Math.max(maxEnd, delay + dur);
      }
      if (isText) {
        g.getBoundingClientRect();
        g.style.transition = `opacity 0.35s ease ${(delay + 0.1).toFixed(2)}s`;
        g.style.opacity = "1";
        cleanup.push(() => {
          g.style.opacity = "";
          g.style.transition = "";
        });
        maxEnd = Math.max(maxEnd, delay + 0.45);
      }
    };
    if (document.visibilityState === "hidden") return;
    window.setTimeout(run, 30);
  });
  if (maxEnd > 0) window.setTimeout(() => cleanup.forEach((f) => f()), (maxEnd + 0.4) * 1e3);
}
function armDrawReplay(slide) {
  const fire = () => {
    const presentMode = document.documentElement.classList.contains("o-present");
    const scrollMode = document.querySelector(".o-scroll") !== null;
    if (!presentMode && !scrollMode) return;
    slide.querySelectorAll("figure.o-drawfig").forEach((fig) => {
      const svg = fig.querySelector(".o-draw-svg");
      if (!svg) return;
      const data = parseDrawFigureData(fig);
      if (data?.replay === false) return;
      replayDrawInks(svg, data?.replayOrder);
    });
  };
  const presentNow = slide.classList.contains("is-shown");
  const scrollNow = slide.classList.contains("is-revealed");
  if (presentNow && document.documentElement.classList.contains("o-present") || scrollNow) {
    fire();
    return;
  }
  const obs = new MutationObserver(() => {
    if (slide.classList.contains("is-shown") || slide.classList.contains("is-revealed")) {
      obs.disconnect();
      fire();
    }
  });
  obs.observe(slide, { attributes: true, attributeFilter: ["class"] });
}

// src/venn.ts
var SVGNS3 = "http://www.w3.org/2000/svg";
var HEX_RE4 = /^#[0-9a-fA-F]{3,8}$/;
var DEFAULT_COLORS = ["#4A8CC4", "#D9A520", "#3D8B5A", "#B3402A", "#7A5FA8", "#2F8C9A"];
var DEFAULT_LABELS = ["Set A", "Set B", "Set C", "Set D", "Set E", "Set F"];
var svgEl4 = (tag, attrs, parent) => {
  const e = document.createElementNS(SVGNS3, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
};
var clampCount = (x) => x === 3 || x === 4 || x === 5 || x === 6 ? x : 2;
function sizeKey(raw) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return {};
  const size = Math.max(VENN_SIZE_MIN, Math.min(VENN_SIZE_MAX, raw));
  return size === 1 ? {} : { size };
}
function nudgeKeys(o) {
  const one = (raw) => {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
    return Math.round(Math.max(-VENN_NUDGE_MAX, Math.min(VENN_NUDGE_MAX, raw)) * 10) / 10;
  };
  const dx = one(o.dx);
  const dy = one(o.dy);
  return { ...dx ? { dx } : {}, ...dy ? { dy } : {} };
}
function normalizeVennData(raw) {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const count = clampCount(d.count);
  const rawSets = Array.isArray(d.sets) ? d.sets : [];
  const sets = [];
  for (let i = 0; i < count; i++) {
    const o = rawSets[i] ?? {};
    sets.push({
      label: typeof o.label === "string" ? o.label.slice(0, 40) : DEFAULT_LABELS[i],
      color: typeof o.color === "string" && HEX_RE4.test(o.color) ? o.color : DEFAULT_COLORS[i],
      ...sizeKey(o.size),
      ...nudgeKeys(o)
    });
  }
  const overlaps2 = [];
  const rawOverlaps = Array.isArray(d.overlaps) ? d.overlaps : [];
  for (const rawO of rawOverlaps) {
    const o = rawO ?? {};
    if (!Array.isArray(o.sets)) continue;
    const idx = [...new Set(o.sets.filter((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < count))].sort((a, b) => a - b);
    if (idx.length < 2) continue;
    const label = typeof o.label === "string" ? o.label.slice(0, 40) : "";
    const x = typeof o.x === "number" && Number.isFinite(o.x) ? Math.max(0, Math.min(100, o.x)) : 50;
    const y = typeof o.y === "number" && Number.isFinite(o.y) ? Math.max(0, Math.min(100, o.y)) : 50;
    overlaps2.push({ sets: idx, label, x, y, ...sizeKey(o.size), ...nudgeKeys(o) });
  }
  return { count, sets, ...overlaps2.length ? { overlaps: overlaps2 } : {} };
}
function parseVennFigureData(figure) {
  const block = figure.querySelector('script[data-odata="venn"]');
  if (!block?.textContent) return null;
  try {
    return normalizeVennData(JSON.parse(block.textContent));
  } catch {
    return null;
  }
}
function vennViewBox(count) {
  return count <= 3 ? { w: 400, h: 280 } : { w: 400, h: 360 };
}
function vennLayout(count) {
  if (count === 2) {
    return [
      { cx: 150, cy: 140, r: 100, lx: 95, ly: 140 },
      { cx: 250, cy: 140, r: 100, lx: 305, ly: 140 }
    ];
  }
  if (count === 3) {
    return [
      { cx: 155, cy: 115, r: 92, lx: 105, ly: 85 },
      { cx: 245, cy: 115, r: 92, lx: 295, ly: 85 },
      { cx: 200, cy: 185, r: 92, lx: 200, ly: 235 }
    ];
  }
  const R2 = 76;
  const r = 92;
  const cx0 = 200;
  const cy0 = 180;
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / count;
    const lx = cx0 + (R2 + r * 0.72) * Math.cos(a);
    const ly = cy0 + (R2 + r * 0.72) * Math.sin(a);
    return { cx: cx0 + R2 * Math.cos(a), cy: cy0 + R2 * Math.sin(a), r, lx, ly };
  });
}
function vennContainingSets(data, x, y) {
  const n = normalizeVennData(data);
  const out = [];
  vennLayout(n.count).forEach((p, i) => {
    const dx = x - p.cx;
    const dy = y - p.cy;
    if (dx * dx + dy * dy <= p.r * p.r) out.push(i);
  });
  return out;
}
var vennOverlapKey = (sets) => [...sets].sort((a, b) => a - b).join(",");
function wrapVennLabel(text, fontSize, maxWidth) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if (estTextWidth(`${cur} ${w}`, fontSize) <= maxWidth) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
var MIN_LABEL_SIZE = 7;
function fitVennLabelSize(text, fontSize, maxWidth) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return fontSize;
  const widest = Math.max(...words.map((w) => estTextWidth(w, fontSize)));
  if (widest <= maxWidth) return fontSize;
  return Math.max(MIN_LABEL_SIZE, fontSize * maxWidth / widest);
}
var LABEL_EDGE_MARGIN = 8;
function nudged(x, y, dx, dy, vb) {
  const m = 10;
  return {
    x: Math.max(m, Math.min(vb.w - m, x + (dx ?? 0))),
    y: Math.max(m, Math.min(vb.h - m, y + (dy ?? 0)))
  };
}
function setLabelWrapWidth(p) {
  const dy = Math.abs(p.ly - p.cy);
  const halfChord = Math.sqrt(Math.max(0, p.r * p.r - dy * dy));
  const toLeft = p.lx - (p.cx - halfChord);
  const toRight = p.cx + halfChord - p.lx;
  return Math.max(44, Math.min(toLeft, toRight) * 2 - LABEL_EDGE_MARGIN);
}
function mergeVennOverlaps(data, keys, label) {
  const overlaps2 = data.overlaps ?? [];
  const chosen = overlaps2.filter((o) => keys.includes(vennOverlapKey(o.sets)));
  if (chosen.length < 2) return data;
  const union = [...new Set(chosen.flatMap((o) => o.sets))].sort((a, b) => a - b);
  const x = chosen.reduce((s2, o) => s2 + o.x, 0) / chosen.length;
  const y = chosen.reduce((s2, o) => s2 + o.y, 0) / chosen.length;
  const rest = overlaps2.filter((o) => !keys.includes(vennOverlapKey(o.sets)));
  return { ...data, overlaps: [...rest, { sets: union, label: label.slice(0, 40), x, y }] };
}
var lin = (c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
function rgb01(hex3) {
  const h = hex3.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255];
}
function luminance2(hex3) {
  const [r, g, b] = rgb01(hex3);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function blendLuminance(hexes) {
  let r = 1;
  let g = 1;
  let b = 1;
  for (const h of hexes) {
    const [cr, cg, cb] = rgb01(h);
    r *= cr;
    g *= cg;
    b *= cb;
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
var inkFor = (lum) => lum > 0.55 ? "#1a1a1a" : "#ffffff";
function halo(t, ink) {
  t.setAttribute("stroke", ink === "#ffffff" ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)");
  t.setAttribute("stroke-width", "3");
  t.setAttribute("paint-order", "stroke fill");
}
function wrappedText(parent, o) {
  const size = fitVennLabelSize(o.text, o.fontSize, o.maxWidth);
  const lines = wrapVennLabel(o.text, size, o.maxWidth);
  const lineH = size * 1.24;
  const t = svgEl4("text", {
    class: o.cls,
    x: o.x,
    y: o.y,
    "text-anchor": "middle",
    "dominant-baseline": "middle",
    fill: o.ink,
    "font-size": String(Math.round(size * 100) / 100),
    "font-weight": String(o.fontWeight),
    "font-family": "var(--font, Inter, system-ui, sans-serif)",
    ...o.fontStyle ? { "font-style": o.fontStyle } : {},
    ...o.attrs
  }, parent);
  halo(t, o.ink);
  lines.forEach((line, i) => {
    const span2 = svgEl4("tspan", {
      x: o.x,
      // centre the BLOCK on the label point: half a line-height per line above the middle.
      // The old -0.62 was a two-line constant applied to every count, so a wrapped label sat
      // 0.12 line-heights high at two lines and 0.38 LOW at three — a systematic, N-dependent
      // drift that read as a label slightly ajar of the region it names.
      dy: i === 0 ? -(lines.length - 1) / 2 * lineH : lineH
    }, t);
    span2.textContent = line;
  });
  return { lines, lineH };
}
function vennSceneSvg(data, selected) {
  const n = normalizeVennData(data);
  const vb = vennViewBox(n.count);
  const svg = svgEl4("svg", {
    class: "o-venn-svg",
    viewBox: `0 0 ${vb.w} ${vb.h}`,
    xmlns: SVGNS3,
    role: "img",
    "aria-label": "Venn diagram"
  });
  const blend = svgEl4("g", { class: "o-venn-blend" }, svg);
  blend.setAttribute("style", "isolation: isolate");
  const places = vennLayout(n.count);
  n.sets.forEach((set, i) => {
    const p = places[i];
    const c = svgEl4("circle", {
      class: "o-venn-circle",
      cx: p.cx,
      cy: p.cy,
      r: p.r,
      fill: set.color,
      "data-set": String(i)
    }, blend);
    c.setAttribute("style", "mix-blend-mode: multiply");
    c.setAttribute("fill-opacity", "0.72");
  });
  const labels = svgEl4("g", { class: "o-venn-labels" }, svg);
  n.sets.forEach((set, i) => {
    const p = places[i];
    const ink = inkFor(luminance2(set.color));
    const seat = nudged(p.lx, p.ly, set.dx, set.dy, vb);
    wrappedText(labels, {
      cls: "o-venn-label",
      x: seat.x,
      y: seat.y,
      text: set.label || DEFAULT_LABELS[i],
      ink,
      fontSize: 15 * (set.size ?? 1),
      fontWeight: 600,
      maxWidth: setLabelWrapWidth(p),
      attrs: { "data-set": String(i), "data-size": String(set.size ?? 1), "data-dx": String(set.dx ?? 0), "data-dy": String(set.dy ?? 0) }
    });
  });
  for (const o of n.overlaps ?? []) {
    const ink = inkFor(blendLuminance(o.sets.map((i) => n.sets[i]?.color ?? DEFAULT_COLORS[i])));
    const key = vennOverlapKey(o.sets);
    const seat = nudged(o.x / 100 * vb.w, o.y / 100 * vb.h, o.dx, o.dy, vb);
    const cx = seat.x;
    const cy = seat.y;
    if (selected?.has(key)) {
      const sel = svgEl4("rect", {
        class: "o-venn-sel",
        x: cx - 56,
        y: cy - 11,
        width: 112,
        height: 22,
        rx: 11
      }, labels);
      sel.setAttribute("fill", "var(--accent)");
      sel.setAttribute("fill-opacity", "0.16");
    }
    wrappedText(labels, {
      cls: "o-venn-overlap",
      x: cx,
      y: cy,
      text: o.label,
      ink,
      fontSize: 12.5 * (o.size ?? 1),
      fontWeight: 500,
      maxWidth: 104,
      fontStyle: "italic",
      attrs: { "data-overlap": key, "data-size": String(o.size ?? 1), "data-dx": String(o.dx ?? 0), "data-dy": String(o.dy ?? 0) }
    });
  }
  return svg;
}
function vennContainerOf(block) {
  return block.closest("figure") ?? block.parentElement;
}
function renderVenn(figure, data, selected) {
  const mount = figure.querySelector("[data-venn-mount]");
  if (!mount) return;
  mount.textContent = "";
  mount.appendChild(vennSceneSvg(data, selected));
}
function mountVenns(slide) {
  slide.querySelectorAll('script[data-odata="venn"]').forEach((block) => {
    const root = vennContainerOf(block);
    if (!root) return;
    const data = parseVennFigureData(root);
    if (data) renderVenn(root, data);
    else {
      const mount = root.querySelector("[data-venn-mount]");
      if (mount) mount.textContent = "venn data block missing or unparseable";
    }
  });
}
var finalizeVenns = mountVenns;
function parseVennSlideData(root) {
  return parseVennFigureData(root);
}

// src/blocks/registry.ts
var RUNTIME_BLOCKS = [
  // slide-kind dispatch (conditional on slide.kind), in KIND_BEHAVIOURS order
  { key: "cover", slide: {} },
  { key: "bullets", slide: {} },
  { key: "stats", slide: {} },
  { key: "free", slide: {} },
  { key: "document", slide: { mount: docMount, finalize: docFinalize } },
  // clone-phase in-slide blocks — mounted in cloneSlide for stage AND print
  // forPrint reaches the gradient-id namespace: the print clone must not share `url(#…)` targets
  // with the display:none stage copy, or its area fills paint nothing (see chart/defs.ts).
  { key: "chart", sweep: { phase: "clone", mount: (s2, ctx) => mountCharts(s2, ctx.forPrint) } },
  {
    key: "video",
    sweep: {
      phase: "clone",
      mount: (s2, ctx) => mountVideos(s2, {
        capabilities: ctx.capabilities ?? [],
        interactive: !ctx.forPrint,
        referrerless: ctx.referrerless ?? false
      })
    }
  },
  // stage-phase in-slide blocks — interactive mount on stage, static finalize for print
  { key: "table", sweep: { phase: "stage", mount: (s2) => mountTables(s2), finalize: (s2) => finalizeTables(s2) } },
  { key: "grid", sweep: { phase: "stage", mount: (s2) => mountGrids(s2), finalize: (s2) => finalizeGrids(s2) } },
  { key: "tracker", sweep: { phase: "stage", mount: (s2) => mountTrackers(s2), finalize: (s2) => finalizeTrackers(s2) } },
  { key: "notes", sweep: { phase: "stage", mount: (s2, ctx) => mountNotes(s2, ctx.assets), finalize: (s2) => finalizeNotes(s2) } },
  // roadmap / flowchart / nodegraph — converted from whole-slide kinds to in-slide blocks; each sweep
  // renders BOTH a legacy .o-*-shell whole-fold and an in-slide .o-*fig figure (via *ContainerOf)
  { key: "gantt", sweep: { phase: "stage", mount: (s2) => mountGantts(s2), finalize: (s2) => finalizeGantts(s2) } },
  { key: "flow", sweep: { phase: "stage", mount: (s2) => mountFlows(s2), finalize: (s2) => finalizeFlows(s2) } },
  { key: "graph", sweep: { phase: "stage", mount: (s2) => mountGraphs(s2), finalize: (s2) => finalizeGraphs(s2) } },
  { key: "draw", sweep: { phase: "stage", mount: (s2) => mountDraws(s2), finalize: (s2) => finalizeDraws(s2) } },
  { key: "venn", sweep: { phase: "stage", mount: (s2) => mountVenns(s2), finalize: (s2) => finalizeVenns(s2) } }
];
var KIND_BEHAVIOURS = Object.fromEntries(
  RUNTIME_BLOCKS.filter((b) => b.slide).map((b) => [b.key, b.slide])
);
function mountCloneBlocks(slide, ctx) {
  for (const b of RUNTIME_BLOCKS) if (b.sweep?.phase === "clone") b.sweep.mount(slide, ctx);
}
function mountStageBlocks(slide, ctx) {
  for (const b of RUNTIME_BLOCKS) if (b.sweep?.phase === "stage") b.sweep.mount(slide, ctx);
}
function finalizeStageBlocks(slide, ctx) {
  for (const b of RUNTIME_BLOCKS) if (b.sweep?.phase === "stage") b.sweep.finalize?.(slide, ctx);
}

// src/kinds.ts
function mountCountUps(slide) {
  slide.querySelectorAll("[data-count-to]").forEach((el6) => {
    const to = parseInt(el6.getAttribute("data-count-to") ?? "0", 10) || 0;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / 800);
      el6.textContent = String(Math.round(to * p));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function finalizeCountUps(slide) {
  slide.querySelectorAll("[data-count-to]").forEach((el6) => {
    el6.textContent = el6.getAttribute("data-count-to") ?? el6.textContent;
  });
}
function readSpark(el6) {
  return (el6.getAttribute("data-spark") ?? "").split(",").map((s2) => Number(s2.trim())).filter((n) => Number.isFinite(n));
}
var SPARK_TONE = {
  accent: "var(--accent, #3F7268)",
  green: "#3D8B5A",
  amber: "#B07D2B",
  red: "#B3402A"
};
function drawSpark(el6, animate) {
  const vals = readSpark(el6);
  if (vals.length < 2) {
    el6.textContent = "";
    return;
  }
  const W = 100, H = 30, color = SPARK_TONE[el6.getAttribute("data-spark-tone") ?? "accent"] ?? SPARK_TONE.accent;
  const min = Math.min(...vals), max = Math.max(...vals), span2 = max - min || 1;
  const step = W / (vals.length - 1);
  const pts = vals.map((v, i) => `${Math.round(i * step * 100) / 100},${Math.round((H - 3 - (v - min) / span2 * (H - 6)) * 100) / 100}`);
  const last = pts[pts.length - 1].split(",");
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "o-spark-svg");
  const area = document.createElementNS(svgNs, "polygon");
  area.setAttribute("points", `0,${H} ${pts.join(" ")} ${W},${H}`);
  area.setAttribute("fill", color);
  area.setAttribute("opacity", "0.12");
  const line = document.createElementNS(svgNs, "polyline");
  line.setAttribute("points", pts.join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  const dot = document.createElementNS(svgNs, "circle");
  dot.setAttribute("cx", last[0]);
  dot.setAttribute("cy", last[1]);
  dot.setAttribute("r", "2.4");
  dot.setAttribute("fill", color);
  svg.append(area, line, dot);
  if (animate) {
    const len = 200;
    line.style.strokeDasharray = String(len);
    line.style.strokeDashoffset = String(len);
    line.style.transition = "stroke-dashoffset .9s cubic-bezier(.2,.7,.2,1)";
    requestAnimationFrame(() => {
      line.style.strokeDashoffset = "0";
    });
  }
  el6.textContent = "";
  el6.appendChild(svg);
}
function mountSparklines(slide) {
  slide.querySelectorAll(".o-spark[data-spark]").forEach((el6) => drawSpark(el6, true));
}
function finalizeSparklines(slide) {
  slide.querySelectorAll(".o-spark[data-spark]").forEach((el6) => drawSpark(el6, false));
}
function mountKind(kind, slide) {
  KIND_BEHAVIOURS[kind]?.mount?.(slide);
}
function finalizeKind(kind, slide) {
  KIND_BEHAVIOURS[kind]?.finalize?.(slide);
}

// src/lite-edit.ts
var LITE_LEAF = "h1,h2,h3,h4,p,li,th,td,figcaption,footer,.lbl,.o-btn,.o-pill,code";
var KIND_MOUNTS = "[data-gantt-mount],[data-tracker-mount],[data-flow-mount],[data-graph-mount],[data-chart-mount],[data-video-mount],[data-toc-mount]";
var INLINE_OK = /* @__PURE__ */ new Set([
  "A",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "CODE",
  "SPAN",
  "SMALL",
  "MARK",
  "SUB",
  "SUP",
  "ABBR",
  "KBD",
  "BR",
  "WBR",
  "TIME",
  "CITE",
  "Q",
  "VAR",
  "SAMP"
]);
function isInlineEditable(el6) {
  for (const d of el6.querySelectorAll("*")) if (!INLINE_OK.has(d.tagName)) return false;
  return true;
}
function liteEditNodes(scope) {
  const cand = Array.from(scope.querySelectorAll(LITE_LEAF)).filter(
    (n) => !n.hasAttribute("data-count-to") && !n.closest(KIND_MOUNTS) && isInlineEditable(n)
  );
  const set = new Set(cand);
  return cand.filter((n) => {
    const outer = n.parentElement?.closest(LITE_LEAF);
    return !(outer && set.has(outer));
  });
}
var HREF_BAD = /^\s*(javascript|data|vbscript):/i;
var SAFE_COLOR_STYLE = /^\s*color\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%/]+\)|hsla?\([\d.,\s%/]+\)|var\(--[\w-]+\)|[a-z]+)\s*;?\s*$/i;
var DROP = /* @__PURE__ */ new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "LINK",
  "META",
  "BASE",
  "FORM",
  "SVG",
  "MATH",
  "TEMPLATE",
  "NOSCRIPT",
  "TITLE",
  "IMG",
  "VIDEO",
  "AUDIO",
  "SOURCE"
]);
function sanitizeInline(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  for (const el6 of Array.from(t.content.querySelectorAll("*"))) {
    if (DROP.has(el6.tagName)) {
      el6.remove();
      continue;
    }
    if (!INLINE_OK.has(el6.tagName)) {
      el6.replaceWith(...Array.from(el6.childNodes));
      continue;
    }
    for (const attr of Array.from(el6.attributes)) {
      const name = attr.name.toLowerCase();
      const keep = name === "class" || el6.tagName === "A" && name === "href" && !HREF_BAD.test(attr.value) || name === "style" && SAFE_COLOR_STYLE.test(attr.value);
      if (!keep) el6.removeAttribute(attr.name);
    }
  }
  return t.innerHTML;
}
function buildEditedCopy(pristine, edits) {
  let deck = parseDeck(pristine);
  for (const [id, values] of edits) {
    if (!deck.slideById.has(id)) continue;
    const host = document.createElement("template");
    host.innerHTML = slideInner(deck, id);
    liteEditNodes(host.content).forEach((n, i) => {
      if (values[i] !== void 0) n.innerHTML = sanitizeInline(values[i]);
    });
    deck = replaceSlideInner(deck, id, host.innerHTML);
  }
  return deck.text;
}
function downloadCopy(text, title) {
  const safe = (title || "deck").replace(/[\\/:*?"<>|]+/g, "_").trim() || "deck";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/html" }));
  a.download = `${safe} (edited).origami.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  const url = a.href;
  setTimeout(() => URL.revokeObjectURL(url), 2e3);
}

// src/css.ts
var BASE_CSS = `
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--font-body);
  /* Deck flow text reads at the SAME readable size as a Scroll/document fold
     (.k-document .o-doc pins 17px below): a deck's 1em base is set here so plain
     paragraphs, lists and .o-text are 17px in a Deck just as they are in a Scroll.
     Headings/lede/stat numbers set their own px/clamp sizes, so they're unaffected.
     Line-height stays the default \u2014 decks are short slide text, not long prose, and a
     global loose leading would balloon grid/table row heights. */
  font-size: 17px;
  /* --bg-grad lets the theme paint a gradient background (set by the Studio's background
     gradient control); it falls back to the solid --bg, so --bg stays a plain colour for
     the color-mix() + chrome-fade uses that need one. Byte-stable when --bg-grad is unset. */
  background: var(--bg-grad, var(--bg));
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.slide {
  min-height: 100vh;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  box-sizing: border-box;
  /* a positioned block walks right via margin-left and is pulled back into view by
     translate; the margin still grows the layout box, so clip the horizontal overflow
     to keep that off-screen remainder from raising a page scrollbar (vertical stays
     visible \u2014 clip does not force the other axis to auto) */
  overflow-x: clip;
  /* a stacking context so a Backdrop (an absolute z-index:-1 child, anchored
     HERE \u2014 not to the document paper) sits behind the slide content but above
     the slide's own background, on slides AND documents, and stays inside the
     slide when cloned for the PowerPoint rasteriser */
  position: relative; isolation: isolate;
  background:
    radial-gradient(circle at 12% 8%, var(--tint-a) 0%, transparent 42%),
    radial-gradient(circle at 88% 92%, var(--tint-b) 0%, transparent 42%),
    var(--fold-bg, var(--bg-grad, var(--bg)));
}
/* --fold-bg is a PER-FOLD background override the studio sets inline on a card's section.slide
   (documents use --fold-paper on the paper instead, since their .o-doc paper is opaque). Unset ===
   the theme background, so a deck that never sets a fold colour serializes byte-identically. */
/* position:relative makes the content column the positioning frame for FLOATING LAYERS, so a layer
   is placed relative to the content (identical in the editor and in present/print) rather than the
   stage (whose height differs \u2014 min-height:100vh while editing vs fit-to-screen when presented,
   which slid a layer off its mark). A document's .o-doc is already relative, so this only newly
   affects cards. */
/* --obw is FLOORED at the default here: the block-width grip narrows the BLOCK it hangs off (the
   data figure consumes --obw itself, below), not the whole fold \u2014 a narrow block must not drag the
   fold's title and prose in with it. A --obw WIDER than the default still grows the fold, exactly
   as before; 90vw stays the viewport guard. */
.slide-inner { width: min(max(var(--obw, 2600px), 2600px), 90vw); margin: 0 auto; padding: clamp(72px, 12vh, 128px) 0; position: relative; }
/* blocks inserted beside a kind component (roadmap/tracker/flow/graph folds
   have no .slide-inner) get the standard column gutter instead of full-bleed */
.k-gantt > :not(.o-gantt-shell), .k-tracker > :not(.o-tracker-shell),
.k-grid > :not(.o-grid-shell), .k-table > :not(.o-table-shell),
.k-flow > :not(.o-flow-shell), .k-graph > :not(.o-graph-shell) {
  width: min(1080px, 90vw); margin-left: auto; margin-right: auto;
}
.eyebrow {
  font-size: calc(13px * var(--osz, 1)); font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.2em; color: var(--accent); margin: 0 0 22px;
}
h1 {
  font-family: var(--font-display); font-weight: 600;
  font-size: calc(clamp(48px, 7.5vw, 96px) * var(--osz, 1)); line-height: 1.02;
  letter-spacing: -0.022em; margin: 0 0 28px;
}
h2 {
  font-family: var(--font-display); font-weight: 600;
  font-size: calc(clamp(36px, 4.8vw, 60px) * var(--osz, 1)); line-height: 1.06;
  letter-spacing: -0.018em; margin: 0 0 26px;
}
.lede { font-size: calc(clamp(19px, 2.1vw, 26px) * var(--osz, 1)); color: var(--ink-soft); max-width: 56ch; line-height: 1.55; }
p { margin: 0 0 14px; font-size: calc(1em * var(--osz, 1)); }
/* divider: tone dots colour it; a dedicated thickness control sets data-othick (1\u20138px) */
.rule { border: none; border-top: calc(var(--othk, 1) * 1px) solid var(--rule); margin: 28px 0; }
.rule[data-otone] { border-top-color: var(--tone, var(--rule)); }
.rule[data-othick="2"] { --othk: 2; }
.rule[data-othick="3"] { --othk: 3; }
.rule[data-othick="4"] { --othk: 4; }
.rule[data-othick="6"] { --othk: 6; }
.rule[data-othick="8"] { --othk: 8; }

/* two columns read as coloured "pills": col 1 outlined on paper, col 2 a filled
   dark panel (theme-aware \u2014 tracks --ink/--paper, so it recolours with the deck).
   align-items:stretch keeps the pair equal height like cards. */
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(24px, 3.5vw, 48px); align-items: stretch; margin: 18px 0; }
.cols > .col { padding: clamp(20px, 3vw, 32px); border-radius: 14px; }
.cols > .col:nth-child(1) { background: var(--paper); border: 1.5px solid var(--rule); box-shadow: 0 1px 2px rgba(26,26,26,0.04); }
.cols > .col:nth-child(2) { background: var(--ink); color: var(--paper); border: 1.5px solid transparent; }
/* the toolbar's tone dots recolour both column PANELS (pills) when the .cols block is
   selected \u2014 text inside a column is recoloured via its own selection toolbar, not this.
   Same specificity as the nth-child defaults above, placed after so a set tone wins. */
.cols[data-otone] > .col { background: var(--tone); border-color: transparent; color: #fff; }
/* per-column tone: select ONE column (click its padding) and tone it \u2014 each pill keeps its
   theme default until changed, and an individual tone wins over the whole-block one above */
.cols > .col[data-otone] { background: var(--tone); border-color: transparent; color: #fff; }
@media (max-width: 760px) { .cols { grid-template-columns: 1fr; } }
.card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: clamp(16px, 2vw, 28px); margin-top: clamp(28px, 5vh, 52px); }
/* cards-per-row override (toolbar \u25A6): pin 2/3/4 so a row of 4 can become a
   wider pair; minmax(0,1fr) keeps a long stat number from blowing the track */
.card-grid[data-ocols="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.card-grid[data-ocols="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.card-grid[data-ocols="4"] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.stat-card { background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: clamp(24px, 3vw, 40px); box-shadow: 0 1px 2px rgba(26,26,26,0.04), 0 6px 24px rgba(26,26,26,0.05); }
.stat-card .big { font-family: var(--font-display); font-size: calc(clamp(48px, 5.5vw, 84px) * var(--osz, 1)); font-weight: 600; line-height: 1; letter-spacing: -0.02em; }
.stat-card .lbl { font-size: calc(14px * var(--osz, 1)); font-weight: 600; color: var(--ink-soft); margin-top: 14px; text-transform: uppercase; letter-spacing: 0.08em; }
/* CARD BACKGROUND FILL \u2014 the same soft-tint recipe as a text block's fill (data-ofill on .o-text,
   below) and a table cell's (data-ofill on td/th, further down) \u2014 one mental model for "fill" across
   the deck. .stat-card already carries its own padding/radius (the plain --paper card), so the fill
   only swaps the background; nothing else moves. The Theme panel's "Cards" swatch (the paper token)
   stays the deck-wide default \u2014 this is a per-card override, same relationship data-otone already has. */
.stat-card[data-ofill] {
  --o-fill: var(--accent);
  background: color-mix(in srgb, var(--o-fill) calc(var(--ofa, 10) * 1%), var(--paper));
}
.stat-card[data-ofill="green"] { --o-fill: #3D8B5A; }
.stat-card[data-ofill="amber"] { --o-fill: #B07D2B; }
.stat-card[data-ofill="red"] { --o-fill: #B3402A; }
.stat-card[data-ofill="ink"] { --o-fill: var(--ink); }
/* the stamp is a normal block image \u2014 it stacks and inserts behave normally.
   (round H's auto inline-block "lockup" hijacked the next block onto the
   stamp's line, which misplaced inserts and broke the gap dots \u2014 dropped.) */
/* --sw (continuous, from the drag handle) wins over --osz (the discrete A\u2212/A+ enum) when set */
.o-cover-mark { display: block; height: calc(72px * var(--sw, var(--osz, 1))); width: auto; max-width: calc(300px * var(--sw, var(--osz, 1))); object-fit: contain; object-position: left; margin-bottom: 28px; }
.o-text { margin: 14px 0; font-size: calc(1em * var(--osz, 1)); }
/* paragraphs inside a text block read as one flowing box, not stacked blocks */
.o-text p { margin: 0 0 8px; }
.o-text p:last-child { margin-bottom: 0; }
/* multi-column prose (toolbar "Columns" on a text block): a grid of INDEPENDENT text columns
   \u2014 each track is its own editable .o-text, so a click selects/edits only that column and text
   never flows between them (a text block with data-ocols>=2 is transformed into this grid; 1
   transforms it back to a flat .o-text \u2014 see setTextColumns). No .col wrapper and no paper/ink
   panel decoration (that lives on .cols), so prose styling applies to the bare columns and there
   is zero specificity interaction with .cols. min-width:0 lets a track shrink below its longest
   word rather than blowing the grid wide. */
.o-tcols { display: grid; gap: clamp(24px, 3.5vw, 48px); align-items: start; margin: 14px 0; }
/* min-height keeps an EMPTY column visible (and so clickable to fill): an empty <p> carries no line
   box, so without it a blank column collapsed to nothing \u2014 invisible in the editor and in present
   alike, which read as "the other columns don't show" once one was left blank. */
.o-tcols > .o-text { margin: 0; min-width: 0; min-height: 1.5em; }
.o-tcols[data-ocols="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.o-tcols[data-ocols="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.o-tcols[data-ocols="4"] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 760px) { .o-tcols { grid-template-columns: 1fr; } }
/* Tinted panel behind the prose \u2014 the callout's colour-mix recipe, so both read as one material.
   Padding + radius appear ONLY when filled, or every existing deck would gain indents. Its own
   attribute, NOT data-otone: tone already means TEXT colour here, and the two must stay separate.
   --ofa is how much of the colour is mixed into the paper: a raw hex reads as a hard slab, and what
   a page of prose wants is a soft tint of it, so the strength is the user's to set (default 10%). */
.o-text[data-ofill] {
  --o-fill: var(--accent);
  background: color-mix(in srgb, var(--o-fill) calc(var(--ofa, 10) * 1%), var(--paper));
  padding: 14px 18px; border-radius: 10px;
}
.o-text[data-ofill="green"] { --o-fill: #3D8B5A; }
.o-text[data-ofill="amber"] { --o-fill: #B07D2B; }
.o-text[data-ofill="red"] { --o-fill: #B3402A; }
.o-text[data-ofill="ink"] { --o-fill: var(--ink); }
/* scratch-pad fold: a notebook skin (a left margin gutter), theme-aware. The accent RULE that
   used to draw down that gutter is gone: it read as a stray vertical line an author could not
   select, click or delete. The indent stays, so existing scratch content does not shift. */
.o-scratch { padding-left: clamp(18px, 3vw, 36px); }
ul, ol { font-size: calc(1em * var(--osz, 1)); }
figcaption { font-size: calc(1em * var(--osz, 1)); }

/* ---- block formatting vocabulary (data-o*): core, kind-agnostic.
   Size = a multiplier consumed by the type rules above. The :where reset
   stops it inheriting into nested consuming rules (a quote's <p> would
   otherwise scale twice); the scaled font-size itself flows down via em.
   Tone = an inherited custom property (presets below, custom via
   style="--tone:#hex"). ---- */
[data-oalign="left"] { text-align: left; }
[data-oalign="center"] { text-align: center; }
[data-oalign="right"] { text-align: right; }
figure.o-img[data-oalign="center"] { margin-left: auto; margin-right: auto; }
figure.o-img[data-oalign="right"] { margin-left: auto; }
.o-cover-mark[data-oalign="center"] { margin-left: auto; margin-right: auto; object-position: center; }
.o-cover-mark[data-oalign="right"] { margin-left: auto; object-position: right; }
[data-osize] :where(*) { --osz: 1; }
/* The reset above zeroes --osz for every DESCENDANT, which works for text (the attribute sits on the
   same element that consumes it, and the scaled size flows down via em). A ledger is the exception:
   the attribute lands on the block <figure> but the cells live in an inner .o-ledger wrapper, so they
   would always read --osz:1. Re-expose the scale here \u2014 resolved ON the holder, where --osz is real \u2014
   under a name the reset does not touch, so it inherits into the grid. Consumed by the ledger rules. */
[data-osize] { --lgz: var(--osz, 1); }
[data-osize="s"] { --osz: 0.8; }
[data-osize="l"] { --osz: 1.25; }
[data-osize="xl"] { --osz: 1.55; }
[data-osize="xxl"] { --osz: 2; }
[data-osize="xxxl"] { --osz: 2.7; }
[data-otone] { color: var(--tone, inherit); }
[data-otone="accent"] { --tone: var(--accent); }
[data-otone="green"] { --tone: #3D8B5A; }
[data-otone="amber"] { --tone: #B07D2B; }
[data-otone="red"] { --tone: #B3402A; }
[data-otone="ink"] { --tone: var(--ink); }
/* inline word-colour spans (tone picker on a text selection) \u2014 class-based so they
   survive the inline sanitiser; mirror the data-otone preset palette */
.o-tone-accent { color: var(--accent); }
.o-tone-green { color: #3D8B5A; }
.o-tone-amber { color: #B07D2B; }
.o-tone-red { color: #B3402A; }
.o-tone-ink { color: var(--ink); }
.stat-card[data-otone] { border-color: var(--tone, var(--rule)); color: inherit; }
.stat-card[data-otone] .big { color: var(--tone, inherit); }
.o-btn[data-otone] { background: var(--tone, var(--accent)); color: #fff; }
.o-pill[data-otone] { border-color: var(--tone, var(--rule)); color: var(--tone, inherit); }
/* a resized image is block by default (so a following button/pill drops below
   it, not overlapping); it only goes inline-block when sat NEXT TO another
   resized image \u2014 that's the side-by-side case (:has, Chromium) */
figure.o-img[data-owidth] { width: calc(var(--ow, 100) * 1% - 6px); }
/* a side-by-side PAIR: both go inline-block, and EACH is capped just under half the row so
   the two ALWAYS fit on one line. The old fit was razor-thin (the -6px buffer + the 10px
   gutter + inter-block whitespace), so a hair over 50% tipped the second image onto its own
   line \u2014 the "invisible air gap" that dropped it down. The cap is a ceiling only: narrower
   images stay under it, so 3-up of small images still packs onto one row. */
figure.o-img[data-owidth]:has(+ figure.o-img[data-owidth]),
figure.o-img[data-owidth]:has(+ figure.o-img[data-owidth]) + figure.o-img[data-owidth] {
  display: inline-block; vertical-align: top; max-width: calc(50% - 12px);
}
/* the gutter between the pair, only on the UNpositioned second image \u2014 once it's positioned
   its own data-opos margin-left drives placement and must not be out-ranked by this gutter.
   A FLOATED second image is excluded for the same reason and one more: this selector is (0,7,3),
   so it out-ranks every float rule below it \u2014 the base (0,1,0) and the repeated-attribute margin
   rule at (0,4,0) alike \u2014 and on an absolutely positioned box the left property positions the
   MARGIN edge, so 8px of gutter is 8px of misplacement (measured +8.01 before this guard).
   The half-row CAP above is deliberately NOT excluded: it is what holds the layer at the width it
   had in the flow, and dropping it doubles the picture's width the instant it floats (measured
   519.9 -> 1057.8px), which is the same jump this arc exists to remove. */
figure.o-img[data-owidth]:has(+ figure.o-img[data-owidth]) + figure.o-img[data-owidth]:not([data-opos]):not([data-ofloat]) { margin-left: 8px; }
[data-ofont="playfair"] { font-family: 'Playfair Display', Georgia, serif; }
[data-ofont="lora"] { font-family: 'Lora', Georgia, serif; }
[data-ofont="inter"] { font-family: 'Inter', "Segoe UI", Arial, sans-serif; }
[data-ofont="source-serif"] { font-family: 'Source Serif 4', Georgia, serif; }
[data-ofont="caveat"] { font-family: 'Caveat', "Segoe Script", cursive; }
/* header-row / first-column fill \u2014 the colour is a settable var (data-ohead-tone),
   defaulting to accent; 14% mix so a chosen colour actually reads */
table.o-table[data-ohead="row"] th, table.o-table[data-ohead="both"] th {
  background: color-mix(in srgb, var(--thead-fill, var(--accent)) 14%, var(--paper)); color: var(--thead-fill, var(--accent));
  border-bottom-color: var(--thead-fill, var(--accent)); padding-left: 10px;
}
table.o-table[data-ohead="col"] td:first-child, table.o-table[data-ohead="both"] td:first-child {
  background: color-mix(in srgb, var(--thead-fill, var(--accent)) 14%, var(--paper)); font-weight: 700; padding-left: 10px;
}
table.o-table[data-ohead-tone="accent"] { --thead-fill: var(--accent); }
table.o-table[data-ohead-tone="green"] { --thead-fill: #3D8B5A; }
table.o-table[data-ohead-tone="amber"] { --thead-fill: #B07D2B; }
table.o-table[data-ohead-tone="red"] { --thead-fill: #B3402A; }
table.o-table[data-ohead-tone="ink"] { --thead-fill: var(--ink); }
/* PER-CELL FILL \u2014 the SAME soft-tint recipe as a text block's fill (data-ofill on .o-text above),
   lifted onto table cells so a shaded cell reads as the same document material, not the ledger's
   saturated slab. Declared AFTER the header-tint rules and at equal specificity, so an explicitly
   filled header cell keeps its own colour. A custom hex arrives as the inline --o-fill var exactly
   as setBlockFill writes it; presets set the token colour below. */
table.o-table td[data-ofill], table.o-table th[data-ofill] {
  --o-fill: var(--accent);
  background: color-mix(in srgb, var(--o-fill) calc(var(--ofa, 10) * 1%), var(--paper));
}
table.o-table td[data-ofill="green"], table.o-table th[data-ofill="green"] { --o-fill: #3D8B5A; }
table.o-table td[data-ofill="amber"], table.o-table th[data-ofill="amber"] { --o-fill: #B07D2B; }
table.o-table td[data-ofill="red"], table.o-table th[data-ofill="red"] { --o-fill: #B3402A; }
table.o-table td[data-ofill="ink"], table.o-table th[data-ofill="ink"] { --o-fill: var(--ink); }
/* PER-CELL ALIGNMENT \u2014 data-oalign is already text-align (the bare selectors above), but a th sets
   its own left-align that outranks the bare attribute, so scope these to the table to beat it and to
   cover td explicitly. Right-aligning a column of numbers is the commonest table need. */
table.o-table td[data-oalign="left"], table.o-table th[data-oalign="left"] { text-align: left; }
table.o-table td[data-oalign="center"], table.o-table th[data-oalign="center"] { text-align: center; }
table.o-table td[data-oalign="right"], table.o-table th[data-oalign="right"] { text-align: right; }
/* COLUMN WIDTHS \u2014 fixed layout so the per-column widths (a % on each first-row cell, written by the
   resize drag) are honoured instead of the browser auto-sizing to content. Opt-in per table via
   data-ocolsized, so a table nobody has resized keeps its content-driven auto layout unchanged. */
table.o-table[data-ocolsized] { table-layout: fixed; }
.o-quote {
  border-left: 3px solid var(--accent); margin: 28px 0; padding: 6px 0 6px 28px;
  font-family: var(--font-display); font-style: italic;
  font-size: calc(clamp(24px, 2.7vw, 36px) * var(--osz, 1)); line-height: 1.45; color: var(--ink);
}
.o-quote footer {
  margin-top: 14px; font-family: var(--font-body); font-style: normal;
  font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft);
}
table.o-table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: calc(clamp(15px, 1.6vw, 19px) * var(--osz, 1)); }
.o-table th {
  text-align: left; font-size: calc(12.5px * var(--osz, 1)); font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--ink-soft); border-bottom: 2px solid var(--ink); padding: 10px 18px 10px 0;
}
.o-table td { border-bottom: 1px solid var(--rule); padding: 13px 18px 13px 0; vertical-align: top; }
.o-btn {
  display: inline-block; background: var(--accent); color: #fff; border-radius: 8px;
  padding: 13px 28px; font-weight: 600; font-size: calc(15px * var(--osz, 1)); text-decoration: none; margin: 10px 0;
}
/* a button block can hold several buttons (the + button toolbar) \u2014 they wrap as a row */
.o-btns { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; margin: 10px 0; }
.o-btns .o-btn { margin: 0; }
/* a tone on the button block recolours every button in it (per-block, like the pills) */
.o-btns[data-otone] .o-btn { background: var(--tone, var(--accent)); }
.o-pill {
  display: inline-block; border: 1px solid var(--rule); background: var(--paper); border-radius: 999px;
  padding: 6px 16px; font-size: calc(13px * var(--osz, 1)); font-weight: 600; color: var(--ink-soft); margin: 0 8px 8px 0;
}
/* icons follow the block tone when one is set (the toolbar dots), else accent \u2014
   the svg strokes in currentColor */
.o-icon { display: inline-flex; color: var(--tone, var(--accent)); vertical-align: middle; }
.o-icon svg { width: calc(1.5em * var(--osz, 1)); height: calc(1.5em * var(--osz, 1)); }
/* traffic light \u2014 click a lamp to light it (data-lit); the toolbar tone is freed to
   colour the label text (data-otone). green / amber / red; cleared = all lamps dim */
.o-tlight {
  display: inline-flex; align-items: center; gap: 7px; margin: 10px 0;
  padding: 9px 18px 9px 12px; border: 1px solid var(--rule); border-radius: 999px; background: var(--paper);
}
.o-tlight .tl-lamp { width: calc(15px * var(--osz, 1)); height: calc(15px * var(--osz, 1)); border-radius: 50%; opacity: 0.16; flex: 0 0 auto; }
.o-tlight .tl-r { background: #B3402A; }
.o-tlight .tl-a { background: #B07D2B; }
.o-tlight .tl-g { background: #3D8B5A; }
.o-tlight[data-lit="red"] .tl-r, .o-tlight[data-lit="amber"] .tl-a, .o-tlight[data-lit="green"] .tl-g { opacity: 1; }
.o-tlight p { margin: 0 0 0 4px; font-weight: 700; font-size: calc(14px * var(--osz, 1)); }
figure.o-img { margin: 26px 0; }
figure.o-img img {
  display: block; width: 100%; height: auto; border-radius: 12px;
  box-shadow: 0 1px 2px rgba(26,26,26,0.06), 0 12px 40px rgba(26,26,26,0.10);
}
/* A SHADOW TRACES THE BORDER BOX, so on a raster with transparency it draws the rectangle of the
   FILE rather than the edge of the picture \u2014 a cut-out PNG reads as artwork on a white-grey plate.
   The marker is written by the runtime once the alpha trace says the silhouette is not the rectangle
   (markAlphaFigures in document.ts); view-only, never in the file. The RADIUS is left alone: it
   clips nothing a transparent raster shows. Same move [data-ofade] makes below, for the same reason
   \u2014 an edge the shadow can honestly trace is the thing being tested for. */
figure.o-img[data-oalphaimg] img { box-shadow: none; }
figure.o-img figcaption { margin-top: 12px; font-size: 13px; color: var(--ink-soft); }
/* Fade + transparency \u2014 settling an image INTO prose instead of sitting it on top. Both act on the
   <img>, never the figure, so the caption stays opaque. The fade is a MASK, not an overlay: it
   dissolves into whatever is behind with no colour to keep in sync. The mask box excludes the
   shadow's spread, which would clip it to a hard edge \u2014 so drop the shadow deliberately; a fading
   image needs none, the fade IS its edge. -webkit- prefix for pre-120 Chromium decks. */
figure.o-img[data-ofade] img { -webkit-mask-image: var(--ofd); mask-image: var(--ofd); box-shadow: none; }
figure.o-img[data-ofade="bottom"] { --ofd: linear-gradient(to bottom, #000 45%, transparent); }
figure.o-img[data-ofade="top"] { --ofd: linear-gradient(to top, #000 45%, transparent); }
figure.o-img[data-ofade="left"] { --ofd: linear-gradient(to left, #000 45%, transparent); }
figure.o-img[data-ofade="right"] { --ofd: linear-gradient(to right, #000 45%, transparent); }
figure.o-img[data-ofade="edges"] { --ofd: radial-gradient(ellipse at center, #000 55%, transparent); }
figure.o-img[data-oopacity] img { opacity: calc(var(--oopq, 100) / 100); }
/* Hue \u2014 rotate the whole picture's colour wheel. Three independent CSS properties carry the three
   effects (mask / filter / opacity), so fade, hue and dimming compose without fighting. */
figure.o-img[data-ohue] img { filter: hue-rotate(calc(var(--ohu, 0) * 1deg)); }
/* Gradient wash \u2014 a chosen colour bleeding up across the picture (--ogc the colour, --ogx how far
   it reaches). The figure becomes a one-column grid ONLY while a wash is set, so the overlay can
   share the image's exact grid cell: an inset:0 overlay on the figure would tint the caption too,
   and no CSS can size an absolute overlay to a natural-height <img>. A plain figure is untouched. */
figure.o-img[data-ograd] { display: grid; }
figure.o-img[data-ograd] > img { grid-area: 1 / 1; }
figure.o-img[data-ograd] > figcaption { grid-area: 2 / 1; }
figure.o-img[data-ograd]::after {
  content: ''; grid-area: 1 / 1; border-radius: 12px; pointer-events: none;
  background: linear-gradient(to top, var(--ogc, #1A1A1A) 0%, transparent calc(var(--ogx, 60) * 1%));
}
/* a side-by-side PAIR is inline-block (rule above); keep that packing when one carries a wash */
figure.o-img[data-ograd][data-owidth]:has(+ figure.o-img[data-owidth]),
figure.o-img[data-owidth]:has(+ figure.o-img[data-ograd][data-owidth]) + figure.o-img[data-ograd][data-owidth] {
  display: inline-grid;
}

/* Continuous left\u2194right placement (the \u2194 drag grip; the retired \u25C2 \u2299 \u25B8 nudges wrote the
   same data-opos): 0 (cleared) = natural left, 10 = flush right, 5 = exact centre.
   margin-left walks the block right; translate pulls it back the same fraction of the
   BLOCK's own width, so the block lands visually within the row at any size. translate is
   a separate property so .anim's transform never fights it; max-width:100% stops a block
   from exceeding the row (an oversized image used to spill past it AND invert the drag).
   Layout containers own their full width and are excluded. */
[data-opos]:where(:not(.card-grid):not(.cols):not(table)) {
  max-width: 100%; margin-left: calc(var(--op, 0) * 10%); translate: calc(var(--op, 0) * -10%) 0;
}
/* Text & inline blocks shrink to their natural content so they have room to move (a
   centred heading = its text width). max-content \u2014 NOT fit-content \u2014 keeps that width
   STABLE as the left margin grows; fit-content re-shrank the block mid-slide. Media
   figures are excluded: they keep their own box (data-owidth, or full width) so a chart
   never collapses and a resized image slides without distorting. */
[data-opos]:where(:not(.card-grid):not(.cols):not(table):not(figure)) { width: max-content; }
[data-opos="1"] { --op: 1; } [data-opos="2"] { --op: 2; } [data-opos="3"] { --op: 3; }
[data-opos="4"] { --op: 4; } [data-opos="5"] { --op: 5; } [data-opos="6"] { --op: 6; }
[data-opos="7"] { --op: 7; } [data-opos="8"] { --op: 8; } [data-opos="9"] { --op: 9; }
[data-opos="10"] { --op: 10; }
/* Media figures set margin:26px 0 at class+element specificity, which out-ranks the
   :where()-zeroed [data-opos] margin-left above, so they keep the translate but drop the
   margin and lurch LEFT (the image-inversion bug \u2014 o-img was missing here entirely).
   Re-assert the positional margin for every media figure at matching specificity. */
figure.o-img[data-opos], figure.o-videofig[data-opos], figure.o-chartfig[data-opos] {
  margin-left: calc(var(--op, 0) * 10%);
}

/* Floating layers (the "Float" toggle). A block leaves the flow and pins to the .slide stage at
   an inline left/top/width \u2014 all PERCENT of the stage, so a layer holds its place at any viewport
   width \u2014 painted above flow content via z-index (Layers control overrides the default via inline
   z-index). DOM order is untouched: floating is a pure paint/position overlay, so paths, selection
   and insert dots are unaffected (renderGaps already skips out-of-flow blocks) and the block below
   closes the gap. The stage is already position:relative;isolation:isolate, so the -1 backdrop stays
   below and no containing-block change is needed. translate:none stops the .anim reveal shifting a
   pinned layer off its coordinates. */
/* A layer is ANCHORED BY ITS CENTRE: left/top store the centre (percent; px top on a scroll) and
   translate:-50% pins the box on that point \u2014 width-INDEPENDENT, so a layer centred in the editor
   stays centred in Present even though the frame width (min(--obw,90vw)) differs between them.
   translate is free: the reveal it once guarded uses the transform property, disabled on floats below.
   width:max-content shrinks a layer to its content (a title-sized box that moves cleanly);
   max-width:100% caps a paragraph at the frame; the block-width grip still overrides. */
[data-ofloat] { position: absolute; margin: 0; z-index: 1; translate: -50% -50%; width: max-content; max-width: 100%; }
/* A LAYER HAS NO MARGINS, said again at a weight that actually wins. The top property positions the
   MARGIN edge of an absolutely positioned box, so any vertical margin a kind's own sheet leaves on
   the block moves the layer off the point the author dropped it \u2014 and the rule above is (0,1,0),
   which loses to nearly every one of them. Measured on the float-one-of-every-kind corpus: a to-do
   list landed 10px low, a callout 18px, a card table 24px, a chart 26px, and on a document every
   figure \u2014 picture and drawing alike \u2014 22px. The surfaces the corpus cannot see are the reader and
   print, and this is runtime CSS, so the recipient had the same offset.
   THE ATTRIBUTE IS REPEATED, not marked !important, and four times rather than two. It is the same
   move the document's band declaration makes for the same reason (document-css.ts), and it was
   audited rather than guessed: the heaviest vertical margin any shipped sheet sets on something that
   can be a top-level block is .k-document .o-doc blockquote.o-quote / table.o-table at (0,3,1), so
   (0,4,0) clears the lot \u2014 while staying an ordinary rule that an author's own CSS can still beat,
   which !important would not. The corpus test is the net that names the kind if a future rule ever
   does out-rank this one. */
[data-ofloat][data-ofloat][data-ofloat][data-ofloat] { margin: 0; }
/* a floated MULTI-COLUMN text block keeps a real measure so its 1fr grid tracks resolve \u2014 max-content
   would collapse them into one unwrappable line and make the layer immovable */
[data-ofloat].o-tcols { width: min(680px, 100%); }
/* A CARD block pushed clear of a floating layer's reserved band carries the gap that moved it there
   (written by the runtime's card band pass as a custom property \u2014 live DOM only, never the file).
   Cards run no paginator, so there is no --opgap to add in here; a document's combined declaration
   lives in the document kind sheet and :not(.o-doc) keeps the two from ever both applying to the
   one container that carries both classes.
   THE SPECIFICITY IS THE POINT, and it was audited rather than guessed. The document's equivalent
   has to DOUBLE its attribute to reach (0,4,0); this one does not, because the frame contributes two
   classes of its own. Every vertical margin any shipped sheet sets on something that can be a direct
   child of a card's column weighs at most two classes \u2014 .k-cover .lede (0,2,0) is the heaviest,
   with figure.o-img, table.o-table, figure.o-chartfig and .k-bullets ul at (0,1,1) \u2014 and the theme
   sheet sets no margins at all. (0,3,0) clears the lot with a step to spare, and un-doubling was
   measured against the corpus test below, which drags a layer across one of every card-insertable
   kind: still green. Doubling on top of that would buy nothing, and the corpus test is the net that
   names the kind if a future rule ever does out-rank this one. */
.slide-inner:not(.o-doc) > [data-oband] { margin-top: var(--obgap, 0px); }
/* THE WRAP ENGINE'S RUNS \u2014 how a block flows BESIDE a layer instead of dropping below it (written by
   the same band passes, live DOM only, never the file). The engine breaks the lines itself and hangs
   one absolutely positioned span per run, which is what lets one line own text on BOTH sides of a
   picture \u2014 the thing the pseudo-float this replaced (a ::before with shape-outside, one float and
   therefore one side) structurally could not do. See wrap-runs.ts and docs/WRAP_ENGINE_B_SPEC.md.
   View-only, like every other marker the band passes write: data-orun never reaches a file.
   BOTH RULES ARE GATED ON [data-orun], so a leaf no layer reaches renders byte-identically to a build
   with no wrap engine in it at all.
   position:relative makes the leaf the containing block the runs resolve their left/top against \u2014
   they are written in its content box plus its own padding, which is the padding box those two
   properties actually mean.
   white-space:pre is load-bearing twice over: it stops the browser re-wrapping inside a run box
   (which would undo the line breaking we just did), and it keeps the trailing BREAK SPACE each run
   carries, so the leaf's textContent still reads with its spaces for the eleven consumers that read
   it. The leaf's own height is set inline by the mount \u2014 the runs are out of flow, so without it the
   leaf would collapse and pagination, the band floors and the keystroke cap would all read zero.
   text-indent:0 is not defensive tidying. A leaf whose own ::before must ride line one is given an
   inline text-indent to seat it (mountRuns), text-indent INHERITS, and position:absolute blockifies
   these spans \u2014 so every run would have indented its own first line by the seat as well, putting the
   text a second gap past the number (measured: run zero at x 525 where the layout put it at 274). */
[data-orun] { position: relative; }
[data-orun] > .o-run { position: absolute; white-space: pre; margin: 0; text-indent: 0; }

/* TEXT-FLOW MODES \u2014 the two ways a layer can stop reserving anything at all and simply overlap the
   prose. Both mean the same thing to the layout (the band passes drop a layer carrying data-oflow
   before any geometry: no band, no carve, no push \u2014 the text does not know the layer is there) and
   differ ONLY in who paints on top. Model-carried, so the reader, Present and print inherit the
   picture the editor showed without any of them knowing the feature exists.

   OVER \u2014 text above the layer. A positioned box paints above static content whatever its z-index, so
   putting text on top is not "lower the layer", it is "raise the prose": the flow blocks become
   positioned at z-index 1 and the layer is dropped back to z-index auto. THE LAYER MUST NOT KEEP A
   Z-INDEX: any value makes it a stacking context, which would trap its own descendants inside it and
   below the prose however high their z (the reference implementation's load-bearing note \u2014 it is why
   its handles are outside the floater). Ours are further out still (the canvas grips are body-level
   at z-index 55, so they clear the raised prose in every case), but the rule is kept because the
   principle is the same one: nothing inside an over-mode layer may be trapped under the text.
   !important is deliberate and narrow \u2014 the Layers control writes an INLINE z-index, which would
   otherwise silently cancel the mode, and there is no drag handler writing z-index to fight (the
   float drags write left/top/width only).
   The backdrop is excluded: it is flow-positioned but it is the page's own background, and raising it
   would paint it over everything including the layer.

   UNDER \u2014 the layer above the text. Nothing to raise: the layer's own default z-index already puts it
   above static flow content, so this is simply the picture on top. Text it covers is not clickable,
   which is the honest consequence of putting a picture over it and is left honest. A layer explicitly
   sent BACK (a negative inline z-index from the Layers control) still goes behind the prose \u2014 the
   author asked for that in as many words, so the control keeps working inside the mode rather than
   being overridden by it.
   UNDER CARRIES NO GHOST. It used to drop an image layer to opacity 0.85 to hint that prose was
   passing beneath it. Since 0.4.2 under is what a NEWLY floated block of any kind gets by default
   (setBlockFloat), so the ghost would have washed out every picture an author simply floated \u2014 and a
   layer that is deliberately on top has no reason to be transparent. Wrap and over never had it. */
.o-doc:has(> [data-ofloat][data-oflow="over"]) > :not([data-ofloat]):not(.o-doc-bg),
.slide-inner:has(> [data-ofloat][data-oflow="over"]) > :not([data-ofloat]):not(.o-doc-bg) {
  position: relative; z-index: 1;
}
[data-ofloat][data-oflow="over"] { z-index: auto !important; }

/* diagram \u270E \u2014 rendered only by the Studio canvas (edit mode), shared by the
   flow + graph kinds, so it lives in base rather than a treeshakeable section */
.o-diagram-edit {
  position: absolute; top: 8px; right: 8px; font: 600 12px "Segoe UI", sans-serif;
  border: 1px solid var(--rule); border-radius: 7px; background: var(--paper);
  color: var(--ink-soft); padding: 5px 10px; cursor: pointer;
}
.o-diagram-edit:hover { color: var(--accent); border-color: var(--accent); }
.o-dport { cursor: crosshair; }
.o-dmenu {
  position: absolute; z-index: 60; display: flex; flex-direction: column; gap: 2px;
  background: var(--paper); border: 1px solid var(--rule); border-radius: 8px; padding: 4px;
  box-shadow: 0 8px 26px rgba(26,26,26,0.16);
}
.o-dmenu button {
  border: none; background: none; cursor: pointer; text-align: left;
  font: 600 12.5px var(--font-body); color: var(--ink); padding: 6px 12px; border-radius: 5px;
}
.o-dmenu button:hover { background: var(--rule-soft); color: var(--accent); }
.o-dmrename {
  position: absolute; z-index: 60; width: 180px; text-align: center;
  font: 600 13px var(--font-body); color: var(--ink);
  border: 1.5px solid var(--accent); border-radius: 7px; padding: 5px 8px; background: var(--paper);
}
.fxvisual .fx-opt { display: grid; grid-template-columns: repeat(6, minmax(54px, 1fr)); gap: 4px; min-width: 360px; max-width: 520px; }
.fxvisual .fx-opt-visual { display: block; height: 24px; }
.fxvisual .fx-opt-visual svg { width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 2; }

.anim { opacity: 0; transform: translateY(16px); }
.is-shown .anim {
  animation: o-rise 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
  animation-delay: calc(var(--i, 0) * 90ms);
}
@keyframes o-rise { to { opacity: 1; transform: none; } }
/* a floating layer is persistent chrome, not revealing content: skip the reveal so it appears at
   once and holds its coordinates \u2014 the reveal's translate/opacity also made it flash and shift (and,
   mid-animation, destabilised drag + hit-testing). Placed after .anim so it wins by source order.
   The DESCENDANTS matter too: opacity doesn't inherit, so a multi-column layer's own columns (each an
   .o-text.anim) stayed at the reveal's opacity:0 when the float re-render didn't re-fire their reveal
   (they're out of flow) \u2014 a column silently vanished. Reveal every .anim inside a float. */
[data-ofloat].anim, [data-ofloat], [data-ofloat] .anim { opacity: 1; transform: none; animation: none; }
@media (prefers-reduced-motion: reduce) {
  .anim { opacity: 1; transform: none; animation: none; }
}
`;
var LEDGER_EDITOR_CSS = `
/* Popover layer \u2014 appended to the canvas <body>, OUTSIDE the block, so its fixed popovers clear any
   transformed deck/scroll ancestor. A high-z stacking context keeps the popovers (and the Expand shell)
   painting above the deck's own chrome (e.g. #fold-notes), which otherwise intercepts clicks. */
.o-ledger-pop-layer { position:absolute; top:0; left:0; width:0; height:0; z-index:2147483000; }
.o-ledger .block { border-radius:13px; background:var(--lg-paper-2); border:1px solid var(--lg-rule-strong); overflow:hidden; }
.o-ledger .block.editing { border-color:var(--lg-forest-edge); box-shadow:0 0 0 3px var(--lg-forest-soft); }
.o-ledger .block-bar { display:flex; align-items:center; gap:6px; padding:8px 10px 8px 14px; background:var(--lg-head); border-bottom:1px solid var(--lg-rule); font-size:12.5px; }
.o-ledger .block-bar .label { font-weight:700; color:var(--lg-ink); display:flex; align-items:center; gap:7px; }
.o-ledger .block-bar .dot { width:7px; height:7px; border-radius:50%; background:var(--lg-forest); }
.o-ledger .block-bar .spacer { flex:1; }
.o-ledger .block-bar .status { color:var(--lg-ink-faint); font-family:var(--lg-mono); font-size:11px; white-space:nowrap; max-width:320px; overflow:hidden; text-overflow:ellipsis; }
.o-ledger .tool { border:1px solid var(--lg-rule-strong); background:var(--lg-paper-3); color:var(--lg-ink-soft); border-radius:8px; padding:5px 9px; font-size:12px; cursor:pointer; font-family:var(--lg-sans); line-height:1; white-space:nowrap; }
.o-ledger .tool:hover { border-color:var(--lg-forest-edge); color:var(--lg-forest); background:var(--lg-forest-soft); }
.o-ledger .fbar { display:flex; align-items:stretch; background:var(--lg-paper-3); border-bottom:1px solid var(--lg-rule-strong); border-top:1px solid var(--lg-rule); font-family:var(--lg-mono); }
.o-ledger .fbar .fb-addr { display:flex; align-items:center; justify-content:center; min-width:52px; padding:0 10px; background:var(--lg-head-strong); color:var(--lg-forest-deep); font-weight:800; font-size:12px; border-right:1px solid var(--lg-rule-strong); }
.o-ledger .fbar .fb-fx { display:flex; align-items:center; padding:0 9px; color:var(--lg-forest); font-style:italic; font-weight:700; font-family:var(--lg-serif); border-right:1px solid var(--lg-rule); font-size:14px; }
.o-ledger .fbar .fb-input { flex:1; border:none; outline:none; background:var(--lg-paper-3); color:var(--lg-ink); font-family:var(--lg-mono); font-size:13px; padding:8px 11px; min-width:0; }
.o-ledger .fbar .fb-input:focus { background:#fff; box-shadow:inset 0 0 0 2px var(--lg-forest); }
.o-ledger .fbar .fb-input::placeholder { color:var(--lg-ink-faint); font-style:italic; font-family:var(--lg-sans); }
/* cell provenance (derived, no persisted data) \u2014 the focused-cell origin chip beside fb-input. Empty
   textContent (a blank/empty cell has no provenance to show) collapses the chip via :empty. */
.o-ledger .fbar .fb-prov { display:flex; align-items:center; padding:0 11px; font-family:var(--lg-sans); font-size:11px; font-weight:700; letter-spacing:.02em; color:var(--lg-ink-faint); border-left:1px solid var(--lg-rule); white-space:nowrap; }
.o-ledger .fbar .fb-prov:empty { display:none; }
.o-ledger .fbar .fb-prov.prov-formula, .o-ledger .fbar .fb-prov.prov-rule { color:var(--lg-calc); }
.o-ledger .fbar .fb-prov.prov-source { color:var(--lg-ref-c); }
/* the EDITOR ledger's height-capped canvas \u2014 the block-height grip's --obh drives it (default
   unchanged at 352px, 90vh the viewport guard, mirroring the --obw width pattern) */
.o-ledger .viewport { max-height:min(var(--obh, 352px), 90vh); overflow:auto; background:var(--lg-cell); position:relative; }
/* NB: no min-width:100% \u2014 with table-layout:fixed, forcing the table wider than its natural (sum-of-
   columns) width makes the fixed-layout algorithm redistribute the surplus across every column, which
   silently re-inflates a column dragged down to a sliver width (it no longer renders at the width the
   author set). The editor sets a DEFINITE inline width (sum of the <col> widths \u2014 see buildGrid):
   fixed layout only truly engages with one; width:max-content here is just the pre-build fallback
   (content-measured, so alone it would re-floor a sliver at its label's min-content width). The
   .viewport's own background already fills any leftover space to the right. */
.o-ledger table.grid { border-collapse:separate; border-spacing:0; width:max-content; table-layout:fixed; }
.o-ledger table.grid th, .o-ledger table.grid td { margin:0; padding:0; }
.o-ledger thead th { position:sticky; top:0; z-index:20; background:var(--lg-head-strong); color:var(--lg-ink-soft); font-weight:700; font-size:11px; letter-spacing:.05em; border-bottom:1px solid var(--lg-rule-strong); border-right:1px solid var(--lg-rule); user-select:none; }
.o-ledger thead th.corner { left:0; z-index:30; width:38px; min-width:38px; cursor:pointer; }
.o-ledger thead th.corner:hover { background:var(--lg-head-strong); filter:brightness(0.94); }
.o-ledger .colh { position:relative; vertical-align:top; }
.o-ledger .colh .name { height:24px; display:flex; align-items:center; padding:0 9px; font-weight:700; color:var(--lg-ink-soft); white-space:nowrap; overflow:hidden; }
.o-ledger .colh .name .cn { font-size:11px; letter-spacing:.05em; color:var(--lg-ink-faint); }
.o-ledger .colh .name .nm { color:var(--lg-forest-deep); font-weight:700; margin-left:5px; letter-spacing:0; text-transform:none; font-size:11.5px; }
/* editor filter funnel \u2014 a live button ON the filter row's own cells (Excel-like). Clicking opens the
   value checklist; unchecking hides the rows BELOW in the editor grid (transient view state). Same clip-
   path funnel the inert viewer draws; the .on state marks a column whose filter is currently constraining. */
.o-ledger table.grid td.cell .o-funnel { position:absolute; top:50%; right:3px; transform:translateY(-50%); z-index:3; padding:1px 2px; border:none; background:transparent; color:var(--lg-ink-faint); cursor:pointer; border-radius:4px; line-height:0; }
.o-ledger table.grid td.cell .o-funnel::before { content:""; display:inline-block; width:9px; height:9px; background:currentColor; clip-path:polygon(0 0,100% 0,62% 42%,62% 100%,38% 82%,38% 42%); }
.o-ledger table.grid td.cell .o-funnel:hover { color:var(--lg-forest); background:var(--lg-forest-tint); }
.o-ledger table.grid td.cell .o-funnel.on { color:var(--lg-forest); }
.o-ledger th.rowh { position:sticky; left:0; z-index:15; background:var(--lg-head-strong); color:var(--lg-ink-soft); font-weight:700; font-size:11px; width:38px; min-width:38px; border-right:1px solid var(--lg-rule-strong); border-bottom:1px solid var(--lg-rule); text-align:center; user-select:none; }
.o-ledger td.cell.active { outline:2px solid var(--lg-forest); outline-offset:-2px; z-index:5; box-shadow:0 0 0 3px var(--lg-forest-soft); }
/* cell provenance (derived, no persisted data) \u2014 a small top-right corner triangle (Excel's comment-
   triangle idiom) marks a formula/rule cell; a source-refreshed cell gets a distinct tint. Nothing
   marks a typed cell (the default). td.cell already carries position:relative from KINDS_CSS. */
.o-ledger td.cell.prov-formula::after { content:""; position:absolute; top:0; right:0; border-style:solid; border-width:0 6px 6px 0; border-color:transparent var(--lg-calc-line) transparent transparent; pointer-events:none; }
.o-ledger td.cell.prov-source::after { content:""; position:absolute; top:0; right:0; border-style:solid; border-width:0 6px 6px 0; border-color:transparent var(--lg-ref-c) transparent transparent; pointer-events:none; }
/* Bug 7 (drag-select spilled a native text selection across the top row) \u2014 editor-ONLY: the editing grid
   is table.grid, the inert VIEWER is table.lv-table, so scoping to .grid keeps a recipient's shipped
   ledger cells fully selectable/copyable (this rule lives in LEDGER_EDITOR_CSS, never shipped anyway). */
.o-ledger .grid td.cell { user-select:none; }
.o-ledger td.cell .editor { position:absolute; inset:0; z-index:40; border:none; outline:none; margin:0; padding:0 10px; font-size:14px; line-height:31px; height:100%; background:#fff; color:var(--lg-ink); font-family:var(--lg-serif); box-shadow:0 0 0 2px var(--lg-forest), 0 6px 16px rgba(29,36,32,.16); width:100%; user-select:text; }
/* inline column-rename input (dbl-click a column header) \u2014 sits over the header name */
.o-ledger .colh .colname-input { width:100%; box-sizing:border-box; border:none; outline:none; margin:0; padding:0; font:inherit; font-size:11px; font-weight:700; letter-spacing:.03em; text-transform:none; color:var(--lg-ink); background:#fff; box-shadow:0 0 0 2px var(--lg-forest); border-radius:3px; user-select:text; }
.o-ledger td.cell .editor.isf { font-family:var(--lg-mono); font-size:13px; color:var(--lg-forest-deep); }
/* references a formula reads \u2014 coloured while editing (slice 2) */
.o-ledger td.cell.ref.r0 { box-shadow:inset 0 0 0 2px var(--lg-ref-a); background:color-mix(in srgb, var(--lg-forest) 6%, transparent); }
.o-ledger td.cell.ref.r1 { box-shadow:inset 0 0 0 2px var(--lg-ref-b); background:#b9763b12; }
.o-ledger td.cell.ref.r2 { box-shadow:inset 0 0 0 2px var(--lg-ref-c); background:#4a6f9e12; }
.o-ledger td.cell.ref.r3 { box-shadow:inset 0 0 0 2px var(--lg-ref-d); background:#9a5a8c12; }
.o-ledger td.cell.pick { outline:2px dashed var(--lg-ref-b); outline-offset:-2px; z-index:6; }
/* Excel fill handle + drag preview (slice 2) */
.o-ledger .fillh { position:absolute; right:-4px; bottom:-4px; width:9px; height:9px; background:var(--lg-forest); border:1.5px solid var(--lg-paper-3); border-radius:2px; cursor:crosshair; z-index:8; }
.o-ledger td.cell.fillpreview { box-shadow:inset 0 0 0 2px var(--lg-forest-edge); background:var(--lg-forest-tint); }
/* function autocomplete popover (slice 2) \u2014 positioned fixed at the editing cell */
.o-ledger .hint { position:fixed; z-index:220; background:#1d2420; color:#f4f1ea; border-radius:9px; padding:0; font-size:12px; font-family:var(--lg-mono); box-shadow:0 12px 30px rgba(0,0,0,.34); display:none; min-width:240px; max-width:360px; overflow:hidden; }
.o-ledger .hint.open { display:block; }
.o-ledger .hint .cat { background:#161c19; color:#7f9c92; font-family:var(--lg-sans); font-size:9px; letter-spacing:.12em; text-transform:uppercase; font-weight:800; padding:4px 11px; }
.o-ledger .hint .row { padding:7px 11px; line-height:1.45; border-bottom:1px solid #ffffff14; cursor:pointer; }
.o-ledger .hint .row:last-child { border-bottom:none; }
.o-ledger .hint .row[data-fn]:hover { background:#2c5a51; }
.o-ledger .hint .row.sel { background:#3f7268; }
.o-ledger .hint .fn { color:#8fd0bd; font-weight:700; }
.o-ledger .hint .row.sel .fn { color:#fff; }
.o-ledger .hint .arg { color:#e6c77f; }
.o-ledger .hint .desc { color:#b8b1a4; font-family:var(--lg-sans); display:block; margin-top:2px; font-size:10.5px; }
.o-ledger .hint .row.sel .desc { color:#dfeae3; }
.o-ledger .hint .pick-tip { background:#161c19; color:#9c9483; font-family:var(--lg-sans); font-size:10px; padding:5px 11px; }
/* column rules \u2014 the "= rule" row + computed-column affordance + Rules toggle (slice 3) */
.o-ledger .colh .rule { height:22px; display:flex; align-items:center; gap:5px; padding:0 9px; font-family:var(--lg-mono); font-size:11px; color:var(--lg-ink-faint); background:var(--lg-paper-3); outline:none; white-space:nowrap; overflow:hidden; cursor:text; border-top:1px solid var(--lg-rule); }
.o-ledger .colh .rule:empty::before { content:"= rule"; color:var(--lg-ink-faint); opacity:.6; font-family:var(--lg-sans); font-size:10.5px; }
.o-ledger .block.rules-off .colh .rule { display:none; }
.o-ledger .colh.computed { background:var(--lg-calc-soft); }
.o-ledger .colh.computed .rule { color:var(--lg-calc); background:rgba(15,157,107,.06); font-weight:600; }
.o-ledger .colh.computed .name .cn, .o-ledger .colh.computed .name .nm { color:var(--lg-calc); }
.o-ledger .colh.computed::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--lg-calc-line); }
.o-ledger .colh .badge { margin-left:auto; font-family:var(--lg-sans); font-size:9px; font-weight:800; letter-spacing:.4px; color:var(--lg-calc); background:rgba(15,157,107,.14); border-radius:4px; padding:1px 5px; }
/* row rules (slice 2) \u2014 a computed ROW gets the same calc tint + a corner "\u0192" badge (double-click a row
   header with Rules on to edit it). The badge only shows while Rules is on, mirroring the column line. */
.o-ledger .rowh.computed { background:var(--lg-calc-soft); color:var(--lg-calc); }
.o-ledger .rowh .rbadge { position:absolute; top:1px; right:2px; font-family:var(--lg-mono); font-size:9px; line-height:1; font-weight:800; color:var(--lg-calc); }
.o-ledger .block.rules-off .rowh .rbadge { display:none; }
/* --- slice 4: format / style / fill toolbar buttons + popovers + resize + cell styling --- */
.o-ledger .mtool { display:inline-flex; flex-direction:column; align-items:center; gap:3px; cursor:pointer; user-select:none; border:1px solid transparent; border-radius:8px; padding:3px 6px 2px; transition:background .12s ease, border-color .12s ease; line-height:1; }
.o-ledger .mtool:hover { background:var(--lg-forest-soft); }
.o-ledger .mtool.on { background:var(--lg-forest); border-color:var(--lg-forest); }
.o-ledger .mtool.on .mlbl, .o-ledger .mtool.on .mico { color:#fff; }
.o-ledger .mtool .mico { height:15px; display:flex; align-items:center; justify-content:center; font-size:13px; line-height:1; color:var(--lg-ink-soft); font-weight:600; }
.o-ledger .mtool:hover .mico { color:var(--lg-forest); }
.o-ledger .mtool .mlbl { font-size:9.5px; letter-spacing:.02em; color:var(--lg-ink-soft); font-weight:700; line-height:1; }
.o-ledger .mtool:hover .mlbl { color:var(--lg-forest-deep); }
/* redesign: the compact 6-icon B/I/U + align cluster (replaces the Style + Align popover buttons).
   B/I/U toggle directly; the U icon carries a caret that opens the underline/strikethrough menu. */
.o-ledger .fmtcluster { display:grid; grid-template-columns:repeat(3, 1fr); gap:1px; padding:2px; background:var(--lg-paper-3); border:1px solid var(--lg-rule); border-radius:8px; align-self:center; }
.o-ledger .ficon { position:relative; display:flex; align-items:center; justify-content:center; min-width:20px; height:14px; padding:0 1px; border:1px solid transparent; border-radius:4px; background:none; cursor:pointer; font-size:11px; line-height:1; color:var(--lg-ink-soft); font-family:var(--lg-sans); }
.o-ledger .ficon:hover { background:var(--lg-forest-soft); color:var(--lg-forest-deep); }
.o-ledger .ficon.on { background:var(--lg-forest); border-color:var(--lg-forest); color:#fff; }
.o-ledger .ficon b { font-weight:800; }
.o-ledger .ficon .fi { font-style:italic; font-family:var(--lg-serif); font-weight:600; }
.o-ledger .ficon .fu { text-decoration:underline; font-weight:600; }
.o-ledger .ficon.has-more { padding-right:9px; }
.o-ledger .ficon .fcar { position:absolute; right:1px; bottom:0; font-size:7px; line-height:1; color:var(--lg-ink-faint); }
.o-ledger .ficon:hover .fcar { color:var(--lg-forest-deep); }
.o-ledger .ficon.on .fcar { color:#fff; }
/* relocated whole-ledger font-size select (was in the block toolbar) */
.o-ledger .lg-size { height:26px; border:1px solid var(--lg-rule-strong); border-radius:7px; background:var(--lg-paper-3); color:var(--lg-ink); font-family:var(--lg-sans); font-size:12px; padding:0 4px; cursor:pointer; }
.o-ledger .fontmenu .sitem { justify-content:flex-start; }
/* Filter tool funnel glyph \u2014 the same clip-path funnel drawn on the filter row's cells. */
.o-ledger .mtool .mico .fico { width:12px; height:12px; background:currentColor; clip-path:polygon(0 0,100% 0,62% 42%,62% 100%,38% 82%,38% 42%); }
.o-ledger .toolsep { width:1px; height:18px; background:var(--lg-rule-strong); margin:0 2px; }
/* resize grips */
.o-ledger .colh .grip { position:absolute; top:0; right:-5px; width:11px; height:100%; cursor:col-resize; z-index:40; }
.o-ledger .colh .grip::after { content:""; position:absolute; top:0; bottom:0; left:4px; width:3px; background:transparent; transition:background .12s; }
.o-ledger .colh .grip:hover::after, .o-ledger .colh .grip.live::after { background:var(--lg-forest); }
.o-ledger th.rowh { position:sticky; left:0; z-index:15; }
.o-ledger th.rowh .rgrip { position:absolute; left:0; right:0; bottom:-5px; height:11px; cursor:row-resize; z-index:40; }
.o-ledger th.rowh .rgrip::after { content:""; position:absolute; left:0; right:0; top:4px; height:3px; background:transparent; transition:background .12s; }
.o-ledger th.rowh .rgrip:hover::after, .o-ledger th.rowh .rgrip.live::after { background:var(--lg-forest); }
/* selection */
.o-ledger td.cell.sel { background:var(--lg-forest-tint, #3f72681c); }
.o-ledger .colh.selh, .o-ledger th.rowh.selh { background:var(--lg-head-strong); color:var(--lg-forest-deep); }
/* the shared popover */
.o-ledger .pop { position:fixed; z-index:230; background:var(--lg-paper-3); border:1px solid var(--lg-rule-strong); border-radius:12px; box-shadow:0 22px 60px -30px #1d242088; padding:11px; display:none; width:230px; font-family:var(--lg-sans); }
.o-ledger .pop.open { display:block; }
.o-ledger .pop .pop-head { font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--lg-ink-faint); font-weight:700; margin:0 0 8px; }
.o-ledger .pop .fmt-scope { font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--lg-ink-faint); font-weight:700; margin:0 2px 8px; }
.o-ledger .pop .pop-note { font-size:10.5px; color:var(--lg-ink-faint); line-height:1.4; margin-top:9px; font-style:italic; }
.o-ledger .stylemenu { display:flex; flex-direction:column; gap:2px; }
.o-ledger .stylemenu .sitem { display:flex; align-items:center; gap:9px; padding:6px 10px; border-radius:7px; cursor:pointer; font-size:13px; color:var(--lg-ink); }
.o-ledger .stylemenu .sitem:hover { background:var(--lg-forest-soft); color:var(--lg-forest-deep); }
.o-ledger .stylemenu .sitem.on { background:var(--lg-forest); color:#fff; }
.o-ledger .stylemenu .sitem .tick { width:12px; text-align:center; font-weight:800; opacity:0; }
.o-ledger .stylemenu .sitem.on .tick { opacity:1; }
.o-ledger .stylemenu .sitem .sk { display:inline-block; min-width:20px; text-align:center; }
/* right-click context menu (insert/delete row-col, remove duplicates) \u2014 reuses the shared .pop shell */
.o-ledger .ctxmenu { display:flex; flex-direction:column; gap:1px; }
.o-ledger .ctxmenu .citem { padding:6px 10px; border-radius:7px; cursor:pointer; font-size:13px; color:var(--lg-ink); white-space:nowrap; }
.o-ledger .ctxmenu .citem:hover { background:var(--lg-forest-soft); color:var(--lg-forest-deep); }
.o-ledger .ctxmenu .citem.disabled { opacity:0.4; pointer-events:none; }
.o-ledger .ctxmenu .csep { height:1px; background:var(--lg-rule-strong); margin:5px 6px; }
/* format painter: armed = the tool's green .on state; persistent (double-click) adds a dashed cue; the
   grid shows a copy cursor while armed. data-tool="painter" stays the stable selector throughout. */
.o-ledger .mtool.persist { outline:2px dashed var(--lg-forest); outline-offset:1px; }
.o-ledger .block.painting td.cell { cursor:copy; }
/* Text popover: wrap toggle + indent stepper + orientation picker (openTextMenu) */
.o-ledger .pop .wraprow { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--lg-ink); cursor:pointer; padding:4px 2px; }
.o-ledger .pop .wraprow input[type=checkbox] { width:15px; height:15px; cursor:pointer; accent-color:var(--lg-forest); }
.o-ledger .pop .indentrow { display:flex; align-items:center; justify-content:space-between; margin-top:10px; padding:0 2px; }
.o-ledger .pop .indentrow .lbl, .o-ledger .pop .orientrow .lbl { font-size:11px; color:var(--lg-ink-soft); font-weight:700; }
.o-ledger .pop .stepper { display:flex; align-items:center; gap:7px; }
.o-ledger .pop .stepper button { width:22px; height:22px; border:1px solid var(--lg-rule-strong); background:var(--lg-paper-3); color:var(--lg-ink-soft); border-radius:6px; cursor:pointer; font:700 13px var(--lg-sans); line-height:1; }
.o-ledger .pop .stepper button:hover { background:var(--lg-forest-soft); color:var(--lg-forest); border-color:var(--lg-forest-edge); }
.o-ledger .pop .stepper .ind-val { min-width:14px; text-align:center; font-family:var(--lg-mono); font-size:12.5px; color:var(--lg-ink); }
.o-ledger .pop .orientrow { margin-top:10px; }
/* radial orientation dial: a circle with a draggable arrow (any angle, snapped 15\xB0), a live readout, an
   exact-degree numeric input, plus Stack + Reset. Editor-only chrome \u2014 never ships in a distributed deck. */
.o-ledger .pop .orientdial-wrap { display:flex; align-items:center; gap:12px; margin-top:7px; }
.o-ledger .pop .orientdial { position:relative; width:58px; height:58px; flex:0 0 58px; border-radius:50%; background:var(--lg-paper-3); border:1px solid var(--lg-rule-strong); cursor:crosshair; }
.o-ledger .pop .orientdial.muted { opacity:.45; }
.o-ledger .pop .orientdial-track { position:absolute; inset:8px; border-radius:50%; border:1px dashed var(--lg-rule); }
.o-ledger .pop .orientdial-arrow { position:absolute; left:50%; top:50%; width:22px; height:2.5px; background:var(--lg-forest); border-radius:2px; transform-origin:0 50%; }
.o-ledger .pop .orientdial-arrow::after { content:""; position:absolute; right:-1px; top:50%; width:6px; height:6px; background:var(--lg-forest); border-radius:50%; transform:translateY(-50%); }
.o-ledger .pop .orientdial-hub { position:absolute; left:50%; top:50%; width:6px; height:6px; margin:-3px 0 0 -3px; border-radius:50%; background:var(--lg-ink-soft); }
.o-ledger .pop .orientdial-side { display:flex; flex-direction:column; gap:6px; flex:1; }
.o-ledger .pop .orientdial-read { font:700 12px var(--lg-mono); color:var(--lg-forest); }
.o-ledger .pop .orientdial-num { width:100%; box-sizing:border-box; border:1px solid var(--lg-rule-strong); border-radius:6px; padding:4px 7px; font:inherit; font-size:12px; font-family:var(--lg-mono); color:var(--lg-ink); background:var(--lg-paper-3); }
.o-ledger .pop .orientdial-btns { display:flex; gap:5px; }
.o-ledger .pop .orientdial-btns button { flex:1; border:1px solid var(--lg-rule-strong); background:var(--lg-paper-3); color:var(--lg-ink-soft); border-radius:7px; padding:5px 2px; cursor:pointer; font:600 10.5px var(--lg-sans); }
.o-ledger .pop .orientdial-btns button:hover { background:var(--lg-forest-soft); color:var(--lg-forest); border-color:var(--lg-forest-edge); }
.o-ledger .pop .orientdial-btns button.on { background:var(--lg-forest); color:#fff; border-color:var(--lg-forest); }
.o-ledger .swatches { display:grid; grid-template-columns:repeat(6,1fr); gap:7px; }
.o-ledger .swatches .chip { width:24px; height:24px; border-radius:7px; cursor:pointer; border:1px solid #0002; transition:transform .1s ease; }
.o-ledger .swatches .chip:hover { transform:scale(1.14); }
.o-ledger .swatches .chip.clear { background:repeating-linear-gradient(45deg,#fff,#fff 4px,#eee 4px,#eee 8px); }
.o-ledger .swatches .chip.fill-forest { background:#e3eee9; } .o-ledger .swatches .chip.fill-sage { background:#dfe9dc; } .o-ledger .swatches .chip.fill-sand { background:#f1eada; }
.o-ledger .swatches .chip.fill-ochre { background:#f6e6cf; } .o-ledger .swatches .chip.fill-clay { background:#f3ddd2; } .o-ledger .swatches .chip.fill-slate { background:#dde6ef; }
.o-ledger .swatches .chip.fill-plum { background:#ebdcec; } .o-ledger .swatches .chip.fill-mist { background:#e6e3da; } .o-ledger .swatches .chip.fill-forest2 { background:#cfe3da; }
.o-ledger .swatches .chip.fill-highlight { background:#fbf0c9; } .o-ledger .swatches .chip.fill-inkwash { background:#dcd7cc; }
.o-ledger .pop .fill-custom { display:flex; align-items:center; gap:8px; margin-top:11px; font-size:11.5px; color:var(--lg-ink-soft); cursor:pointer; }
.o-ledger .pop .fill-custom input[type=color] { width:28px; height:22px; padding:0; border:1px solid var(--lg-rule-strong); border-radius:6px; background:none; cursor:pointer; }
.o-ledger .fmtmenu { display:flex; flex-direction:column; gap:2px; }
.o-ledger .fmtmenu .fitem { display:flex; align-items:center; gap:8px; padding:6px 9px; border-radius:7px; cursor:pointer; font-size:12.5px; color:var(--lg-ink); }
.o-ledger .fmtmenu .fitem:hover { background:var(--lg-forest-soft); color:var(--lg-forest-deep); }
.o-ledger .fmtmenu .fitem.on { background:var(--lg-forest); color:#fff; }
.o-ledger .fmtmenu .fitem .tick { width:12px; text-align:center; color:var(--lg-forest); font-weight:800; opacity:0; }
.o-ledger .fmtmenu .fitem.on .tick { color:#fff; opacity:1; }
.o-ledger .fmtmenu .fitem .ex { margin-left:auto; font-family:var(--lg-mono); font-size:11px; color:var(--lg-ink-faint); }
.o-ledger .fmtmenu .fitem.on .ex { color:#ffffffcc; }
.o-ledger .fmtmenu .fitem .chev { margin-left:6px; color:var(--lg-ink-faint); font-size:10px; }
.o-ledger .fmtmenu .fitem.on .chev { color:#ffffffcc; }
.o-ledger .fmt-sub { border-top:1px solid var(--lg-rule); margin-top:8px; padding-top:9px; }
.o-ledger .fmt-sub .sub-h { font-size:10px; letter-spacing:.09em; text-transform:uppercase; color:var(--lg-ink-faint); font-weight:800; margin:0 2px 7px; display:flex; align-items:center; }
.o-ledger .fmt-sub .fmt-live-eg { font-family:var(--lg-mono); font-size:11px; color:var(--lg-forest); background:var(--lg-forest-soft); border-radius:5px; padding:2px 7px; margin-left:auto; }
.o-ledger .fmt-sub .frow { display:flex; align-items:center; gap:7px; margin:0 2px 8px; font-size:11.5px; color:var(--lg-ink-soft); }
.o-ledger .fmt-sub .frow .lbl { min-width:82px; }
.o-ledger .fmt-sub .seg { display:inline-flex; border:1px solid var(--lg-rule-strong); border-radius:7px; overflow:hidden; }
.o-ledger .fmt-sub .seg button { border:none; background:var(--lg-paper-3); color:var(--lg-ink-soft); font:inherit; font-size:11.5px; padding:3px 8px; cursor:pointer; border-right:1px solid var(--lg-rule); }
.o-ledger .fmt-sub .seg button:last-child { border-right:none; }
.o-ledger .fmt-sub .seg button.on { background:var(--lg-forest); color:#fff; }
.o-ledger .fmt-sub .fdate-list { display:flex; flex-direction:column; gap:3px; }
.o-ledger .fmt-sub .fdate-list button { text-align:left; border:1px solid var(--lg-rule-strong); background:var(--lg-paper-3); color:var(--lg-ink); border-radius:6px; padding:5px 8px; cursor:pointer; font:inherit; font-size:11.5px; display:flex; justify-content:space-between; gap:10px; }
.o-ledger .fmt-sub .fdate-list button .eg { color:var(--lg-ink-faint); font-family:var(--lg-mono); font-size:10.5px; }
.o-ledger .fmt-sub .fdate-list button.on { background:var(--lg-forest); color:#fff; border-color:var(--lg-forest); }
.o-ledger .fmt-sub .fdate-list button.on .eg { color:#ffffffcc; }
.o-ledger .fmt-sub .apply-row { display:flex; justify-content:flex-end; margin-top:4px; }
.o-ledger .fmt-sub .apply-row button { border:1px solid var(--lg-forest); background:var(--lg-forest); color:#fff; border-radius:7px; padding:5px 12px; cursor:pointer; font:inherit; font-size:12px; font-weight:600; }
.o-ledger .fmt-sub .apply-row button:hover { background:var(--lg-forest-deep); }
.o-ledger td.cell.named { box-shadow:inset 2px 0 0 var(--lg-forest); }
.o-ledger td.cell.named .v::after { content:''; position:absolute; top:5px; right:5px; width:5px; height:5px; border-radius:50%; background:var(--lg-forest); opacity:.7; }
.o-ledger td.cell.pinned .v::after { content:''; position:absolute; top:5px; right:5px; width:5px; height:5px; border-radius:50%; background:#b9763b; opacity:.85; }
.o-ledger .pop .name-input { width:100%; box-sizing:border-box; border:1px solid var(--lg-rule-strong); border-radius:7px; padding:6px 9px; font:inherit; font-size:13px; font-family:var(--lg-mono); color:var(--lg-ink); background:var(--lg-paper-3); margin-bottom:8px; }
.o-ledger .pop .name-input:focus { outline:none; box-shadow:inset 0 0 0 2px var(--lg-forest); }
/* --- Bake caret (\u25BE) + the named-views menu (Save as view / switch active / Unbake). Editor-only chrome
   \u2014 this CSS lives in LEDGER_EDITOR_CSS and never ships in a distributed deck. --- */
/* the caret is the RIGHT HALF of a split button: extra right padding opens a full-height column for it,
   so it reads as "this button has a menu" at arm's length (not a corner sliver). */
.o-ledger .mtool[data-tool="bake"] { position:relative; padding-right:34px; }
.o-ledger .mtool .mmore { position:absolute; top:0; right:0; bottom:0; width:24px; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; color:var(--lg-ink-soft); cursor:pointer; border-left:1px solid var(--lg-rule-strong); border-radius:0 8px 8px 0; }
.o-ledger .mtool .mmore:hover { color:var(--lg-forest-deep); background:var(--lg-forest-soft); }
.o-ledger .bakemenu { display:flex; flex-direction:column; gap:6px; }
.o-ledger .bakemenu .bk-act { display:block; width:100%; box-sizing:border-box; text-align:left; padding:7px 10px; border:1px solid var(--lg-rule-strong); background:var(--lg-paper-3); color:var(--lg-ink); border-radius:7px; cursor:pointer; font:600 12.5px var(--lg-sans); }
.o-ledger .bakemenu .bk-act:hover { background:var(--lg-forest-soft); color:var(--lg-forest-deep); border-color:var(--lg-forest-edge); }
.o-ledger .bakemenu .bk-saveas { display:flex; gap:5px; align-items:center; }
.o-ledger .bakemenu .bk-saveas .bk-name { flex:1; min-width:0; box-sizing:border-box; border:1px solid var(--lg-rule-strong); border-radius:7px; padding:6px 9px; font:inherit; font-size:12.5px; color:var(--lg-ink); background:var(--lg-paper-3); }
.o-ledger .bakemenu .bk-saveas .bk-name:focus { outline:none; box-shadow:inset 0 0 0 2px var(--lg-forest); }
.o-ledger .bakemenu .bk-saveas .bk-act { width:auto; white-space:nowrap; }
.o-ledger .bakemenu .bk-views { display:flex; flex-direction:column; gap:2px; }
.o-ledger .bakemenu .bk-view { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; border-radius:7px; cursor:pointer; font-size:12.5px; color:var(--lg-ink); }
.o-ledger .bakemenu .bk-view:hover { background:var(--lg-forest-soft); color:var(--lg-forest-deep); }
.o-ledger .bakemenu .bk-view.on { background:var(--lg-forest); color:#fff; }
.o-ledger .bakemenu .bk-view .bk-vname { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.o-ledger .bakemenu .bk-view .bk-vx { flex:none; width:16px; text-align:center; font-weight:800; opacity:.6; }
.o-ledger .bakemenu .bk-view .bk-vx:hover { opacity:1; color:#a15234; }
.o-ledger .bakemenu .bk-empty { font-size:11px; color:var(--lg-ink-faint); font-style:italic; padding:4px 2px; }
.o-ledger .bakemenu .bk-unbake { color:var(--lg-ink-soft); }
.o-ledger .bakemenu .bk-unbake.armed { background:#a15234; border-color:#a15234; color:#fff; }
/* --- posture: Bake (freeze to the recipient view; same footprint as the grid, resizable, scrollable) --- */
.o-ledger .baked { display:none; padding:14px 14px 6px; background:var(--lg-paper-3); }
.o-ledger .block.baked-on .baked { display:block; }
/* baking hides the live grid + formula bar, but KEEPS the pinned-KPI strip visible (it stays part of
   the authoring view, and the recipient sees it too \u2014 so hiding it in the editor was a mismatch). */
.o-ledger .block.baked-on .viewport, .o-ledger .block.baked-on .fbar { display:none; }
/* full bake: the baked preview renders its own "Metrics" KPI strip, so hide the editor's "Pinned" one
   to avoid showing the same numbers twice (a scoped bake has no strip, so the editor's stays visible). */
.o-ledger .block.baked-on.baked-dup-kpis > .kpis { display:none; }
/* the baked preview is a fixed, scrollable frame \u2014 no user resize (it only sized the editor preview
   box, never the presented output, which auto-fits; the drag grip just confused). */
.o-ledger .baked-view { width:100%; height:352px; min-width:220px; min-height:120px; max-width:100%; max-height:min(640px,78vh); box-sizing:border-box; overflow:auto; border:1px solid var(--lg-rule-strong); border-radius:10px; background:var(--lg-paper-3); }
.o-ledger .baked-view .lv { border:none; border-radius:0; box-shadow:none; background:transparent; }
.o-ledger .baked-view .lv-wrap { max-height:none; overflow:visible; }
.o-ledger .baked-view::-webkit-scrollbar { width:13px; height:13px; }
.o-ledger .baked-view::-webkit-scrollbar-track { background:transparent; }
.o-ledger .baked-view::-webkit-scrollbar-thumb { background:var(--lg-forest); border-radius:7px; border:3px solid var(--lg-paper-3); }
.o-ledger .baked-view::-webkit-scrollbar-thumb:hover { background:var(--lg-forest-deep); }
.o-ledger .baked-view::-webkit-scrollbar-corner { background:transparent; }
.o-ledger .baked-hint { margin:11px 2px 8px; font-size:11.5px; color:var(--lg-ink-faint); font-style:italic; line-height:1.5; }
/* --- posture: Expand (LARGE full-screen editor host on the body overlay, so it clears deck/scroll transforms) --- */
.o-ledger .o-shell { display:none; }
.o-ledger .o-shell.open { display:flex; flex-direction:column; align-items:stretch; gap:8px; position:fixed; inset:0; z-index:215; padding:8px 10px 10px; box-sizing:border-box; background:var(--lg-paper-3); overflow:hidden; }
.o-ledger .o-shell.open .o-back { align-self:flex-start; flex:0 0 auto; }
.o-ledger .o-shell.open .block { flex:1 1 auto; width:100%; min-height:0; max-height:none; border-radius:9px; box-shadow:0 20px 60px -34px rgba(0,0,0,.45); display:flex; flex-direction:column; }
.o-ledger .o-shell.open .viewport { flex:1 1 auto; max-height:none; min-height:0; } /* min-height:0 lets the grid SCROLL inside the viewport instead of ballooning the block past the shell (which clipped the tab strip on long files) */
.o-ledger .o-shell.open .o-tabstrip { flex:0 0 auto; } /* keep the sheet tabs pinned + fully visible at the bottom of the full-screen editor */
/* scoped to .block.baked-on: unbaked, .baked keeps its base display:none (line 488) so the empty
   preview doesn't eat half the full-screen shell \u2014 the grid above just gets all the reclaimed space. */
.o-ledger .o-shell.open .block.baked-on .baked { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
.o-ledger .o-shell.open .block.baked-on .baked-view { flex:1 1 auto; height:auto; max-height:none; } /* fill the full-screen shell \u2014 the 640px/78vh cap (bug 5) is for the in-fold frame only */
.o-ledger .o-back { align-self:flex-start; border:1px solid var(--lg-rule-strong); background:var(--lg-paper-2); color:var(--lg-ink); border-radius:8px; padding:7px 14px; font:600 12.5px var(--lg-sans); cursor:pointer; }
.o-ledger .o-back:hover { background:var(--lg-head-strong); }
/* Conditional-format menu (openCondFmtMenu) \u2014 the shared .pop shell; quick actions + a Manage list. */
.o-ledger .cfmenu { display:flex; flex-direction:column; gap:6px; }
.o-ledger .cfmenu .cf-act { text-align:left; border:1px solid var(--lg-rule-strong); background:var(--lg-paper-3); color:var(--lg-ink); border-radius:7px; padding:6px 10px; cursor:pointer; font:inherit; font-size:12.5px; }
.o-ledger .cfmenu .cf-act:hover { background:var(--lg-forest-soft); color:var(--lg-forest-deep); border-color:var(--lg-forest-edge); }
.o-ledger .cfmenu .cf-row { display:flex; align-items:center; gap:7px; }
.o-ledger .cfmenu .cf-row .cf-lbl { flex:1; font-size:11.5px; color:var(--lg-ink-soft); }
.o-ledger .cfmenu .cf-row .cf-num { width:56px; box-sizing:border-box; border:1px solid var(--lg-rule-strong); border-radius:6px; padding:4px 6px; font:inherit; font-size:12px; font-family:var(--lg-mono); color:var(--lg-ink); background:var(--lg-paper-3); }
.o-ledger .cfmenu .cf-row .cf-add { border:1px solid var(--lg-forest); background:var(--lg-forest); color:#fff; border-radius:6px; padding:4px 10px; cursor:pointer; font:600 11.5px var(--lg-sans); }
.o-ledger .cfmenu .cf-row .cf-add:hover { background:var(--lg-forest-deep); }
.o-ledger .cf-manage { margin-top:9px; }
.o-ledger .cf-manage .cf-manage-h { font-size:10px; letter-spacing:.09em; text-transform:uppercase; color:var(--lg-ink-faint); font-weight:800; margin:0 2px 6px; }
.o-ledger .cf-manage .cf-empty { font-size:11px; color:var(--lg-ink-faint); font-style:italic; margin:0 2px; }
.o-ledger .cf-manage .cf-mrow { display:flex; align-items:center; gap:8px; padding:3px 2px; font-size:11.5px; }
.o-ledger .cf-manage .cf-mrange { font-family:var(--lg-mono); color:var(--lg-forest); }
.o-ledger .cf-manage .cf-mkind { flex:1; color:var(--lg-ink-soft); }
.o-ledger .cf-manage .cf-del { border:none; background:none; color:var(--lg-ink-faint); cursor:pointer; font-size:15px; line-height:1; padding:0 4px; }
.o-ledger .cf-manage .cf-del:hover { color:#b4432f; }
/* --- Excel-style sheet-tab strip along the BOTTOM of the editor block. Editor-only chrome \u2014 this CSS
   lives in LEDGER_EDITOR_CSS and never ships in a distributed deck (the viewer renders the top-level
   sheet and has no tab UI). Pills are comfortable hit targets; the active pill is clearly distinct. --- */
.o-ledger .o-tabstrip { display:flex; align-items:flex-end; gap:3px; padding:5px 8px 0; background:var(--lg-head); border-top:1px solid var(--lg-rule-strong); overflow-x:auto; overflow-y:hidden; scrollbar-width:thin; scrollbar-color:var(--lg-rule-strong) transparent; }
.o-ledger .o-tabstrip::-webkit-scrollbar { height:7px; }
.o-ledger .o-tabstrip::-webkit-scrollbar-thumb { background:var(--lg-rule-strong); border-radius:4px; }
.o-ledger .o-tabstrip .o-tabpill { flex:0 0 auto; display:inline-flex; align-items:center; max-width:180px; min-height:28px; box-sizing:border-box; border:1px solid var(--lg-rule-strong); border-bottom:none; background:var(--lg-paper-3); color:var(--lg-ink-soft); border-radius:8px 8px 0 0; padding:6px 13px; font:600 12px var(--lg-sans); line-height:1; cursor:pointer; }
.o-ledger .o-tabstrip .o-tabpill:hover { background:var(--lg-forest-soft); color:var(--lg-forest-deep); border-color:var(--lg-forest-edge); }
.o-ledger .o-tabstrip .o-tabpill.on { background:var(--lg-paper-2); color:var(--lg-forest-deep); border-color:var(--lg-forest); border-top:2px solid var(--lg-forest); padding-top:5px; font-weight:800; cursor:default; }
.o-ledger .o-tabstrip .o-tabpill .o-tabpill-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.o-ledger .o-tabstrip .o-tabpill-input { border:none; outline:none; background:#fff; box-shadow:0 0 0 2px var(--lg-forest); border-radius:3px; font:inherit; font-weight:700; font-size:12px; color:var(--lg-ink); width:104px; min-width:44px; max-width:150px; padding:1px 3px; }
.o-ledger .o-tabstrip .o-tabadd { flex:0 0 auto; align-self:center; min-height:26px; box-sizing:border-box; border:1px solid var(--lg-rule-strong); background:var(--lg-paper-3); color:var(--lg-ink-soft); border-radius:7px; padding:5px 11px; font:700 15px var(--lg-sans); line-height:1; cursor:pointer; }
.o-ledger .o-tabstrip .o-tabadd:hover { background:var(--lg-forest-soft); color:var(--lg-forest); border-color:var(--lg-forest-edge); }
/* a sheet HIDDEN from Present \u2014 an editor-only cue (never shipped): the pill dims and carries a small
   slash-through-eye glyph. The recipient/Present never renders a hidden-unbaked sheet, so this mark is
   authoring chrome. */
.o-ledger .o-tabstrip .o-tabpill.hidden { opacity:.5; }
.o-ledger .o-tabstrip .o-tabpill .o-eyeoff { flex:0 0 auto; display:inline-block; position:relative; width:12px; height:12px; margin-left:6px; border:1.4px solid currentColor; border-radius:50%; }
.o-ledger .o-tabstrip .o-tabpill .o-eyeoff::after { content:""; position:absolute; top:-2px; left:4px; width:1.4px; height:15px; background:currentColor; transform:rotate(45deg); }
/* the tab context menu's destructive Delete \u2014 armed two-click confirm, mirroring the Bake menu's Unbake. */
.o-ledger .ctxmenu .citem.cdanger { color:#a15234; }
.o-ledger .ctxmenu .citem.cdanger.armed { background:#a15234; color:#fff; }
/* cross-sheet formula pick (link a formula across tabs): a =formula stayed open when the user switched
   sheets, so the formula bar is the live surface \u2014 tint it + call it out in the status, and mark the
   sheet being referenced. Editor-only chrome (never ships in a distributed deck). */
.o-ledger .block.xsheet-pick .fbar .fb-input, .o-ledger .block.xsheet-pick .fbar .fb-input:focus { background:#fff; box-shadow:inset 0 0 0 2px var(--lg-ref-b); }
.o-ledger .block.xsheet-pick .block-bar .status { color:var(--lg-ref-b); font-weight:700; max-width:440px; }
.o-ledger .block.xsheet-pick .o-tabstrip .o-tabpill.on { border-color:var(--lg-ref-b); border-top-color:var(--lg-ref-b); }
`;
var RUNTIME_CSS = `
.o-logo { height: 22px; width: auto; max-width: 140px; flex: none; }
.o-top {
  position: fixed; top: 0; left: 0; right: 0; z-index: 40;
  display: flex; align-items: center; gap: 28px;
  /* chrome tokens: corporate decks recolour the header bar (--chrome bg,
     --chrome-ink text, --chrome-soft muted), set its thickness (--chrome-pad),
     and tint an inline stamp (--chrome-mark). Defaults keep today's soft fade. */
  padding: var(--chrome-pad, 16px) 28px;
  background: var(--mast-bg, var(--chrome, linear-gradient(to bottom, var(--bg) 30%, transparent)));
  color: var(--mast-ink, var(--chrome-ink, var(--ink)));
}
/* THE FOLDS HAVE TO CLEAR THE BAND. .o-top is position:fixed, so it reserves nothing, and the room
   the folds left for it was a constant that could not know its size: clamp(72px,12vh,128px) on a
   card (BASE_CSS .slide-inner), clamp(28px,5vh,56px) on a scroll section. A masthead is not a
   constant \u2014 thickness (--chrome-pad 8-40px), title (12-40px), subtitle (10-24px) and a chips row
   reach ~190px, and everything past the constant stood on the fold's own heading. Measured on the
   card stage: a 189px band over content starting at 86px. So the padding takes whichever is LARGER,
   the old constant or the band's MEASURED height, which viewer.ts publishes as --mast-h and keeps
   true with a ResizeObserver. Only padding-top is restated; the bottom keeps its clamp.
   NO EXTRA GAP ON TOP OF THE MEASURED HEIGHT \u2014 a decision, not an omission. n px of gap is n px of
   movement for every deck whose band lands within n px of the constant, and the default band is
   66px against a 72px floor. A small band already has the constant's 72-128px of air; a large one
   gets what the editor draws, where #masthead is position:static and #mount starts where it ends.
   SCOPED TO .o-stage, load-bearing twice. PRINT: the print block hides .o-top and prints the
   .o-print clones, a SIBLING of the stage \u2014 unscoped, they would carry a blank strip for a band
   that is not on the paper. BYTES: .slide-inner lives in BASE_CSS, embedded in every saved file and
   byte-frozen by a golden test; this lives in RUNTIME_CSS, so the fix costs no deck bytes and still
   reaches decks written before it existed. */
.o-stage .slide-inner { padding-top: max(clamp(72px, 12vh, 128px), var(--mast-h, 0px)); }
.o-scroll .o-stage .slide:not(.k-document) .slide-inner { padding-top: max(clamp(28px, 5vh, 56px), var(--mast-h, 0px)); }
/* the stamp/logo scales with the bar thickness (chrome-pad); default = 22px (16+6),
   so plain decks are unchanged, and a thicker bar gets a proportionally bigger mark */
.o-top .o-logo, .o-top .o-stamp { color: var(--chrome-mark, var(--accent)); height: var(--chrome-mark-h, calc(var(--chrome-pad, 16px) + 6px)); width: auto; flex: none; }
.o-title { font-family: var(--font-mast, var(--font-display)); font-size: var(--mast-title-size, 17px); font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; color: inherit; }
.o-title::after { content: "."; color: var(--accent); }
/* deck masthead (subtitle + metadata chips), only present when the manifest sets them */
.o-headmeta { display: flex; flex-direction: column; gap: 4px; justify-content: center; min-width: 0; }
.o-headmeta .o-title { white-space: normal; }
.o-subtitle { font: 400 var(--mast-sub-size, 13px) var(--font-body); color: var(--mast-sub-ink, var(--chrome-soft, var(--ink-soft))); max-width: 64ch; }
.o-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.o-chip {
  font: 600 11px var(--font-body); letter-spacing: 0.02em; white-space: nowrap;
  padding: 3px 10px; border-radius: 99px;
  background: color-mix(in srgb, var(--mast-ink, var(--chrome-ink, var(--ink))) 13%, transparent);
  color: var(--mast-ink, var(--chrome-ink, var(--ink)));
}
/* many folds overflow \u2014 a visible (thin) scrollbar, and go() keeps the active
   tab scrolled into view */
.o-tabs { display: flex; gap: 4px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: thin; scrollbar-color: var(--rule) transparent; }
.o-tabs::-webkit-scrollbar { height: 6px; }
.o-tabs::-webkit-scrollbar-thumb { background: var(--rule); border-radius: 3px; }
.o-tab {
  border: none; background: none; cursor: pointer; white-space: nowrap;
  font: 600 12.5px var(--font-body); color: var(--mast-sub-ink, var(--chrome-soft, var(--ink-soft)));
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 8px 12px; border-radius: 6px; border-bottom: 2px solid transparent;
}
.o-tab:hover { color: var(--accent); }
.o-tab.o-active { color: var(--mast-ink, var(--chrome-ink, var(--ink))); border-bottom-color: var(--accent); }
.o-actions { display: flex; gap: 8px; }
.o-actions button {
  border: 1px solid var(--rule); background: rgba(255,255,255,0.6); color: var(--ink-soft);
  border-radius: 6px; padding: 5px 12px; cursor: pointer; font: 600 12.5px var(--font-body);
}
.o-actions button:hover { border-color: var(--accent); color: var(--accent); }

.o-banner {
  display: none; position: fixed; top: 58px; left: 50%; transform: translateX(-50%); z-index: 41;
  padding: 8px 14px; border-radius: 8px; background: #FFF4E5; color: #8a4b00;
  font: 500 13px var(--font-body); border: 1px solid #f0ddc0; box-shadow: 0 4px 18px rgba(26,26,26,0.08);
  gap: 12px; align-items: center;
}
.o-edit-mode .o-banner { display: flex; }
.o-banner button { border: 1px solid #c98a3d; background: #fff; color: #8a4b00; border-radius: 5px; padding: 3px 10px; cursor: pointer; font-size: 12.5px; }

.o-stage { min-height: 100vh; }

.o-bottom {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 40;
  display: flex; align-items: center; gap: 20px;
  padding: 14px 28px;
  background: linear-gradient(to top, var(--bg) 25%, transparent);
}
.o-mark { font: 500 11.5px var(--font-body); color: var(--ink-soft); text-decoration: none; opacity: 0.7; display: inline-flex; align-items: center; gap: 5px; }
.o-mark:hover { opacity: 1; color: var(--accent); }
.o-mark svg { height: 16px; width: auto; color: var(--accent); flex: none; }
.o-pipstack { display: flex; flex-direction: column; align-items: center; gap: 5px; margin: 0 auto; }
.o-pips { display: flex; gap: 8px; }
.o-pip { width: 8px; height: 8px; border-radius: 50%; border: none; padding: 0; background: var(--rule); cursor: pointer; transition: background 0.2s, transform 0.2s; }
.o-pip.o-active { background: var(--accent); transform: scale(1.25); }
/* within-group dots: a smaller row under the main pips (how many folds in this group, which is live) */
.o-subpips { display: flex; gap: 6px; }
.o-subpips[hidden] { display: none; }
.o-subpip { width: 5px; height: 5px; border-radius: 50%; border: none; padding: 0; background: var(--rule); opacity: 0.55; cursor: pointer; transition: background 0.2s, transform 0.2s, opacity 0.2s; }
.o-subpip.o-active { background: var(--accent); opacity: 1; transform: scale(1.3); }
.o-nav { display: flex; align-items: center; gap: 10px; font: 600 12.5px var(--font-body); color: var(--ink-soft); }
.o-nav button { border: 1px solid var(--rule); background: rgba(255,255,255,0.6); color: var(--ink); border-radius: 6px; padding: 4px 11px; cursor: pointer; font-size: 14px; line-height: 1.2; }
.o-nav button:hover { border-color: var(--accent); color: var(--accent); }

.o-edit-mode [contenteditable] { outline: 1px dashed rgba(85,122,78,0.45); outline-offset: 3px; min-width: 1ch; }
.o-edit-mode [data-oedit]:focus { outline: 2px solid var(--accent); }

.o-overlay { position: fixed; inset: 0; display: none; z-index: 60; }
.o-overlay.o-black { display: block; background: #000; }
.o-overlay.o-white { display: block; background: #fff; }

/* present KEEPS the page header (tabs + Edit) visible by default \u2014 a presentation
   can still navigate by page, and a recipient can jump into Edit. DRAG the bar up
   (or throw the pointer to the very top edge) to tuck it away for a full-bleed view;
   Esc/Backspace brings the header \u2014 and the Edit button \u2014 back. The footer brand
   mark + prev/next arrows still fall away; the page dots stay. */
.o-present .o-banner { display: none; }
.o-present .o-mark, .o-present .o-nav { display: none; }
.o-present .o-top { transition: transform 0.24s ease; cursor: grab; }
.o-present .o-top:active { cursor: grabbing; }
.o-present .o-top button, .o-present .o-top a, .o-present .o-top .o-tab { cursor: pointer; }
.o-present.o-chrome-hidden .o-top { transform: translateY(-115%); }

/* Scroll fold type (foldType:'scroll') \u2014 a continuous-reading document, not a
   one-fold-at-a-time card stage. The whole Fold flows down the stage; the footer
   pips / prev-next and Present fall away; the header tabs become a section jump-list
   (a live TOC). Sections drop the 100vh scene height so they flow; document folds
   already render their own paper, so they need only the height release. These rules
   live in RUNTIME_CSS (viewer chrome, injected at boot) \u2014 never saved into the file,
   so adding a foldType changes zero deck bytes. */
.o-scroll .o-stage { min-height: 0; }
.o-scroll .slide { min-height: 0; }
.o-scroll .slide:not(.k-document) .slide-inner { padding: clamp(28px, 5vh, 56px) 0; }
.o-scroll .o-pipstack, .o-scroll .o-nav, .o-scroll .o-present-btn { display: none; }

.o-print { display: none; }
/* Laid out but off-screen, so the paginator can MEASURE the print clones. A display:none subtree
   reports every offset as 0, which silently produced a one-page print copy; visibility:hidden would
   reserve space in the page. Applied for the duration of one synchronous pass and removed again. */
.o-print.o-measuring { display: block; position: absolute; left: -200000px; top: 0; }
/* MEASURE UNDER THE GEOMETRY YOU WILL PRINT WITH. The measuring pass runs with SCREEN rules (it is
   not an actual print), and the one box property that differs between the two is the document's
   margin \u2014 on screen it is centred with a generous top margin, in print it is flush to the page.
   Measuring with the screen margin and then printing without it shifted every running header and
   footer down the page by that margin. Everything else already agrees, which is what the
   border-box change bought. */
.o-print.o-measuring .slide.k-document .o-doc[data-opage] { margin: 0; }
/* MEASURE THE BLOCK AT ITS PRINT HEIGHT \u2014 which is now the CAPPED height, because print clips a full
   block at the page line exactly as the screen does (editor is law). So the measuring pass must NOT
   un-cap: it clips progressively, block by block, the same way the live pass does, and each block
   lands on the page print will actually put it on. Un-capping here is what used to make the measured
   layout disagree with the clipped print \u2014 the paginator paged as if the text flowed, then print
   clipped it, and the break-before markers pointed a page short. The cap's --opfill is set DURING the
   pass, so a block is still measured at full height on the one iteration that decides whether it IS
   full; only the blocks already decided are clipped, which is exactly what the live pass sees too. */
@media print {
  /* named pages let ONE print mix landscape slides + portrait A4 documents.
     PHYSICAL units (in), not px: the interactive print dialog honours an in/mm
     @page size as the actual paper, but treats a px size as a hint and falls back
     to Letter/A4 \u2014 which letterboxed the 16:9 slide with big white bars. 1280\xD7720
     CSS px = 13.333in \xD7 7.5in at 96dpi, so the slide still fills the page exactly. */
  @page slidepage { size: 13.333in 7.5in; margin: 0; }
  /* A PAGED document prints its own sheet: the .o-doc box IS the paper, margins included (it is
     border-box), and the paginator has already placed every block against that sheet. So the page
     margin here must be ZERO \u2014 the document's own padding is the margin, and any @page margin on
     top of it would be a second one, shrinking the printable area until the engine broke pages
     somewhere the screen never did. Zero margin is what makes screen pagination and print
     pagination the same pagination. @page slidepage is untouched: a slide is not a document. */
  @page docpage { size: A4; margin: 14mm; }
  /* One named page per paper format. @page cannot be scoped by selector \u2014 the size lives on the
     page rule and an element opts in via the page property \u2014 so each format needs its own named page and a
     matching :has() rule below. Chromium-only, like the side-by-side image rules. */
  @page docpage-a3 { size: A3; margin: 14mm; }
  @page docpage-a2 { size: A2; margin: 14mm; }
  @page docpage-a5 { size: A5; margin: 10mm; }
  @page docpage-book { size: 152.4mm 228.6mm; margin: 10mm; }
  /* NO bare unnamed @page default here: one fixed paper size for the whole job
     corrupted the combined mixed PDF in the interactive dialog (it fought the named
     docpage). The export page injects the right single default per scope, and NOTHING
     for a mixed job so the named slidepage/docpage drive each page. A deck printed
     directly via Ctrl+P (not through the export page) relies on the named pages too. */
  body { background: #fff; }
  .o-top, .o-bottom, .o-banner, .o-stage, .o-overlay { display: none !important; }
  .o-print { display: block; }
  .o-print .slide:not(.k-document) {
    page: slidepage;
    width: 1280px; height: 720px; min-height: 0; overflow: hidden;
    page-break-after: always; break-after: page;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .o-print .slide.k-document {
    page: docpage; display: block; min-height: 0; background: #fff; overflow: visible;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* Opt each formatted document into its named page. The attribute lives on the .o-doc INSIDE the
     slide, but the page property has to be set on the fragmentation root \u2014 the slide \u2014 hence :has(). */
  .o-print .slide.k-document:has(.o-doc[data-opage="a3"]) { page: docpage-a3; }
  .o-print .slide.k-document:has(.o-doc[data-opage="a2"]) { page: docpage-a2; }
  .o-print .slide.k-document:has(.o-doc[data-opage="a5"]) { page: docpage-a5; }
  /* the custom sheet's SIZE cannot live here: @page takes no custom property, so the rule itself
     is generated at runtime (see syncCustomPaper). This only does the opt-in. */
  .o-print .slide.k-document:has(.o-doc[data-opage="custom"]) { page: docpage-custom; }
  .o-print .slide.k-document:has(.o-doc[data-opage="book"]) { page: docpage-book; }
  /* display:block + overflow:visible put the document body in a fragmentable block flow, so a
     page-break inside it is honoured \u2014 the base .slide's overflow-x:clip / flex context would
     otherwise suppress CSS fragmentation and the page-break became a silent no-op */
  /* min-height:0 matters now the screen rules give a formatted page a sheet-high box \u2014 carrying
     that into print would pad every document with blank paper before the flow even starts */
  /* A PAGED document keeps EVERYTHING the paginator did: its sheet width, its real padding, and the
     pushes that placed each block on a page. With @page margin:0 above, the .o-doc box and the
     physical page are the same rectangle, so the engine's breaks land exactly where the screen's
     boundaries are \u2014 the printed page count matches the screen page count, the Contents page
     numbers are true on paper, and the running header/footer sit where they were drawn.
     The pushes are NOT undone any more. They used to be, because the old print box was a different
     shape and a push would have broken the page twice; now the push IS the page break's position. */
  /* The doc is pinned to the PRINTABLE WIDTH, not left to width:auto. auto filled the print
     container \u2014 which is the 1280px layout viewport, not the A4 content box \u2014 so the text wrapped
     far wider than on screen, every block came out shorter, and the paginator (which measured at the
     real --opw) and the engine disagreed about where pages ended. A 4-page document printed 5 with a
     near-blank page, exactly the report. The printable width is the sheet minus its two side margins
     (the @page horizontal margin is --opmar), which is the same text column the screen and the
     measuring pass use, so the same lines wrap onto the same pages.
     The @page margin already draws the page's edges, so the box carries no margin/padding of its
     own \u2014 a second one would shrink the band and break pages early. */
  .o-print .slide.k-document .o-doc[data-opage] {
    display: block; overflow: visible; box-sizing: border-box;
    width: calc(var(--opw) - 2 * var(--opmar)); max-width: none; min-height: 0; margin: 0; padding: 0;
    background-image: none; box-shadow: none; border: none; background: transparent;
  }
  /* The paginator already decided which block starts each page. On screen that is drawn as a gap;
     here it becomes a real break, so the engine's pages and the screen's pages are the same pages \u2014
     and the Contents numbers stay true. The gap itself must go, or it would pad the break. */
  .o-print .slide.k-document .o-doc[data-opage] > [data-opagetop] { margin-top: 0; break-before: page; }
  /* The screen overlay cannot survive print: box padding applies to the first and last fragment
     only, and a margin is truncated at a break, so nothing holds content off the paper's edge on a
     continuation page and the bands ended up under the text. Print uses @page margin boxes instead
     (generated in document.ts) \u2014 they live in the margin, repeat per page, and can count pages. */
  .o-print .o-pagefurn { display: none; }
  /* A CAPPED text block IS capped on paper too \u2014 editor is law. The screen clips a full block at the
     page line; print clips it at the same --opfill so both surfaces show the same page, and the
     engine never flows the hidden text onto a sheet the editor never drew. That also makes the block
     at most one page tall, so break-inside: avoid (below) can keep it whole. The screen's loud cut
     band is dropped from print \u2014 the author is warned on screen before they export; the PDF stays
     clean (a clipped block carries no marker in the finished document, by Passing's call). */
  .o-print .slide.k-document .o-doc > .o-text[data-ofull]::after { content: none; }
  /* The engine breaks ONLY where the paginator told it to \u2014 a break-before on a pushed block \u2014 and
     never inside a block. A capped text block is clipped to a page (above) so it is always keepable;
     a block genuinely taller than a page, a big figure or a long table, the engine cannot keep, so it
     ignores the rule and spans it, which is the long-standing figure/table behaviour. */
  .o-print .slide.k-document .o-doc[data-opage] > * { break-inside: avoid; }
  /* An UNPAGED document is a Scroll \u2014 no sheet, nothing to reproduce \u2014 so it still flattens into a
     plain flow and lets the engine break it wherever it likes. */
  .o-print .slide.k-document .o-doc:not([data-opage]) { display: block; overflow: visible; width: auto; max-width: none; min-height: 0; margin: 0; padding: 0; background-image: none; box-shadow: none; border: none; background: transparent; }
  .o-print .slide.k-document .o-doc:not([data-opage]) > [data-opagetop] { margin-top: 0; }
  /* A block the AUTHOR's page break pushed keeps its gap on screen (that gap is the boundary you
     see) but must not carry it into print, where the engine has already broken at the rule. */
  .o-print .slide.k-document .o-doc > [data-opgbrk] { margin-top: 0; }
  .o-print .slide.k-document hr.o-pagebreak { break-after: page; break-inside: avoid; border: none; height: 0; margin: 0; }
  .o-print .slide.k-document hr.o-pagebreak::after { display: none; }
  .o-print .slide.k-document h2, .o-print .slide.k-document h3 { break-after: avoid; }
  .o-print .slide.k-document figure, .o-print .slide.k-document .o-callout,
  .o-print .slide.k-document pre.o-code, .o-print .slide.k-document nav.o-toc { break-inside: avoid; }
  /* the watermark is an absolute layer \u2014 it would only paint on the first page;
     drop it from print so a document doesn't look broken across pages */
  .o-print .o-doc-bg { display: none; }

  .o-print .anim { opacity: 1 !important; transform: none !important; animation: none !important; }
}
`;

// src/viewer.ts
var tpl = (id) => document.querySelector(`template[data-origami-slide="${CSS.escape(id)}"]`);
function createViewer(manifest, hooks, assets = {}) {
  const root = document.getElementById("origami-root");
  if (!root) throw new Error("origami: #origami-root missing");
  const style = document.createElement("style");
  style.id = "origami-runtime-css";
  style.textContent = RUNTIME_CSS;
  document.head.appendChild(style);
  const fontCss = fontFacesCss(assets);
  if (fontCss) {
    const fonts = document.createElement("style");
    fonts.id = "origami-fonts-css";
    fonts.textContent = fontCss;
    document.head.appendChild(fonts);
  }
  applyBrandLogoVar(document.documentElement, assets);
  applyFavicon(assets);
  const hidden = new Set(manifest.hidden ?? []);
  const visibleOrder = (manifest.order ?? []).filter((id) => !hidden.has(id) && tpl(id));
  const edits = /* @__PURE__ */ new Map();
  let idx = 0;
  let editMode = false;
  const isScroll = manifest.foldType === "scroll";
  root.innerHTML = `
    <header class="o-top">
      <span class="o-title"></span>
      <nav class="o-tabs" aria-label="Slides"></nav>
      <span class="o-actions">
        <button class="o-edit-toggle">\u270E Edit</button>
        <button class="o-present-btn">Present</button>
      </span>
    </header>
    <div class="o-banner"><span>Editing \u2014 changes live here until you save a copy.</span><button class="o-save">Save a copy</button></div>
    <main class="o-stage"></main>
    <footer class="o-bottom">
      <a class="o-mark" href="https://origamilabs.nl" target="_blank" rel="noopener"><svg viewBox="0 0 64 64" aria-hidden="true"><g fill="currentColor"><animateTransform attributeName="transform" type="translate" values="0 0; 0 -1; 0 0" keyTimes="0;0.5;1" dur="4.5s" repeatCount="indefinite"/><g opacity="0.45"><animateTransform attributeName="transform" type="rotate" values="0 36 40; 7 36 40; 0 36 40" keyTimes="0;0.5;1" dur="3.2s" repeatCount="indefinite"/><polygon points="30,40 47,40 52,11"/></g><g><animateTransform attributeName="transform" type="rotate" values="0 34 40; -12 34 40; 0 34 40" keyTimes="0;0.5;1" dur="3.2s" repeatCount="indefinite"/><polygon points="26,40 48,40 43,7" opacity="0.92"/></g><polygon points="44,40 62,29 47,48" opacity="0.72"/><polygon points="28,39 48,41 36,55"/><polygon points="21,44 28,39 36,55" opacity="0.7"/><polygon points="9,12 15,13 28,41 22,44" opacity="0.85"/><polygon points="9,12 15,13 14,19 2,17"/></g></svg>made with origami</a>
      <div class="o-pipstack">
        <div class="o-pips" role="group" aria-label="Slide position"></div>
        <div class="o-subpips" role="group" aria-label="Position within group" hidden></div>
      </div>
      <span class="o-nav">
        <button class="o-prev" aria-label="Previous slide">\u2039</button>
        <span class="o-progress"></span>
        <button class="o-next" aria-label="Next slide">\u203A</button>
      </span>
    </footer>
    <div class="o-overlay"></div>
    <div class="o-print"></div>`;
  document.documentElement.classList.toggle("o-scroll", isScroll);
  root.querySelector(".o-title").textContent = manifest.title || "Untitled deck";
  const mast = manifest.header;
  const topEl = root.querySelector(".o-top");
  const MAST_HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
  for (const [k, prop] of [["bg", "--mast-bg"], ["ink", "--mast-ink"], ["subInk", "--mast-sub-ink"]]) {
    const c = mast?.[k];
    if (typeof c === "string" && MAST_HEX.test(c)) topEl.style.setProperty(prop, c);
  }
  if (mast && (mast.subtitle || mast.chips && mast.chips.length)) {
    const titleEl = root.querySelector(".o-title");
    const meta = document.createElement("div");
    meta.className = "o-headmeta";
    titleEl.replaceWith(meta);
    meta.appendChild(titleEl);
    if (mast.subtitle) {
      const sub = document.createElement("span");
      sub.className = "o-subtitle";
      sub.textContent = mast.subtitle;
      meta.appendChild(sub);
    }
    if (mast.chips && mast.chips.length) {
      const chips = document.createElement("div");
      chips.className = "o-chips";
      for (const c of mast.chips) {
        const chip = document.createElement("span");
        chip.className = "o-chip";
        chip.textContent = c;
        chips.appendChild(chip);
      }
      meta.appendChild(chips);
    }
  }
  if (assets["brand-logo"] && mast?.stamp !== false) {
    const logo = document.createElement("img");
    logo.className = "o-logo";
    logo.src = assets["masthead-logo"] ?? assets["brand-logo"];
    logo.alt = "";
    topEl.insertBefore(logo, topEl.firstChild);
  }
  if (typeof ResizeObserver !== "undefined") {
    let lastMastH = -1;
    const publishMastHeight = () => {
      const h = Math.ceil(topEl.getBoundingClientRect().height);
      if (h === lastMastH) return;
      lastMastH = h;
      document.documentElement.style.setProperty("--mast-h", `${h}px`);
    };
    publishMastHeight();
    new ResizeObserver(publishMastHeight).observe(topEl, { box: "border-box" });
  }
  const tabs = root.querySelector(".o-tabs");
  const pips = root.querySelector(".o-pips");
  const subpips = root.querySelector(".o-subpips");
  const stage = root.querySelector(".o-stage");
  const progress = root.querySelector(".o-progress");
  const overlay = root.querySelector(".o-overlay");
  const printHost = root.querySelector(".o-print");
  function cloneSlide(id, forPrint = false) {
    const t = tpl(id);
    const meta = manifest.slides[id];
    const el6 = document.createElement("section");
    el6.className = "slide k-" + (meta?.kind ?? "unknown");
    el6.setAttribute("data-slide-id", id);
    if (meta?.bg) el6.style.setProperty(meta.kind === "document" ? "--fold-paper" : "--fold-bg", meta.bg);
    el6.appendChild(t.content.cloneNode(true));
    el6.querySelectorAll('script:not([type="application/json"])').forEach((s2) => {
      if (forPrint) {
        s2.remove();
        return;
      }
      if (!s2.src) s2.textContent = "(function(){\n" + (s2.textContent ?? "") + "\n})();";
    });
    resolveAssetRefs(el6, assets);
    mountCloneBlocks(el6, {
      assets,
      capabilities: manifest.capabilities ?? [],
      forPrint,
      referrerless: location.protocol === "file:" || window.origin === "null"
    });
    const stored = edits.get(id);
    if (stored) applyEdits(el6, stored);
    return el6;
  }
  function applyEdits(slide, values) {
    liteEditNodes(slide).forEach((n, i) => {
      if (values[i] !== void 0) n.innerHTML = sanitizeInline(values[i]);
    });
  }
  function captureEdits() {
    if (!editMode) return;
    stage.querySelectorAll(".slide").forEach((mounted) => {
      const id = mounted.getAttribute("data-slide-id");
      if (!id) return;
      withSource(mounted, () => {
        const nodes = liteEditNodes(mounted);
        if (nodes.length === 0) return;
        edits.set(id, nodes.map((n) => n.innerHTML ?? ""));
      });
    });
  }
  function renderNav() {
    tabs.innerHTML = "";
    pips.innerHTML = "";
    visibleOrder.forEach((id, i) => {
      if (i !== 0 && manifest.slides[id]?.group === true) return;
      const tab = document.createElement("button");
      tab.className = "o-tab";
      tab.setAttribute("data-tab", id);
      tab.setAttribute("data-head", String(i));
      tab.textContent = manifest.slides[id]?.label ?? id;
      tab.addEventListener("click", () => go(i));
      tabs.appendChild(tab);
      const pip = document.createElement("button");
      pip.className = "o-pip";
      pip.setAttribute("data-head", String(i));
      pip.setAttribute("aria-label", manifest.slides[id]?.label ?? `Slide ${i + 1}`);
      pip.addEventListener("click", () => go(i));
      pips.appendChild(pip);
    });
  }
  function headOf(i) {
    let head = 0;
    for (let j = 0; j <= i; j++) {
      if (j === 0 || manifest.slides[visibleOrder[j]]?.group !== true) head = j;
    }
    return head;
  }
  function groupSpan(head) {
    const span2 = [head];
    for (let j = head + 1; j < visibleOrder.length; j++) {
      if (manifest.slides[visibleOrder[j]]?.group === true) span2.push(j);
      else break;
    }
    return span2;
  }
  function renderSubpips(i) {
    const span2 = groupSpan(headOf(i));
    subpips.innerHTML = "";
    if (span2.length <= 1) {
      subpips.hidden = true;
      return;
    }
    subpips.hidden = false;
    for (const j of span2) {
      const d = document.createElement("button");
      d.className = "o-subpip" + (j === i ? " o-active" : "");
      d.setAttribute("aria-label", manifest.slides[visibleOrder[j]]?.label ?? `Fold ${j + 1}`);
      if (j === i) d.setAttribute("aria-current", "true");
      d.addEventListener("click", () => go(j));
      subpips.appendChild(d);
    }
  }
  function wireEditing(slide) {
    liteEditNodes(slide).forEach((n) => {
      if (editMode) n.setAttribute("contenteditable", "plaintext-only");
      else n.removeAttribute("contenteditable");
    });
  }
  function markActive(i) {
    progress.textContent = `${i + 1} / ${visibleOrder.length}`;
    const head = String(headOf(i));
    tabs.querySelectorAll(".o-tab").forEach(
      (t) => t.classList.toggle("o-active", t.getAttribute("data-head") === head)
    );
    tabs.querySelector(".o-tab.o-active")?.scrollIntoView({ inline: "nearest", block: "nearest" });
    pips.querySelectorAll(".o-pip").forEach(
      (p) => p.classList.toggle("o-active", p.getAttribute("data-head") === head)
    );
    renderSubpips(i);
  }
  function mount() {
    const id = visibleOrder[idx];
    stage.innerHTML = "";
    const slide = cloneSlide(id);
    stage.appendChild(slide);
    wireEditing(slide);
    mountKind(manifest.slides[id]?.kind ?? "", slide);
    mountCountUps(slide);
    mountSparklines(slide);
    mountStageBlocks(slide, { assets });
    resolveAssetRefs(slide, assets);
    reserveCardBandsWhenSettled(slide);
    requestAnimationFrame(() => slide.classList.add("is-shown"));
    window.scrollTo(0, 0);
    markActive(idx);
  }
  function mountContinuous() {
    stage.innerHTML = "";
    for (const id of visibleOrder) {
      const slide = cloneSlide(id);
      stage.appendChild(slide);
      wireEditing(slide);
      mountKind(manifest.slides[id]?.kind ?? "", slide);
      mountCountUps(slide);
      mountSparklines(slide);
      mountStageBlocks(slide, {});
      resolveAssetRefs(slide, assets);
      reserveCardBandsWhenSettled(slide);
      slide.classList.add("is-shown");
    }
    markActive(idx);
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) e.target.classList.add("is-revealed");
          });
          const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
          const id = top && top.target.getAttribute("data-slide-id");
          const i = id ? visibleOrder.indexOf(id) : -1;
          if (i >= 0) {
            idx = i;
            markActive(i);
          }
        },
        { rootMargin: "-45% 0px -45% 0px" }
      );
      stage.querySelectorAll(".slide").forEach((s2) => io.observe(s2));
    }
  }
  function go(i) {
    captureEdits();
    idx = (i + visibleOrder.length) % visibleOrder.length;
    if (isScroll) {
      stage.querySelector(`.slide[data-slide-id="${CSS.escape(visibleOrder[idx])}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      markActive(idx);
    } else {
      mount();
    }
  }
  function setEditMode(on) {
    captureEdits();
    editMode = on;
    document.documentElement.classList.toggle("o-edit-mode", on);
    if (isScroll) {
      stage.querySelectorAll(".slide").forEach(wireEditing);
    } else {
      mount();
    }
    refreshPrint();
  }
  function refreshPrint() {
    printHost.innerHTML = "";
    for (const id of visibleOrder) {
      const slide = cloneSlide(id, true);
      slide.classList.add("is-shown");
      finalizeKind(manifest.slides[id]?.kind ?? "", slide);
      finalizeCountUps(slide);
      finalizeSparklines(slide);
      finalizeStageBlocks(slide, {});
      resolveAssetRefs(slide, assets);
      printHost.appendChild(slide);
    }
    printHost.classList.add("o-measuring");
    for (const slide of Array.from(printHost.children)) {
      if (slide instanceof HTMLElement) {
        paginateDoc(slide);
        const inner = slide.querySelector(".slide-inner:not(.o-doc)");
        if (inner) reserveCardBands(inner);
      }
    }
    printHost.classList.remove("o-measuring");
  }
  function setOverlay(mode) {
    overlay.className = "o-overlay" + (mode ? " " + mode : "");
  }
  function present() {
    document.documentElement.classList.add("o-present");
    document.documentElement.classList.remove("o-chrome-hidden");
    document.documentElement.requestFullscreen?.().catch(() => void 0);
  }
  function exitModes() {
    setOverlay("");
    if (document.documentElement.classList.contains("o-present")) {
      document.documentElement.classList.remove("o-present", "o-chrome-hidden");
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => void 0);
      return;
    }
    if (editMode) setEditMode(false);
  }
  function escapeOrReveal() {
    const r = document.documentElement;
    if (r.classList.contains("o-present") && r.classList.contains("o-chrome-hidden")) {
      r.classList.remove("o-chrome-hidden");
      return;
    }
    exitModes();
  }
  root.querySelector(".o-prev").addEventListener("click", () => go(idx - 1));
  root.querySelector(".o-next").addEventListener("click", () => go(idx + 1));
  root.querySelector(".o-present-btn").addEventListener("click", present);
  if (document.documentElement.hasAttribute("data-origami-published")) {
    root.querySelector(".o-edit-toggle").remove();
  } else {
    root.querySelector(".o-edit-toggle").addEventListener("click", () => setEditMode(!editMode));
  }
  root.querySelector(".o-save").addEventListener("click", () => {
    captureEdits();
    hooks.onSaveCopy();
  });
  document.addEventListener("keydown", (e) => {
    const target = e.target;
    if (target?.isContentEditable) {
      if (e.key === "Escape") target.blur();
      return;
    }
    if (isScroll) {
      if (e.key === "Escape" && editMode) {
        e.preventDefault();
        setEditMode(false);
      }
      return;
    }
    switch (e.key) {
      case "ArrowRight":
      case " ":
        e.preventDefault();
        go(idx + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        go(idx - 1);
        break;
      case "Backspace":
      // a reveal/exit key here — never let it navigate the browser back
      case "Escape":
        e.preventDefault();
        escapeOrReveal();
        break;
      case "f":
      case "F":
        present();
        break;
      case "b":
      case "B":
        setOverlay(overlay.classList.contains("o-black") ? "" : "o-black");
        break;
      case "w":
      case "W":
        setOverlay(overlay.classList.contains("o-white") ? "" : "o-white");
        break;
    }
  });
  const topBar = root.querySelector(".o-top");
  let dragFromY = null;
  topBar.addEventListener("pointerdown", (e) => {
    if (!document.documentElement.classList.contains("o-present")) return;
    if (e.target.closest("button, a, .o-tab")) return;
    dragFromY = e.clientY;
  });
  window.addEventListener("pointermove", (e) => {
    const r = document.documentElement;
    if (!r.classList.contains("o-present")) {
      dragFromY = null;
      return;
    }
    if (dragFromY !== null && dragFromY - e.clientY > 24) {
      r.classList.add("o-chrome-hidden");
      dragFromY = null;
    } else if (r.classList.contains("o-chrome-hidden") && e.clientY <= 4) {
      r.classList.remove("o-chrome-hidden");
    }
  });
  window.addEventListener("pointerup", () => {
    dragFromY = null;
  });
  let bandRaf = 0;
  window.addEventListener("resize", () => {
    if (bandRaf) return;
    bandRaf = requestAnimationFrame(() => {
      bandRaf = 0;
      stage.querySelectorAll(".slide .slide-inner:not(.o-doc)").forEach(reserveCardBands);
    });
  });
  window.addEventListener("beforeprint", () => {
    captureEdits();
    refreshPrint();
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) document.documentElement.classList.remove("o-present");
  });
  renderNav();
  if (isScroll) mountContinuous();
  else mount();
  refreshPrint();
  return {
    go,
    next: () => go(idx + 1),
    prev: () => go(idx - 1),
    current: () => visibleOrder[idx],
    setEditMode,
    isEditMode: () => editMode,
    present,
    edits,
    visibleOrder,
    refreshPrint
  };
}

// src/blocks/cover-css.ts
var coverCss = `/* @kind:cover */
.k-cover .eyebrow { margin-bottom: 30px; }
.k-cover .lede { margin-top: 6px; }
.k-cover .slide-inner::after {
  content: ""; display: block; width: 64px; height: 3px;
  background: var(--accent); margin-top: 44px; border-radius: 2px;
}
/* @endkind */
`;

// src/blocks/bullets-css.ts
var bulletsCss = `/* @kind:bullets */
.k-bullets ul { list-style: none; padding: 0; margin: 10px 0 0; font-size: calc(clamp(20px, 2.2vw, 27px) * var(--osz, 1)); line-height: 1.6; }
.k-bullets li { padding: 16px 0 16px 36px; position: relative; border-bottom: 1px solid var(--rule-soft); font-size: calc(1em * var(--osz, 1)); }
.k-bullets li::before { content: "\u2014"; position: absolute; left: 0; color: var(--accent); font-weight: 700; }
.k-bullets li:last-child { border-bottom: none; }
/* To-do list: a checklist variant of bullets (any list marked data-otodo, in any slide). A fixed
   checkbox column + baseline-aligned text keep the box and the first text line married up cleanly
   across every item \u2014 including items that wrap to several lines. Per-item state = li[data-checked].
   Inert: the box + tick are pure CSS; the editor flips data-checked, the viewer never mutates it. */
ul[data-otodo] { list-style: none; padding: 0; margin: 10px 0 0; font-size: calc(1em * var(--osz, 1)); line-height: 1.6; }
ul[data-otodo] > li { display: flex; align-items: baseline; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--rule-soft); font-size: calc(1em * var(--osz, 1)); }
ul[data-otodo] > li:last-child { border-bottom: none; }
ul[data-otodo] > li::before {
  content: ""; flex: 0 0 auto; width: 0.95em; height: 0.95em; align-self: baseline;
  /* position:static/left:auto neutralise the .k-bullets li::before rule (position:absolute; left:0),
     which would otherwise yank the checkbox to the slide's left edge when a to-do list sits on a
     bullets-kind slide \u2014 the box must stay in the flex row. */
  position: static; left: auto;
  transform: translateY(0.12em); border: 2px solid var(--accent); border-radius: 5px; box-sizing: border-box;
}
ul[data-otodo] > li[data-checked="true"]::before {
  border-color: var(--accent);
  background: var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23fff' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round' d='M3.5 8.6l3 3 6-7'/%3E%3C/svg%3E") center / 74% no-repeat;
}
ul[data-otodo] > li[data-checked="true"] { color: var(--ink-soft); }
/* @endkind */
`;

// src/blocks/stats-css.ts
var statsCss = `/* @kind:stats */
/* stat cards are core block vocabulary (base sheet) \u2014 blocks render
   identically on every slide kind */
/* @endkind */
`;

// src/blocks/gantt-css.ts
var ganttCss = `/* @kind:gantt */
.k-gantt { justify-content: flex-start; }
/* --obw is FLOORED at the kind default: a narrow block never drags the fold's title in with it
   (the .o-gantt-wrap below consumes --obw itself); a wider --obw still grows the whole fold. */
.o-gantt-shell { width: min(max(var(--obw, 1480px), 1480px), 96vw); margin: 0 auto; padding: clamp(56px, 9vh, 96px) 0 32px; display: flex; flex-direction: column; min-height: 0; flex: 1; }
.o-gantt-head .eyebrow { margin-bottom: 12px; }
.o-gantt-head h2 { margin-bottom: 18px; }
/* roadmap as an in-slide block (insertable on any fold, like a chart) */
figure.o-ganttfig { margin: 26px 0; }
figure.o-ganttfig[data-opos] { margin-left: calc(var(--op, 0) * 10%); }
figure.o-ganttfig figcaption { margin-top: 12px; font-size: 13px; color: var(--ink-soft); }
.o-gantt { display: flex; flex-direction: column; min-height: 0; }
.o-gantt-bar { display: flex; align-items: center; gap: 8px; margin: 4px 0 10px; flex-wrap: wrap; }
.o-gantt-chips { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.o-gantt-chip {
  border: 1px solid var(--rule); background: var(--paper); color: var(--ink-soft); cursor: pointer;
  border-radius: 999px; padding: 4px 12px; font: 600 11.5px var(--font-body);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.o-gantt-chip:hover { border-color: var(--accent); color: var(--accent); }
.o-gantt-chip.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
/* the chart body IS the resizable block: it consumes --obw (width grip) and --obh (height grip),
   centred in the shell so the fold's own measure and title stay put around it */
.o-gantt-wrap { overflow: auto; position: relative; border: 1px solid var(--rule); border-radius: 10px; background: var(--paper); width: min(var(--obw, 100%), 100%); margin-left: auto; margin-right: auto; max-height: min(var(--obh, 62vh), 90vh); }
.o-gantt-grid { position: relative; min-width: 100%; width: max-content; padding-bottom: 10px; }
.o-gantt-axis { position: sticky; top: 0; z-index: 30; background: var(--paper); border-bottom: 2px solid var(--rule); height: 52px; display: flex; box-shadow: 0 2px 4px rgba(26,26,26,0.04); }
.o-gantt-corner { width: 230px; flex-shrink: 0; border-right: 2px solid var(--rule); background: var(--paper); position: sticky; left: 0; z-index: 40; padding: 8px 14px; font-size: 11px; color: var(--ink-soft); letter-spacing: 0.08em; text-transform: uppercase; box-sizing: border-box; }
.o-gantt-axis-track { position: relative; flex: 1; min-width: var(--gantt-w); }
.o-gantt-month { position: absolute; top: 0; height: 100%; border-left: 1px solid var(--rule); padding: 8px 8px 0; font-size: 11px; color: var(--ink-soft); letter-spacing: 0.08em; text-transform: uppercase; box-sizing: border-box; }
.o-gantt-month-name { font-weight: 600; color: var(--ink); }
.o-gantt-month-range { font-size: 10px; opacity: 0.7; }
.o-gantt-tick { position: absolute; top: 34px; width: 1px; height: 18px; background: var(--rule); }
.o-gantt-tick.major { background: var(--ink-soft); }
.o-gantt-tick.minor { opacity: 0.45; height: 12px; }
/* fine (day/hour) axis: a taller axis with a dedicated day/hour label row below the ticks */
.o-gantt-axis.o-gantt-axis-fine { height: 74px; }
.o-gantt-axis-fine .o-gantt-tick { top: 42px; height: 14px; }
.o-gantt-axis-fine .o-gantt-tick.minor { height: 9px; }
/* the week/date marker (one per week or per day) sits just under the month band */
.o-gantt-axis-wk { position: absolute; top: 30px; font-size: 10px; font-weight: 700; color: var(--ink); padding-left: 3px; white-space: nowrap; pointer-events: none; }
/* Mon\u2013Sun labels, centred under each day; HH:00 labels under their hour tick */
.o-gantt-axis-day { position: absolute; top: 58px; font-size: 9px; line-height: 1; color: var(--ink-soft); text-align: center; white-space: nowrap; overflow: hidden; box-sizing: border-box; pointer-events: none; }
.o-gantt-axis-hr { position: absolute; top: 58px; font-size: 8px; line-height: 1; color: var(--ink-soft); padding-left: 2px; white-space: nowrap; pointer-events: none; }
/* zones: a faint tinted band behind the cards + a banner on the axis */
.o-gantt-zone { position: absolute; top: 0; bottom: 0; z-index: 0; pointer-events: none; }
.o-gantt-zone-axis { position: absolute; top: 33px; height: 17px; display: flex; align-items: center; padding: 0 6px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; overflow: hidden; box-sizing: border-box; opacity: 0.85; pointer-events: none; }
.o-gantt-lane { display: flex; min-height: 64px; border-bottom: 1px solid var(--rule); }
.o-gantt-lane:nth-child(even) .o-gantt-tracks { background: color-mix(in srgb, var(--rule) 18%, var(--paper)); }
.o-gantt-label { width: 230px; flex-shrink: 0; padding: 10px 14px; border-right: 2px solid var(--rule); background: var(--paper); position: sticky; left: 0; z-index: 10; display: flex; flex-direction: column; justify-content: center; box-sizing: border-box; }
.o-gantt-lane-name { font-size: 13px; font-weight: 700; color: var(--accent); padding-right: 46px; }
.o-gantt-lane-owner { font-size: 11px; color: var(--ink-soft); margin-top: 2px; }
.o-gantt-lane-count { font-size: 11px; color: var(--ink-soft); margin-top: 4px; font-weight: 600; }
.o-gantt-tracks { position: relative; flex: 1; min-width: var(--gantt-w); background: var(--paper); }
.o-gantt-card {
  position: absolute; min-width: 24px; height: 36px; border-radius: 4px;
  padding: 4px 14px 4px 12px; color: #fff; font-size: 11px; font-weight: 600;
  overflow: hidden; display: flex; align-items: center; box-sizing: border-box;
  transition: opacity 0.25s, transform 0.15s, box-shadow 0.2s;
  border: 2px solid transparent; box-shadow: 0 1px 3px rgba(26,26,26,0.10); user-select: none;
}
.o-gantt-card.faded { opacity: 0.12; pointer-events: none; }
.o-gantt-card.completed { opacity: 0.32; filter: grayscale(0.65); }
.o-gantt-card.completed .o-gantt-card-title { text-decoration: line-through; text-decoration-thickness: 1.5px; }
.o-gantt-card.completed::before { content: '\\2713'; display: inline-block; margin-right: 4px; font-weight: 800; color: #fff; }
.o-gantt-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.85); margin-right: 6px; flex-shrink: 0; }
.o-gantt-card-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.o-gantt-ms-line { position: absolute; top: 0; bottom: 0; width: 2px; opacity: 0.7; pointer-events: none; z-index: 4; }
.o-gantt-ms-tag {
  position: absolute; top: 4px; transform: translateX(-50%); white-space: nowrap;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.02em; z-index: 35;
  background: var(--paper); padding: 1px 6px; border-radius: 4px; border: 1px solid currentColor; user-select: none;
}
.o-gantt-ms-tag::after { content: ''; position: absolute; left: 50%; top: 100%; width: 2px; height: 8px; background: currentColor; transform: translateX(-50%); }
.o-gantt-legend { flex-shrink: 0; padding: 10px 2px 0; display: flex; align-items: center; gap: 18px; font-size: 12px; color: var(--ink-soft); flex-wrap: wrap; }
.o-gantt-swatch { display: inline-flex; align-items: center; gap: 6px; }
.o-gantt-swatch .sw { width: 14px; height: 14px; border-radius: 3px; }
.o-gantt-count { margin-left: auto; color: var(--accent); font-weight: 600; }
.o-gantt-empty { padding: 28px 14px; color: var(--ink-soft); font-size: 14px; }
.o-gantt-error { padding: 24px 0; color: #a13d2d; font-size: 15px; }
@media (max-width: 760px) { .o-gantt-corner, .o-gantt-label { width: 130px; } }
/* @endkind */
`;

// src/blocks/flow-css.ts
var flowCss = `/* @kind:flow */
.k-flow { justify-content: flex-start; }
/* --obw is FLOORED at the kind default: a narrow block never drags the fold's title in with it
   (the .o-flow-svg below consumes --obw itself); a wider --obw still grows the whole fold. */
.o-flow-shell { width: min(max(var(--obw, 1280px), 1280px), 94vw); margin: 0 auto; padding: clamp(56px, 9vh, 96px) 0 40px; }
.o-flow-head .eyebrow { margin-bottom: 12px; }
.o-flow-head h2 { margin-bottom: 18px; }
/* flowchart as an in-slide block (insertable on any fold, like a chart) */
figure.o-flowfig { margin: 26px 0; }
figure.o-flowfig[data-opos] { margin-left: calc(var(--op, 0) * 10%); }
figure.o-flowfig figcaption { margin-top: 12px; font-size: 13px; color: var(--ink-soft); }
.o-flow { position: relative; }
/* the drawing IS the resizable block: it consumes --obw (width grip) and --obh (height grip).
   --obh sets an EXPLICIT height, not only a cap: a drawing is height:auto off its viewBox aspect,
   so a cap alone could only ever shrink it \u2014 raising a cap above the natural height moved nothing,
   which is what made the height grip look dead. With an explicit height the grip works both ways:
   growing adds canvas room (the svg letterboxes under the default preserveAspectRatio), shrinking
   scales the drawing down. Unset, height falls back to auto and the cap back to the kind's 72vh,
   so a drawing that was never dragged renders exactly as before. */
.o-flow-svg { display: block; width: min(var(--obw, 100%), 100%); margin-left: auto; margin-right: auto; height: var(--obh, auto); max-height: min(var(--obh, 72vh), 90vh); }
/* BLOCK BACKGROUND \u2014 the same soft-tint recipe as a text block's fill (data-ofill on .o-text,
   css.ts). This is the whole BLOCK's own background, distinct from a flowchart's per-NODE fill
   (each node's own box colour, set in its own inline popup, canvas-diagram.ts) \u2014 the toolbar
   button reads "background", never bare "fill", so the two never look like the same control.
   figure.o-flowfig carries no padding of its own, so it gets padding + radius the moment it is
   filled, exactly like .o-text; the legacy .o-flow-shell keeps its own clamp() padding above and
   only gains the tint. */
figure.o-flowfig[data-ofill] {
  --o-fill: var(--accent);
  background: color-mix(in srgb, var(--o-fill) calc(var(--ofa, 10) * 1%), var(--paper));
  padding: 14px 18px; border-radius: 10px;
}
.o-flow-shell[data-ofill] {
  --o-fill: var(--accent);
  background: color-mix(in srgb, var(--o-fill) calc(var(--ofa, 10) * 1%), var(--paper));
}
figure.o-flowfig[data-ofill="green"], .o-flow-shell[data-ofill="green"] { --o-fill: #3D8B5A; }
figure.o-flowfig[data-ofill="amber"], .o-flow-shell[data-ofill="amber"] { --o-fill: #B07D2B; }
figure.o-flowfig[data-ofill="red"], .o-flow-shell[data-ofill="red"] { --o-fill: #B3402A; }
figure.o-flowfig[data-ofill="ink"], .o-flow-shell[data-ofill="ink"] { --o-fill: var(--ink); }

`;

// src/blocks/graph-css.ts
var graphCss = `/* @kind:graph */
.k-graph { justify-content: flex-start; }
/* --obw is FLOORED at the kind default: a narrow block never drags the fold's title in with it
   (the .o-graph-svg below consumes --obw itself); a wider --obw still grows the whole fold. */
.o-graph-shell { width: min(max(var(--obw, 1280px), 1280px), 94vw); margin: 0 auto; padding: clamp(56px, 9vh, 96px) 0 40px; }
.o-graph-head .eyebrow { margin-bottom: 12px; }
.o-graph-head h2 { margin-bottom: 18px; }
/* node graph as an in-slide block (insertable on any fold, like a chart) */
figure.o-graphfig { margin: 26px 0; }
figure.o-graphfig[data-opos] { margin-left: calc(var(--op, 0) * 10%); }
figure.o-graphfig figcaption { margin-top: 12px; font-size: 13px; color: var(--ink-soft); }
.o-graph { position: relative; }
/* the drawing IS the resizable block: it consumes --obw (width grip) and --obh (height grip).
   --obh sets an EXPLICIT height, not only a cap: a drawing is height:auto off its viewBox aspect,
   so a cap alone could only ever shrink it \u2014 raising a cap above the natural height moved nothing,
   which is what made the height grip look dead. With an explicit height the grip works both ways:
   growing adds canvas room (the svg letterboxes under the default preserveAspectRatio), shrinking
   scales the drawing down. Unset, height falls back to auto and the cap back to the kind's 72vh,
   so a drawing that was never dragged renders exactly as before. */
.o-graph-svg { display: block; width: min(var(--obw, 100%), 100%); margin-left: auto; margin-right: auto; height: var(--obh, auto); max-height: min(var(--obh, 72vh), 90vh); }
/* BLOCK BACKGROUND \u2014 the same soft-tint recipe as a text block's fill (data-ofill on .o-text,
   css.ts). This is the whole BLOCK's own background, distinct from a node graph's per-NODE fill
   (each node's own box colour, set in its own inline popup, canvas-diagram.ts) \u2014 the toolbar
   button reads "background", never bare "fill", so the two never look like the same control.
   figure.o-graphfig carries no padding of its own, so it gets padding + radius the moment it is
   filled, exactly like .o-text; the legacy .o-graph-shell keeps its own clamp() padding above and
   only gains the tint. */
figure.o-graphfig[data-ofill] {
  --o-fill: var(--accent);
  background: color-mix(in srgb, var(--o-fill) calc(var(--ofa, 10) * 1%), var(--paper));
  padding: 14px 18px; border-radius: 10px;
}
.o-graph-shell[data-ofill] {
  --o-fill: var(--accent);
  background: color-mix(in srgb, var(--o-fill) calc(var(--ofa, 10) * 1%), var(--paper));
}
figure.o-graphfig[data-ofill="green"], .o-graph-shell[data-ofill="green"] { --o-fill: #3D8B5A; }
figure.o-graphfig[data-ofill="amber"], .o-graph-shell[data-ofill="amber"] { --o-fill: #B07D2B; }
figure.o-graphfig[data-ofill="red"], .o-graph-shell[data-ofill="red"] { --o-fill: #B3402A; }
figure.o-graphfig[data-ofill="ink"], .o-graph-shell[data-ofill="ink"] { --o-fill: var(--ink); }

`;

// src/blocks/tracker-css.ts
var trackerCss = `/* @kind:tracker */
.k-tracker { justify-content: flex-start; }
/* --obw is FLOORED at the kind default: a narrow block never drags the fold's title in with it
   (.o-tracker-wrap below consumes --obw itself); a wider --obw still grows the whole fold.
   The tracker FOLD holds no figure \u2014 only the shell, its header and the mount \u2014 so the wrap, not
   figure.o-trackerfig, is the element that has to read the var on this kind. */
.o-tracker-shell { width: min(max(var(--obw, 1200px), 1200px), 92vw); margin: 0 auto; padding: clamp(56px, 9vh, 96px) 0 40px; }
.o-tracker-head .eyebrow { margin-bottom: 12px; }
.o-tracker-head h2 { margin-bottom: 18px; }
/* tracker as an in-slide block (insertable on any fold, like a chart) */
/* the data figure IS the resizable block on a CARD fold: it consumes --obw, centred so the fold
   keeps its measure. The wrap inside re-reads --obw capped at 100% of this figure, so the two
   rules agree instead of narrowing twice. */
figure.o-trackerfig { margin: 26px auto; width: min(var(--obw, 100%), 100%); }
figure.o-trackerfig[data-opos] { margin-left: calc(var(--op, 0) * 10%); }
figure.o-trackerfig figcaption { margin-top: 12px; font-size: 13px; color: var(--ink-soft); }
.o-tracker-filterbar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 6px 0 12px;
  padding: 12px 14px; background: var(--paper); border: 1px solid var(--rule);
  border-radius: 12px; box-shadow: 0 2px 12px rgba(26,26,26,0.05);
}
.o-tracker-search { flex: 1; min-width: 200px; font: inherit; font-size: 14px; border: 1.5px solid var(--rule); border-radius: 8px; padding: 8px 12px; background: var(--paper); color: var(--ink); }
.o-tracker-search:focus { border-color: var(--accent); outline: none; }
.o-tracker-toggle { display: inline-flex; align-items: center; gap: 7px; font-size: 13.5px; color: var(--ink-soft); cursor: pointer; user-select: none; white-space: nowrap; }
.o-tracker-toggle input { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
.o-tracker-clear { font: inherit; font-size: 13px; border: 1.5px solid var(--rule); border-radius: 8px; padding: 7px 12px; background: var(--paper); color: var(--ink-soft); cursor: pointer; }
.o-tracker-clear:hover { border-color: var(--accent); color: var(--accent); }
.o-tracker-toolbar { display: flex; align-items: center; gap: 14px; margin: 8px 0 14px; flex-wrap: wrap; position: relative; }
.o-tracker-add { font: 600 13px var(--font-body); border: none; border-radius: 8px; padding: 8px 14px; background: #3D8B5A; color: #fff; cursor: pointer; }
.o-tracker-add:hover { background: #2d6c45; }
.o-tracker-editstatuses { font: 600 13px var(--font-body); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 14px; background: var(--paper); color: var(--ink-soft); cursor: pointer; }
.o-tracker-editstatuses:hover { border-color: var(--accent); color: var(--accent); }
/* status-options editor (\u2699 Statuses) */
.o-tracker-statuses { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 10px; border: 1px solid var(--rule); border-radius: 8px; background: var(--paper); }
.o-tracker-status-row { display: flex; gap: 6px; align-items: center; }
.o-tracker-status-row input { flex: 1; font: 13px var(--font-body); border: 1px solid var(--rule); border-radius: 6px; padding: 5px 8px; }
.o-tracker-status-row button, .o-tracker-statuses > button { font: 600 12px var(--font-body); border: 1px solid var(--rule); border-radius: 6px; padding: 5px 9px; background: var(--paper); color: var(--ink-soft); cursor: pointer; }
.o-tracker-statuses > button:hover { border-color: var(--accent); color: var(--accent); }
/* the table body IS the resizable block: it consumes --obw (width grip) and --obh (height grip),
   centred in the shell so the fold's own measure, title and toolbars stay put around it.
   overflow was hidden purely to clip the header row's accent fill to the 12px radius; auto clips
   the same way and only differs once a height BINDS, which is what the grip is for.
   max-height has no vh guard because there is no kind default to fall back to: min() around an
   unset var needs an invented cap, and any cap would shorten tall trackers at rest. The editor's
   BLOCK_H_MIN/MAX clamp (220..1600) is this grip's guard instead. */
.o-tracker-wrap { border: 1px solid var(--rule); border-radius: 12px; overflow: auto; width: min(var(--obw, 100%), 100%); margin-left: auto; margin-right: auto; max-height: var(--obh, none); box-shadow: 0 2px 12px rgba(26,26,26,0.05); }
table.o-tracker-table { width: 100%; border-collapse: collapse; font-size: 14px; background: var(--paper); }
table.o-tracker-table th { background: var(--accent); color: #fff; text-align: left; padding: 11px 14px; font-weight: 600; font-size: 12.5px; letter-spacing: 0.02em; }
table.o-tracker-table td { padding: 6px 10px; border-bottom: 1px solid var(--rule); vertical-align: top; }
table.o-tracker-table tr:last-child td { border-bottom: none; }
table.o-tracker-table tr.done td { background: #f3faf5; }
table.o-tracker-table tr.done .o-tracker-cell[data-f="action"] { text-decoration: line-through; color: var(--ink-soft); }
table.o-tracker-table tr.blocked td { background: #fdeeee; }
table.o-tracker-table tr.blocked .o-tracker-status, table.o-tracker-table tr.blocked .o-tracker-status-text { border-color: #B3402A; color: #B3402A; font-weight: 700; }
.o-tracker-cell { min-height: 22px; padding: 6px 8px; border-radius: 5px; outline: none; line-height: 1.45; }
.o-tracker.editing .o-tracker-cell:hover { background: color-mix(in srgb, var(--rule) 30%, var(--paper)); }
.o-tracker.editing .o-tracker-cell:focus { background: color-mix(in srgb, var(--accent) 8%, var(--paper)); box-shadow: inset 0 0 0 1.5px var(--accent); }
.o-tracker-status { font: inherit; font-size: 13px; border: 1.5px solid var(--rule); border-radius: 6px; padding: 6px; background: var(--paper); color: var(--ink); }
.o-tracker-status:focus { border-color: var(--accent); outline: none; }
.o-tracker-status-text { font-size: 13px; }
.o-tracker-done-td { text-align: center; }
.o-tracker-check { width: 28px; height: 28px; border-radius: 6px; border: 1.5px solid var(--rule); background: var(--paper); color: var(--ink-soft); cursor: pointer; font-size: 14px; font-weight: 800; transition: background 0.15s, color 0.15s, border-color 0.15s; }
.o-tracker-check:hover { border-color: #3D8B5A; color: #3D8B5A; }
.o-tracker-check.on { background: #3D8B5A; color: #fff; border-color: #3D8B5A; }
.o-tracker-del { width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent; cursor: pointer; font-size: 14px; opacity: 0.55; }
.o-tracker-del:hover { opacity: 1; background: #fdecec; }
.o-tracker-ops-td { white-space: nowrap; text-align: center; }
.o-tracker-grip { width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent; cursor: grab; font-size: 15px; color: var(--ink-soft); opacity: 0.5; }
.o-tracker-grip:hover { opacity: 1; background: var(--rule); color: var(--ink); }
.o-tracker-grip:active { cursor: grabbing; }
tr.o-tracker-dragging { opacity: 0.4; }
tr.o-tracker-drop > td { box-shadow: inset 0 2px 0 0 var(--accent, #557A4E); }
.o-tracker-empty { padding: 22px 14px; text-align: center; color: var(--ink-soft); font-size: 14px; }
.o-tracker-count { font-size: 12.5px; color: var(--ink-soft); margin-top: 10px; }
.o-tracker-error { padding: 24px 0; color: #a13d2d; font-size: 15px; }
/* @endkind */
`;

// src/blocks/notes-css.ts
var notesCss = `/* @kind:notes */
/* scratch-pad card board ("your OneNote for the year") \u2014 an in-slide block, any fold */
/* the card board IS the resizable block: it consumes --obw, centred, so narrowing a scratch fold
   takes the board and leaves the fold's eyebrow, title and lede at their own measure. The grid
   inside is auto-fill/minmax, so it reflows to fewer columns as the board narrows. */
figure.o-notesfig { margin: 22px auto; width: min(var(--obw, 100%), 100%); }
.o-notes-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 6px 0 16px; }
.o-notes-search { flex: 1; min-width: 200px; font: inherit; font-size: 14px; border: 1.5px solid var(--rule); border-radius: 8px; padding: 8px 12px; background: var(--paper); color: var(--ink); }
.o-notes-search:focus { border-color: var(--accent); outline: none; }
.o-notes-add { font: 600 13px var(--font-body); border: none; border-radius: 8px; padding: 8px 14px; background: var(--accent); color: #fff; cursor: pointer; }
.o-notes-add:hover { filter: brightness(0.93); }
.o-notes-count { font-size: 12.5px; color: var(--ink-soft); margin-left: auto; }
.o-notes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(228px, 1fr)); gap: 16px; align-content: start; }
.o-note { position: relative; background: var(--paper); border: 1px solid var(--rule); border-top: 4px solid var(--note-color, var(--rule)); border-radius: 12px; padding: 13px 15px 15px; box-shadow: 0 2px 12px rgba(26,26,26,0.06); display: flex; flex-direction: column; gap: 8px; }
.o-notes-grid .o-note[draggable="true"] { cursor: grab; }
.o-note.o-note-dragging { opacity: 0.4; }
.o-note.o-note-drop { box-shadow: 0 0 0 2px var(--accent); }
.o-note-head { display: flex; align-items: flex-start; gap: 8px; }
.o-note-title { flex: 1; font-weight: 700; font-size: 15px; line-height: 1.3; color: var(--ink); outline: none; min-height: 20px; }
.o-note-title:empty::before, .o-note-body:empty::before { content: attr(data-ph); color: var(--ink-soft); opacity: 0.55; }
.o-note-tools { display: flex; gap: 2px; flex: none; }
.o-note-tools button { width: 26px; height: 26px; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-size: 13px; opacity: 0.5; line-height: 1; padding: 0; }
.o-note-tools button:hover { opacity: 1; background: var(--rule); }
.o-note-pin.on { opacity: 1; color: #C8A04A; }
.o-note-pinmark { color: #C8A04A; font-size: 14px; line-height: 1.3; }
.o-note-del:hover { background: #fdecec; }
.o-note-body { font-size: 13.5px; line-height: 1.5; color: var(--ink-soft); white-space: pre-wrap; word-break: break-word; outline: none; min-height: 18px; }
.o-note-bullets { margin: 0; padding-left: 18px; font-size: 13.5px; line-height: 1.5; color: var(--ink-soft); }
.o-note-bullets li { margin: 2px 0; }
.o-note-imgwrap { position: relative; }
.o-note-img { width: 100%; border-radius: 8px; display: block; }
.o-note-imgrm { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border: none; border-radius: 50%; background: rgba(0,0,0,0.55); color: #fff; cursor: pointer; font-size: 11px; line-height: 1; }
.o-note-swatches { display: flex; gap: 5px; margin-top: 2px; }
.o-note-swatch { width: 16px; height: 16px; border-radius: 50%; border: 1.5px solid var(--rule); background: var(--sw); cursor: pointer; padding: 0; }
.o-note-swatch.on { box-shadow: 0 0 0 2px var(--paper), 0 0 0 3.5px var(--ink-soft); }
.o-note-date { font-size: 11px; color: var(--ink-soft); opacity: 0.7; margin-top: 2px; }
.o-notes-empty { color: var(--ink-soft); font-size: 14px; padding: 18px 2px; grid-column: 1 / -1; }
.o-notes-error { padding: 24px 0; color: #a13d2d; font-size: 15px; }
/* @endkind */
`;

// src/blocks/grid-css.ts
var gridCss = `/* @kind:grid */
.k-grid { justify-content: flex-start; }
/* --obw is FLOORED at the kind default: a narrow block never drags the fold's title in with it
   (.o-grid-wrap below consumes --obw itself); a wider --obw still grows the whole fold.
   A grid SHELL fold holds no figure \u2014 only the shell, its header and the mount \u2014 so the wrap, not
   figure.o-gridfig, is the element that has to read the var on this kind. */
.o-grid-shell { width: min(max(var(--obw, 1240px), 1240px), 94vw); margin: 0 auto; padding: clamp(56px, 9vh, 96px) 0 40px; }
.o-grid-head .eyebrow { margin-bottom: 12px; }
.o-grid-head h2 { margin-bottom: 18px; }
/* data grid as an in-slide block (insertable on any fold, like a chart) */
/* the data figure IS the resizable block on a CARD fold: it consumes --obw, centred so the fold
   keeps its measure. The wrap inside re-reads --obw capped at 100% of this figure, so the two
   rules agree instead of narrowing twice. */
figure.o-gridfig { margin: 26px auto; width: min(var(--obw, 100%), 100%); }
figure.o-gridfig[data-opos] { margin-left: calc(var(--op, 0) * 10%); }
figure.o-gridfig figcaption { margin-top: 12px; font-size: 13px; color: var(--ink-soft); }
.o-grid-filterbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 6px 0 12px; padding: 12px 14px; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; box-shadow: 0 2px 12px rgba(26,26,26,0.05); }
.o-grid-search { flex: 1; min-width: 200px; font: inherit; font-size: 14px; border: 1.5px solid var(--rule); border-radius: 8px; padding: 8px 12px; background: var(--paper); color: var(--ink); }
.o-grid-search:focus { border-color: var(--accent); outline: none; }
.o-grid-clear { font: inherit; font-size: 13px; border: 1.5px solid var(--rule); border-radius: 8px; padding: 7px 12px; background: var(--paper); color: var(--ink-soft); cursor: pointer; }
.o-grid-clear:hover { border-color: var(--accent); color: var(--accent); }
.o-grid-toolbar { display: flex; align-items: center; gap: 10px; margin: 8px 0 14px; }
.o-grid-add { font: 600 13px var(--font-body); border: none; border-radius: 8px; padding: 8px 14px; background: var(--accent); color: #fff; cursor: pointer; }
.o-grid-add:hover { filter: brightness(0.93); }
/* the table body IS the resizable block: --obw (width grip) and --obh (height grip), centred */
.o-grid-wrap { border: 1px solid var(--rule); border-radius: 12px; overflow: auto; width: min(var(--obw, 100%), 100%); margin-left: auto; margin-right: auto; max-height: min(var(--obh, 72vh), 90vh); box-shadow: 0 2px 12px rgba(26,26,26,0.05); }
table.o-grid-table { width: 100%; border-collapse: collapse; font-size: 13.5px; background: var(--paper); }
.o-grid-th { position: sticky; top: 0; z-index: 1; background: var(--accent); color: #fff; text-align: left; padding: 10px 12px; font-weight: 600; font-size: 12px; letter-spacing: 0.02em; white-space: nowrap; }
.o-grid-th.a-right { text-align: right; } .o-grid-th.a-center { text-align: center; }
.o-grid-th.sortable { cursor: pointer; user-select: none; }
.o-grid-th.sortable:hover { filter: brightness(1.08); }
.o-grid-th.sort-asc .o-grid-thlabel::after { content: " \\25B2"; font-size: 9px; opacity: 0.85; }
.o-grid-th.sort-desc .o-grid-thlabel::after { content: " \\25BC"; font-size: 9px; opacity: 0.85; }
.o-grid-thlabel { outline: none; }
.o-grid-tone, .o-grid-delcol { margin-left: 6px; border: none; background: rgba(255,255,255,0.18); color: #fff; border-radius: 5px; cursor: pointer; font-size: 11px; padding: 2px 6px; }
.o-grid-tone.on { background: #fff; color: var(--accent); }
.o-grid-tone:hover, .o-grid-delcol:hover { background: rgba(255,255,255,0.34); }
table.o-grid-table td.o-grid-cell { padding: 7px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; line-height: 1.45; }
td.o-grid-cell.a-right { text-align: right; font-variant-numeric: tabular-nums; } td.o-grid-cell.a-center { text-align: center; }
table.o-grid-table tbody tr:last-child td { border-bottom: none; }
.o-grid.editing td.o-grid-cell:focus { box-shadow: inset 0 0 0 1.5px var(--accent); border-radius: 4px; outline: none; }
.o-grid-delrow-td { text-align: center; }
.o-grid-del { width: 26px; height: 26px; border-radius: 6px; border: none; background: transparent; cursor: pointer; font-size: 13px; opacity: 0.5; }
.o-grid-del:hover { opacity: 1; background: #fdecec; }
.o-grid-empty { padding: 22px 14px; text-align: center; color: var(--ink-soft); font-size: 14px; }
.o-grid-count { font-size: 12.5px; color: var(--ink-soft); margin-top: 10px; }
.o-grid-error { padding: 24px 0; color: #a13d2d; font-size: 15px; }
/* per-column conditional-colour editor (popover) */
.o-grid-tonepop { position: fixed; z-index: 50; width: min(330px, calc(100vw - 20px)); max-height: 62vh; overflow-y: auto; overflow-x: hidden; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; box-shadow: 0 18px 48px rgba(26,26,26,0.22); padding: 14px 16px; font: 13px var(--font-body); color: var(--ink); box-sizing: border-box; }
.o-grid-tonepop *, .o-grid-tonepop *::before { box-sizing: border-box; }
.o-grid-tp-head { font-weight: 700; font-size: 12.5px; margin-bottom: 9px; }
.o-grid-tp-modes { display: flex; gap: 6px; margin-bottom: 10px; }
.o-grid-tp-chip { flex: 1; font: 600 12px var(--font-body); border: 1.5px solid var(--rule); border-radius: 7px; padding: 6px 4px; background: var(--paper); color: var(--ink-soft); cursor: pointer; }
.o-grid-tp-chip.on { background: var(--ink); color: #fff; border-color: var(--ink); }
.o-grid-tp-note { margin: 0; font-size: 12px; color: var(--ink-soft); line-height: 1.45; }
.o-grid-tp-row { display: flex; gap: 10px; margin-bottom: 9px; }
.o-grid-tp-num { display: flex; flex-direction: column; gap: 3px; font: 600 11px var(--font-body); color: var(--ink-soft); flex: 1; min-width: 0; }
.o-grid-tp-num input { font: inherit; font-size: 13px; border: 1.5px solid var(--rule); border-radius: 6px; padding: 5px 7px; background: var(--paper); color: var(--ink); width: 100%; min-width: 0; }
.o-grid-tp-rev { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-soft); cursor: pointer; }
.o-grid-tp-list { display: flex; flex-direction: column; gap: 5px; }
.o-grid-tp-vrow { display: flex; align-items: center; gap: 8px; }
.o-grid-tp-vlabel { flex: 1; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.o-grid-tp-sw { display: flex; gap: 4px; }
.o-grid-tp-dot { width: 21px; height: 21px; border-radius: 5px; border: 1.5px solid var(--rule); cursor: pointer; font-size: 11px; line-height: 1; color: var(--ink-soft); padding: 0; }
.o-grid-tp-dot.on { box-shadow: 0 0 0 2px var(--ink); }
/* trend-card block: a stat-card with an inline sparkline (drawn by the runtime
   from .o-spark[data-spark]) \u2014 value + label + trend in one block */
.stat-card.o-trend { display: flex; flex-direction: column; }
.o-spark { margin-top: 12px; min-height: 30px; }
.o-spark-svg { display: block; width: 100%; height: 30px; }
/* @endkind */
`;

// src/blocks/table-css.ts
var tableCss = `/* @kind:table */
/* ledger table as an in-slide block (insertable on any fold, like a chart) */
/* the data figure IS the resizable block on a CARD fold: it consumes --obw, centred so the fold
   keeps its measure. The .o-ledger root inside re-reads --obw capped at 100% of this figure, so the
   two rules agree instead of narrowing twice. */
figure.o-tablefig { margin: 26px auto; width: min(var(--obw, 100%), 100%); }
figure.o-tablefig[data-opos] { margin-left: calc(var(--op, 0) * 10%); }
figure.o-tablefig figcaption { margin-top: 12px; font-size: 13px; color: var(--ink-soft); }
.k-table { justify-content: flex-start; }
/* --obw is FLOORED at the kind default: a narrow block never drags the fold's title in with it
   (the .o-ledger root the mount renders consumes --obw itself, below); a wider --obw still grows
   the whole fold. A ledger SHELL fold holds no figure \u2014 only the shell, its header and the mount \u2014
   so .o-ledger, not figure.o-tablefig, is the element that has to read the var on this kind.
   (.o-table-wrap further down is dead CSS: no code path renders that class any more, both mounts
   build .o-ledger. Left in place for old decks that carry it inline.) */
.o-table-shell { width: min(max(var(--obw, 1240px), 1240px), 94vw); margin: 0 auto; padding: clamp(56px, 9vh, 96px) 0 40px; }
.o-table-head .eyebrow { margin-bottom: 12px; }
.o-table-head h2 { margin-bottom: 18px; }
.o-table-filterbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 6px 0 12px; padding: 12px 14px; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; box-shadow: 0 2px 12px rgba(26,26,26,0.05); }
.o-table-search { flex: 1; min-width: 200px; font: inherit; font-size: 14px; border: 1.5px solid var(--rule); border-radius: 8px; padding: 8px 12px; background: var(--paper); color: var(--ink); }
.o-table-search:focus { border-color: var(--accent); outline: none; }
.o-table-clear { font: inherit; font-size: 13px; border: 1.5px solid var(--rule); border-radius: 8px; padding: 7px 12px; background: var(--paper); color: var(--ink-soft); cursor: pointer; }
.o-table-clear:hover { border-color: var(--accent); color: var(--accent); }
.o-table-asof { margin-left: auto; font-size: 12px; color: var(--ink-soft); white-space: nowrap; font-variant-numeric: tabular-nums; }
.o-table-wrap { border: 1px solid var(--rule); border-radius: 12px; overflow: auto; max-height: min(var(--obh, 72vh), 90vh); box-shadow: 0 2px 12px rgba(26,26,26,0.05); }
table.o-table-table { width: 100%; border-collapse: collapse; font-size: 13.5px; background: var(--paper); }
.o-table-th { position: sticky; top: 0; z-index: 1; background: var(--accent); color: #fff; text-align: left; padding: 10px 12px; font-weight: 600; font-size: 12px; letter-spacing: 0.02em; white-space: nowrap; }
.o-table-th.a-right { text-align: right; } .o-table-th.a-center { text-align: center; }
.o-table-th.sortable { cursor: pointer; user-select: none; }
.o-table-th.sortable:hover { filter: brightness(1.08); }
.o-table-th.sort-asc .o-table-thlabel::after { content: " \\25B2"; font-size: 9px; opacity: 0.85; }
.o-table-th.sort-desc .o-table-thlabel::after { content: " \\25BC"; font-size: 9px; opacity: 0.85; }
.o-table-thlabel { outline: none; }
table.o-table-table td.o-table-cell { padding: 7px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; line-height: 1.45; }
td.o-table-cell.a-right { text-align: right; font-variant-numeric: tabular-nums; } td.o-table-cell.a-center { text-align: center; }
table.o-table-table tbody tr:last-child td { border-bottom: none; }
.o-table-foot td.o-table-footcell { padding: 9px 12px; border-top: 2px solid var(--ink, #1a1a1a); font-weight: 700; font-variant-numeric: tabular-nums; background: var(--bg, #faf7f2); }
.o-table-footcell.a-right { text-align: right; } .o-table-footcell.a-center { text-align: center; }
.o-table-empty { padding: 22px 14px; text-align: center; color: var(--ink-soft); font-size: 14px; }
.o-table-count { font-size: 12.5px; color: var(--ink-soft); margin-top: 10px; }
.o-table-error { padding: 24px 0; color: #a13d2d; font-size: 15px; }
/* --- ledger "table" kind \u2014 VIEWER-shipped CSS. Scoped under .o-ledger (the alpha's locked warm-paper
   palette). This half is what a distributed deck carries: the --lg-* tokens + the leaf cell classes the
   inert viewer renders (num, err, bold, italic, underline, strike, al-, fill-, wrap, indent, clr-, orient-,
   v-cur/pct/date, .kpis/.kpi, the Sigma footer) + the read-only .lv-* frame (runtime/table.ts). The EDITOR-only chrome (formula
   bar, A1 grid + gutter, popovers, toolbars, resize grips, selection, autocomplete hint, named/pinned
   dots) lives in LEDGER_EDITOR_CSS below and is injected ONLY into the Studio canvas \u2014 it never ships
   in a distributed deck. (td.cell.calc is the one editor tint kept here \u2014 harmless; the viewer never
   adds it.) --- */
/* Palette: structural vars (paper/ink/rule/accent + header/fbar surfaces) link to the deck theme tokens with warm fallbacks. The ledger's own header + cell surface can be themed SEPARATELY from the rest of the deck via the optional --ledger-head (accent/header) and --ledger-cell tokens; --ledger-cell drives ONLY --lg-cell (the table-body surface behind the transparent cells), NOT the header/formula-bar/KPI paper. Both fall back to --accent / --paper when unset (so existing themes are unchanged). Semantic vars (fill palette, calc-green, error-red, format tints) stay constant across themes. */
.o-ledger { --lg-paper:var(--paper,#f7f4ec); --lg-paper-2:var(--paper,#fbf9f3); --lg-paper-3:var(--paper,#fdfcf8); --lg-cell:var(--ledger-cell,var(--paper,#fdfcf8)); --lg-ink:var(--ink,#1d2420); --lg-ink-soft:var(--ink-soft,color-mix(in srgb, var(--lg-ink) 62%, var(--lg-paper))); --lg-ink-faint:color-mix(in srgb, var(--lg-ink) 42%, var(--lg-paper)); --lg-rule:color-mix(in srgb, var(--lg-ink) 11%, var(--lg-paper)); --lg-rule-strong:color-mix(in srgb, var(--lg-ink) 30%, var(--lg-paper)); --lg-grid:color-mix(in srgb, var(--lg-ink) 18%, var(--lg-paper)); --lg-forest:var(--ledger-head,var(--accent,#3f7268)); --lg-forest-deep:color-mix(in srgb, var(--lg-forest) 72%, #000); --lg-forest-soft:#e3eee9; --lg-forest-edge:color-mix(in srgb, var(--lg-forest) 34%, transparent); --lg-forest-tint:color-mix(in srgb, var(--lg-forest) 11%, transparent); --lg-head:color-mix(in srgb, var(--lg-forest) 7%, var(--lg-paper-2)); --lg-head-strong:color-mix(in srgb, var(--lg-forest) 15%, var(--lg-paper-2)); --lg-ref-a:var(--lg-forest); --lg-ref-b:#b9763b; --lg-ref-c:#4a6f9e; --lg-ref-d:#9a5a8c; --lg-calc:#0c7d54; --lg-calc-soft:rgba(15,157,107,.09); --lg-calc-line:rgba(15,157,107,.5); --lg-bad:#b3402b; --lg-bad-fill:#fbeae6; --lg-mono:ui-monospace,"SF Mono","Cascadia Mono","Roboto Mono",Menlo,Consolas,monospace; --lg-serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif; --lg-sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif; font-family:var(--lg-sans); }
/* the ledger block IS the resizable block: the .o-ledger root a [data-table-mount] renders (the
   viewer's .lv card and the editor's .block both hang off it) consumes --obw, centred. Scoped to
   the mount so the editor's body-level popover layer (canvas-table.ts, also .o-ledger) is untouched. */
[data-table-mount] > .o-ledger { width: min(var(--obw, 100%), 100%); margin-left: auto; margin-right: auto; }
.o-ledger td.cell { border-right:1px solid var(--lg-grid); border-bottom:1px solid var(--lg-grid); height:calc(31px * var(--lgz, 1)); position:relative; vertical-align:middle; cursor:cell; background:transparent; overflow:hidden; }
.o-ledger td.cell .v { display:flex; align-items:center; padding:0 10px; height:100%; font-size:calc(14px * var(--lgz, 1)); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums; font-family:var(--lg-serif); }
.o-ledger td.cell.num .v { justify-content:flex-end; font-family:var(--lg-mono); font-size:calc(13px * var(--lgz, 1)); }
.o-ledger td.cell.calc .v { color:var(--lg-calc); }
.o-ledger td.cell.err { background:var(--lg-bad-fill); }
.o-ledger td.cell.err .v { color:var(--lg-bad); font-style:italic; font-family:var(--lg-serif); }
/* per-cell text styles + align */
.o-ledger td.cell.bold .v { font-weight:700; }
.o-ledger td.cell.italic .v { font-style:italic; }
.o-ledger td.cell.underline .v { text-decoration:underline; }
.o-ledger td.cell.strike .v { text-decoration:line-through; }
.o-ledger td.cell.underline.strike .v { text-decoration:underline line-through; }
.o-ledger td.cell.al-left .v { justify-content:flex-start; }
.o-ledger td.cell.al-center .v { justify-content:center; }
.o-ledger td.cell.al-right .v { justify-content:flex-end; }
/* wrap: multi-line, the row grows to fit. height on a table cell is a MIN in every browser's native
   table layout (even under table-layout:fixed, which only fixes COLUMN width, never row height), so
   letting the wrapped .v grow past the base 31px is enough \u2014 no JS row-height measurement needed. */
.o-ledger td.cell.wrap .v { white-space:normal; overflow:visible; text-overflow:clip; word-break:break-word; align-items:flex-start; padding-top:6px; padding-bottom:6px; }
/* indent: Excel-style padding-left steps (~12px/level, 0..15) via a --ind custom property the renderer sets */
.o-ledger td.cell.indent .v { padding-left:calc(10px + var(--ind, 0) * 12px); }
/* font colour \u2014 same token-or-hex discipline as fill; a DISTINCT "clr-" class prefix (not the fill-*
   classes themselves) so a cell can carry a fill background AND a font colour at once. */
.o-ledger td.cell.clr-fill-forest .v { color:#2f6b57; }
.o-ledger td.cell.clr-fill-sage .v { color:#3f5c3a; }
.o-ledger td.cell.clr-fill-sand .v { color:#8a7332; }
.o-ledger td.cell.clr-fill-ochre .v { color:#9c6a1a; }
.o-ledger td.cell.clr-fill-clay .v { color:#a15234; }
.o-ledger td.cell.clr-fill-slate .v { color:#3d5b7a; }
.o-ledger td.cell.clr-fill-plum .v { color:#7a4a78; }
.o-ledger td.cell.clr-fill-mist .v { color:#5c574a; }
.o-ledger td.cell.clr-fill-forest2 .v { color:#245945; }
.o-ledger td.cell.clr-fill-highlight .v { color:#8a6d0f; }
.o-ledger td.cell.clr-fill-inkwash .v { color:#4a4438; }
/* orientation: a REAL vertical writing-mode (not a paint-only transform), so the cell's own needed
   height (an orthogonal-flow box's auto block-size follows its content) grows the row naturally \u2014
   the same "height is a min" mechanism wrap relies on, so rotated text never clips or overflows into
   neighbouring rows. 'down' rotates glyphs 90\xB0 clockwise (top-to-bottom read); 'up' is the same box
   spun 180\xB0 (bottom-to-top read, glyphs rotated the other way) \u2014 the standard cross-browser way to
   fake vertical-lr, which has poor support; 'stack' keeps every glyph upright, stacked. */
.o-ledger td.cell.orient-down .v, .o-ledger td.cell.orient-up .v, .o-ledger td.cell.orient-stack .v { writing-mode:vertical-rl; white-space:nowrap; height:auto; justify-content:center; padding:8px 2px; }
.o-ledger td.cell.orient-down .v { text-orientation:sideways; }
.o-ledger td.cell.orient-up .v { text-orientation:sideways; transform:rotate(180deg); }
.o-ledger td.cell.orient-stack .v { text-orientation:upright; }
/* arbitrary-angle orientation (the radial dial): transform:rotate is PAINT-ONLY, so the editor persists
   the rotated content's needed height into the rowHeights side-map and the row is sized from THAT. The .v
   is shrink-to-content, centred in the cell (text-align + vertical-align) and rotated about its centre;
   the cell's overflow:hidden keeps it from bleeding over a neighbour. --orient-deg is set inline per cell. */
.o-ledger td.cell.orient-rot { text-align:center; }
.o-ledger td.cell.orient-rot .v { display:inline-block; width:auto; height:auto; white-space:nowrap; overflow:visible; text-overflow:clip; padding:1px 4px; vertical-align:middle; transform:rotate(var(--orient-deg,0deg)); transform-origin:center center; }
/* format-driven tint */
.o-ledger td.cell.v-cur .v { color:#2c7a4d; }
.o-ledger td.cell.v-pct .v { color:#7a5ca8; }
.o-ledger td.cell.v-date .v { color:#b07a2e; }
.o-ledger td.cell.v-num .v { color:#41504a; }
/* theme fill tokens (a token, not a colour, so re-theming re-colours) */
.o-ledger td.cell.fill-forest { background:#e3eee9; }
.o-ledger td.cell.fill-sage { background:#dfe9dc; }
.o-ledger td.cell.fill-sand { background:#f1eada; }
.o-ledger td.cell.fill-ochre { background:#f6e6cf; }
.o-ledger td.cell.fill-clay { background:#f3ddd2; }
.o-ledger td.cell.fill-slate { background:#dde6ef; }
.o-ledger td.cell.fill-plum { background:#ebdcec; }
.o-ledger td.cell.fill-mist { background:#e6e3da; }
.o-ledger td.cell.fill-forest2 { background:#cfe3da; }
.o-ledger td.cell.fill-highlight { background:#fbf0c9; }
.o-ledger td.cell.fill-inkwash { background:#dcd7cc; }
/* --- slice 5: KPI strip, \u03A3 footer --- */
.o-ledger .kpis { display:none; gap:9px; flex-wrap:wrap; align-items:stretch; padding:11px 14px; background:var(--lg-paper-2); border-bottom:1px solid var(--lg-rule); }
.o-ledger .kpis.has-kpis { display:flex; }
.o-ledger .kpi-lead { font-size:10.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--lg-ink-faint); font-weight:700; align-self:center; margin-right:2px; white-space:nowrap; }
.o-ledger .kpi { position:relative; border:1px solid var(--lg-rule-strong); background:var(--lg-paper-3); border-radius:10px; padding:7px 11px; min-width:104px; cursor:pointer; transition:all .14s ease; border-left:3px solid var(--lg-forest); }
.o-ledger .kpi:hover { border-color:var(--lg-forest-edge); transform:translateY(-1px); box-shadow:0 6px 16px -10px #1d242055; }
.o-ledger .kpi .k-name { font-size:11px; color:var(--lg-ink-soft); font-weight:600; }
.o-ledger .kpi .k-val { font-family:var(--lg-mono); font-size:18px; font-weight:600; color:var(--lg-ink); line-height:1.15; margin-top:2px; font-variant-numeric:tabular-nums; }
.o-ledger .kpi .k-val.err { color:var(--lg-bad); font-size:13px; font-style:italic; font-family:var(--lg-serif); }
.o-ledger .kpi .k-x { position:absolute; top:-7px; right:-7px; width:17px; height:17px; border-radius:50%; background:var(--lg-ink-soft); color:#fff; font-size:11px; line-height:17px; text-align:center; cursor:pointer; opacity:0; transform:scale(.6); transition:all .12s ease; border:1.5px solid var(--lg-paper-2); }
.o-ledger .kpi:hover .k-x { opacity:1; transform:scale(1); }
.o-ledger .kpi .k-x:hover { background:var(--lg-bad); }
.o-ledger .kpi-add { border:1px dashed var(--lg-rule-strong); background:transparent; color:var(--lg-ink-faint); border-radius:10px; padding:0 13px; font-size:12px; cursor:pointer; font-family:var(--lg-sans); transition:all .14s ease; }
.o-ledger .kpi-add:hover { border-color:var(--lg-forest-edge); color:var(--lg-forest); background:var(--lg-forest-soft); }
/* view-switch pills (viewer + Present) \u2014 a slim row ABOVE the pins; a baked ledger with >=2 named bake
   views shows one pill per view, the active one filled. Clicking switches the displayed window (transient,
   never persisted). Absent for a single-view / legacy-rect / unbaked ledger. */
.o-ledger .lv-views { display:flex; gap:6px; flex-wrap:wrap; align-items:center; padding:8px 14px; background:var(--lg-paper-2); border-bottom:1px solid var(--lg-rule); }
.o-ledger .lv-views-lead { font-size:10.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--lg-ink-faint); font-weight:700; margin-right:2px; }
.o-ledger .lv-view { border:1px solid var(--lg-rule-strong); background:var(--lg-paper-3); color:var(--lg-ink-soft); border-radius:999px; padding:3px 12px; font-size:12px; line-height:1.35; cursor:pointer; font-family:var(--lg-sans); transition:all .12s ease; }
.o-ledger .lv-view:hover { border-color:var(--lg-forest-edge); color:var(--lg-forest); }
.o-ledger .lv-view.on { background:var(--lg-forest); border-color:var(--lg-forest); color:#fff; font-weight:600; }
/* sheet-TAB pills (viewer + Present) \u2014 the top card row when a multi-tab ledger has >=2 SHOWN sheets
   (shown = not hidden, OR baked). One pill per shown sheet; clicking switches the whole sheet. Sits ABOVE
   the view pills (views belong to a sheet). Same pill idiom as lv-view, on a header-tinted rail. */
.o-ledger .lv-tabs { display:flex; gap:6px; flex-wrap:wrap; align-items:center; padding:8px 14px; background:var(--lg-head); border-bottom:1px solid var(--lg-rule); }
.o-ledger .lv-tab { border:1px solid var(--lg-rule-strong); background:var(--lg-paper-3); color:var(--lg-ink-soft); border-radius:999px; padding:3px 12px; font-size:12px; font-weight:600; line-height:1.35; cursor:pointer; font-family:var(--lg-sans); transition:all .12s ease; }
.o-ledger .lv-tab:hover { border-color:var(--lg-forest-edge); color:var(--lg-forest); }
.o-ledger .lv-tab.on { background:var(--lg-forest); border-color:var(--lg-forest); color:#fff; }
.o-ledger tfoot td { background:var(--lg-head); border-top:1px solid var(--lg-rule-strong); border-right:1px solid var(--lg-rule); height:30px; }
.o-ledger tfoot td.aggc { cursor:pointer; position:relative; }
.o-ledger tfoot td.aggc .v { display:flex; align-items:center; justify-content:flex-end; padding:0 10px; height:calc(30px * var(--lgz, 1)); font-family:var(--lg-mono); font-weight:700; color:var(--lg-ink); font-variant-numeric:tabular-nums; font-size:calc(13px * var(--lgz, 1)); }
.o-ledger tfoot td.aggc .fn { position:absolute; left:8px; top:50%; transform:translateY(-50%); font-family:var(--lg-sans); font-size:9px; font-weight:800; letter-spacing:.4px; color:var(--lg-ink-faint); }
.o-ledger tfoot td.aggc:hover { background:var(--lg-head-strong); }
.o-ledger tfoot th.footlabel { position:sticky; left:0; z-index:15; background:var(--lg-head-strong); color:var(--lg-ink-soft); font-size:11px; font-weight:800; text-align:center; border-right:1px solid var(--lg-rule-strong); }
/* --- ledger VIEWER (inert, R3): the shared/baked ledger a recipient opens \u2014 format + style aware,
   warm-paper, no editing chrome, no A1 gutter, no calc. It reuses the leaf cell classes above so it
   looks like what the author designed; only the read-only frame + label header are new. See
   runtime/table.ts. (The interactive o-table-* viewer CSS near the top of @kind:table is superseded
   by this and kept only for reference.) --- */
.o-ledger .lv { border:1px solid var(--lg-rule-strong); border-radius:13px; background:var(--lg-paper-2); overflow:hidden; box-shadow:0 2px 12px rgba(26,26,26,0.05); }
.o-ledger .lv-asof { padding:7px 14px; font-family:var(--lg-mono); font-size:11px; color:var(--lg-ink-faint); text-align:right; border-bottom:1px solid var(--lg-rule); font-variant-numeric:tabular-nums; }
.o-ledger .lv-wrap { overflow:auto; max-height:min(var(--obh, 72vh), 90vh); background:var(--lg-cell); }
.o-ledger table.lv-table { border-collapse:separate; border-spacing:0; width:100%; table-layout:fixed; background:var(--lg-cell); }
.o-ledger table.lv-table th, .o-ledger table.lv-table td { margin:0; padding:0; }
.o-ledger .lv-table thead th.lv-h { position:sticky; top:0; z-index:2; text-align:left; background:var(--lg-head-strong); color:var(--lg-ink-soft); font-weight:700; font-size:calc(11.5px * var(--lgz, 1)); letter-spacing:.03em; padding:9px 11px; border-bottom:1px solid var(--lg-rule-strong); border-right:1px solid var(--lg-rule); white-space:nowrap; }
.o-ledger .lv-table thead th.lv-h.a-right { text-align:right; }
.o-ledger .lv-table thead th.lv-h.a-center { text-align:center; }
.o-ledger .lv-table td.cell { cursor:default; }
.o-ledger .lv-table tfoot td.lv-agg { cursor:default; }
.o-ledger .lv-table tfoot td.lv-agg:hover { background:var(--lg-head); }
.o-ledger .lv-empty { padding:22px 14px; text-align:center; color:var(--lg-ink-faint); font-size:14px; border-bottom:1px solid var(--lg-rule); }
/* the KPI strip is read-only here \u2014 neutralise the editor's clickable affordances */
.o-ledger .lv .kpi { cursor:default; }
.o-ledger .lv .kpi:hover { transform:none; box-shadow:none; border-color:var(--lg-rule-strong); }
/* --- viewer FILTER funnel: a button ON the header row's own cells that opens an inert value-checklist
   dropdown; unchecking hides the rows BELOW (display-only). The dropdown is appended to <body>, so it styles
   off the DECK theme tokens (--paper/--ink/--rule) like grid.ts's tone popover, not the .o-ledger --lg-*
   palette. --- */
.o-ledger .lv-table td.cell .lv-funnel { position:absolute; top:50%; right:3px; transform:translateY(-50%); z-index:3; padding:2px 3px; border:none; background:transparent; color:var(--lg-ink-faint); cursor:pointer; border-radius:4px; line-height:0; }
.o-ledger .lv-table td.cell .lv-funnel::before { content:""; display:inline-block; width:9px; height:9px; background:currentColor; clip-path:polygon(0 0,100% 0,62% 42%,62% 100%,38% 82%,38% 42%); }
.o-ledger .lv-table td.cell .lv-funnel:hover { color:var(--lg-forest); background:var(--lg-forest-tint); }
.o-ledger .lv-table td.cell .lv-funnel.on { color:var(--lg-forest); }
.o-ledger .lv-tothint { padding:6px 12px; font-size:11px; font-style:italic; color:var(--lg-ink-faint); border-top:1px solid var(--lg-rule); }
.lv-filterpop { position:fixed; z-index:50; width:230px; max-height:320px; overflow:auto; box-sizing:border-box; padding:8px; background:var(--paper,#fff); color:var(--ink,#1a1a1a); border:1px solid var(--rule,#ddd); border-radius:10px; box-shadow:0 8px 28px rgba(26,26,26,0.18); font:13px var(--font-body); }
.lv-filter-search { width:100%; box-sizing:border-box; font:inherit; font-size:12.5px; border:1.5px solid var(--rule); border-radius:6px; padding:5px 8px; margin-bottom:6px; background:var(--paper); color:var(--ink); }
.lv-filter-acts { display:flex; gap:6px; margin-bottom:6px; }
.lv-filter-act { flex:1; font:600 11px var(--font-body); border:1px solid var(--rule); border-radius:6px; padding:4px; background:transparent; color:var(--ink-soft); cursor:pointer; }
.lv-filter-act:hover { border-color:var(--accent); color:var(--accent); }
.lv-filter-list { display:flex; flex-direction:column; gap:2px; }
.lv-filter-item { display:flex; align-items:center; gap:7px; padding:3px 4px; border-radius:5px; cursor:pointer; font-size:12.5px; }
.lv-filter-item:hover { background:color-mix(in srgb, var(--accent) 9%, transparent); }
.lv-filter-vlabel { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* @endkind */
`;

// src/blocks/chart-css.ts
var chartCss = `/* @kind:chart */
figure.o-chartfig { margin: 26px 0; }
.o-chart svg { display: block; width: 100%; height: auto; max-width: 100%; margin: 0 auto; }
.o-chart-grid { stroke: var(--rule); stroke-width: 1; }
.o-chart-tick { font: 11px var(--font-body); font-family: var(--chart-font, var(--font-body)); font-size: calc(11px * var(--chart-tsz, 1)); fill: var(--chart-ink, var(--ink-soft)); }
.o-chart-legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 10px; font-family: var(--chart-font, var(--font-body)); font-size: calc(12.5px * var(--chart-tsz, 1)); color: var(--chart-ink, var(--ink-soft)); }
.o-chart-swatch { display: inline-flex; align-items: center; gap: 6px; }
.o-chart-swatch .sw { width: 12px; height: 12px; border-radius: 3px; }
figure.o-chartfig figcaption { margin-top: 12px; font-size: 13px; font-family: var(--chart-font, var(--font-body)); color: var(--ink-soft); }
.o-chart-error { padding: 18px 0; color: #a13d2d; font-size: 14px; }
.o-chart-datalabel { font: 600 10px var(--font-body); fill: var(--ink-soft); }
.o-chart-axistitle { font: 600 11px var(--font-body); font-family: var(--chart-font, var(--font-body)); font-size: calc(11px * var(--chart-tsz, 1)); fill: var(--chart-ink, var(--ink-soft)); }
.o-chart-title { font: 600 16px var(--font-display); font-family: var(--chart-font, var(--font-display)); font-size: calc(16px * var(--chart-tsz, 1)); fill: var(--chart-ink, var(--ink)); }
.o-chart-sub { font: 11px var(--font-body); font-family: var(--chart-font, var(--font-body)); font-size: calc(11px * var(--chart-tsz, 1)); fill: var(--chart-ink, var(--ink-soft)); }
.o-chart-inner-ring { stroke: var(--paper); stroke-width: 1.5px; }
.o-chart-hiband { fill: var(--accent); fill-opacity: 0.1; }
.o-chart-name { font: 10px var(--font-body); fill: var(--ink); }
.o-chart-name.hi { fill: var(--accent); font-weight: 600; }
.o-chart-split { stroke: var(--ink-soft); stroke-width: 1; stroke-dasharray: 5 4; opacity: 0.55; }
.o-chart-corner { font: 11px var(--font-body); font-family: var(--chart-font, var(--font-body)); font-size: calc(11px * var(--chart-tsz, 1)); fill: var(--chart-ink, var(--ink-soft)); }
/* second (right-hand) value axis + stream band names \u2014 0.4.1 wave 2. The axis rules declare NO
   stroke and NO fill on purpose: the colour is a presentation attribute so the axis can be painted
   in the colour of the mark it belongs to, and any CSS declaration here would beat that attribute.
   UNTOUCHED by 0.4.1h for the same reason: --chart-ink must not out-rank a series' own colour either. */
.o-chart-axis2 { stroke-width: 1; }
.o-chart-tick2 { font: 11px var(--font-body); }
.o-chart-connector { stroke: var(--ink-soft); stroke-width: 1; opacity: 0.45; }
.o-chart-bandlabel { font: 600 11px var(--font-body); font-family: var(--chart-font, var(--font-body)); font-size: calc(11px * var(--chart-tsz, 1)); fill: var(--chart-ink, var(--ink)); }
/* polar/shape family \u2014 0.4.1 wave 3. The centre readout carries a donut's total and a gauge's
   value, which are the whole point of both pictures, so it is deliberately larger than a title.
   The needle and the gauge track are theme inks rather than presentation attributes: unlike the
   second axis they belong to no series, so no attribute has to win over them. */
.o-chart-centre { font: 700 26px var(--font-display); font-family: var(--chart-font, var(--font-display)); font-size: calc(26px * var(--chart-tsz, 1)); fill: var(--chart-ink, var(--ink)); }
.o-chart-needle { stroke: var(--ink); fill: var(--ink); }
.o-chart-track { fill: var(--rule); }
/* sequential-colour family \u2014 0.4.1 wave 4 (heatmap + hex binning). The in-cell number declares NO
   fill on purpose, exactly like the second axis above: the ink is picked per cell by contrast against
   that cell's own ramp colour and set as a presentation attribute, and any fill declared here would
   beat it \u2014 dark ink on a dark cell, which on a printed page is a number that is simply gone.
   UNTOUCHED by 0.4.1h: --chart-ink must not out-rank the contrast pick either (chart-wave4.test.ts). */
.o-chart-cellvalue { font: 600 10px var(--font-body); }
.o-chart-hexedge { stroke: var(--paper); stroke-width: 1; }
.o-chart-scaleframe { fill: none; stroke: var(--rule); stroke-width: 1; }
/* tree family \u2014 0.4.1 wave 5 (treemap + sunburst + convex treemap). Two SIBLING cells under one
   branch share a colour by design, so the seam between them is the only thing that says there are
   two: it is paper-coloured rather than a rule, so it reads as a cut and not as a gridline. The
   branch outline is the same colour one step heavier, drawn over the children it contains. */
.o-chart-cellsep { stroke: var(--paper); stroke-width: 1.5; }
.o-chart-branch { stroke: var(--paper); stroke-width: 3; }
/* timeseries draw-on \u2014 plays when a slide is REVEALED in Present (card decks) or first scrolled
   into view (scroll decks, .is-revealed \u2014 see viewer.ts's IntersectionObserver in mountContinuous);
   static (fully drawn) everywhere else (edit, print, PPTX, reduced-motion). Card decks and scroll
   decks never carry both triggers on the same fold, so the two selectors never double-apply. */
:root.o-present .is-shown .o-chartfig .ts-series,
.o-scroll .slide.is-revealed .o-chartfig .ts-series { animation: o-ts-draw 1.6s cubic-bezier(0.4, 0, 0.2, 1) both; }
@keyframes o-ts-draw { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@media (prefers-reduced-motion: reduce) {
  :root.o-present .is-shown .o-chartfig .ts-series,
  .o-scroll .slide.is-revealed .o-chartfig .ts-series { animation: none; }
}
/* chart entrance \u2014 every family but timeseries (which keeps its own draw-on above) rises + fades in
   as one group on the same two triggers. The Studio canvas sets neither :root.o-present nor
   .is-revealed, so a chart never animates while being edited. */
:root.o-present .is-shown .o-chartfig .o-chart-marks,
.o-scroll .slide.is-revealed .o-chartfig .o-chart-marks { animation: o-chart-in 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
@keyframes o-chart-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  :root.o-present .is-shown .o-chartfig .o-chart-marks,
  .o-scroll .slide.is-revealed .o-chartfig .o-chart-marks { animation: none; }
}
/* PRINT ALWAYS SHOWS THE FINAL STATE, unconditionally. Without this, Ctrl+P from inside Present
   restarts both animations on the freshly rebuilt print clone (viewer.ts's refreshPrint re-adds
   .is-shown while :root.o-present still matches), printing a chart mid-wipe/mid-rise. This also
   closes that same latent bug for .ts-series, which had no print guard of its own before now. */
@media print {
  .o-chartfig .o-chart-marks, .o-chartfig .ts-series { animation: none !important; opacity: 1 !important; transform: none !important; }
}
/* @endkind */
`;

// src/blocks/video-css.ts
var videoCss = `/* @kind:video */
figure.o-videofig { margin: 26px 0; }
.o-video { max-width: 760px; }
.o-vd { box-sizing: border-box; }
.o-vd-play { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; aspect-ratio: 16 / 9; width: 100%; border-radius: 14px; background: linear-gradient(145deg, #23211d, #3a362e); color: #faf7f2; cursor: pointer; }
.o-vd-play .o-vd-badge { position: absolute; top: 14px; right: 16px; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(250, 247, 242, 0.65); }
.o-vd-play .o-vd-btn { display: grid; place-items: center; width: 68px; height: 68px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 24px; padding-left: 5px; transition: transform 0.15s; }
.o-vd-play:hover .o-vd-btn, .o-vd-play:focus-visible .o-vd-btn { transform: scale(1.08); }
.o-vd-play .o-vd-title { font-family: var(--font-display); font-size: 22px; max-width: 80%; text-align: center; }
.o-vd-play .o-vd-hint { font-size: 12px; color: rgba(250, 247, 242, 0.55); }
.o-vd-frame { display: block; width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: 14px; background: #000; }
.o-vd-link, .o-vd-empty { display: flex; align-items: center; gap: 16px; padding: 18px 20px; border: 1.5px solid var(--rule); border-radius: 14px; background: var(--paper); color: inherit; text-decoration: none; }
.o-vd-link .o-vd-btn, .o-vd-empty .o-vd-btn { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 15px; padding-left: 3px; }
.o-vd-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.o-vd-link .o-vd-title { font-weight: 600; font-size: 16px; }
.o-vd-url { font-size: 12.5px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.o-vd-note { font-size: 12px; color: var(--ink-soft); white-space: normal; }
.o-vd-link .o-vd-hint, .o-vd-empty .o-vd-hint { margin-left: auto; flex: none; font-size: 12px; color: var(--ink-soft); }
a.o-vd-link:hover { border-color: var(--accent); }
.o-vd-empty { border-style: dashed; color: var(--ink-soft); }
.o-vd-empty .o-vd-btn { background: var(--rule); color: var(--ink-soft); }
figure.o-videofig figcaption { margin-top: 12px; font-size: 13px; color: var(--ink-soft); }
.o-video-error { padding: 18px 0; color: #a13d2d; font-size: 14px; }
`;

// src/blocks/document-css.ts
var documentCss = `/* @kind:document \u2014 a long-form A4 report fold (the Word-killer). Kills the 100vh
   scene; renders a continuous paper reading column with document type scale + CSS
   counters for headings/figures/tables/footnotes. Print (named A4 page) lives in the
   @media print block. Inert: the auto-TOC is built by the runtime, never in source. */
.k-document { justify-content: flex-start; }
.k-document .o-doc {
  width: min(820px, 92vw); margin: clamp(24px, 5vh, 56px) auto;
  /* The vertical padding is a VARIABLE because a running header or footer has to RESERVE its strip:
     the paginator reads the computed padding to decide where a page's text must stop, so folding the
     reserve into the padding is what makes the boundaries \u2014 and the text-block cap \u2014 respect the
     footer rather than letting prose run underneath it. */
  --opad-base-t: clamp(36px, 5vh, 60px);
  --opad-base-b: clamp(36px, 5vh, 60px);
  padding: calc(var(--opad-base-t) + var(--opf-h, 0px)) clamp(24px, 5vw, 60px)
           calc(var(--opad-base-b) + var(--opf-f, 0px));
  /* --fold-paper is the PER-FOLD paper-colour override (the studio sets it inline on the fold for a
     document; unset === the theme paper, so an untouched document is byte-identical). */
  background: var(--fold-paper, var(--paper)); color: var(--ink);
  border: 1px solid var(--rule-soft); border-radius: 4px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 14px 50px rgba(0,0,0,0.07);
  counter-reset: o-h2 o-fig o-tbl o-fn;
  font-family: var(--font-body); font-size: 17px; line-height: 1.62;
  /* a stacking context so a Backdrop child (o-doc-bg, absolute z-index:-1) anchors
     to the PAPER and sits ON it behind the text (above the paper fill, below the
     content) \u2014 a true document watermark. Anchoring to .slide instead hid it
     entirely behind the opaque paper, leaking only into the margin below. */
  position: relative; isolation: isolate;
}
/* PAPER SIZE. On screen this draws the page BOX \u2014 real millimetres, so A5 next to A3 reads as a
   genuinely different sheet rather than the same column with different text. min-height shows one
   sheet's worth of paper even though the content still flows continuously: Origami has no
   pagination yet, so this is the page's shape, not its boundaries.
   Deliberately NOT clamped to the viewport: an A2 that silently shrank to fit would look identical
   to A3 and the setting would be a lie. Wide formats scroll horizontally instead.
   In print the @page rules own the real geometry (see the print block in css.ts), so the fixed
   width is dropped there or it would fight the page margins. */
/* SCROLL is the default and means exactly what it says: no paper, no page boundaries, no
   paginator \u2014 one continuous reading column, which is what a document fold has always been. Paper
   is opt-in, so an existing deck opens looking exactly as it did.
   PAGE EDGES are drawn as a repeating background, not as elements: pathOf/nodeAt are pure
   children[i] walks, so ANY node injected into .o-doc would shift every later block's path and
   edits would land on the wrong element. The paginator pushes blocks with a margin for the same
   reason. Regular spacing is safe because a pushed block lands exactly at the next sheet's content
   top, so the boundaries always fall on exact multiples of the sheet height. */
/* THE SEAM between two sheets. A single hairline was too quiet to read as a page ending \u2014 on a long
   document you could not see where one sheet stopped and the next began without hunting for it.
   This is still a background rather than an element (an injected node would shift every block path),
   but it now shades the last few millimetres of the sheet and closes with a definite rule, so the
   boundary reads as paper running out rather than as a stray underline. */
/* PER-PAGE PAPER COLOUR rides as a SECOND background layer under the seam, for the same reason the
   seam itself is a background: a coloured sheet cannot be an element. --opgbg-layer is written
   inline by the paginator (document.ts) as ONE non-repeating gradient whose hard stops fall on
   exact multiples of --oph, so the bands line up with the seams above them. Unset === the fallback,
   a fully transparent image, so the page shows --fold-paper/--paper exactly as it always did and a
   document with no per-page colour is byte-identical in every computed style.
   ORDER IS LOAD-BEARING: the seam is listed FIRST so it paints ON TOP of the colour \u2014 a coloured
   page must still show where it ends. Both layers share this rule's background-origin, so "0" means
   the same edge for both. */
.k-document .o-doc[data-opage] {
  background-origin: border-box;
  background-image: repeating-linear-gradient(to bottom,
    transparent 0 calc(var(--oph) - 9px),
    rgba(0, 0, 0, 0.028) calc(var(--oph) - 9px) calc(var(--oph) - 2px),
    var(--ink-soft) calc(var(--oph) - 2px) var(--oph)),
    var(--opgbg-layer, linear-gradient(transparent, transparent));
}
/* the block that begins a page carries the gap that pushed it there (set by the paginator), and a
   block pushed clear of a floating layer's reserved band carries the gap that moved it down. ONE
   declaration for both, because a block can be both: two rules would let the later one drop the
   other's gap, and the block would land back under the layer (or back through the page line).
   The attribute selector is DOUBLED ([data-oband][data-oband]) purely to raise this rule's own
   specificity: kind rules further down this file such as blockquote.o-quote or table.o-table
   weigh two classes plus a tag, and a single-attribute selector here used to lose to them outright
   \u2014 the block would sit at its natural margin and print straight through the reserved band (or the
   page line) as if nothing had pushed it at all. Doubling costs nothing at match time (the same
   attribute either way) and does not change which elements the rule targets. */
.k-document .o-doc > [data-opagetop][data-opagetop],
.k-document .o-doc > [data-oband][data-oband] { margin-top: calc(var(--opgap, 0px) + var(--obgap, 0px)); }
/* CAPPED: a text block too long for the sheet stops AT the page line instead of bleeding through
   it. Origami has no intra-block flow, so the alternative to capping is fragmenting prose across
   sheets, which needs a text model that does not exist.
   The clip applies on EVERY surface \u2014 screen and print alike (editor is law) \u2014 so the PDF shows the
   same page the editor drew and never flows hidden text onto a sheet of its own. The cut band is
   LOUD but screen-ONLY: it warns the author at edit time (a bare overflow:hidden would read as text
   silently deleted), and print drops it (see css.ts) so the finished PDF carries no editor chrome.
   The prose itself is untouched in the file \u2014 only its rendered height is bounded. */
.k-document .o-doc[data-opage] > .o-text[data-ofull] {
  max-height: var(--opfill); overflow: hidden; position: relative;
}
.k-document .o-doc[data-opage] > .o-text[data-ofull]::after {
  content: "Full \u2014 this block reaches the page line. Split it to carry on.";
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 3px 8px 4px; box-sizing: border-box;
  font-family: var(--font-body); font-size: 11px; line-height: 1.3; font-style: normal;
  color: var(--paper); background: var(--ink-soft); border-top: 1px solid var(--ink);
}
/* BORDER-BOX, and it is load-bearing twice over.
   As a bug: the default content-box made a width of 210mm the width of the TEXT COLUMN, so an "A4"
   sheet rendered 210mm PLUS its padding and border \u2014 measured at 915.7px against A4's 793.7px, a
   sheet 32.3mm too wide. A4 has never actually been A4 on screen.
   As a prerequisite: print can only reproduce the screen sheet if the sheet is genuinely the paper
   size, margins included. It also makes the paginator's own arithmetic honest \u2014 it computes the
   usable band as (sheet - padding), which is only true when the padding is INSIDE the sheet. */
.k-document .o-doc[data-opage] {
  box-sizing: border-box;
  width: var(--opw); min-height: var(--oph); max-width: none;
  /* A PAGE MARGIN IN MILLIMETRES. The unpaged reading column sizes itself off the viewport
     (clamp with vh/vw), which is right for a column on a screen and WRONG for a sheet of paper:
     vh resolves against the browser window while measuring and against the PAGE BOX while printing,
     so the same document had a 52px top margin when the paginator measured it and 72.15px when the
     engine printed it \u2014 20px of drift per page, and a margin that changed if you resized the window.
     Millimetres are the same number on every surface, which is the whole point of choosing paper. */
  --opmar: 14mm;
  --opad-base-t: var(--opmar);
  --opad-base-b: var(--opmar);
  padding: calc(var(--opad-base-t) + var(--opf-h, 0px)) var(--opmar)
           calc(var(--opad-base-b) + var(--opf-f, 0px));
}
/* the small sheets are physically narrow, so a 14mm margin would eat the column */
.k-document .o-doc[data-opage="a5"], .k-document .o-doc[data-opage="book"] { --opmar: 10mm; }
.k-document .o-doc[data-opage="a4"] { --opw: 210mm; --oph: 297mm; }
.k-document .o-doc[data-opage="a3"] { --opw: 297mm; --oph: 420mm; }
.k-document .o-doc[data-opage="a2"] { --opw: 420mm; --oph: 594mm; }
.k-document .o-doc[data-opage="a5"] { --opw: 148mm; --oph: 210mm; }
/* the KDP 6 x 9in paperback trim, to the tenth of a mm */
.k-document .o-doc[data-opage="book"] { --opw: 152.4mm; --oph: 228.6mm; }
/* a size the author typed: --opw/--oph arrive as an inline style, so the rule above already picks
   them up and the paginator measures them like any other sheet */
/* the small formats are physically narrow, so the generous reading padding would eat the column */
.k-document .o-doc[data-opage="a5"], .k-document .o-doc[data-opage="book"] { font-size: 15px; }
/* A running header/footer sits a fixed DISTANCE FROM THE PAGE EDGE, which is the number a word
   processor gives you ("header from top: 12mm") and the one that actually describes where the thing
   lands. The first cut made the author's number the band's HEIGHT instead, which grew the text box
   without moving it \u2014 the wrong control.
   The band's own height is intrinsic: it holds one line of small type and nothing else.
   The RESERVE is then whatever the furniture needs BEYOND the page margin. Where the band fits
   inside the margin already, it costs the text nothing; only a band pushed deeper than the margin
   moves the prose, and only by the difference. max() rather than an unconditional add, so the
   common case reserves zero. */
.k-document .o-doc[data-opage] { --opfd: 8mm; --opfbh: 14px; }
/* --opfh / --opff: the author's per-band pixel HEIGHT (written inline by setFurnitureBandHeight,
   ONLY once a document uses the height control) IS the reserve, directly \u2014 no separate distance +
   intrinsic-height sum survives. Where a document has never touched it, var()'s own fallback
   reproduces the RETIRED from-edge model's number (opfd + opfbh) so an old deck's reserve is
   unchanged to the pixel. document.ts's renderPageFurniture/syncPrintFurniture read the SAME
   fallback for the band's own on-screen/print geometry \u2014 via JS there, because an unregistered
   custom property's calc() fallback resolves once it feeds a real typed property (padding, here)
   but does not resolve to a plain length if read back directly with getComputedStyle. */
/* Keyed on ANY of the band's three text slots: a header that only uses its centre slot reserves the
   same strip a left-slot header does. data-ohdr/data-oftr stay the LEFT slot, so a legacy deck
   matches the first selector exactly as before. */
.k-document .o-doc[data-ohdr], .k-document .o-doc[data-ohdrc], .k-document .o-doc[data-ohdrr] { --opf-h: max(0px, calc(var(--opfh, calc(var(--opfd) + var(--opfbh))) - var(--opmar))); }
.k-document .o-doc[data-oftr], .k-document .o-doc[data-oftrc], .k-document .o-doc[data-oftrr] { --opf-f: max(0px, calc(var(--opff, calc(var(--opfd) + var(--opfbh))) - var(--opmar))); }
/* The furniture is an overlay OUTSIDE .o-doc, never blocks inside it: pathOf/nodeAt are pure
   children[i] walks, so page furniture living among the blocks would shift every later block's path
   and send edits to the wrong element \u2014 the same constraint that makes the page edges a background
   and the paginator's push a margin. Being a sibling, it disturbs no path at all. */
.k-document .slide:has(> .o-pagefurn) { position: relative; }
.k-document .o-pagefurn { position: absolute; pointer-events: none; z-index: 1; }
.k-document .o-pf { position: absolute; left: 0; right: 0; }
.k-document .o-pf-h, .k-document .o-pf-f {
  /* border-box so the band's rule lives INSIDE the strip it reserved. Without it a 16px reserve
     rendered a 17px band, and the extra pixel came out of the text's page rather than the margin. */
  box-sizing: border-box;
  position: absolute; left: 0; right: 0;
  /* the same margin the text column uses, so the band lines up with the prose instead of with the
     viewport \u2014 this was a vw clamp, which drifted between measuring and printing like the page
     margin did */
  padding: 0 var(--opmar, 14mm);
  display: flex; align-items: center;
  font-family: var(--font-body);
  line-height: 1.15;
  white-space: nowrap; overflow: hidden;
}
/* THE AUTHOR'S KNOBS, each falling back to the value the band has always drawn \u2014 so a document that
   never opened the band panel renders byte-identically. The custom properties are relayed onto the
   furniture layer by document.ts (a sibling cannot read .o-doc's own properties); the font and the
   rule are attributes on .o-doc, selected from here, so nothing has to be handed across for them. */
.k-document .o-pf-h { font-size: var(--ohdr-size, 10.5px); color: var(--ohdr-ink, var(--ink-soft)); background: var(--ohdr-bg, transparent); }
.k-document .o-pf-f { font-size: var(--oftr-size, 10.5px); color: var(--oftr-ink, var(--ink-soft)); background: var(--oftr-bg, transparent); }
/* THE THREE COLUMNS. Left and right are equal columns (basis 0, grow 1) and the centre is sized to
   its own text between them, which is what puts the centre slot at the band's TRUE centre instead
   of at the midpoint of the space the left slot happened to leave.
   The slots overflow VISIBLY and the band hides the overrun, so one long slot still runs the full
   width of the band and still clips at its edge \u2014 exactly what a single-slot band did before the
   other two existed.
   o-pf-sp is a column the author has NOT ticked: the same box, holding the balance open, with no
   text and no way in. It is what lets the middle column alone sit at the true centre and the right
   column alone reach the right edge \u2014 take the empty boxes away and both collapse leftwards. */
.k-document .o-pf-s, .k-document .o-pf-sp { flex: 1 1 0; min-width: 0; overflow: visible; }
.k-document .o-pf-c { flex: 0 1 auto; text-align: center; }
.k-document .o-pf-r { text-align: right; }
.k-document .o-doc[data-ohdrfont="playfair"] ~ .o-pagefurn .o-pf-h { font-family: 'Playfair Display', Georgia, serif; }
.k-document .o-doc[data-ohdrfont="lora"] ~ .o-pagefurn .o-pf-h { font-family: 'Lora', Georgia, serif; }
.k-document .o-doc[data-ohdrfont="inter"] ~ .o-pagefurn .o-pf-h { font-family: 'Inter', "Segoe UI", Arial, sans-serif; }
.k-document .o-doc[data-ohdrfont="source-serif"] ~ .o-pagefurn .o-pf-h { font-family: 'Source Serif 4', Georgia, serif; }
.k-document .o-doc[data-oftrfont="playfair"] ~ .o-pagefurn .o-pf-f { font-family: 'Playfair Display', Georgia, serif; }
.k-document .o-doc[data-oftrfont="lora"] ~ .o-pagefurn .o-pf-f { font-family: 'Lora', Georgia, serif; }
.k-document .o-doc[data-oftrfont="inter"] ~ .o-pagefurn .o-pf-f { font-family: 'Inter', "Segoe UI", Arial, sans-serif; }
.k-document .o-doc[data-oftrfont="source-serif"] ~ .o-pagefurn .o-pf-f { font-family: 'Source Serif 4', Georgia, serif; }
.k-document .o-doc[data-opage="a5"] ~ .o-pagefurn .o-pf-h,
.k-document .o-doc[data-opage="a5"] ~ .o-pagefurn .o-pf-f,
.k-document .o-doc[data-opage="book"] ~ .o-pagefurn .o-pf-h,
.k-document .o-doc[data-opage="book"] ~ .o-pagefurn .o-pf-f { padding: 0 10mm; }
.k-document .o-pf-h { border-bottom: 1px solid var(--rule-soft); }
.k-document .o-pf-f { border-top: 1px solid var(--rule-soft); }
/* the rule is ON today, so only turning it OFF is recorded \u2014 an untouched deck carries no attribute
   and keeps the line it has always drawn. The band keeps its border-box height either way, so
   dropping the rule never moves the text. */
.k-document .o-doc[data-ohdrrule="off"] ~ .o-pagefurn .o-pf-h { border-bottom-color: transparent; }
.k-document .o-doc[data-oftrrule="off"] ~ .o-pagefurn .o-pf-f { border-top-color: transparent; }
.k-document .o-doc-masthead { border-bottom: 2px solid var(--accent); padding-bottom: 16px; margin-bottom: 6px; }
.k-document .o-doc-masthead h1 { font-family: var(--font-display); font-size: calc(clamp(30px, 3.6vw, 44px) * var(--osz, 1)); line-height: 1.12; margin: 0 0 6px; }
.k-document .o-doc-byline { font-size: calc(13.5px * var(--osz, 1)); color: var(--ink-soft); margin: 0; }
/* --osz was silently DEAD on document headings: the size control shipped on their toolbar but the
   sizes were hard px, so picking one did nothing at all. The attribute sits on the heading itself,
   which is the element consuming it, so the :where descendant reset does not interfere. */
.k-document .o-doc h2 { font-family: var(--font-display); font-size: calc(25px * var(--osz, 1)); line-height: 1.25; margin: 30px 0 10px; counter-increment: o-h2; counter-reset: o-h3; }
/* attr(data-opre) yields "" when the attribute is absent, so ONE rule serves prefixed and
   unprefixed headings \u2014 otherwise every numeral-style rule below would need a twin. The trailing
   space is stored in the attribute value rather than added here, for the same reason. */
.k-document .o-doc h2::before { content: attr(data-opre) counter(o-h2) ".  "; color: var(--accent); font-weight: 700; }
/* Numeral style is a DOCUMENT-wide choice written onto every heading (the .o-doc container is the
   slide-inner, whose block path is empty, and an empty path is what the intent dispatcher refuses to send).
   the counter() style argument must be a literal \u2014 it cannot come from a custom property \u2014 so each
   style needs its own rule. These live in the document @kind chunk, so they are tree-shaken out of
   any deck with no document fold. renderDocToc mirrors them for the Contents. */
.k-document .o-doc h2[data-onumst="upper-roman"]::before { content: attr(data-opre) counter(o-h2, upper-roman) ".  "; }
.k-document .o-doc h2[data-onumst="lower-roman"]::before { content: attr(data-opre) counter(o-h2, lower-roman) ".  "; }
.k-document .o-doc h2[data-onumst="upper-alpha"]::before { content: attr(data-opre) counter(o-h2, upper-alpha) ".  "; }
.k-document .o-doc h2[data-onumst="lower-alpha"]::before { content: attr(data-opre) counter(o-h2, lower-alpha) ".  "; }
.k-document .o-doc h3 { font-family: var(--font-display); font-size: calc(19px * var(--osz, 1)); margin: 22px 0 8px; counter-increment: o-h3; }
.k-document .o-doc h3::before { content: attr(data-opre) counter(o-h2) "." counter(o-h3) "  "; color: var(--ink-soft); font-weight: 700; }
.k-document .o-doc h3[data-onumst="upper-roman"]::before { content: attr(data-opre) counter(o-h2, upper-roman) "." counter(o-h3, upper-roman) "  "; }
.k-document .o-doc h3[data-onumst="lower-roman"]::before { content: attr(data-opre) counter(o-h2, lower-roman) "." counter(o-h3, lower-roman) "  "; }
.k-document .o-doc h3[data-onumst="upper-alpha"]::before { content: attr(data-opre) counter(o-h2, upper-alpha) "." counter(o-h3, upper-alpha) "  "; }
.k-document .o-doc h3[data-onumst="lower-alpha"]::before { content: attr(data-opre) counter(o-h2, lower-alpha) "." counter(o-h3, lower-alpha) "  "; }
/* An unnumbered heading (data-onum="off") is plain free text \u2014 write your own "Appendix A" if you
   want one. It also stops INCREMENTING, unlike a delisted heading: a delisted section is still
   printed with its number so it must keep it, whereas an unnumbered one shows no number at all and
   consuming one would leave a visible gap in the sequence (1, 3, 4). h2 keeps its counter-reset so
   the subsections under an unnumbered section still start at 1. */
.k-document .o-doc h2[data-onum="off"], .k-document .o-doc h3[data-onum="off"] { counter-increment: none; }
/* The NUMBER goes, the PREFIX stays. An unnumbered "Appendix A" heading is precisely the case the
   prefix exists for, and content:none here used to swallow the prefix along with the number \u2014 while
   the Contents kept rendering it, so the list and the page disagreed. attr() yields "" when no
   prefix is set, which generates an empty box and shows nothing. */
.k-document .o-doc h2[data-onum="off"]::before, .k-document .o-doc h3[data-onum="off"]::before { content: attr(data-opre); }
.k-document .o-doc p { margin: 0 0 14px; }
.k-document .o-doc ul, .k-document .o-doc ol { margin: 0 0 14px; padding-left: 26px; }
.k-document .o-doc li { margin: 4px 0; }
.k-document .o-doc blockquote.o-quote { margin: 18px 0; }
.k-document .o-doc figure { margin: 22px 0; }
.k-document .o-doc figure figcaption::before { counter-increment: o-fig; content: "Figure " counter(o-fig) ". "; font-weight: 700; color: var(--ink-soft); }
.k-document .o-doc table.o-table { margin: 18px 0; }
.k-document .o-doc table.o-table caption { caption-side: top; text-align: left; font-size: 13px; color: var(--ink-soft); margin-bottom: 6px; }
.k-document .o-doc table.o-table caption::before { counter-increment: o-tbl; content: "Table " counter(o-tbl) ". "; font-weight: 700; }
/* the nudge buttons (\u25C2 \u2299 \u25B8) set data-opos; the doc typography margins above
   (.k-document .o-doc p/h2/figure \u2026) out-rank the :where()-zeroed [data-opos]
   margin-left and would pin the block hard left while keeping its translate.
   Re-assert the positional margin for any doc child so the 11-stop nudge shifts. */
.k-document .o-doc [data-opos] { margin-left: calc(var(--op, 0) * 10%); }
/* document blocks \u2014 reusable like chart/video (uniquely classed, safe globally) */
.o-callout { --o-tone: var(--accent); border-left: 3px solid var(--o-tone); background: var(--paper); background: color-mix(in srgb, var(--o-tone) 8%, var(--paper)); border-radius: 8px; padding: 12px 16px; margin: 18px 0; }
.o-callout > :first-child { margin-top: 0; } .o-callout > :last-child { margin-bottom: 0; }
.o-callout[data-otone="green"] { --o-tone: #3d8b5a; } .o-callout[data-otone="amber"] { --o-tone: #b8862b; } .o-callout[data-otone="red"] { --o-tone: #b3402a; }
pre.o-code { background: var(--paper); background: color-mix(in srgb, var(--ink) 5%, var(--paper)); border: 1px solid var(--rule); border-radius: 8px; padding: 13px 16px; margin: 18px 0; overflow-x: auto; }
pre.o-code code { font: 13.5px/1.55 ui-monospace, "Cascadia Code", Menlo, Consolas, monospace; color: var(--ink); white-space: pre; }
.o-footnote { counter-increment: o-fn; font-size: 0.8em; vertical-align: super; color: var(--accent); }
.o-footnote::before { content: "[" counter(o-fn) "]"; }
hr.o-pagebreak { border: none; border-top: 1px dashed var(--rule); position: relative; margin: 30px 0; height: 0; }
hr.o-pagebreak::after { content: "Page break"; position: absolute; top: -8px; left: 50%; transform: translateX(-50%); background: var(--paper); padding: 0 8px; font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); }
/* --osz was dead on the Contents block for the same reason it was dead on document headings above:
   the block declared no font-size of its own, so the toolbar's size probe (canvas.ts oszBase) saw
   nothing move and handed back the six-word preset menu instead of the px box.
   1em, not a hard px: the doc base is 17px but an a5/book page is 15px, and a bare nav.o-toc can
   render outside .k-document \u2014 1em is a pixel-exact no-op at --osz:1 in every one of those cases,
   where a number would silently re-size the block. The rows inherit it; their own sizes are ems. */
nav.o-toc { display: block; font-size: calc(1em * var(--osz, 1)); border: 1px solid var(--rule); border-radius: 10px; padding: 14px 18px; margin: 20px 0 26px; background: var(--paper); background: color-mix(in srgb, var(--accent) 3%, var(--paper)); }
nav.o-toc .o-toc-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; text-decoration: none; color: var(--ink); padding: 4px 0; }
nav.o-toc .o-toc-row:hover { color: var(--accent); }
nav.o-toc .o-toc-l3 .o-toc-label { padding-left: 20px; font-size: 0.94em; color: var(--ink-soft); }
nav.o-toc .o-toc-label { flex: 1; }
nav.o-toc .o-toc-pageno { color: var(--ink-soft); flex: none; }
/* Folding sections. The twisty is a real button so it is keyboard-reachable; it only exists on a
   section that HAS subsections, so there is never a control that does nothing. The fold is a
   grid-rows collapse rather than display:none, which keeps it animatable and keeps the rows
   measurable while hidden. A print/static build renders the same markup and simply stays open. */
nav.o-toc .o-toc-tw {
  flex: none; width: 15px; height: 15px; margin-right: 2px; padding: 0; cursor: pointer;
  border: none; background: none; color: var(--ink-soft); align-self: center;
}
nav.o-toc .o-toc-tw::before { content: "\u25BE"; display: block; font-size: 10px; line-height: 15px; transition: rotate 0.15s ease; }
nav.o-toc .o-toc-tw:hover { color: var(--accent); }
nav.o-toc .o-toc-grp.collapsed .o-toc-tw::before { rotate: -90deg; }
/* display:none, not a grid-rows animation: the 0fr collapse trick sizes only the FIRST explicit
   row, so with N subsection rows it would fold one and leave the rest showing. Animating would
   need an extra wrapper element in every group \u2014 not worth the DOM or the runtime bytes. */
nav.o-toc .o-toc-grp.collapsed .o-toc-kids { display: none; }
/* a section with no subsections has no twisty, so pad its label to line up with those that do */
nav.o-toc .o-toc-grp > .o-toc-row:not(:has(.o-toc-tw)) { padding-left: 17px; }
/* brand motifs. The MOTIF is a toolbar option on any block (data-omotif left/right),
   painting the deck's brand-logo as a small inline mark before/after the block via
   the --brand-logo CSS var (the runtime sets it from the asset). The BACKDROP is a
   brand watermark: an absolute z-index:-1 child that anchors to its nearest stacking
   context. On a SLIDE that is .slide (isolation:isolate) \u2014 it fills the screen behind
   the content and bleeds into the page margins. On a DOCUMENT that is .o-doc
   (isolation:isolate) \u2014 it sits ON the paper behind the text, like a real watermark,
   instead of hiding behind the opaque page. Being absolute (not fixed) it stays
   inside the slide when cloned for the PowerPoint rasteriser. */
[data-omotif="left"]::before, [data-omotif="right"]::after {
  content: ""; display: inline-block; width: 1.05em; height: 1.05em; flex: none;
  background: var(--brand-logo, none) center / contain no-repeat; vertical-align: -0.16em;
}
[data-omotif="left"]::before { margin-right: 0.45em; }
[data-omotif="right"]::after { margin-left: 0.45em; }
/* A DOCUMENT HEADING already owns its ::before \u2014 that is where its number lives, and the
   .k-document .o-doc h2::before rule out-specifies the generic motif rule above. The result was a
   heading whose number painted ON TOP of the brand mark, so the motif looked broken.
   Give the left mark its own box instead: ::after is free on a left-motif element (a block carries
   one motif value, never both), absolute keeps it clear of the number, and the padding reserves
   room for it. The right mark needs nothing \u2014 its ::after never collided. */
/* ...and the generic rule does more than set content: it also SIZES that pseudo to a 1.05em box and
   paints the logo as its background. Those two declarations still landed, because the heading rule
   only overrides the content property. So the number was crammed into a 1.05em box with a crane behind it, and
   the ::after below then drew a SECOND crane. Reset ::before back to a plain text pseudo \u2014 on these
   elements the mark is ::after's job and ::before is only ever the number. */
.k-document .o-doc :where(h2, h3)[data-omotif="left"]::before {
  display: inline; width: auto; height: auto; background: none; margin-right: 0;
}
.k-document .o-doc :where(h2, h3)[data-omotif="left"] { position: relative; padding-left: 1.6em; }
.k-document .o-doc :where(h2, h3)[data-omotif="left"]::after {
  content: ""; position: absolute; left: 0; top: 0.18em; width: 1.05em; height: 1.05em;
  background: var(--brand-logo, none) center / contain no-repeat;
}
.o-doc-bg { position: absolute; inset: 0; z-index: -1; pointer-events: none; display: grid; place-items: center; opacity: 0.05; }
.o-doc-bg img, .o-doc-bg svg { width: min(70vmin, 86vw); height: auto; max-height: 82vh; object-fit: contain; }
/* On a card the backdrop must stay FULL-BLEED even though its container (.slide-inner) is now
   position:relative (the frame for floating layers) \u2014 inset:0 would shrink it to the content column
   and bury it under .slide-inner. Centre it on the column and size it to the viewport so it covers
   the whole stage and stays reachable in the side margins. A document keeps inset:0 of its paper. */
.slide:not(.k-document) .o-doc-bg { inset: auto; top: 50%; left: 50%; width: 100vw; height: 100vh; transform: translate(-50%, -50%); }
/* @endkind */
`;

// src/blocks/slider-css.ts
var sliderCss = `/* @kind:slider */
/* slider as an in-slide block (insertable on any fold, like a chart). A PRE-BAKED,
   INERT control panel: an o-slider-panel[data-style] wraps one o-slider-fader[--val]
   per item, each a WELL (track) with an accent fill + thumb, a value readout and an
   optional label. ZERO viewer JS \u2014 the editor drags the thumb and re-bakes; the viewer
   paints what it is given. Four styles: single (one horizontal fader), rows (a stack of
   them), mixer (a row of vertical faders), panel (mixer in framed card chrome). */
figure.o-sliderfig { margin: 26px 0; }
figure.o-sliderfig[data-opos] { margin-left: calc(var(--op, 0) * 10%); }
figure.o-sliderfig figcaption { margin-top: 12px; font-size: 13px; color: var(--ink-soft); }
.o-slider { max-width: 620px; }
/* single / rows: horizontal faders \u2014 label, then the flexed track, then the value */
.o-slider-faders { display: flex; flex-direction: column; gap: 20px; }
.o-slider-fader { display: flex; align-items: center; gap: 16px; }
.o-slider-fader .o-slider-track { flex: 1; }
/* the track WELL: inset, softly gradiented, rounded */
.o-slider-track {
  position: relative; height: 10px; border-radius: 999px; cursor: pointer; user-select: none;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ink) 9%, var(--paper)), color-mix(in srgb, var(--ink) 3%, var(--paper)));
  box-shadow: inset 0 1px 2px rgba(26,26,26,0.20), inset 0 0 0 1px var(--rule-soft);
}
/* the accent fill: a soft gradient with a low glow */
.o-slider-fill {
  position: absolute; inset: 0 auto 0 0; width: calc(var(--val, 0) * 100%); border-radius: 999px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 72%, #fff), var(--accent));
  box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 42%, transparent);
}
/* the thumb: 22px, radial sheen, accent ring, soft grab halo */
.o-slider-thumb {
  position: absolute; top: 50%; left: calc(var(--val, 0) * 100%); width: 22px; height: 22px; border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #fff, color-mix(in srgb, var(--paper) 80%, var(--accent)) 76%);
  border: 2px solid var(--accent); transform: translate(-50%, -50%);
  box-shadow: 0 1px 3px rgba(26,26,26,0.28), 0 0 0 6px color-mix(in srgb, var(--accent) 13%, transparent);
}
.o-slider-value { font: 600 18px var(--font-display); color: var(--ink); font-variant-numeric: tabular-nums; flex: none; min-width: 48px; text-align: right; }
.o-slider-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); flex: none; min-width: 76px; }
/* MIXER + PANEL: a row of VERTICAL faders (value chip on top via column-reverse, groove, label under) */
.o-slider-panel[data-style="mixer"] .o-slider-faders, .o-slider-panel[data-style="panel"] .o-slider-faders {
  flex-direction: row; flex-wrap: wrap; align-items: flex-end; gap: 26px;
}
.o-slider-panel[data-style="mixer"] .o-slider-fader, .o-slider-panel[data-style="panel"] .o-slider-fader {
  flex-direction: column-reverse; align-items: center; gap: 10px;
}
/* the vertical WELL: a standing groove with faint tick marks */
.o-slider-panel[data-style="mixer"] .o-slider-track, .o-slider-panel[data-style="panel"] .o-slider-track {
  flex: none; width: 12px; height: 150px;
  background-image:
    repeating-linear-gradient(180deg, transparent 0, transparent 13px, color-mix(in srgb, var(--ink) 12%, transparent) 13px, color-mix(in srgb, var(--ink) 12%, transparent) 14px),
    linear-gradient(90deg, color-mix(in srgb, var(--ink) 9%, var(--paper)), color-mix(in srgb, var(--ink) 3%, var(--paper)));
}
.o-slider-panel[data-style="mixer"] .o-slider-fill, .o-slider-panel[data-style="panel"] .o-slider-fill {
  inset: auto 0 0 0; width: auto; height: calc(var(--val, 0) * 100%);
  background: linear-gradient(0deg, color-mix(in srgb, var(--accent) 72%, #fff), var(--accent));
}
/* a wider fader-CAP thumb, like a mixing desk */
.o-slider-panel[data-style="mixer"] .o-slider-thumb, .o-slider-panel[data-style="panel"] .o-slider-thumb {
  left: 50%; top: auto; bottom: calc(var(--val, 0) * 100%); width: 28px; height: 14px; border-radius: 5px; transform: translate(-50%, 50%);
}
.o-slider-panel[data-style="mixer"] .o-slider-value, .o-slider-panel[data-style="panel"] .o-slider-value {
  min-width: 0; text-align: center; font-size: 14px; padding: 2px 9px; border-radius: 7px;
  background: color-mix(in srgb, var(--accent) 12%, var(--paper)); border: 1px solid var(--rule);
}
.o-slider-panel[data-style="mixer"] .o-slider-label, .o-slider-panel[data-style="panel"] .o-slider-label {
  min-width: 0; text-align: center;
}
/* PANEL: the mixer wrapped in framed card chrome + a tinted header strip */
.o-slider-panel[data-style="panel"] {
  display: inline-block; vertical-align: top; border: 1px solid var(--rule); border-radius: 14px;
  background: var(--paper); overflow: hidden; box-shadow: 0 1px 2px rgba(26,26,26,0.04), 0 10px 34px rgba(26,26,26,0.07);
}
.o-slider-panel[data-style="panel"] .o-slider-head {
  height: 32px; border-bottom: 1px solid var(--rule);
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 15%, var(--paper)), color-mix(in srgb, var(--accent) 6%, var(--paper)));
}
.o-slider-panel[data-style="panel"] .o-slider-faders { padding: 22px 26px; }
/* @endkind */
`;

// src/blocks/draw-css.ts
var drawCss = `/* @kind:draw */
/* drawing as an in-slide block (insertable on any fold, like a chart) */
/* :not([data-ofloat]) IS LOAD-BEARING, and this is runtime CSS so it applies on every
   surface (editor, viewer, Present, print). figure.o-drawfig is (0,1,1) and the base
   float rule [data-ofloat]{margin:0} is (0,1,0), so an unguarded 26px top margin wins
   on a floated draw block \u2014 and top positions the MARGIN edge of an absolutely
   positioned box, so the layer lands 26px below where the author dropped it. */
figure.o-drawfig:not([data-ofloat]) { margin: 26px 0; max-width: 100%; }
figure.o-drawfig[data-opos] { margin-left: calc(var(--op, 0) * 10%); }
figure.o-drawfig figcaption { margin-top: 12px; font-size: 13px; color: var(--ink-soft); }
.o-draw { position: relative; aspect-ratio: var(--odraw-ar, auto); }
.o-draw-svg { display: block; width: 100%; height: auto; }
/* entrance \u2014 handled by the figure's .anim class (fade+rise) and the
   JS replayDrawInks (element-by-element stroke replay). The old o-draw-in
   CSS animation on .o-draw-marks conflicted with the JS replay: its
   animation-fill-mode:both set opacity:0 on the parent container, making
   the stroke-dashoffset transitions invisible (draw-042 UAT finding). */
/* BLOCK BACKGROUND \u2014 the same soft-tint recipe as a flow/graph figure's fill */
figure.o-drawfig[data-ofill] {
  --o-fill: var(--accent);
  background: color-mix(in srgb, var(--o-fill) calc(var(--ofa, 10) * 1%), var(--paper));
  padding: 14px 18px; border-radius: 10px;
}
figure.o-drawfig[data-ofill="green"] { --o-fill: #3D8B5A; }
figure.o-drawfig[data-ofill="amber"] { --o-fill: #B07D2B; }
figure.o-drawfig[data-ofill="red"] { --o-fill: #B3402A; }
figure.o-drawfig[data-ofill="ink"] { --o-fill: var(--ink); }
/* @endkind */

`;

// src/blocks/venn-css.ts
var vennCss = `/* @kind:venn */
/* Venn diagram as an in-slide block (insertable on any fold, like a flowchart) */
figure.o-vennfig:not([data-ofloat]) { margin: 26px 0; max-width: 100%; }
figure.o-vennfig[data-opos] { margin-left: calc(var(--op, 0) * 10%); }
figure.o-vennfig figcaption { margin-top: 12px; font-size: 13px; color: var(--ink-soft); }
.o-venn { position: relative; }
/* the diagram IS the resizable block: it consumes --obw (width grip) and --obh (height grip).
   --obh sets an EXPLICIT height, not only a cap: a diagram is height:auto off its viewBox aspect,
   so a cap alone could only ever shrink it. With an explicit height the grip works both ways. */
.o-venn-svg { display: block; width: min(var(--obw, 100%), 100%); margin-left: auto; margin-right: auto; height: var(--obh, auto); max-height: min(var(--obh, 72vh), 90vh); }
/* BLOCK BACKGROUND \u2014 soft-tint recipe shared with flow/graph/draw figures */
figure.o-vennfig[data-ofill] {
  --o-fill: var(--accent);
  background: color-mix(in srgb, var(--o-fill) calc(var(--ofa, 10) * 1%), var(--paper));
  padding: 14px 18px; border-radius: 10px;
}
figure.o-vennfig[data-ofill="green"] { --o-fill: #3D8B5A; }
figure.o-vennfig[data-ofill="amber"] { --o-fill: #B07D2B; }
figure.o-vennfig[data-ofill="red"] { --o-fill: #B3402A; }
figure.o-vennfig[data-ofill="ink"] { --o-fill: var(--ink); }
/* @endkind */

`;

// src/blocks/kinds-css.ts
var CSS_ORDER = [
  "cover",
  "bullets",
  "stats",
  "gantt",
  "flow",
  "graph",
  "tracker",
  "notes",
  "grid",
  "table",
  "chart",
  "video",
  "document",
  "slider",
  "draw",
  "venn"
];
var KIND_CSS_BY_KEY = {
  cover: coverCss,
  bullets: bulletsCss,
  stats: statsCss,
  gantt: ganttCss,
  flow: flowCss,
  graph: graphCss,
  tracker: trackerCss,
  notes: notesCss,
  grid: gridCss,
  table: tableCss,
  chart: chartCss,
  video: videoCss,
  document: documentCss,
  slider: sliderCss,
  draw: drawCss,
  venn: vennCss
};
var KINDS_CSS = "\n" + CSS_ORDER.map((k) => KIND_CSS_BY_KEY[k]).join("");

// src/themes.ts
var FONT_DISPLAY = '"Iowan Old Style", Georgia, "Times New Roman", serif';
var FONT_BODY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
var THEMES = [
  {
    // warm linen + deep pine — calm, print-safe, and nobody else's brand
    name: "origami-default",
    label: "Paper",
    tokens: {
      bg: "#F7F6F1",
      paper: "#FFFFFF",
      ink: "#22251F",
      "ink-soft": "#5D6156",
      rule: "#E4E3D6",
      "rule-soft": "#EFEEE4",
      accent: "#3F7268",
      "tint-a": "rgba(63, 114, 104, 0.05)",
      "tint-b": "rgba(123, 94, 167, 0.04)",
      chrome: "#F7F6F1",
      "chrome-ink": "#22251F",
      "chrome-soft": "#5D6156",
      "font-display": FONT_DISPLAY,
      "font-body": FONT_BODY
    }
  },
  {
    // cool porcelain + dusty steel blue
    name: "boardroom",
    label: "Boardroom",
    tokens: {
      bg: "#F3F5F8",
      paper: "#FFFFFF",
      ink: "#19222C",
      "ink-soft": "#54616E",
      rule: "#DDE3EA",
      "rule-soft": "#EAEFF4",
      accent: "#38628F",
      "tint-a": "rgba(56, 98, 143, 0.05)",
      "tint-b": "rgba(25, 34, 44, 0.04)",
      chrome: "#F3F5F8",
      "chrome-ink": "#19222C",
      "chrome-soft": "#54616E",
      "font-display": FONT_DISPLAY,
      "font-body": FONT_BODY
    }
  },
  {
    // pale sage + meadow green
    name: "meadow",
    label: "Meadow",
    tokens: {
      bg: "#F5F7F1",
      paper: "#FFFFFF",
      ink: "#242922",
      "ink-soft": "#5B6354",
      rule: "#E0E5D5",
      "rule-soft": "#ECF0E3",
      accent: "#557A4E",
      "tint-a": "rgba(85, 122, 78, 0.06)",
      "tint-b": "rgba(176, 125, 43, 0.04)",
      chrome: "#F5F7F1",
      "chrome-ink": "#242922",
      "chrome-soft": "#5B6354",
      "font-display": FONT_DISPLAY,
      "font-body": FONT_BODY
    }
  },
  {
    // pale lavender + soft violet
    name: "dusk",
    label: "Dusk",
    tokens: {
      bg: "#F7F5FA",
      paper: "#FFFFFF",
      ink: "#26212E",
      "ink-soft": "#5E5669",
      rule: "#E5DFEC",
      "rule-soft": "#EFEBF5",
      accent: "#7B5EA7",
      "tint-a": "rgba(123, 94, 167, 0.05)",
      "tint-b": "rgba(63, 114, 104, 0.04)",
      chrome: "#F7F5FA",
      "chrome-ink": "#26212E",
      "chrome-soft": "#5E5669",
      "font-display": FONT_DISPLAY,
      "font-body": FONT_BODY
    }
  }
];
var THEME_CSS = themeCssFromTokens(THEMES[0].tokens);

// src/assemble.ts
var escapeText = (s2) => s2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var STATIC_CRANE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="#557A4E"><polygon points="30,40 47,40 52,11" opacity="0.45"/><polygon points="26,40 48,40 43,7" opacity="0.92"/><polygon points="44,40 62,29 47,48" opacity="0.72"/><polygon points="28,39 48,41 36,55"/><polygon points="21,44 28,39 36,55" opacity="0.7"/><polygon points="9,12 15,13 28,41 22,44" opacity="0.85"/><polygon points="9,12 15,13 14,19 2,17"/></g></svg>';
var DEFAULT_FAVICON = "data:image/svg+xml;base64," + btoa(STATIC_CRANE_SVG);
function deckFavicon(assets) {
  const logo = assets?.["brand-logo"];
  return logo && logo.startsWith("data:image/") && !/["\s]/.test(logo) ? logo : DEFAULT_FAVICON;
}
function setHeadFavicon(html, href) {
  if (!href || /["'\s<>]/.test(href)) return html;
  const tag = `<link rel="icon" href="${href}">`;
  const existing = /<link\b[^>]*\brel=["']icon["'][^>]*>/i;
  if (existing.test(html)) return html.replace(existing, tag);
  return html.replace(/<title\b/i, `${tag}
<title`);
}
function assembleDeck(input) {
  const { manifest, slides, runtimeJs } = input;
  if (runtimeJs.includes("<\/script")) {
    throw new Error('runtimeJs contains "<\/script" \u2014 cannot embed safely');
  }
  for (const id of manifest.order) {
    if (!(id in slides)) throw new Error(`assembleDeck: manifest order has "${id}" but no slide content given`);
  }
  const manifestJson = JSON.stringify(manifest, null, 2).replace(/</g, "\\u003c");
  const assetsJson = JSON.stringify(input.assets ?? {}, null, 2).replace(/</g, "\\u003c");
  const templates = manifest.order.map((id) => {
    const kind = manifest.slides[id]?.kind ?? "unknown";
    return `<template data-origami-slide="${id}" data-kind="${kind}">
${slides[id]}
</template>`;
  }).join("\n\n");
  return `<!DOCTYPE html>
<html lang="en" data-origami="${manifest.v}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="${deckFavicon(input.assets)}">
<title>${escapeText(manifest.title || "Deck")}</title>
<style id="origami-base-css">${input.baseCss ?? BASE_CSS}</style>
<style id="origami-kinds-css">${input.kindsCss ?? KINDS_CSS}</style>
<style id="origami-theme-css">${input.themeCss ?? THEME_CSS}</style>
</head>
<body>
<div id="origami-root"></div>

<script type="application/json" id="origami-manifest">
${manifestJson}
<\/script>

${templates}

<script type="application/json" id="origami-assets">
${assetsJson}
<\/script>

<script id="origami-runtime">
${runtimeJs}
<\/script>
</body>
</html>
`;
}
export {
  BASE_CSS,
  CHART_FONT_STACK,
  CHART_H,
  CHART_PALETTE,
  CHART_W,
  DIAGRAM_ICONS,
  GANTT_CARD_GAP,
  GANTT_CARD_HEIGHT,
  GANTT_CARD_INSET,
  GANTT_CARD_MIN_PX,
  GANTT_CARD_VSPACING,
  GANTT_LABEL_WIDTH,
  GANTT_LANE_PADDING,
  GANTT_PX_MAX,
  GANTT_PX_MIN,
  GANTT_PX_PER_WEEK,
  KINDS_CSS,
  KIND_BEHAVIOURS,
  LEDGER_EDITOR_CSS,
  NOTE_SWATCHES,
  RUNTIME_BLOCKS,
  RUNTIME_CSS,
  THEMES,
  THEME_CSS,
  TRACKER_STATUSES,
  addDiagramLane,
  applyBrandLogoVar,
  applyFavicon,
  assembleDeck,
  bandSlot,
  buildEditedCopy,
  createViewer,
  docBlockFull,
  docFinalize,
  docMount,
  downloadCopy,
  drawSceneSvg,
  finalizeCountUps,
  finalizeDraws,
  finalizeFlows,
  finalizeGantts,
  finalizeGraphs,
  finalizeGrids,
  finalizeKind,
  finalizeNotes,
  finalizeSparklines,
  finalizeStageBlocks,
  finalizeTables,
  finalizeTrackers,
  finalizeVenns,
  fontFacesCss,
  freeIntervals,
  ganttLensColor,
  ganttWeekIndex,
  graphLayout,
  hachureLines,
  holdRuns,
  inflate,
  isInlineEditable,
  isRunsHeld,
  liteEditNodes,
  mergeVennOverlaps,
  mountCharts,
  mountCloneBlocks,
  mountCountUps,
  mountDraws,
  mountFlows,
  mountGantts,
  mountGraphs,
  mountGrids,
  mountKind,
  mountNotes,
  mountRuns,
  mountSparklines,
  mountStageBlocks,
  mountTables,
  mountTrackers,
  mountVenns,
  mountVideos,
  mulberry32,
  niceMax,
  normalizeChartData,
  normalizeDrawData,
  normalizeFlowData,
  normalizeGanttData,
  normalizeGraphData,
  normalizeGridData,
  normalizeNotesData,
  normalizeTrackerData,
  normalizeVennData,
  normalizeVideoData,
  packLane,
  paginateDoc,
  parseChartFigureData,
  parseFlowSlideData,
  parseGanttSlideData,
  parseGraphSlideData,
  parseGridSlideData,
  parseNotesSlideData,
  parseTableSlideData,
  parseTrackerSlideData,
  parseVennSlideData,
  parseVideoFigureData,
  plotHeightBounds,
  releaseCardBands,
  releaseFloatBands,
  releaseRuns,
  releaseRunsIn,
  removeDiagramLane,
  renderChart,
  renderDiagramError,
  renderDocToc,
  renderDraw,
  renderFlow,
  renderGantt,
  renderGanttError,
  renderGraph,
  renderGrid,
  renderGridError,
  renderNotes,
  renderNotesError,
  renderTable,
  renderTableError,
  renderTracker,
  renderTrackerError,
  renderVenn,
  renderVideo,
  reserveCardBands,
  reserveCardBandsWhenSettled,
  resolveAssetRefs,
  runnable,
  runsMounted,
  sanitizeInline,
  sceneBounds,
  setDiagramSnap,
  setHeadFavicon,
  simplifyPoints,
  sketchyLine,
  sliceColor,
  smoothPath,
  spanInBand,
  tokenize,
  toneStyle,
  usable,
  vennContainingSets,
  vennLayout,
  vennOverlapKey,
  vennSceneSvg,
  vennViewBox,
  withSource,
  wrapVennLabel
};
