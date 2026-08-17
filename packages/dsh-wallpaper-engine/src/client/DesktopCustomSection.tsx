/**
 * Desktop customisation panel: presets and sliders that control the
 * DSH app frame's opacity, blur, colour, radius, border, and shadow.
 * Registered as the "Desktop" settings section.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { WallpaperEngineController } from './controller.ts'
import type { WallpaperEngineState, CustomStyle } from './store.ts'
import { DEFAULT_CUSTOM_STYLE } from './store.ts'
import type { WallpaperKey } from './locales.ts'
import css from './WallpaperSection.module.css'

export interface DesktopCustomSectionInjected {
  controller: WallpaperEngineController
  useSnapshot: SnapshotSelectorHook<WallpaperEngineState>
  isDesktop: boolean
  t: (key: WallpaperKey) => string
}

export type DesktopCustomSectionProps = Partial<DesktopCustomSectionInjected>

export function DesktopCustomSection(props: DesktopCustomSectionProps): ReactNode {
  if (props.controller === undefined || props.useSnapshot === undefined || props.t === undefined) return null
  return <LoadedDesktop controller={props.controller} useSnapshot={props.useSnapshot} t={props.t} />
}

const PRESETS: Array<{ key: WallpaperKey; style: CustomStyle }> = [
  {
    key: 'presetDefault',
    style: { ...DEFAULT_CUSTOM_STYLE },
  },
  {
    key: 'presetGlass',
    style: {
      panelOpacity: 0.55, panelBlur: 24, sidebarOpacity: 0.4, sidebarBlur: 16,
      tintColor: '', accentColor: '', radius: 12, borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.15)', shadowStrength: 0.3,
    },
  },
  {
    key: 'presetAcrylic',
    style: {
      panelOpacity: 0.7, panelBlur: 8, sidebarOpacity: 0.5, sidebarBlur: 4,
      tintColor: '', accentColor: '', radius: 8, borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)', shadowStrength: 0.2,
    },
  },
  {
    key: 'presetTransparent',
    style: {
      panelOpacity: 0.2, panelBlur: 0, sidebarOpacity: 0.15, sidebarBlur: 0,
      tintColor: '', accentColor: '', radius: 0, borderWidth: 0,
      borderColor: '', shadowStrength: 0,
    },
  },
]

function LoadedDesktop({ controller, useSnapshot, t }: {
  controller: WallpaperEngineController
  useSnapshot: SnapshotSelectorHook<WallpaperEngineState>
  t: (key: WallpaperKey) => string
}): ReactNode {
  const state = useSnapshot((s: WallpaperEngineState) => s)
  const cs = state.customStyle

  const set = (patch: Partial<CustomStyle>): void => {
    controller.store.actions.setCustomStyle({ ...cs, ...patch })
  }

  return (
    <div className={css.section}>
      <div className={css.head}>
        <div>
          <h3 className={css.title}>{t('desktopTitle')}</h3>
          <p className={css.subtitle}>{t('desktopSubtitle')}</p>
        </div>
      </div>

      <div className={css.presets}>
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            className={css.presetBtn}
            type="button"
            onClick={() => { controller.store.actions.setCustomStyle(preset.style) }}
          >{t(preset.key)}</button>
        ))}
      </div>

      <div className={css.controls}>
        <SliderRow label={t('panelOpacity')} value={cs.panelOpacity} min={0.1} max={1} step={0.05} onChange={(v) => { set({ panelOpacity: v }) }} />
        <SliderRow label={t('panelBlur')} value={cs.panelBlur} min={0} max={40} step={1} onChange={(v) => { set({ panelBlur: v }) }} />
        <SliderRow label={t('sidebarOpacity')} value={cs.sidebarOpacity} min={0.1} max={1} step={0.05} onChange={(v) => { set({ sidebarOpacity: v }) }} />
        <SliderRow label={t('sidebarBlur')} value={cs.sidebarBlur} min={0} max={40} step={1} onChange={(v) => { set({ sidebarBlur: v }) }} />
        <ColorRow label={t('tintColor')} value={cs.tintColor} onChange={(v) => { set({ tintColor: v }) }} />
        <ColorRow label={t('accentColor')} value={cs.accentColor} onChange={(v) => { set({ accentColor: v }) }} />
        <SliderRow label={t('radius')} value={cs.radius} min={0} max={24} step={1} onChange={(v) => { set({ radius: v }) }} />
        <SliderRow label={t('borderWidth')} value={cs.borderWidth} min={0} max={4} step={1} onChange={(v) => { set({ borderWidth: v }) }} />
        <ColorRow label={t('borderColor')} value={cs.borderColor} onChange={(v) => { set({ borderColor: v }) }} />
        <SliderRow label={t('shadowStrength')} value={cs.shadowStrength} min={0} max={1} step={0.05} onChange={(v) => { set({ shadowStrength: v }) }} />
      </div>
    </div>
  )
}

function SliderRow({ label, value, min, max, step, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}): ReactNode {
  return (
    <label className={css.control}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => { onChange(Number(e.target.value)) }} />
      <span className={css.controlVal}>{value}</span>
    </label>
  )
}

function ColorRow({ label, value, onChange }: {
  label: string
  value: string
  onChange: (value: string) => void
}): ReactNode {
  const [current, setCurrent] = useState(value)
  useEffect(() => { setCurrent(value) }, [value])
  return (
    <label className={css.control}>
      <span>{label}</span>
      <input
        type="text"
        className={css.colorInput}
        value={current}
        placeholder="rgba(255,255,255,0.15) 或 #3964fe"
        onChange={(e) => { setCurrent(e.target.value) }}
        onBlur={() => { onChange(current) }}
      />
    </label>
  )
}