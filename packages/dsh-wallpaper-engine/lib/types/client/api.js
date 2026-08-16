/**
 * Desktop-bridge types and detection. The actual implementation is injected
 * by the Electron preload as `window.desktopWindow`; web builds without the
 * bridge keep working and show the "desktop only" hint.
 */
/** Read the optional bridge once and cache the verdict. */
export function getDesktopWindowApi() {
    const value = window.desktopWindow;
    return value !== undefined && value.isDesktop ? value : null;
}
/** Build a `dsh-wallpaper://` media URL for an indexed project. */
export function wallpaperMediaUrl(kind, item, token) {
    if (item === null || token === '')
        return '';
    return `dsh-wallpaper://${kind}/${encodeURIComponent(item.id)}?v=${encodeURIComponent(String(item.updatedAt || 0))}&token=${encodeURIComponent(token)}`;
}
//# sourceMappingURL=api.js.map