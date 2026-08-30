import { validateBlockInstance } from '../block-def.js';
export const compositeBlock = {
    key: 'block',
    name: 'Composite block (agent-defined)',
    schemaComment: [
        'an IN-SLIDE block whose TYPE is a custom def you register first with define_block (kind "x.<name>")',
        'define_block(def): a CompositeBlockDef stored in manifest.blocks = { kind:"x.<name>", name, version:int>=1,',
        '  fields:[{name(identifier), type: text|number|select|color, label?, options?(select only), default?}],',
        '  template:"<inert HTML using {{field}} placeholders>", schemaComment?:[…] }',
        'the template MUST render INERT (no <script>/<style>/<iframe>/on*=/remote URLs) — define_block rejects a template that would bake to active content',
        'an INSTANCE is <figure class="o-block anim"> holding ONE inert <script type="application/json" data-odata="block"> block, FOLLOWED BY the baked HTML output',
        '  the JSON is { block:"x.<name>", values:{ <field>:<value>, … } }; the trusted app renders the template with the values and bakes inert HTML on save (the viewer just shows the baked HTML)',
        'author via add_chunk/write_chunk with {block, fields} (the server renders + bakes), or supply the figure html directly',
        'a composite block is how you invent a reusable typed component a human can still edit field-by-field — the field manifest IS the human-edit contract',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    // Shape-only here (like the historical KIND_DATA_SPECS.block entry): the def-exists
    // check needs the deck registry, so validateKindData runs the full registry-aware
    // validateBlockInstance inline — this facet is used standalone (e.g. the Studio edit handler).
    data: { placement: 'block', validate: (data) => validateBlockInstance(data) },
};
