/**
 * Wallpaper Engine client plugin, browser half: registers the library panel
 * as a settings section and the full-viewport background layer as a
 * shell.overlay entry. The desktop bridge is optional — without it the panel
 * shows the "desktop version" hint and the background layer stays inert.
 * Export discipline: packages/client/AGENTS.md.
 */
import { WallpaperEngineController, bindWallpaperSnapshot } from "./controller.js";
import { WallpaperSection } from "./WallpaperSection.js";
import { WallpaperBackground } from "./WallpaperBackground.js";
import { getDesktopWindowApi } from "./api.js";
import { en, zh } from "./locales.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'settings.wallpaper-engine';
/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale'];
/**
 * Register the wallpaper dictionary, settings section, and background layer.
 * Both entries share one controller (and therefore one store instance).
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-wallpaper-engine: copy dictionaries');
    const t = ctx.locale.bind(NS);
    const api = getDesktopWindowApi();
    const controller = new WallpaperEngineController(api);
    const useSnapshot = bindWallpaperSnapshot(controller);
    const sectionInjected = () => ({
        controller,
        useSnapshot,
        isDesktop: api !== null,
        t,
    });
    const backgroundInjected = () => ({
        controller,
        useSnapshot,
        isDesktop: api !== null,
    });
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'wallpaper-engine',
        order: 900,
        label: () => t('nav'),
        inject: sectionInjected,
    }, WallpaperSection));
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'wallpaper-engine-background',
        order: -100,
        inject: backgroundInjected,
    }, WallpaperBackground));
}
//# sourceMappingURL=index.js.map