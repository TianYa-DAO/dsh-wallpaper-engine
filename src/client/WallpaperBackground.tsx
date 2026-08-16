/**
 * Full-viewport wallpaper background layer. Rendered through a portal onto
 * `document.body` (behind #root) so the three-column app frame stays above
 * it; when a wallpaper is active the component also injects a stylesheet that
 * makes the app frame and sidebar transparent. Media/preview projects render
 * as CSS backgrounds or a muted looping `<video>`; WE Scene projects are
 * captured from the native WE window through the desktop-capture source-id
 * path and fall back to the preview image on any error.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { WallpaperEngineController } from './controller.ts'
import type { WallpaperEngineState } from './store.ts'
import { wallpaperMediaUrl } from './api.ts'
import type { WallpaperProjectItem } from './api.ts'
import css from './WallpaperBackground.module.css'

export interface WallpaperBackgroundInjected {
  controller: WallpaperEngineController
  useSnapshot: SnapshotSelectorHook<WallpaperEngineState>
  isDesktop: boolean
}

export type WallpaperBackgroundProps = Partial<WallpaperBackgroundInjected>

const TRANSPARENT_APP_STYLE_ID = 'dsh-wallpaper-transparent-app'

/** Capture one Chromium desktop source id into a MediaStream. */
async function captureDesktopSource(sourceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: 7680,
        maxHeight: 4320,
      },
    } as unknown as MediaTrackConstraints,
  })
}

function stopStream(stream: MediaStream | null): void {
  if (stream === null) return
  for (const track of stream.getTracks()) track.stop()
}

type BoundsBridge = {
  desktopWindow?: {
    onWallpaperEngineHostBoundsChanged?: (cb: (payload: unknown) => void) => () => void
  }
}

function projectById(state: WallpaperEngineState, id: string): WallpaperProjectItem | null {
  return state.projects.find(item => item.id === id) ?? null
}

function LayerStyle({ selection }: { selection: WallpaperEngineState['selection'] }): { opacity: number; filter: string } {
  const blur = selection.blur > 0 ? `blur(${selection.blur}px)` : ''
  return { opacity: selection.opacity, filter: blur }
}

/**
 * Render the wallpaper layer. The overlay slot outlet renders nothing; the
 * actual element is portalled to a body child with negative z-index, which
 * paints below the app frame.
 * @param props - injected controller, store hook, and desktop flag.
 * @returns null (the portal owns the visible element).
 */
export function WallpaperBackground(props: WallpaperBackgroundProps): ReactNode {
  if (props.controller === undefined || props.useSnapshot === undefined) return null
  return <LoadedBackground controller={props.controller} useSnapshot={props.useSnapshot} />
}

function LoadedBackground({
  controller,
  useSnapshot,
}: {
  controller: WallpaperEngineController
  useSnapshot: SnapshotSelectorHook<WallpaperEngineState>
}): ReactNode {
  const state = useSnapshot((s: WallpaperEngineState) => s)
  const [portalHost] = useState(() => {
    const host = document.createElement('div')
    host.className = css.host ?? 'dsh-wallpaper-bg-host'
    host.setAttribute('aria-hidden', 'true')
    document.body.appendChild(host)
    return host
  })
  const [engineStream, setEngineStream] = useState<MediaStream | null>(null)
  const [engineVideoReady, setEngineVideoReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const selection = state.selection
  const scene = state.scene
  const token = state.mediaToken
  const project = selection.active ? projectById(state, selection.id) : null

  // Restore a persisted selection before the panel was ever opened: the
  // background needs the library snapshot (media token + project record).
  useEffect(() => {
    if (selection.active && token === '' && state.status === 'idle') void controller.load()
  }, [controller, selection.active, token, state.status])

  // Keep the app frame transparent only while a wallpaper is active.
  useEffect(() => {
    if (!selection.active) return
    let style = document.getElementById(TRANSPARENT_APP_STYLE_ID)
    if (style === null) {
      style = document.createElement('style')
      style.id = TRANSPARENT_APP_STYLE_ID
      style.textContent = '#root > div { background: transparent; } #root { --dsw-specific-sidebar-fill: transparent; }'
      document.head.appendChild(style)
    }
    return () => {
      style.remove()
    }
  }, [selection.active])

  // WE native-scene lifecycle: start -> capture -> ACK, stop on cleanup.
  useEffect(() => {
    if (selection.kind !== 'engine' || !selection.active) {
      setEngineStream(null)
      setEngineVideoReady(false)
      void controller.stopScene()
      return
    }
    const cancelled = { value: false }
    const isCancelled = (): boolean => cancelled.value
    let stream: MediaStream | null = null
    setEngineStream(null)
    setEngineVideoReady(false)

    const run = async (): Promise<void> => {
      const started = await controller.startScene(selection.id)
      if (isCancelled() || !started.ok || started.sourceId === undefined || started.sessionId === undefined) return
      try {
        stream = await captureDesktopSource(started.sourceId)
      } catch {
        await controller.reportCapture(started.sessionId, false)
        return
      }
      if (isCancelled()) {
        stopStream(stream)
        return
      }
      setEngineStream(stream)
      // First-frame confirmation: wait for video dimensions, then ACK.
      const video = videoRef.current
      if (video !== null) {
        video.srcObject = stream
        await video.play().catch(() => {})
      }
      const deadline = Date.now() + 6000
      while (Date.now() < deadline && !isCancelled()) {
        const ready = videoRef.current !== null && videoRef.current.videoWidth > 0
        if (ready) {
          setEngineVideoReady(true)
          await controller.reportCapture(started.sessionId, true)
          return
        }
        await new Promise(resolve => setTimeout(resolve, 120))
      }
      await controller.reportCapture(started.sessionId, false)
    }
    void run()

    return () => {
      cancelled.value = true
      stopStream(stream)
      setEngineStream(null)
      setEngineVideoReady(false)
      if (selection.active) void controller.stopScene()
    }
  }, [controller, selection.active, selection.id, selection.kind])

  // Host bounds change: freeze the frame briefly, then resume playback.
  useEffect(() => {

    const api = (window as BoundsBridge).desktopWindow
    if (api?.onWallpaperEngineHostBoundsChanged === undefined) return
    let timer = 0
    const unsubscribe = api.onWallpaperEngineHostBoundsChanged(() => {
      const video = videoRef.current
      if (video === null) return
      video.pause()
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (video.srcObject !== null) void video.play().catch(() => {})
      }, 180)
    })
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [controller])

  // Cleanup the body host on unmount.
  useEffect(() => () => {
    portalHost.remove()
  }, [portalHost])

  if (!selection.active) return createPortal(null, portalHost)

  const showEngineVideo = selection.kind === 'engine' && engineStream !== null && engineVideoReady
  const fallbackUrl = wallpaperMediaUrl(
    project?.hasPreview === true || project?.playable !== true ? 'preview' : 'media',
    project,
    token,
  )
  const mediaUrl = wallpaperMediaUrl('media', project, token)
  const sourceUrl = showEngineVideo ? '' : (selection.kind === 'media' && mediaUrl !== '' ? mediaUrl : fallbackUrl)
  const layerStyle = LayerStyle({ selection })

  return createPortal(
    <div className={css.layer} style={layerStyle} data-kind={selection.kind}>
      {showEngineVideo
        ? (
          <video
            ref={videoRef}
            className={clsx(css.video, css[`fill_${selection.fill}`])}
            autoPlay
            muted
            loop
            playsInline
          />
        )
        : sourceUrl !== '' && (
          selection.kind === 'media' && selection.mediaType === 'video'
            ? (
              <video
                className={clsx(css.video, css[`fill_${selection.fill}`])}
                src={sourceUrl}
                autoPlay
                muted
                loop
                playsInline
              />
            )
            : (
              <div
                className={clsx(css.image, css[`fill_${selection.fill}`])}
                style={{ backgroundImage: `url("${sourceUrl}")` }}
              />
            )
        )}
      {selection.kind === 'engine' && scene.error !== '' && <div className={css.fallbackNote}>{scene.error}</div>}
    </div>,
    portalHost,
  )
}
