/* Slide markup shared by the unit suite and the Playwright suite, so both prove the SAME
   bytes. Shapes taken from kindSchemaComment('venn') / ('flow') — the contract an agent gets
   back from get_kind_schema. */

const dataBlock = (kind: string, data: unknown): string =>
  `<script type="application/json" data-odata="${kind}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

export const VENN_DATA = {
  count: 3,
  sets: [
    { label: 'Inert', color: '#557A4E' },
    { label: 'Editable', color: '#4a8cc4' },
    { label: 'Portable', color: '#d9a520' },
  ],
  overlaps: [{ sets: [0, 1, 2], label: 'A Fold', x: 50, y: 52 }],
};

export const VENN_INNER = `<figure class="o-vennfig anim">${dataBlock('venn', VENN_DATA)}<div class="o-venn" data-venn-mount></div><figcaption>What a Fold is</figcaption></figure>`;

export const FLOW_DATA = {
  nodes: [
    { id: 'propose', label: 'Agent proposes', shape: 'box', tone: '' },
    { id: 'review', label: 'Human or agent reviews', shape: 'diamond', tone: 'accent' },
    { id: 'apply', label: 'Applied to the Fold', shape: 'pill', tone: 'green' },
  ],
  edges: [
    { from: 'propose', to: 'review', label: 'staged' },
    { from: 'review', to: 'apply', label: 'accepted' },
  ],
};

export const FLOW_INNER = `<figure class="o-flowfig anim">${dataBlock('flow', FLOW_DATA)}<div class="o-flow" data-flow-mount></div><figcaption>The review path</figcaption></figure>`;
