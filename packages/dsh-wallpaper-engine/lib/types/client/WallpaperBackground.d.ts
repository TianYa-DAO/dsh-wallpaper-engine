/**
 * Full-viewport wallpaper background layer. Rendered through a portal onto
 * `document.body` (behind #root) so the three-column app frame stays above
 * it; when a wallpaper is active the component also injects a stylesheet that
 * makes the app frame and sidebar transparent. Media/preview projects render
 * as CSS backgrounds or a muted looping `<video>`; WE Scene projects are
 * captured from the native WE window through the desktop-capture source-id
 * path and fall back to the preview image on any error.
 */
import type { ReactNode } from 'react';
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type { WallpaperEngineController } from './controller.ts';
import type { WallpaperEngineState } from './store.ts';
export interface WallpaperBackgroundInjected {
    controller: WallpaperEngineController;
    useSnapshot: SnapshotSelectorHook<WallpaperEngineState>;
    isDesktop: boolean;
}
export type WallpaperBackgroundProps = Partial<WallpaperBackgroundInjected>;
/**
 * Render the wallpaper layer. The overlay slot outlet renders nothing; the
 * actual element is portalled to a body child with negative z-index, which
 * paints below the app frame.
 * @param props - injected controller, store hook, and desktop flag.
 * @returns null (the portal owns the visible element).
 */
export declare function WallpaperBackground(props: WallpaperBackgroundProps): ReactNode;
//# sourceMappingURL=WallpaperBackground.d.ts.map