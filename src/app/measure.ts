import type { FoldGeometry, MeasureResult } from '../core/inspect.js';

/* The honest render measurement.
   ------------------------------------------------------------------------------------------
   inspect_render must report what the deck ACTUALLY lays out as, which means a real browser
   layout of the real bytes. There is no second renderer to ask, so this puts the serialized
   Fold into a hidden iframe — the same srcdoc the visible preview gets — with one measuring
   script appended, and the script posts the geometry back out.

   WHY APPENDING IS SAFE. Every byte of slide content in that deck has already been through
   validateSlideContent (no stray <template>, balanced <script>), so appending a <script> after
   the deck's own closing </body> cannot land inside an unterminated element. It is appended at
   the LAST </body>, not the first: the deck carries its whole runtime inline and that bundle
   contains the string "</body>" in its own source.

   WHY THE VISIBLE PREVIEW IS NOT REUSED. The measurer navigates the deck (clicking tabs) to
   reach every fold, which would yank the human's view around; this frame is off-screen and
   removed the moment it has answered. The preview carries only the small navigation bridge
   (preview.ts), which appends through the SAME injectMeasurer seam and never measures.

   SANDBOX. Same as the preview: `allow-scripts`, never `allow-same-origin`. The measurer talks
   back through postMessage, which crosses an opaque origin fine; a nonce matches the reply to
   the request, since `event.origin` is the useless string "null" for a sandboxed frame. */

/**
 * A fixed, stated presentation viewport.
 *
 * The first version sized this frame to the preview element the human is looking at, which
 * sounded honest and was not: in a narrow window the preview is ~267px tall, the deck enforces a
 * minimum fold height well above that, and EVERY fold came back "overflows" — an artifact of the
 * measuring window, reported as a defect in the deck. A verdict that changes with the reader's
 * window size is not a verdict. So: one size, always, named in the result, and the tool says a
 * full-screen reader has more room.
 */
export const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
/** Guard rails: a 0px or 40000px frame measures nothing useful and can wedge the browser. */
export const clampViewport = (v?: { width?: number; height?: number }): { width: number; height: number } => ({
  width: Math.min(3840, Math.max(320, Math.round(v?.width || DEFAULT_VIEWPORT.width))),
  height: Math.min(2160, Math.max(240, Math.round(v?.height || DEFAULT_VIEWPORT.height))),
});

/** How long to let the deck's runtime mount its blocks (charts and diagrams render async). */
const MOUNT_MS = 700;
/** How long to let one fold settle after activating its tab. */
const SETTLE_MS = 260;
/** Hard ceiling — a deck that never answers must not hang the tool. */
const TIMEOUT_MS = 15_000;

/**
 * The measuring script, injected into the deck. It runs INSIDE the sandboxed frame, so it is
 * written as a string rather than imported: it has no access to this module's scope, and this
 * module has no access to its DOM.
 *
 * Every selector in here was read off a real render (header.o-top, main.o-stage,
 * section.slide[data-slide-id], .o-tabs .o-tab[data-tab]) rather than assumed. In `deck`
 * foldType the stage holds only the fold on show, so a fold is reached by clicking its tab; in
 * `scroll` every fold is stacked in the stage already and is scrolled to instead.
 */
const MEASURER = (nonce: string, ids: string[], mountMs: number, settleMs: number): string => `
<script>(function(){
  var NONCE=${JSON.stringify(nonce)}, IDS=${JSON.stringify(ids)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms);});};
  var rect=function(el){return el.getBoundingClientRect();};
  function stageSection(id){
    var stage=document.querySelector('main.o-stage');
    return stage?stage.querySelector(':scope > section.slide[data-slide-id="'+id+'"]'):null;
  }
  function measureOne(sec){
    var inner=sec.firstElementChild||sec;
    var r=rect(sec);
    /* Where does the reader's eye actually start?
       NOT the wrapper's box: a .slide-inner fills the stage from y=0 and uses PADDING to push
       its blocks clear of the masthead, so reading the wrapper's top says "clipped" for every
       correctly laid-out fold. Measuring the wrapper was the first thing this file got wrong —
       a blank deck reported its cover as clipped by 64px when nothing was wrong with it.
       So: the topmost LEAF that paints. A leaf has no element children, so it is real content
       (an h2, a <p>, an SVG <path>) rather than a container whose box says nothing about where
       the ink is. */
    var top=null, painted=0, all=sec.querySelectorAll('*');
    for(var i=0;i<all.length;i++){
      if(all[i].children.length) continue;
      var lr=rect(all[i]);
      if(lr.width<=0||lr.height<=0) continue;
      painted++;
      if(top===null||lr.top<top) top=lr.top;
    }
    if(top===null) top=r.top;   // nothing paints — the empty-fold rule will say so
    var head=document.querySelector('header.o-top');
    var labels=[];
    var texts=sec.querySelectorAll('svg text');
    for(var j=0;j<texts.length;j++){
      var tr=rect(texts[j]);
      if(tr.width<=0||tr.height<=0) continue;
      labels.push({text:(texts[j].textContent||'').trim().slice(0,40),x:tr.left,y:tr.top,w:tr.width,h:tr.height});
    }
    return {
      measured:true,
      contentTop:top,
      contentHeight:Math.max(r.height,inner.scrollHeight),
      mastheadBottom:head?rect(head).bottom:0,
      blockCount:inner.children.length,
      paintedLeaves:painted,
      // textContent counts the JSON inside a data block as "text", so an empty flow whose
      // <script> holds {"nodes":[],"edges":[]} looked like a fold full of prose. Measured.
      textLength:visibleText(sec),
      labels:labels
    };
  }
  function visibleText(sec){
    var t='', w=document.createTreeWalker(sec,NodeFilter.SHOW_TEXT,null);
    for(var n=w.nextNode();n;n=w.nextNode()){
      var pt=n.parentElement;
      if(pt&&(pt.tagName==='SCRIPT'||pt.tagName==='STYLE')) continue;
      t+=' '+n.nodeValue;
    }
    return t.replace(/\\s+/g,' ').trim().length;
  }
  function reply(payload){parent.postMessage({nonce:NONCE,payload:payload},'*');}
  /* One fold at a time, as soon as it is known: the parent keeps these, so a deck that runs
     out of budget still answers with the folds that WERE reached instead of nothing. */
  function progress(g){parent.postMessage({nonce:NONCE,progress:g},'*');}
  (async function(){
    try{
      await sleep(${mountMs});
      /* A frame with no viewport has no layout to read. It happens when the page is hidden
         (a background or minimised window) — every fold then comes back 0px tall and the old
         answer called that a clean deck. Wait a little for the page to be shown, then refuse. */
      var waited=0;
      while((innerWidth===0||innerHeight===0)&&waited<1500){await sleep(100);waited+=100;}
      if(innerWidth===0||innerHeight===0){
        reply({error:'the measuring frame laid out at 0x0 — the page is hidden (a background or minimised window), so nothing was measured; bring the tab to the front and call again'});
        return;
      }
      var out=[];
      for(var i=0;i<IDS.length;i++){
        var id=IDS[i], sec=stageSection(id), g;
        if(!sec||rect(sec).height===0){
          var tab=document.querySelector('.o-tabs .o-tab[data-tab="'+id+'"]');
          if(tab){tab.click(); await sleep(${settleMs}); sec=stageSection(id);}
        }
        if(!sec){g={id:id,measured:false,reason:'this fold is not on the stage — it is hidden, so the deck never lays it out'};}
        else if(rect(sec).height===0){g={id:id,measured:false,reason:'the fold is in the deck but rendered with zero height, and no tab could bring it on screen'};}
        else{
          if(rect(sec).top>2){sec.scrollIntoView(); await sleep(60);}   // scroll folds: read it where a reader would
          g=measureOne(sec); g.id=id;
        }
        out.push(g); progress(g);
      }
      reply({viewport:{width:innerWidth,height:innerHeight},folds:out});
    }catch(e){reply({error:String(e&&e.message||e)});}
  })();
})();</script>`;

/** Append the measurer at the deck's LAST </body>, or at the very end if it has none. */
export function injectMeasurer(deckText: string, script: string): string {
  const at = deckText.lastIndexOf('</body>');
  return at === -1 ? deckText + script : deckText.slice(0, at) + script + deckText.slice(at);
}

/**
 * Render `deckText` off-screen at the size the human's preview is showing, and measure every
 * fold in `ids`. Rejects rather than inventing numbers if the frame never answers.
 */
export function measureRender(deckText: string, ids: string[], viewport?: { width?: number; height?: number }): Promise<MeasureResult> {
  const size = clampViewport(viewport);
  return new Promise((resolve, reject) => {
    const nonce = `m${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts'); // never allow-same-origin, exactly like the preview
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('data-testid', 'measure-frame');
    // Off-screen rather than display:none: a hidden frame has no layout, and a measurement of
    // a thing with no layout is not a measurement.
    frame.style.cssText = `position:fixed;left:-10000px;top:0;border:0;width:${size.width}px;height:${size.height}px;`;

    let done = false;
    const finish = (fn: () => void): void => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      frame.remove();
      fn();
    };
    /* Folds the frame has reported so far. On timeout these are the answer — partial, and
       said to be — rather than throwing every measurement away because the last one was slow. */
    const reached: FoldGeometry[] = [];
    const onMessage = (ev: MessageEvent): void => {
      const data = ev.data as { nonce?: string; progress?: FoldGeometry; payload?: MeasureResult & { error?: string } };
      if (!data || data.nonce !== nonce) return; // origin is "null" for a sandboxed frame — the nonce is the match
      if (data.progress) {
        reached.push(data.progress);
        return;
      }
      const payload = data.payload;
      if (!payload || payload.error) finish(() => reject(new Error(payload?.error ?? 'the measuring frame sent nothing')));
      else if (!payload.viewport || payload.viewport.width <= 0 || payload.viewport.height <= 0) {
        finish(() => reject(new Error(`the measuring frame reported a ${payload.viewport?.width ?? 0}x${payload.viewport?.height ?? 0} viewport — no layout was done, so nothing was measured`)));
      } else finish(() => resolve(payload));
    };
    const timer = setTimeout(
      () =>
        finish(() => {
          if (reached.length === 0) {
            reject(new Error(`the deck did not finish rendering within ${TIMEOUT_MS / 1000}s, so nothing was measured`));
            return;
          }
          const got = new Set(reached.map((g) => g.id));
          const rest: FoldGeometry[] = ids
            .filter((id) => !got.has(id))
            .map((id) => ({
              id,
              measured: false,
              reason: `not reached: the ${TIMEOUT_MS / 1000}s measuring budget ran out after ${reached.length} of ${ids.length} folds — re-run with foldIds for the rest`,
              contentTop: 0,
              contentHeight: 0,
              mastheadBottom: 0,
              blockCount: 0,
              paintedLeaves: 0,
              textLength: 0,
              labels: [],
            }));
          // the frame was sized to `size` by this function, so that IS the viewport it laid out in
          resolve({ viewport: size, folds: [...reached, ...rest], partial: { measuredCount: reached.length, requested: ids.length, budgetMs: TIMEOUT_MS } });
        }),
      TIMEOUT_MS
    ) as unknown as number;

    window.addEventListener('message', onMessage);
    frame.srcdoc = injectMeasurer(deckText, MEASURER(nonce, ids, MOUNT_MS, SETTLE_MS));
    document.body.append(frame);
  });
}
