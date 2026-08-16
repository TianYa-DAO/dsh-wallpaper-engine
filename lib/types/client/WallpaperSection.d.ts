/**
 * Wallpaper Engine library panel, registered as a settings section. It owns
 * search, manual import/remove, the project card grid, background preference
 * sliders, and the native-scene start/stop control. All bridge writes go
 * through the injected controller; components never touch window directly.
 */
import type { ReactNode } from 'react';
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type { WallpaperEngineController } from './controller.ts';
import type { WallpaperEngineState } from './store.ts';
import type { WallpaperKey } from './locales.ts';
export interface WallpaperSectionInjected {
    controller: WallpaperEngineController;
    useSnapshot: SnapshotSelectorHook<WallpaperEngineState>;
    isDesktop: boolean;
    t: (key: WallpaperKey) => string;
}
export type WallpaperSectionProps = Partial<WallpaperSectionInjected>;
/** Render the section; return null until every injected share is present. */
export declare function WallpaperSection(props: WallpaperSectionProps): ReactNode;
//# sourceMappingURL=WallpaperSection.d.ts.map