const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const ASSET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Strict shape check for a notes data block. REJECT, never repair. */
export function validateNotesData(data) {
    const v = [];
    const bad = (rule, detail) => v.push({ rule: `notes.${rule}`, detail });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad('shape', 'notes data must be a JSON object');
        return v;
    }
    const d = data;
    if (!Array.isArray(d.notes)) {
        bad('notes', 'notes must be an array');
        return v;
    }
    const str = (x, max) => typeof x === 'string' && x.length <= max;
    d.notes.forEach((n, i) => {
        const o = (n ?? {});
        if (!str(o.id, 64))
            bad('note.id', `note ${i}: id must be a string (max 64)`);
        if (!str(o.title, 500))
            bad('note.title', `note ${i}: title must be a string (max 500)`);
        if (!str(o.body, 8000))
            bad('note.body', `note ${i}: body must be a string (max 8000)`);
        if (typeof o.color !== 'string' || (o.color !== '' && !HEX_RE.test(o.color))) {
            bad('note.color', `note ${i}: color must be "" or a #hex string`);
        }
        if (typeof o.pinned !== 'boolean')
            bad('note.pinned', `note ${i}: pinned must be a boolean`);
        if (o.date !== undefined && !str(o.date, 32))
            bad('note.date', `note ${i}: date must be a string (max 32)`);
        if (o.image !== undefined && (typeof o.image !== 'string' || !ASSET_ID_RE.test(o.image))) {
            bad('note.image', `note ${i}: image must be an asset id`);
        }
    });
    return v;
}
/** Serialize notes data for embedding — "<" escaped (same invariant as trackerDataJson). */
export function notesDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
