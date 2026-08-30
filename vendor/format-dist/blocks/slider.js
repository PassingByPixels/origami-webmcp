import { validateSliderData } from '../slider-data.js';
export const sliderBlock = {
    key: 'slider',
    name: 'Slider (block)',
    schemaComment: [
        'an IN-SLIDE block, not a slide kind — any number may appear on any slide',
        'shape: <figure class="o-sliderfig anim"> holding ONE inert <script type="application/json" data-odata="slider"> block,',
        '  then <div class="o-slider" data-slider-mount> holding a PRE-BAKED zero-JS control (o-slider-panel[data-style] > o-slider-faders > one o-slider-fader[data-si,--val] per item, each an o-slider-track with o-slider-fill + o-slider-thumb plus an o-slider-value and optional o-slider-label), then an editable <figcaption>',
        'JSON shape: { style?: single|rows|mixer|panel (absent = single), sliders: a NON-EMPTY array of { min: number, max: number (min < max), step: number > 0, value: number within [min,max], label? } }',
        'per-item optional link: a WRITE-side tie to ONE ledger cell — { ledgerId (the target ledger id), tab? (the sheet sid; absent = top-level sheet), cell (a single A1 address like "B3", never a range) }; absent = a standalone fader',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    data: { placement: 'block', validate: validateSliderData },
};
