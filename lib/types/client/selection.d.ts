/**
 * Wallpaper selection persistence. The renderer owns this preference; the
 * desktop main process never reads it. Storage is localStorage so a refresh
 * restores the chosen wallpaper before the first library scan returns.
 */
export declare const WALLPAPER_SELECTION_STORAGE_KEY = "dsh.wallpaper-engine.selection";
export type WallpaperFillMode = 'cover' | 'contain' | 'fill';
export type WallpaperSelectionKind = 'media' | 'preview' | 'engine';
export interface WallpaperSelection {
    active: boolean;
    id: string;
    title: string;
    kind: WallpaperSelectionKind;
    mediaType: 'video' | 'image';
    mediaAnimated: boolean;
    projectType: string;
    hasPreview: boolean;
    previewAnimated: boolean;
    updatedAt: number;
    opacity: number;
    blur: number;
    fill: WallpaperFillMode;
}
/** Read and validate the persisted selection. */
export declare function readWallpaperSelection(): WallpaperSelection;
/** Default selection: inactive, original app background. */
export declare function emptyWallpaperSelection(): WallpaperSelection;
/** Persist the selection. */
export declare function writeWallpaperSelection(selection: WallpaperSelection): void;
//# sourceMappingURL=selection.d.ts.map