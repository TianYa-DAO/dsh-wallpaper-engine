/**
 * Wallpaper Engine library panel, registered as a settings section. It owns
 * search, manual import/remove, the project card grid, background preference
 * sliders, and the native-scene start/stop control. All bridge writes go
 * through the injected controller; components never touch window directly.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { WallpaperEngineController } from './controller.ts'
import type { WallpaperEngineState } from './store.ts'
import { wallpaperMediaUrl } from './api.ts'
import type { WallpaperProjectItem } from './api.ts'
import type { WallpaperFillMode } from './selection.ts'
import type { WallpaperKey } from './locales.ts'
import css from './WallpaperSection.module.css'

export interface WallpaperSectionInjected {
  controller: WallpaperEngineController
  useSnapshot: SnapshotSelectorHook<WallpaperEngineState>
  isDesktop: boolean
  t: (key: WallpaperKey) => string
}

export type WallpaperSectionProps = Partial<WallpaperSectionInjected>

/** Render the section; return null until every injected share is present. */
export function WallpaperSection(props: WallpaperSectionProps): ReactNode {
  if (props.controller === undefined || props.useSnapshot === undefined || props.t === undefined) return null
  return <LoadedSection controller={props.controller} useSnapshot={props.useSnapshot} isDesktop={props.isDesktop === true} t={props.t} />
}

function LoadedSection({ controller, useSnapshot, isDesktop, t }: {
  controller: WallpaperEngineController
  useSnapshot: SnapshotSelectorHook<WallpaperEngineState>
  isDesktop: boolean
  t: (key: WallpaperKey) => string
}): ReactNode {
  const state = useSnapshot((s: WallpaperEngineState) => s)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  const filtered = useMemo(() => {
    const query = state.search.trim().toLowerCase()
    if (query === '') return state.projects
    return state.projects.filter(item =>
      item.title.toLowerCase().includes(query)
      || item.projectType.toLowerCase().includes(query)
      || item.sourceLabel.toLowerCase().includes(query))
  }, [state.projects, state.search])

  return (
    <div className={css.section}>
      <div className={css.head}>
        <div>
          <h3 className={css.title}>{t('title')}</h3>
          <p className={css.subtitle}>
            {isDesktop
              ? (state.runtimeAvailable ? t('runtimeAvailable') : t('runtimeMissing'))
              : t('desktopHint')}
          </p>
        </div>
        <div className={css.actions}>
          <button className={css.button} type="button" onClick={() => { void controller.load(true) }}>{t('rescan')}</button>
          {isDesktop && <button className={css.button} type="button" onClick={() => { void controller.chooseDirectory() }}>{t('importDirectory')}</button>}
          {isDesktop && <button className={css.button} type="button" onClick={() => { void controller.chooseProjectFile() }}>{t('importProjectFile')}</button>}
        </div>
      </div>

      {!isDesktop && <div className={css.notice}>{t('desktopOnly')}</div>}

      {isDesktop && (
        <>
          <div className={css.toolbar}>
            <input
              className={css.search}
              type="search"
              placeholder={t('searchPlaceholder')}
              value={state.search}
              onChange={(event) => { controller.store.actions.setSearch(event.target.value) }}
            />
            {state.selection.active && (
              <button className={clsx(css.button, css.danger)} type="button" onClick={() => { controller.clearSelection() }}>{t('restoreDefault')}</button>
            )}
            <button
              className={clsx(css.button, state.glassMode && css.buttonActive)}
              type="button"
              onClick={() => { controller.store.actions.setGlassMode(!state.glassMode) }}
            >{t('glassMode')}</button>
          </div>

          {state.status === 'loading' && <div className={css.status}>{t('loading')}</div>}
          {state.status === 'error' && <div className={clsx(css.status, css.error)}>{t('errorPrefix')}: {state.error}</div>}

          {state.manualRoots.length > 0 && (
            <div className={css.roots}>
              <span className={css.rootsLabel}>{t('manualRoots')}</span>
              {state.manualRoots.map(root => (
                <span key={root.id} className={css.rootChip}>
                  {root.name}
                  <button type="button" className={css.rootRemove} aria-label={`${t('remove')} ${root.name}`} onClick={() => { void controller.removeRoot(root.id) }}>×</button>
                </span>
              ))}
            </div>
          )}

          {state.status === 'ready' && filtered.length === 0 && <div className={css.status}>{t('empty')}</div>}

          <div className={css.grid}>
            {filtered.map(project => (
              <LazyCard
                key={project.id}
                project={project}
                token={state.mediaToken}
                selected={state.selection.active && state.selection.id === project.id}
                sceneActive={state.scene.active}
                t={t}
                onSelect={() => controller.selectProject(project)}
                onOpen={() => { void controller.openProjectDetails(project) }}
                onStopScene={() => { void controller.stopScene() }}
              />
            ))}
          </div>

          {state.selection.active && (
            <BackgroundControls
              t={t}
              opacity={state.selection.opacity}
              blur={state.selection.blur}
              fill={state.selection.fill}
              onOpacity={(value) => { controller.store.actions.setSelection({ ...state.selection, opacity: value }) }}
              onBlur={(value) => { controller.store.actions.setSelection({ ...state.selection, blur: value }) }}
              onFill={(fill) => { controller.store.actions.setSelection({ ...state.selection, fill }) }}
            />
          )}

          {state.scene.active && (
            <div className={state.scene.windowParked ? css.sceneNote : clsx(css.sceneNote, css.error)}>
              {state.scene.windowParked
                ? t('windowParked')
                : (state.scene.parkError !== '' ? `${t('windowParkFailed')}（${state.scene.parkError}）` : t('engineRun'))}
            </div>
          )}

          {controller.isDesktop ? <DesktopModeControls controller={controller} t={t} /> : null}
        </>
      )}
    </div>
  )
}

function BackgroundControls({ t, opacity, blur, fill, onOpacity, onBlur, onFill }: {
  t: (key: WallpaperKey) => string
  opacity: number
  blur: number
  fill: WallpaperFillMode
  onOpacity: (value: number) => void
  onBlur: (value: number) => void
  onFill: (fill: WallpaperFillMode) => void
}): ReactNode {
  return (
    <div className={css.controls}>
      <label className={css.control}>
        <span>{t('opacity')}</span>
        <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(event) => { onOpacity(Number(event.target.value)) }} />
      </label>
      <label className={css.control}>
        <span>{t('blur')}</span>
        <input type="range" min={0} max={80} step={1} value={blur} onChange={(event) => { onBlur(Number(event.target.value)) }} />
      </label>
      <label className={css.control}>
        <span>{t('fill')}</span>
        <select value={fill} onChange={(event) => { onFill(event.target.value as WallpaperFillMode) }}>
          <option value="cover">{t('fillCover')}</option>
          <option value="contain">{t('fillContain')}</option>
          <option value="fill">{t('fillFill')}</option>
        </select>
      </label>
    </div>
  )
}

function DesktopModeControls({ controller, t }: {
  controller: WallpaperEngineController
  t: (key: WallpaperKey) => string
}): ReactNode {
  const [wallpaperActive, setWallpaperActive] = useState(false)
  const [desktopActive, setDesktopActive] = useState(false)
  const [iconsVisible, setIconsVisible] = useState(true)
  const [supported, setSupported] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void controller.getWallpaperModeStatus().then((status) => {
      if (status !== null && typeof status === 'object') {
        setWallpaperActive((status as { enabled?: boolean }).enabled === true)
        setSupported((status as { supported?: boolean }).supported !== false)
      }
    }).catch(() => {})
    void controller.getDesktopModeStatus().then((status) => {
      if (status !== null && typeof status === 'object') {
        setDesktopActive((status as { enabled?: boolean }).enabled === true)
        setSupported((status as { supported?: boolean }).supported !== false)
      }
    }).catch(() => {})
    void controller.probeDesktopIcons().then((probe) => {
      if (probe !== null && typeof probe === 'object') {
        setIconsVisible((probe as { visible?: boolean }).visible !== false)
      }
    }).catch(() => {})
  }, [controller])

  const toggleWallpaper = async (): Promise<void> => {
    setError('')
    const result = await controller.setWallpaperMode(!wallpaperActive)
    if (result !== null && typeof result === 'object') {
      const value = result as { ok?: boolean; enabled?: boolean; error?: string }
      setWallpaperActive(value.enabled === true || value.ok === true)
      if (value.error !== undefined && value.error !== '') setError(value.error)
    }
  }

  const toggleDesktop = async (): Promise<void> => {
    setError('')
    const result = await controller.setDesktopMode(!desktopActive)
    if (result !== null && typeof result === 'object') {
      const value = result as { ok?: boolean; enabled?: boolean; error?: string }
      setDesktopActive(value.enabled === true)
      if (value.error !== undefined && value.error !== '') setError(value.error)
    }
  }

  const toggleIcons = async (): Promise<void> => {
    setError('')
    const result = await controller.setDesktopIconsVisible(!iconsVisible)
    if (result !== null && typeof result === 'object') {
      const value = result as { ok?: boolean; visible?: boolean; error?: string }
      setIconsVisible(value.visible === true)
      if (value.error !== undefined && value.error !== '') setError(value.error)
    }
  }

  if (!supported) return <div className={css.notice}>{t('desktopModeUnsupported')}</div>

  return (
    <div className={css.desktopMode}>
      <div className={css.desktopModeTitle}>{t('desktopMode')}</div>
      <div className={css.cardActions}>
        <button className={css.button} type="button" onClick={() => { void toggleWallpaper() }}>
          {wallpaperActive ? t('wallpaperModeOff') : t('wallpaperModeOn')}
        </button>
        <button className={css.button} type="button" onClick={() => { void toggleDesktop() }}>
          {desktopActive ? t('desktopModeOff') : t('desktopModeOn')}
        </button>
        <button className={css.button} type="button" onClick={() => { void toggleIcons() }}>
          {iconsVisible ? t('desktopIconsHide') : t('desktopIconsShow')}
        </button>
        <button className={css.button} type="button" onClick={() => { void controller.requestDesktopKeyboardFocus() }}>
          {t('desktopModeFocus')}
        </button>
      </div>
      {error !== '' && <div className={css.error}>{error}</div>}
    </div>
  )
}

/** IntersectionObserver-gated card: only renders its media once near viewport. */
function LazyCard({ project, token, selected, sceneActive, t, onSelect, onOpen, onStopScene }: {
  project: WallpaperProjectItem
  token: string
  selected: boolean
  sceneActive: boolean
  t: (key: WallpaperKey) => string
  onSelect: () => void
  onOpen: () => void
  onStopScene: () => void
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (node === null || visible) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px' })
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [visible])

  const thumb = wallpaperMediaUrl(project.hasPreview ? 'preview' : 'media', project, token)
  const label = project.enginePlayable
    ? t('scene')
    : project.mediaType === 'video'
      ? t('video')
      : project.mediaType === 'image'
        ? t('image')
        : t('previewOnly')

  return (
    <div ref={ref} className={clsx(css.card, selected && css.cardSelected)}>
      <div className={css.thumb}>
        {visible && thumb !== '' && <img className={css.thumbImage} src={thumb} alt="" loading="lazy" />}
        <span className={css.badge}>{label}</span>
        {project.workshopId !== '' && <button className={css.cardOpen} type="button" onClick={onOpen}>STEAM</button>}
      </div>
      <div className={css.cardBody}>
        <div className={css.cardTitle} title={project.title}>{project.title}</div>
        <div className={css.cardMeta}>{project.sourceLabel}</div>
        <div className={css.cardActions}>
          <button className={css.button} type="button" onClick={onSelect}>{selected ? t('applied') : t('setAsBackground')}</button>
          {selected && project.enginePlayable && sceneActive && (
            <button className={clsx(css.button, css.danger)} type="button" onClick={onStopScene}>{t('engineStop')}</button>
          )}
        </div>
      </div>
    </div>
  )
}


