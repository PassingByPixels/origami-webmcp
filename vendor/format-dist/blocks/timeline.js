import { validateTimelineData } from '../timeline-data.js';
export const timelineBlock = {
    key: 'timeline',
    name: 'Timeline',
    schemaComment: [
        'a dated sequence of events — an IN-SLIDE block, insertable on any fold',
        'shape: <figure class="o-timelinefig anim"> holding ONE inert <script type="application/json" data-odata="timeline"> block,',
        '  then <div class="o-timeline" data-timeline-mount></div> (the runtime renders the rail + cards here), then a <figcaption>',
        'JSON shape: { orientation?: "vertical"|"horizontal" (absent = vertical), events: [{ date?: string, title: string, body?: string }] }',
        'markers number themselves 1..N in order; vertical puts the rail down the left, horizontal puts it across the top',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    data: { placement: 'block', validate: validateTimelineData },
};
