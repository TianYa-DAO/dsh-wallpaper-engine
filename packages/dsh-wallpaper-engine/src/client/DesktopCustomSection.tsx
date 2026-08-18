/**
 * Desktop customisation panel: presets and sliders that control the
 * DSH app frame's opacity, blur, colour, radius, border, and shadow.
 * Registered as the "Desktop" settings section.
 */

import clsx from 'clsx'
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
  { key: 'presetDefault', style: { ...DEFAULT_CUSTOM_STYLE } },
  {
    key: 'presetGlass',
    style: {
      mainOpacity: 0.5, mainBlur: 24, sidebarOpacity: 0.35, sidebarBlur: 16,
      chatOpacity: 0.45, chatBlur: 20, inputOpacity: 0.4, inputBlur: 12,
      panelOpacity: 0.5, panelBlur: 18,
      tintColor: '', accentColor: '', radius: 12, borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.15)', shadowStrength: 0.3, scrimStrength: 0.15,
    },
  },
  {
    key: 'presetAcrylic',
    style: {
      mainOpacity: 0.65, mainBlur: 8, sidebarOpacity: 0.45, sidebarBlur: 4,
      chatOpacity: 0.6, chatBlur: 6, inputOpacity: 0.5, inputBlur: 4,
      panelOpacity: 0.6, panelBlur: 6,
      tintColor: '', accentColor: '', radius: 8, borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)', shadowStrength: 0.2,
    },
  },
  {
    key: 'presetTransparent',
    style: {
      mainOpacity: 0.15, mainBlur: 0, sidebarOpacity: 0.1, sidebarBlur: 0,
      chatOpacity: 0.12, chatBlur: 0, inputOpacity: 0.1, inputBlur: 0,
      panelOpacity: 0.15, panelBlur: 0,
      tintColor: '', accentColor: '', radius: 0, borderWidth: 0,
      borderColor: '', shadowStrength: 0,
    },
  },
]

function stylesEqual(a: CustomStyle, b: CustomStyle): boolean {
  return a.mainOpacity === b.mainOpacity && a.mainBlur === b.mainBlur
    && a.sidebarOpacity === b.sidebarOpacity && a.sidebarBlur === b.sidebarBlur
    && a.chatOpacity === b.chatOpacity && a.chatBlur === b.chatBlur
    && a.inputOpacity === b.inputOpacity && a.inputBlur === b.inputBlur
    && a.panelOpacity === b.panelOpacity && a.panelBlur === b.panelBlur
    && a.tintColor === b.tintColor && a.accentColor === b.accentColor
    && a.radius === b.radius && a.borderWidth === b.borderWidth
    && a.borderColor === b.borderColor && a.shadowStrength === b.shadowStrength
    && a.scrimStrength === b.scrimStrength
}

function LoadedDesktop({ controller, useSnapshot, t }: {
  controller: WallpaperEngineController
  useSnapshot: SnapshotSelectorHook<WallpaperEngineState>
  t: (key: WallpaperKey) => string
}): ReactNode {
  const state = useSnapshot((s: WallpaperEngineState) => s)
  const cs = state.customStyle
  const activePreset = PRESETS.findIndex((p) => stylesEqual(p.style, cs))

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
        {PRESETS.map((preset, i) => (
          <button
            key={preset.key}
            className={clsx(css.presetBtn, i === activePreset && css.presetBtnActive)}
            type="button"
            onClick={() => { controller.store.actions.setCustomStyle(preset.style) }}
          >{t(preset.key)}</button>
        ))}
      </div>

      <div className={css.controls}>
        <SliderRow label={t('mainOpacity')} value={cs.mainOpacity} min={0.05} max={1} step={0.05} onChange={(v) => { set({ mainOpacity: v }) }} />
        <SliderRow label={t('mainBlur')} value={cs.mainBlur} min={0} max={40} step={1} onChange={(v) => { set({ mainBlur: v }) }} />
        <SliderRow label={t('sidebarOpacity')} value={cs.sidebarOpacity} min={0.05} max={1} step={0.05} onChange={(v) => { set({ sidebarOpacity: v }) }} />
        <SliderRow label={t('sidebarBlur')} value={cs.sidebarBlur} min={0} max={40} step={1} onChange={(v) => { set({ sidebarBlur: v }) }} />
        <SliderRow label={t('chatOpacity')} value={cs.chatOpacity} min={0.05} max={1} step={0.05} onChange={(v) => { set({ chatOpacity: v }) }} />
        <SliderRow label={t('chatBlur')} value={cs.chatBlur} min={0} max={40} step={1} onChange={(v) => { set({ chatBlur: v }) }} />
        <SliderRow label={t('inputOpacity')} value={cs.inputOpacity} min={0.05} max={1} step={0.05} onChange={(v) => { set({ inputOpacity: v }) }} />
        <SliderRow label={t('inputBlur')} value={cs.inputBlur} min={0} max={40} step={1} onChange={(v) => { set({ inputBlur: v }) }} />
        <SliderRow label={t('panelOpacity')} value={cs.panelOpacity} min={0.05} max={1} step={0.05} onChange={(v) => { set({ panelOpacity: v }) }} />
        <SliderRow label={t('panelBlur')} value={cs.panelBlur} min={0} max={40} step={1} onChange={(v) => { set({ panelBlur: v }) }} />
        <ColorRow label={t('tintColor')} value={cs.tintColor} onChange={(v) => { set({ tintColor: v }) }} />
        <ColorRow label={t('accentColor')} value={cs.accentColor} onChange={(v) => { set({ accentColor: v }) }} />
        <SliderRow label={t('radius')} value={cs.radius} min={0} max={24} step={1} onChange={(v) => { set({ radius: v }) }} />
        <SliderRow label={t('borderWidth')} value={cs.borderWidth} min={0} max={4} step={1} onChange={(v) => { set({ borderWidth: v }) }} />
        <ColorRow label={t('borderColor')} value={cs.borderColor} onChange={(v) => { set({ borderColor: v }) }} />
        <SliderRow label={t('shadowStrength')} value={cs.shadowStrength} min={0} max={1} step={0.05} onChange={(v) => { set({ shadowStrength: v }) }} />
        <SliderRow label={t('scrimStrength')} value={cs.scrimStrength} min={0} max={1} step={0.05} onChange={(v) => { set({ scrimStrength: v }) }} />
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
      <span className={css.controlLabel}>{label}</span>
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
      <span className={css.controlLabel}>{label}</span>
      <input
        type="text"
        className={css.colorInput}
        value={current}
        placeholder="rgba(255,255,255,0.15)"
        onChange={(e) => { setCurrent(e.target.value) }}
        onBlur={() => { onChange(current) }}
      />
    </label>
  )
}