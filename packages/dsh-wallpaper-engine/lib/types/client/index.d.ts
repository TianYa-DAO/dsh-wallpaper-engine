/**
 * Wallpaper Engine client plugin, browser half: registers the library panel
 * as a settings section and the full-viewport background layer as a
 * shell.overlay entry. The desktop bridge is optional — without it the panel
 * shows the "desktop version" hint and the background layer stays inert.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type WallpaperKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Wallpaper Engine panel copy. */
        'settings.wallpaper-engine': WallpaperKey;
    }
}
/** Required services (cordis fiber inject). */
export declare const inject: string[];
/**
 * Register the wallpaper dictionary, settings section, and background layer.
 * Both entries share one controller (and therefore one store instance).
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map