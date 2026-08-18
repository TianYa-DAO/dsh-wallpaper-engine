/**
 * Carousel (auto-rotation) controls: create and manage wallpaper playlists
 * that auto-switch at a configurable interval.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { WallpaperEngineController } from './controller.ts'
import type { WallpaperEngineState, CarouselPlaylist } from './store.ts'
import type { WallpaperKey } from './locales.ts'
import css from './WallpaperSection.module.css'
import clsx from 'clsx'

export interface CarouselControlsInjected {
  controller: WallpaperEngineController
  useSnapshot: SnapshotSelectorHook<WallpaperEngineState>
  t: (key: WallpaperKey) => string
}

const INTERVALS = [30, 60, 120, 300, 600, 1800, 3600]

export function CarouselControls({ controller, useSnapshot, t }: CarouselControlsInjected): ReactNode {
  const state = useSnapshot((s: WallpaperEngineState) => s)
  const carousel = state.carousel
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const activeList = carousel.playlists.find((p) => p.id === carousel.activePlaylistId) ?? null

  const save = (c: typeof carousel): void => {
    controller.store.actions.setCarousel(c)
  }

  const toggleEnabled = (): void => {
    save({ ...carousel, enabled: !carousel.enabled })
  }

  const addPlaylist = (): void => {
    if (newName.trim() === '') return
    const id = Math.random().toString(36).slice(2, 10)
    const list: CarouselPlaylist = { id, name: newName.trim(), wallpaperIds: [], interval: 300, order: 'sequence' }
    save({ ...carousel, playlists: [...carousel.playlists, list], activePlaylistId: carousel.activePlaylistId || id })
    setNewName('')
    setEditing(id)
  }

  const importFromSource = (source: string, name: string): void => {
    const ids = state.projects.filter((p) => p.playable && p.source === source).map((p) => p.id)
    if (ids.length === 0) return
    // Avoid duplicate imports: if a playlist with the same name already exists, skip.
    if (carousel.playlists.some((p) => p.name === name)) return
    const id = Math.random().toString(36).slice(2, 10)
    const list: CarouselPlaylist = { id, name, wallpaperIds: ids, interval: 300, order: 'sequence' }
    save({ ...carousel, playlists: [...carousel.playlists, list], activePlaylistId: carousel.activePlaylistId || id })
  }

  const updatePlaylist = (id: string, patch: Partial<CarouselPlaylist>): void => {
    save({
      ...carousel,
      playlists: carousel.playlists.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })
  }

  const deletePlaylist = (id: string): void => {
    save({
      ...carousel,
      playlists: carousel.playlists.filter((p) => p.id !== id),
      activePlaylistId: carousel.activePlaylistId === id ? '' : carousel.activePlaylistId,
    })
    if (editing === id) setEditing(null)
  }

  const toggleWallpaper = (listId: string, wpId: string): void => {
    const list = carousel.playlists.find((p) => p.id === listId)
    if (!list) return
    const has = list.wallpaperIds.includes(wpId)
    updatePlaylist(listId, {
      wallpaperIds: has ? list.wallpaperIds.filter((id) => id !== wpId) : [...list.wallpaperIds, wpId],
    })
  }

  return (
    <div className={css.carousel}>
      <div className={css.carouselHead}>
        <label className={css.carouselToggle}>
          <input type="checkbox" checked={carousel.enabled} onChange={toggleEnabled} />
          <span>{t('carousel')}</span>
        </label>
        <button className={css.button} type="button" onClick={() => { setOpen(!open) }}>{open ? t('close') : t('carouselManage')}</button>
      </div>

      {open && (
        <div className={css.carouselBody}>
          <div className={css.carouselNew}>
            <input className={css.colorInput} type="text" value={newName} placeholder={t('carouselNewPlaceholder')} onChange={(e) => { setNewName(e.target.value) }} />
            <button className={css.button} type="button" onClick={addPlaylist}>{t('carouselAdd')}</button>
          </div>

          <div className={css.carouselImport}>
            <button className={css.button} type="button" onClick={() => { importFromSource('workshop', t('carouselImportWorkshop')) }}>{t('carouselImportWorkshop')}</button>
            <button className={css.button} type="button" onClick={() => { importFromSource('imported', t('carouselImportManual')) }}>{t('carouselImportManual')}</button>
          </div>

          {carousel.playlists.map((list) => (
            <div key={list.id} className={clsx(css.carouselItem, list.id === carousel.activePlaylistId && css.carouselItemActive)}>
              <div className={css.carouselItemHead}>
                <button className={clsx(css.button, list.id === carousel.activePlaylistId && css.presetBtnActive)} type="button" onClick={() => { save({ ...carousel, activePlaylistId: list.id }) }}>
                  {list.name} ({list.wallpaperIds.length})
                </button>
                <button className={css.button} type="button" onClick={() => { setEditing(editing === list.id ? null : list.id) }}>{t('carouselEdit')}</button>
                <button className={clsx(css.button, css.danger)} type="button" onClick={() => { deletePlaylist(list.id) }}>{t('remove')}</button>
              </div>

              {editing === list.id && (
                <div className={css.carouselEdit}>
                  <label className={css.control}>
                    <span className={css.controlLabel}>{t('carouselInterval')}</span>
                    <select value={list.interval} onChange={(e) => { updatePlaylist(list.id, { interval: Number(e.target.value) }) }}>
                      {INTERVALS.map((v) => (<option key={v} value={v}>{v >= 60 ? `${v / 60} min` : `${v} s`}</option>))}
                    </select>
                  </label>
                  <label className={css.control}>
                    <span className={css.controlLabel}>{t('carouselOrder')}</span>
                    <select value={list.order} onChange={(e) => { updatePlaylist(list.id, { order: e.target.value as 'sequence' | 'random' }) }}>
                      <option value="sequence">{t('carouselOrderSeq')}</option>
                      <option value="random">{t('carouselOrderRand')}</option>
                    </select>
                  </label>
                  <div className={css.carouselWps}>
                    <span className={css.controlLabel}>{t('carouselPick')}</span>
                    <div className={css.carouselGrid}>
                      {state.projects.filter((p) => p.playable).map((p) => (
                        <label key={p.id} className={css.carouselWp}>
                          <input type="checkbox" checked={list.wallpaperIds.includes(p.id)} onChange={() => { toggleWallpaper(list.id, p.id) }} />
                          <span>{p.title.slice(0, 30)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {carousel.enabled && activeList && (
            <div className={activeList.wallpaperIds.length > 1 ? css.carouselStatus : css.carouselWarn}>
              {activeList.wallpaperIds.length > 1
                ? `${t('carouselActive')}: ${activeList.name} — ${activeList.interval >= 60 ? `${activeList.interval / 60} min` : `${activeList.interval} s`}`
                : t('carouselNeedMore')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}