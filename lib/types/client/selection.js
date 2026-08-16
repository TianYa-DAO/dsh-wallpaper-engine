/**
 * Wallpaper selection persistence. The renderer owns this preference; the
 * desktop main process never reads it. Storage is localStorage so a refresh
 * restores the chosen wallpaper before the first library scan returns.
 */
export const WALLPAPER_SELECTION_STORAGE_KEY = 'dsh.wallpaper-engine.selection';
/** Bound a number between min and max, returning the fallback for NaN. */
function bound(value, minimum, maximum, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}
/** Validate a string against the 24-hex project id format. */
function normalizeId(value) {
    const raw = (typeof value === 'string' ? value : '').replace(/[^a-f0-9]/gi, '').slice(0, 24).toLowerCase();
    return /^[a-f0-9]{24}$/.test(raw) ? raw : '';
}
/** Sanitize a title the same way the library sanitizes project titles. */
function normalizeTitle(value) {
    const raw = typeof value === 'string' ? value : '';
    return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}
/** Read and validate the persisted selection. */
export function readWallpaperSelection() {
    try {
        const raw = JSON.parse(localStorage.getItem(WALLPAPER_SELECTION_STORAGE_KEY) ?? '{}');
        const id = normalizeId(raw.id);
        const kind = raw.kind === 'engine' ? 'engine' : (raw.kind === 'media' ? 'media' : 'preview');
        return {
            active: raw.active === true && id.length === 24,
            id,
            title: normalizeTitle(raw.title),
            kind,
            mediaType: raw.mediaType === 'video' ? 'video' : 'image',
            mediaAnimated: raw.mediaAnimated === true,
            projectType: (typeof raw.projectType === 'string' ? raw.projectType : 'unknown').slice(0, 32),
            hasPreview: raw.hasPreview === true,
            previewAnimated: raw.previewAnimated === true,
            updatedAt: Math.max(0, Number(raw.updatedAt) || 0),
            opacity: bound(raw.opacity, 0, 1, 1),
            blur: bound(raw.blur, 0, 80, 0),
            fill: raw.fill === 'contain' ? 'contain' : (raw.fill === 'fill' ? 'fill' : 'cover'),
        };
    }
    catch {
        return emptyWallpaperSelection();
    }
}
/** Default selection: inactive, original app background. */
export function emptyWallpaperSelection() {
    return {
        active: false,
        id: '',
        title: '',
        kind: 'preview',
        mediaType: 'image',
        mediaAnimated: false,
        projectType: 'unknown',
        hasPreview: false,
        previewAnimated: false,
        updatedAt: 0,
        opacity: 1,
        blur: 0,
        fill: 'cover',
    };
}
/** Persist the selection. */
export function writeWallpaperSelection(selection) {
    try {
        localStorage.setItem(WALLPAPER_SELECTION_STORAGE_KEY, JSON.stringify(selection));
    }
    catch {
        // Storage full or disabled: the in-memory selection still applies for the session.
    }
}
//# sourceMappingURL=selection.js.map