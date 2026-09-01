/* Propose-review-accept (§3) — the SHARED, browser-safe half: the proposal wire contract +
   the pure "reviewable view" derivation. A proposal is an Op computed against a pinned per-chunk
   base, STAGED (not applied) until a reviewer accepts. Proposals live in the trusted layer (the
   MCP stages them; a desktop Studio Review panel shows + accepts them), NEVER inside the Fold.

   This module is intentionally crypto-free so it compiles into BOTH the Node MCP (sync
   node:crypto) and the browser Studio (async Web Crypto): the conflict check takes the CURRENT
   chunk hash as a parameter rather than computing it. The store IO + hashing live where the
   runtime allows them — mcp/src/proposals.ts (Node fs + node:crypto), studio-core (Web Crypto). */
/** A reviewable view of a proposal against the live model: action + before/after + a conflict flag.
    `currentInnerHash` is the sha256 of the target chunk's CURRENT inner (undefined if the chunk is
    gone) — the caller computes it (Node or Web Crypto) so this stays runtime-agnostic. */
export function proposalView(p, model, currentInnerHash) {
    const cur = model.slides.get(p.targetId);
    const base = { id: p.id, author: p.author, title: p.title, prompt: p.prompt, targetId: p.targetId };
    switch (p.op.t) {
        case 'slide.inner':
            return { ...base, action: 'edit', before: cur?.inner, after: p.op.inner, conflicted: cur === undefined || currentInnerHash !== p.baseHash };
        case 'slide.insert':
            return { ...base, action: 'add', after: p.op.inner, conflicted: false };
        case 'slide.remove':
            return { ...base, action: 'delete', before: cur?.inner, conflicted: cur === undefined };
        case 'slide.meta':
            return { ...base, action: 'hide', before: cur?.inner, conflicted: cur === undefined };
    }
}
