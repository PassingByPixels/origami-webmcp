import { spliceText } from './splice.js';
import { parseDeck } from './parse.js';
import { extractDataBlocks } from './gantt-data.js';
/**
 * Tree-shake unused kind CSS/JS at save time.
 *
 * Kind sections inside #origami-kinds-css and #origami-kinds-js are delimited by
 * marker comments emitted by the runtime build:
 *   CSS:  /* @kind:stats *\/ ... /* @endkind *\/
 *   JS:   // @kind:stats ... // @endkind
 * Sections whose kind is not used by any slide are removed. "Used" counts both
 * slide kinds AND in-slide data blocks (a chart block on a free slide keeps
 * @kind:chart alive).
 */
const CSS_SECTION = /\/\*\s*@kind:([a-z0-9-]+)\s*\*\/[\s\S]*?\/\*\s*@endkind\s*\*\//g;
const JS_SECTION = /\/\/\s*@kind:([a-z0-9-]+)[^\S\n]*\n[\s\S]*?\/\/\s*@endkind[^\r\n]*/g;
export function treeShakeKinds(deck) {
    const used = new Set(deck.slides.map((s) => s.kind));
    for (const s of deck.slides) {
        for (const b of extractDataBlocks(deck.text.slice(s.inner.start, s.inner.end))) {
            used.add(b.kind);
        }
    }
    const edits = [];
    for (const re of [CSS_SECTION, JS_SECTION]) {
        re.lastIndex = 0;
        for (const m of deck.text.matchAll(re)) {
            if (!used.has(m[1])) {
                let end = m.index + m[0].length;
                if (deck.text.startsWith(deck.eol, end))
                    end += deck.eol.length;
                edits.push({ start: m.index, end, replacement: '' });
            }
        }
    }
    if (edits.length === 0)
        return deck;
    return parseDeck(spliceText(deck.text, edits));
}
