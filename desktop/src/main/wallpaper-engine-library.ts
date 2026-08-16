/**
 * Wallpaper Engine local-library discovery and indexing for the DSH desktop
 * shell. Design is informed by Mineradio's GPL-3.0 wallpaper-engine-library.js
 * (reference design only; this is an independent implementation for DSH and
 * only indexes `project.json` metadata — it never executes Web/Application
 * projects and never reads files outside a project root).
 *
 * @module apps/desktop/src/main/wallpaper-engine-library
 */

import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, readFileSync, type Stats } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { dshHomePath } from './home-paths.ts'

/** Wallpaper Engine Steam app id used for workshop/library containers. */
export const WALLPAPER_ENGINE_APP_ID = '431960'

/** Custom protocol scheme the shell installs for project media/preview files. */
export const WALLPAPER_ENGINE_SCHEME = 'dsh-wallpaper'

/** Persisted manual roots and project files. */
export const WALLPAPER_ENGINE_LIBRARY_CONFIG = 'wallpaper-engine-library.json'

/** Hard ceiling for one project.json read. */
export const MAX_PROJECT_JSON_BYTES = 1024 * 1024

/** Hard ceiling for manual-scan directory entries visited in one run. */
export const MAX_MANUAL_SCAN_ENTRIES = 4000

/** Hard ceilings for persisted manual imports. */
export const MAX_MANUAL_ROOTS = 32
export const MAX_MANUAL_PROJECT_FILES = 64

/** Scene package extensions and their PKGV header signature. */
export const SCENE_PACKAGE_EXTENSIONS = new Set(['.pkg', '.pak'])
const SCENE_PACKAGE_SIGNATURE = /^PKGV\d{4}$/

/** Media extensions the shell is allowed to serve. */
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.m4v', '.mov'])
export const SAFE_MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS])

const IMAGE_MIME = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])
const VIDEO_MIME = new Map([
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'],
])
const SAFE_MIME = new Map([...IMAGE_MIME, ...VIDEO_MIME])

/** Directory names that never participate in a manual scan. */
const SKIPPED_DIRECTORY_NAMES = new Set(['node_modules', 'cache', 'temp', 'tmp'])

/** project.json property guardrails. */
const MAX_SCENE_PROPERTIES = 256
const MAX_PROPERTY_OPTIONS = 64
const BLOCKED_PROPERTY_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/** Audio-related property keys recognized for the default-mute policy. */
const AUDIO_PROPERTY_KEY = new RegExp(
  '^(?:volume|dbvolume|musicvolume|music_volume|audiovolume|audio_volume|soundvolume|'
  + 'sound_volume|bgmvolume|bgm_volume|muteaudio|audiomute|mutemusic|musicmute|audioenable|'
  + 'audioenabled|musicenable|musicenabled|soundenable|soundenabled|bgmenable|bgmenabled|music|audio|sound|bgm)$',
  'i',
)

/** A small, independent audio-property heuristic: keys/labels mentioning sound. */
const AUDIO_HINT = /(?:volume|mute|muted|silent|audio|music|sound|bgm|音量|静音|无声|音乐|声音|音效)/i

/** An option label that means "no sound" for combo audio properties. */
const AUDIO_OFF_HINT = /(?:none|off|mute|muted|silent|disabled?|关闭|静音|无声|不要音乐|无音)/i

/** Audio enable-toggle keys that mute by being set to false. */
const AUDIO_ENABLE_HINT = new RegExp(
  '^(?:audioenable|audioenabled|musicenable|musicenabled|soundenable|soundenabled|bgmenable|bgmenabled)$',
  'i',
)

/** A label that names a visualizer/equalizer control, not the audible track. */
const AUDIO_VISUAL_HINT = new RegExp(
  '(?:visuali[sz](?:er|ation)|\\bbars?\\b|\\bring\\b|\\bpulse\\b|\\bthreshold\\b|'
  + '\\bsensitiv(?:e|ity)\\b|\\bintensity\\b|\\bcolou?r\\b|\\bopacity\\b|\\btransparen(?:cy|t)\\b|'
  + '\\bbounce\\b|\\bflicker\\b|\\balbum\\b|\\binformation\\b|\\bresponse\\b|\\breactive\\b|'
  + '\\bfrequency\\b|\\bspectrum\\b|\\bwave\\b|\\bnote\\b|可视|频谱|跳动|闪烁|响应|颜色|透明|专辑|封面|信息)',
  'i',
)

/** Base dirs tried on Windows when neither the registry nor library VDF yields Steam. */
const FALLBACK_STEAM_ROOTS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'D:\\SteamLibrary',
  'E:\\Steam',
  'E:\\SteamLibrary',
  'F:\\Steam',
  'F:\\SteamLibrary',
]

/** Shape of one indexed project as sent to the renderer. */
export interface WallpaperProjectItem {
  id: string
  title: string
  projectType: string
  mediaType: 'video' | 'image' | ''
  mediaAnimated: boolean
  playable: boolean
  enginePlayable: boolean
  previewOnly: boolean
  hasPreview: boolean
  previewAnimated: boolean
  source: 'workshop' | 'local' | 'imported'
  sourceLabel: string
  workshopId: string
  propertyCount: number
  audioPropertyCount: number
  mutedAudioPropertyCount: number
  updatedAt: number
  safetyMode: 'direct-media' | 'native-engine' | 'preview-only'
}

/** Internal record for resolving an id back to files on disk. */
interface WallpaperProjectRecord {
  id: string
  projectRoot: string
  projectFile: string
  media: string
  preview: string
  scenePackage: string
  workshopId: string
}

interface IndexedProject {
  item: WallpaperProjectItem
  record: WallpaperProjectRecord
}

interface LibrarySnapshot {
  ok: true
  projects: WallpaperProjectItem[]
  count: number
  dynamicCount: number
  enginePlayableCount: number
  previewOnlyCount: number
  sourceCount: number
  manualRoots: Array<{ id: string; name: string }>
  scannedAt: number
  elapsedMs: number
  mediaToken: string
}

interface LibraryConfig {
  version: 2
  manualRoots: string[]
  manualProjectFiles: string[]
}

interface DiscoveredSource {
  root: string
  kind: 'workshop' | 'local' | 'imported'
  label: string
  direct: boolean
}

interface ScenePropertyOption {
  label: string
  value: string | number | boolean
}

/** A normalized scene-property descriptor shared with the renderer. */
export interface ScenePropertyDescriptor {
  key: string
  label: string
  type: string
  value: string | number | boolean | null
  audio: boolean
  autoMuted: boolean
  min?: number
  max?: number
  step?: number
  options?: ScenePropertyOption[]
  muteValue?: string | number | boolean
}

/** Result of scanning a scene project's general.properties. */
export interface ScenePropertyAnalysis {
  properties: ScenePropertyDescriptor[]
  muteProperties: Record<string, string | number | boolean>
  propertyCount: number
  audioPropertyCount: number
  mutedAudioPropertyCount: number
}

interface SceneTarget {
  id: string
  projectFile: string
  scenePackage: string
  muteProperties: Record<string, string | number | boolean>
  propertyCount: number
  audioPropertyCount: number
  mutedAudioPropertyCount: number
}

/** Range parsed from a `Range: bytes=...` header, or null when absent. */
export interface ByteRange {
  start: number
  end: number
}

/** Result of {@link parseByteRange}: `'absent'` | `'invalid'` | a range. */
export type ParsedByteRange = { kind: 'absent' } | { kind: 'invalid' } | ({ kind: 'range' } & ByteRange)

/** Resolve a possibly quoted/loose absolute path. */
export function normalizeAbsolutePath(value: unknown): string {
  const raw = rawText(value).trim().replace(/^"|"$/g, '')
  if (!raw) return ''
  try {
    return resolve(raw)
  } catch {
    return ''
  }
}

/** Canonical, case-folded identity key for a path on Windows. */
export function pathKey(value: string): string {
  return normalizeAbsolutePath(value).replace(/[\\/]+$/, '').toLowerCase()
}

/** Opaque project id: sha256 of the case-folded absolute path, first 24 hex chars. */
export function opaqueId(value: string): string {
  return createHash('sha256').update(pathKey(value)).digest('hex').slice(0, 24)
}

/** Read a value as text, or a fallback when it is not a string. */
function rawText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** Collapse control chars/whitespace and bound the length of user-facing text. */
export function sanitizeText(value: unknown, fallback: string): string {
  const text = rawText(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  return text || fallback
}

/** Strip HTML-ish fragments and zero-width/control marks from property labels. */
function sanitizePropertyLabel(value: unknown, fallback: string): string {
  return sanitizeText(rawText(value)
    .replace(/<[^>]{0,512}>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, ' '), fallback)
}

/** True when `target` stays at or under `root` without leaving it. */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolutePath(rel))
}

function isAbsolutePath(value: string): boolean {
  return isAbsolute(value)
}

/** Normalize one scene property value to a JSON-safe scalar or null. */
function normalizePropertyValue(value: unknown, maximumLength = 512): string | number | boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximumLength)
  return null
}

/**
 * Scan a scene project's `general.properties` for audio controls and decide
 * the default-silent values the shell applies before the first frame is
 * captured. The policy is intentionally conservative: only controls whose
 * key or label clearly names audio are muted, and visualizer/equalizer keys
 * are excluded so the scene's look does not change.
 */
export function analyzeSceneProperties(project: unknown): ScenePropertyAnalysis {
  const descriptors: ScenePropertyDescriptor[] = []
  const muteProperties: Record<string, string | number | boolean> = { volume: 0 }
  let audioPropertyCount = 0
  let mutedAudioPropertyCount = 0

  const properties = readGeneralProperties(project)
  if (properties === null) {
    return {
      properties: descriptors,
      muteProperties: { ...muteProperties },
      propertyCount: 0,
      audioPropertyCount: 0,
      mutedAudioPropertyCount: 0,
    }
  }

  for (const [rawKey, rawProperty] of Object.entries(properties)) {
    if (descriptors.length >= MAX_SCENE_PROPERTIES) break
    const key = rawText(rawKey).trim()
    const property = rawProperty !== null && typeof rawProperty === 'object' && !Array.isArray(rawProperty)
      ? rawProperty as Record<string, unknown>
      : null
    if (property === null) continue
    if (!/^[a-z0-9_.-]{1,128}$/i.test(key) || BLOCKED_PROPERTY_KEYS.has(key.toLowerCase())) continue

    const type = rawText(property.type).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'unknown'
    const label = sanitizePropertyLabel(property.text, key)
    const normalizedKey = key.replace(/[_.-]/g, '').toLowerCase()
    const hint = `${key} ${label}`
    const exactAudioKey = AUDIO_PROPERTY_KEY.test(key)
    const explicitAudio = AUDIO_HINT.test(hint)
    const visualOnly = AUDIO_VISUAL_HINT.test(hint) && !exactAudioKey
    const audioProperty = !visualOnly && (exactAudioKey || explicitAudio)

    const options: ScenePropertyOption[] = Array.isArray(property.options)
      ? property.options.slice(0, MAX_PROPERTY_OPTIONS).map((option, index) => {
        const source = option !== null && typeof option === 'object' && !Array.isArray(option)
          ? option as Record<string, unknown>
          : {}
        return {
          label: sanitizePropertyLabel(source.label, `选项 ${index + 1}`),
          value: normalizePropertyValue(source.value, 256),
        }
      }).filter((option): option is ScenePropertyOption => option.value !== null)
      : []

    const descriptor: ScenePropertyDescriptor = {
      key,
      label,
      type,
      value: normalizePropertyValue(property.value),
      audio: audioProperty,
      autoMuted: false,
    }
    const minimum = Number(property.min)
    const maximum = Number(property.max)
    const step = Number(property.step)
    if (Number.isFinite(minimum)) descriptor.min = minimum
    if (Number.isFinite(maximum)) descriptor.max = maximum
    if (Number.isFinite(step) && step > 0) descriptor.step = step
    if (options.length > 0) descriptor.options = options

    if (audioProperty) {
      audioPropertyCount += 1
      const muteValue = decideMuteValue(type, property.value, normalizedKey, hint, minimum, maximum, options)
      if (muteValue !== undefined) {
        muteProperties[key] = muteValue
        descriptor.autoMuted = true
        descriptor.muteValue = muteValue
        mutedAudioPropertyCount += 1
      }
    }
    descriptors.push(descriptor)
  }

  return {
    properties: descriptors,
    muteProperties: { ...muteProperties },
    propertyCount: descriptors.length,
    audioPropertyCount,
    mutedAudioPropertyCount,
  }
}

function readGeneralProperties(project: unknown): Record<string, unknown> | null {
  if (project === null || typeof project !== 'object' || Array.isArray(project)) return null
  const general = (project as Record<string, unknown>).general
  if (general === null || typeof general !== 'object' || Array.isArray(general)) return null
  const properties = (general as Record<string, unknown>).properties
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) return null
  return properties as Record<string, unknown>
}

/** Decide the silent value for one recognized audio property, or undefined. */
function decideMuteValue(
  type: string,
  rawValue: unknown,
  normalizedKey: string,
  hint: string,
  minimum: number,
  maximum: number,
  options: ScenePropertyOption[],
): string | number | boolean | undefined {
  const isMuteKey = /^(?:muteaudio|audiomute|mutemusic|musicmute)$/.test(normalizedKey)
  const isDecibelKey = normalizedKey === 'dbvolume'
  if (type === 'bool' || typeof rawValue === 'boolean') {
    // Boolean audio toggles: mute keys mean "muted", enable keys mean "off".
    if (isMuteKey) return true
    if (AUDIO_ENABLE_HINT.test(normalizedKey)) return false
    return hint.includes('静音') || hint.includes('mute') || hint.includes('silent') ? true : false
  }
  if (type === 'slider' || typeof rawValue === 'number') {
    if (isDecibelKey || (Number.isFinite(minimum) && minimum < 0 && Number.isFinite(maximum) && maximum <= 0)) {
      return Number.isFinite(minimum) ? minimum : -60
    }
    if ((!Number.isFinite(minimum) || minimum <= 0) && (!Number.isFinite(maximum) || maximum >= 0)) return 0
    if (Number.isFinite(minimum)) return minimum
    return 0
  }
  if (type === 'combo' && options.length > 0) {
    const offOption = options.find(option => AUDIO_OFF_HINT.test(option.label))
      ?? options.find(option => String(option.value) === '0')
    if (offOption !== undefined) return offOption.value
    return undefined
  }
  return undefined
}

/** Extract a Steam workshop id from project fields, then the directory name. */
export function deriveWorkshopId(project: unknown, projectRoot: string, sourceKind: string): string {
  if (project !== null && typeof project === 'object' && !Array.isArray(project)) {
    const record = project as Record<string, unknown>
    const directCandidates = [record.workshopid, record.workshopId, record.publishedfileid, record.publishedFileId]
    for (const candidate of directCandidates) {
      const value = rawText(candidate).trim()
      if (/^\d{5,32}$/.test(value)) return value
    }
    const urlCandidates = [record.workshopurl, record.workshopUrl, record.url]
    for (const candidate of urlCandidates) {
      const match = /(?:[?&]id=|\/filedetails\/?)(\d{5,32})/i.exec(rawText(candidate))
      if (match?.[1] !== undefined) return match[1]
    }
  }
  const directoryId = basename(projectRoot)
  return sourceKind === 'workshop' && /^\d{5,32}$/.test(directoryId) ? directoryId : ''
}

async function statSafe(target: string): Promise<Stats | null> {
  try {
    return await stat(target)
  } catch {
    return null
  }
}

async function isDirectory(target: string): Promise<boolean> {
  const found = await statSafe(target)
  return found !== null && found.isDirectory()
}

/**
 * Resolve one project-relative media reference to a real file that stays
 * inside the real project root and carries an allowed extension.
 */
export async function resolveProjectFile(
  projectRoot: string,
  value: unknown,
  allowedExtensions: Set<string>,
): Promise<string> {
  const raw = rawText(value).trim().replace(/\//g, sep)
  if (raw.length === 0 || raw.includes('\0') || raw.includes(':') || isAbsolutePath(raw)) return ''
  const lexicalRoot = resolve(projectRoot)
  const lexicalTarget = resolve(lexicalRoot, raw)
  if (!isInside(lexicalRoot, lexicalTarget)) return ''
  if (!allowedExtensions.has(extname(lexicalTarget).toLowerCase())) return ''
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(lexicalRoot), realpath(lexicalTarget)])
    if (!isInside(realRoot, realTarget)) return ''
    const found = await statSafe(realTarget)
    return found !== null && found.isFile() ? realTarget : ''
  } catch {
    return ''
  }
}

/** First resolvable file among `values`, or an empty string. */
async function firstProjectFile(
  projectRoot: string,
  values: unknown[],
  allowedExtensions: Set<string>,
): Promise<string> {
  for (const value of values) {
    if (value === undefined || value === null || rawText(value).trim() === '') continue
    const target = await resolveProjectFile(projectRoot, value, allowedExtensions)
    if (target) return target
  }
  return ''
}

/** Validate a scene package header (`PKGV` + 4 digits at offset 0 or 4). */
export async function validateScenePackage(file: string): Promise<string> {
  if (!file || !SCENE_PACKAGE_EXTENSIONS.has(extname(file).toLowerCase())) return ''
  try {
    const handle = await import('node:fs/promises').then(({ open }) => open(file, 'r'))
    try {
      const header = Buffer.alloc(12)
      const result = await handle.read(header, 0, header.length, 0)
      if (result.bytesRead !== header.length) return ''
      const atStart = header.subarray(0, 8).toString('ascii')
      const afterLength = header.subarray(4, 12).toString('ascii')
      return SCENE_PACKAGE_SIGNATURE.test(atStart) || SCENE_PACKAGE_SIGNATURE.test(afterLength) ? file : ''
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

async function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 2500, maxBuffer: 256 * 1024 }, (error, stdout) => {
      resolvePromise(error !== null ? '' : stdout || '')
    })
  })
}

/** Query Steam install roots from the Windows registry. */
export async function windowsSteamRegistryRoots(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const queries: Array<[string, string]> = [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKCU\\Software\\Valve\\Steam', 'SteamExe'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
  ]
  const roots = new Set<string>()
  for (const [key, value] of queries) {
    const output = await execFileText('reg.exe', ['query', key, '/v', value])
    const match = new RegExp(`${value}\\s+REG_\\w+\\s+(.+)$`, 'mi').exec(output)
    if (match?.[1] === undefined) continue
    let found = normalizeAbsolutePath(match[1].replace(/\//g, sep))
    if (/steam\.exe$/i.test(found)) found = dirname(found)
    if (found) roots.add(found)
  }
  return [...roots]
}

/** Read one Steam root plus every `"path"` entry in its libraryfolders.vdf. */
export async function readSteamLibraryFolders(steamRoot: string): Promise<string[]> {
  const roots = new Set<string>([normalizeAbsolutePath(steamRoot)].filter(Boolean))
  const files = [
    join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
    join(steamRoot, 'config', 'libraryfolders.vdf'),
  ]
  for (const file of files) {
    try {
      const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '')
      for (const match of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
        const found = normalizeAbsolutePath((match[1] ?? '').replace(/\\\\/g, '\\'))
        if (found) roots.add(found)
      }
    } catch {
      // Missing or unreadable VDF is not an error; the steam root still counts.
    }
  }
  return [...roots]
}

/** Discover all Steam library roots: registry, environment, and known paths. */
export async function discoverSteamLibraries(): Promise<string[]> {
  const candidates = new Set<string>([
    ...FALLBACK_STEAM_ROOTS,
    ...(process.env.ProgramFiles !== undefined ? [join(process.env.ProgramFiles, 'Steam')] : []),
    ...(process.env['ProgramFiles(x86)'] !== undefined ? [join(process.env['ProgramFiles(x86)'], 'Steam')] : []),
    ...(process.env.ProgramW6432 !== undefined ? [join(process.env.ProgramW6432, 'Steam')] : []),
  ].map(value => normalizeAbsolutePath(value)).filter(Boolean))
  for (const root of await windowsSteamRegistryRoots()) candidates.add(root)

  const libraries = new Set<string>()
  for (const candidate of candidates) {
    if (!(await isDirectory(candidate))) continue
    for (const library of await readSteamLibraryFolders(candidate)) {
      if (await isDirectory(library)) libraries.add(normalizeAbsolutePath(library))
    }
  }
  return [...libraries]
}

/** Known Wallpaper Engine containers inside one Steam library. */
export function knownWallpaperContainers(steamLibrary: string): string[] {
  return [
    join(steamLibrary, 'steamapps', 'workshop', 'content', WALLPAPER_ENGINE_APP_ID),
    join(steamLibrary, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'myprojects'),
  ]
}

/** Direct child project directories of a container (project.json one level down). */
async function directProjectDirectories(container: string): Promise<string[]> {
  const output: string[] = []
  let entries
  try {
    entries = await readdir(container, { withFileTypes: true })
  } catch {
    return output
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const projectRoot = join(container, entry.name)
    const found = await statSafe(join(projectRoot, 'project.json'))
    if (found !== null && found.isFile()) output.push(projectRoot)
  }
  return output
}

/**
 * Find project directories under a manually chosen root. A root that is
 * itself a project wins; known WE containers are scanned directly; otherwise
 * a bounded BFS walks at most two directory levels below the root.
 */
export async function manualProjectDirectories(root: string): Promise<string[]> {
  const normalized = normalizeAbsolutePath(root)
  if (!normalized || !(await isDirectory(normalized))) return []

  const rootProject = await statSafe(join(normalized, 'project.json'))
  if (rootProject !== null && rootProject.isFile()) return [normalized]

  const known = new Set<string>()
  for (const container of knownWallpaperContainers(normalized)) {
    if (!(await isDirectory(container))) continue
    for (const projectRoot of await directProjectDirectories(container)) known.add(projectRoot)
  }
  if (known.size > 0) return [...known]

  const output: string[] = []
  const seen = new Set<string>()
  const queue: Array<{ dir: string; depth: number }> = [{ dir: normalized, depth: 0 }]
  let visitedEntries = 0
  while (queue.length > 0 && visitedEntries < MAX_MANUAL_SCAN_ENTRIES) {
    const current = queue.shift()
    if (current === undefined) break
    let entries
    try {
      entries = await readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (visitedEntries >= MAX_MANUAL_SCAN_ENTRIES) break
      visitedEntries += 1
      const entryDepth = current.depth + 1
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || SKIPPED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) continue
      const child = join(current.dir, entry.name)
      const key = pathKey(child)
      if (seen.has(key)) continue
      seen.add(key)
      const projectFile = await statSafe(join(child, 'project.json'))
      if (projectFile !== null && projectFile.isFile()) {
        output.push(child)
      } else if (entryDepth < 2) {
        queue.push({ dir: child, depth: entryDepth })
      }
    }
  }
  return output
}

/** Read and validate a project.json: size cap, BOM, realpath inside its root. */
async function readProjectManifest(projectRoot: string): Promise<{ value: Record<string, unknown>; file: string; mtimeMs: number } | null> {
  const file = join(projectRoot, 'project.json')
  const found = await statSafe(file)
  if (found === null || !found.isFile() || found.size <= 0 || found.size > MAX_PROJECT_JSON_BYTES) return null
  try {
    const [rawText, realRoot, realFile] = await Promise.all([
      readFile(file, 'utf8'),
      realpath(projectRoot),
      realpath(file),
    ])
    if (!isInside(realRoot, realFile)) return null
    const value: unknown = JSON.parse(rawText.replace(/^\uFEFF/, ''))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    return { value: value as Record<string, unknown>, file: realFile, mtimeMs: Math.round(found.mtimeMs) || 0 }
  } catch {
    return null
  }
}

/** Build one indexed project from a project root plus its source. */
async function indexProject(projectRoot: string, source: DiscoveredSource, scenePackageOverride = ''): Promise<IndexedProject | null> {
  const manifest = await readProjectManifest(projectRoot)
  if (manifest === null) return null
  const project = manifest.value
  const projectType = rawText(project.type).trim().toLowerCase()
  const directExt = extname(rawText(project.file)).toLowerCase()
  const inferredMedia = VIDEO_EXTENSIONS.has(directExt) ? 'video' : (IMAGE_EXTENSIONS.has(directExt) ? 'image' : '')
  const allowDirectMedia = projectType === 'video' || projectType === 'image' || (projectType === '' && inferredMedia !== '')
  const media = allowDirectMedia
    ? await firstProjectFile(projectRoot, [project.file], SAFE_MEDIA_EXTENSIONS)
    : ''
  const overrideRelative = scenePackageOverride !== '' ? relative(projectRoot, scenePackageOverride) : ''
  const scenePackageCandidate = projectType === 'scene'
    ? await firstProjectFile(projectRoot, [
      overrideRelative,
      SCENE_PACKAGE_EXTENSIONS.has(directExt) ? project.file : '',
      'scene.pkg',
      'scene.pak',
    ], SCENE_PACKAGE_EXTENSIONS)
    : ''
  const scenePackage = await validateScenePackage(scenePackageCandidate)
  const preview = await firstProjectFile(projectRoot, [
    project.preview,
    project.cover,
    project.poster,
    'preview.jpg',
    'preview.jpeg',
    'preview.png',
    'preview.webp',
    'preview.gif',
    'cover.jpg',
    'cover.png',
    'cover.webp',
    'cover.gif',
  ], IMAGE_EXTENSIONS)
  if (media === '' && preview === '' && scenePackage === '') return null

  const id = opaqueId(projectRoot)
  const mediaExt = extname(media).toLowerCase()
  const previewExt = extname(preview).toLowerCase()
  const mediaType: 'video' | 'image' | '' = VIDEO_EXTENSIONS.has(mediaExt) ? 'video' : (IMAGE_EXTENSIONS.has(mediaExt) ? 'image' : '')
  const enginePlayable = scenePackage !== ''
  const analysis = projectType === 'scene' ? analyzeSceneProperties(project) : null
  const workshopId = deriveWorkshopId(project, projectRoot, source.kind)

  return {
    item: {
      id,
      title: sanitizeText(project.title, basename(projectRoot)),
      projectType: projectType || mediaType || 'unknown',
      mediaType,
      mediaAnimated: mediaExt === '.gif',
      playable: media !== '',
      enginePlayable,
      previewOnly: media === '' && !enginePlayable,
      hasPreview: preview !== '',
      previewAnimated: previewExt === '.gif',
      source: source.kind,
      sourceLabel: source.label,
      workshopId,
      propertyCount: analysis?.propertyCount ?? 0,
      audioPropertyCount: analysis?.audioPropertyCount ?? 0,
      mutedAudioPropertyCount: analysis?.mutedAudioPropertyCount ?? 0,
      updatedAt: manifest.mtimeMs,
      safetyMode: media !== '' ? 'direct-media' : (enginePlayable ? 'native-engine' : 'preview-only'),
    },
    record: {
      id,
      projectRoot: await realpath(projectRoot),
      projectFile: manifest.file,
      media,
      preview,
      scenePackage,
      workshopId,
    },
  }
}

/** Parse an HTTP `Range` header value against a file size. */
export function parseByteRange(headerValue: string | null | undefined, size: number): ParsedByteRange {
  if (headerValue === null || headerValue === undefined) return { kind: 'absent' }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(headerValue.trim())
  if (match === null) return { kind: 'absent' }
  if (match[1] === '' && match[2] === '') return { kind: 'invalid' }
  let start: number
  let end: number
  if (match[1] === '' && match[2] !== '') {
    const suffix = Math.max(0, Number(match[2]) || 0)
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Math.max(0, Number(match[1]) || 0)
    end = match[2] !== '' ? Math.min(size - 1, Number(match[2])) : size - 1
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return { kind: 'invalid' }
  return { kind: 'range', start, end }
}

export function mimeForPath(file: string): string {
  return SAFE_MIME.get(extname(file).toLowerCase()) ?? 'application/octet-stream'
}

interface MediaRequestLike {
  method?: string
  url: string
  headers?: { get(name: string): string | null }
}

interface MediaHeaders {
  [key: string]: string
}

function mediaResponse(status: number, headers: MediaHeaders, body?: ReadableStream | null): Response {
  return new Response(body ?? null, { status, headers })
}

/**
 * Wallpaper Engine library: discovery, indexing, persistence, and the media
 * protocol handler. It is deliberately Electron-free except for the
 * `installProtocol` seam, so the scanning logic runs in plain Node tests.
 */
export class WallpaperEngineLibrary {
  readonly configPath: string
  private readonly autoDiscover: boolean
  private manualRoots: string[]
  private manualProjectFiles: string[]
  private index = new Map<string, WallpaperProjectRecord>()
  private snapshot: LibrarySnapshot | null = null
  private scanPromise: Promise<LibrarySnapshot> | null = null
  private queuedForceScan: Promise<LibrarySnapshot> | null = null
  private generation = 0
  private disposed = false
  private mediaToken = randomBytes(24).toString('hex')
  private protocolInstalled = false

  /** @param options - config path override and auto-discover toggle for tests. */
  constructor(options: { configPath?: string; autoDiscover?: boolean } = {}) {
    this.configPath = options.configPath ?? dshHomePath(WALLPAPER_ENGINE_LIBRARY_CONFIG)
    this.autoDiscover = options.autoDiscover !== false
    const config = this.readConfig()
    this.manualRoots = config.manualRoots
    this.manualProjectFiles = config.manualProjectFiles
  }

  /** Read the persisted manual roots/files, with bounds and dedupe. */
  readConfig(): LibraryConfig {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.configPath, 'utf8'))
      const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {}
      const manualRoots = Array.isArray(record.manualRoots)
        ? record.manualRoots.map(value => normalizeAbsolutePath(value)).filter(Boolean).slice(0, MAX_MANUAL_ROOTS)
        : []
      const manualProjectFiles = Array.isArray(record.manualProjectFiles)
        ? record.manualProjectFiles.map(value => normalizeAbsolutePath(value)).filter(Boolean).slice(0, MAX_MANUAL_PROJECT_FILES)
        : []
      return { version: 2, manualRoots: [...new Set(manualRoots)], manualProjectFiles: [...new Set(manualProjectFiles)] }
    } catch {
      return { version: 2, manualRoots: [], manualProjectFiles: [] }
    }
  }

  async saveConfig(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })
    const temporary = `${this.configPath}.tmp`
    await writeFile(temporary, JSON.stringify({
      version: 2,
      manualRoots: this.manualRoots,
      manualProjectFiles: this.manualProjectFiles,
    }, null, 2), 'utf8')
    try {
      await rename(temporary, this.configPath)
    } catch {
      // Windows rename can fail when a reader holds the file open briefly.
      await writeFile(this.configPath, await readFile(temporary, 'utf8'), 'utf8')
    }
  }

  manualRootSummary(): Array<{ id: string; name: string }> {
    return this.manualRoots.map(root => ({
      id: opaqueId(root),
      name: basename(root) || parse(root).root || '导入目录',
    }))
  }

  /** Add a directory root, rescan, and return the new snapshot. */
  async addManualRoot(root: string): Promise<LibrarySnapshot> {
    const normalized = normalizeAbsolutePath(root)
    if (!normalized || !(await isDirectory(normalized))) throw new Error('所选目录不存在')
    const projects = await manualProjectDirectories(normalized)
    if (projects.length === 0) throw new Error('所选目录中没有识别到 project.json')
    if (!this.manualRoots.some(value => pathKey(value) === pathKey(normalized))) {
      this.manualRoots = [...this.manualRoots, normalized].slice(-MAX_MANUAL_ROOTS)
      await this.saveConfig()
    }
    return this.list({ force: true })
  }

  /** Add one project.json (as its directory) or a scene package file. */
  async addManualProjectFile(file: string): Promise<LibrarySnapshot> {
    const normalized = normalizeAbsolutePath(file)
    const found = await statSafe(normalized)
    if (found === null || !found.isFile()) throw new Error('所选项目文件不存在')
    if (basename(normalized).toLowerCase() === 'project.json') return this.addManualRoot(dirname(normalized))
    if (!SCENE_PACKAGE_EXTENSIONS.has(extname(normalized).toLowerCase())) {
      throw new Error('请选择 project.json 或 Wallpaper Engine 场景包（.pkg/.pak）')
    }
    const scenePackage = await validateScenePackage(normalized)
    if (scenePackage === '') throw new Error('所选文件不是有效的 Wallpaper Engine PKGV 场景包')
    const projectRoot = dirname(scenePackage)
    const manifest = await readProjectManifest(projectRoot)
    if (manifest === null || rawText(manifest.value.type).trim().toLowerCase() !== 'scene') {
      throw new Error('场景包同目录缺少有效的 Scene project.json')
    }
    if (!this.manualRoots.some(value => pathKey(value) === pathKey(projectRoot))) {
      this.manualRoots = [...this.manualRoots, projectRoot].slice(-MAX_MANUAL_ROOTS)
    }
    if (!this.manualProjectFiles.some(value => pathKey(value) === pathKey(scenePackage))) {
      this.manualProjectFiles = [...this.manualProjectFiles, scenePackage].slice(-MAX_MANUAL_PROJECT_FILES)
    }
    await this.saveConfig()
    return this.list({ force: true })
  }

  /** Remove a manual root and any scene-package files it owns. */
  async removeManualRoot(rootId: string): Promise<LibrarySnapshot> {
    const removed = this.manualRoots.filter(root => opaqueId(root) === rootId)
    const beforeRoots = this.manualRoots.length
    const beforeFiles = this.manualProjectFiles.length
    this.manualRoots = this.manualRoots.filter(root => !removed.includes(root))
    this.manualProjectFiles = this.manualProjectFiles.filter(file =>
      !removed.some(root => isInside(resolve(root), resolve(file))))
    if (this.manualRoots.length !== beforeRoots || this.manualProjectFiles.length !== beforeFiles) await this.saveConfig()
    return this.list({ force: true })
  }

  /** Compose the ordered source list for one scan. */
  async discoverSources(): Promise<DiscoveredSource[]> {
    const output: DiscoveredSource[] = []
    const seen = new Set<string>()
    if (this.autoDiscover) {
      for (const library of await discoverSteamLibraries()) {
        for (const container of knownWallpaperContainers(library)) {
          if (!(await isDirectory(container))) continue
          const key = pathKey(container)
          if (seen.has(key)) continue
          seen.add(key)
          output.push({
            root: container,
            kind: /workshop[\\/]content/i.test(container) ? 'workshop' : 'local',
            label: /workshop[\\/]content/i.test(container) ? 'Steam 创意工坊' : 'Wallpaper Engine 本地项目',
            direct: true,
          })
        }
      }
    }
    for (const root of this.manualRoots) {
      const key = pathKey(root)
      if (seen.has(key) || !(await isDirectory(root))) continue
      seen.add(key)
      output.push({ root, kind: 'imported', label: '手动导入', direct: false })
    }
    return output
  }

  /** Run one full scan and publish the snapshot. */
  async performScan(): Promise<LibrarySnapshot> {
    const startedAt = Date.now()
    const generation = ++this.generation
    const sources = await this.discoverSources()
    const manualPackageByRoot = new Map<string, string>()
    for (const file of this.manualProjectFiles) manualPackageByRoot.set(pathKey(dirname(file)), file)

    const projectSources = new Map<string, { projectRoot: string; source: DiscoveredSource }>()
    for (const source of sources) {
      const projects = source.direct
        ? await directProjectDirectories(source.root)
        : await manualProjectDirectories(source.root)
      for (const projectRoot of projects) {
        const key = pathKey(projectRoot)
        if (!projectSources.has(key)) projectSources.set(key, { projectRoot, source })
      }
    }

    const projects: WallpaperProjectItem[] = []
    const nextIndex = new Map<string, WallpaperProjectRecord>()
    for (const value of projectSources.values()) {
      if (this.disposed || generation !== this.generation) break
      let indexed: IndexedProject | null = null
      try {
        indexed = await indexProject(
          value.projectRoot,
          value.source,
          manualPackageByRoot.get(pathKey(value.projectRoot)) ?? '',
        )
      } catch {
        continue
      }
      if (indexed === null || nextIndex.has(indexed.item.id)) continue
      projects.push(indexed.item)
      nextIndex.set(indexed.item.id, indexed.record)
    }
    projects.sort((a, b) =>
      Number(b.playable) - Number(a.playable)
      || Number(b.enginePlayable) - Number(a.enginePlayable)
      || a.title.localeCompare(b.title, 'zh-CN'))

    if (!this.disposed && generation === this.generation) this.index = nextIndex
    const snapshot: LibrarySnapshot = {
      ok: true,
      projects,
      count: projects.length,
      dynamicCount: projects.filter(item => item.playable && item.mediaType === 'video').length,
      enginePlayableCount: projects.filter(item => item.enginePlayable).length,
      previewOnlyCount: projects.filter(item => item.previewOnly).length,
      sourceCount: sources.length,
      manualRoots: this.manualRootSummary(),
      scannedAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
      mediaToken: this.mediaToken,
    }
    if (!this.disposed && generation === this.generation) this.snapshot = snapshot
    return snapshot
  }

  /** List projects, using a 30s cache unless `force` is set. */
  async list(options: { force?: boolean } = {}): Promise<LibrarySnapshot> {
    if (this.disposed) throw new Error('WALLPAPER_ENGINE_LIBRARY_CLOSED')
    const force = options.force === true
    if (!force && this.snapshot !== null && Date.now() - this.snapshot.scannedAt < 30_000) return this.snapshot
    if (this.scanPromise !== null) {
      if (!force) return this.scanPromise
      if (this.queuedForceScan !== null) return this.queuedForceScan
      const active = this.scanPromise
      const queued = active.catch(() => null).then(() => this.performScan())
      const tracked = queued.finally(() => {
        if (this.scanPromise === tracked) this.scanPromise = null
        if (this.queuedForceScan === tracked) this.queuedForceScan = null
      })
      this.queuedForceScan = tracked
      this.scanPromise = tracked
      return tracked
    }
    const scan = this.performScan()
    const tracked = scan.finally(() => {
      if (this.scanPromise === tracked) this.scanPromise = null
    })
    this.scanPromise = tracked
    return tracked
  }

  /** Re-validate one record file against its real project root. */
  private async validatedRecordFile(record: WallpaperProjectRecord, kind: 'media' | 'preview'): Promise<string> {
    const target = kind === 'media' ? record.media : record.preview
    if (target === '') return ''
    try {
      const [realRoot, realTarget] = await Promise.all([realpath(record.projectRoot), realpath(target)])
      if (!isInside(realRoot, realTarget) || !SAFE_MEDIA_EXTENSIONS.has(extname(realTarget).toLowerCase())) return ''
      const found = await statSafe(realTarget)
      return found !== null && found.isFile() ? realTarget : ''
    } catch {
      return ''
    }
  }

  /** Resolve a native scene target (manifest + validated scene package). */
  async getNativeSceneTarget(id: string): Promise<SceneTarget> {
    const normalized = normalizeProjectId(id)
    if (this.snapshot === null && this.scanPromise === null) await this.list()
    const record = this.index.get(normalized)
    if (record === undefined || record.scenePackage === '') throw new Error('WALLPAPER_SCENE_NOT_FOUND')
    const target = await resolveProjectFile(record.projectRoot, relative(record.projectRoot, record.scenePackage), SCENE_PACKAGE_EXTENSIONS)
    const scenePackage = await validateScenePackage(target)
    if (scenePackage === '') throw new Error('WALLPAPER_SCENE_PACKAGE_INVALID')
    const manifest = await readProjectManifest(record.projectRoot)
    if (manifest === null || rawText(manifest.value.type).trim().toLowerCase() !== 'scene') {
      throw new Error('WALLPAPER_SCENE_MANIFEST_INVALID')
    }
    const analysis = analyzeSceneProperties(manifest.value)
    return {
      id: normalized,
      projectFile: manifest.file,
      scenePackage,
      muteProperties: analysis.muteProperties,
      propertyCount: analysis.propertyCount,
      audioPropertyCount: analysis.audioPropertyCount,
      mutedAudioPropertyCount: analysis.mutedAudioPropertyCount,
    }
  }

  /** Get one project's manifest-derived details for the renderer drawer. */
  async getProjectDetails(id: string): Promise<{
    ok: true
    id: string
    title: string
    projectType: string
    workshopId: string
    propertyCount: number
    audioPropertyCount: number
    mutedAudioPropertyCount: number
    properties: ScenePropertyDescriptor[]
  }> {
    const normalized = normalizeProjectId(id)
    if (this.snapshot === null && this.scanPromise === null) await this.list()
    const record = this.index.get(normalized)
    if (record === undefined) throw new Error('WALLPAPER_PROJECT_NOT_FOUND')
    const manifest = await readProjectManifest(record.projectRoot)
    if (manifest === null) throw new Error('WALLPAPER_PROJECT_MANIFEST_INVALID')
    const project = manifest.value
    const analysis = analyzeSceneProperties(project)
    return {
      ok: true,
      id: normalized,
      title: sanitizeText(project.title, basename(record.projectRoot)),
      projectType: rawText(project.type, 'unknown').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'unknown',
      workshopId: record.workshopId || deriveWorkshopId(project, record.projectRoot, ''),
      propertyCount: analysis.propertyCount,
      audioPropertyCount: analysis.audioPropertyCount,
      mutedAudioPropertyCount: analysis.mutedAudioPropertyCount,
      properties: analysis.properties,
    }
  }

  /** Serve one media/preview file with token + range + nosniff + containment. */
  async mediaResponse(request: MediaRequestLike): Promise<Response> {
    const method = (request.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      return mediaResponse(405, { Allow: 'GET, HEAD', 'X-Content-Type-Options': 'nosniff' })
    }
    if (this.snapshot === null && this.scanPromise === null) await this.list()
    let url: URL
    let id: string
    try {
      url = new URL(request.url)
      id = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    } catch {
      return mediaResponse(404, { 'X-Content-Type-Options': 'nosniff' })
    }
    const kind = url.hostname === 'media' ? 'media' : (url.hostname === 'preview' ? 'preview' : '')
    if (url.searchParams.get('token') !== this.mediaToken) {
      return mediaResponse(404, { 'X-Content-Type-Options': 'nosniff' })
    }
    const normalized = id.toLowerCase()
    if (!/^[a-f0-9]{24}$/.test(normalized) || kind === '') return mediaResponse(404, { 'X-Content-Type-Options': 'nosniff' })
    const record = this.index.get(normalized)
    if (record === undefined) return mediaResponse(404, { 'X-Content-Type-Options': 'nosniff' })
    const target = await this.validatedRecordFile(record, kind)
    if (target === '') return mediaResponse(404, { 'X-Content-Type-Options': 'nosniff' })
    const found = await statSafe(target)
    if (found === null || !found.isFile()) return mediaResponse(404, { 'X-Content-Type-Options': 'nosniff' })

    const size = Math.max(0, found.size)
    const rangeHeader = request.headers?.get('range') ?? null
    const parsed = parseByteRange(rangeHeader, size)
    if (parsed.kind === 'invalid') {
      return mediaResponse(416, { 'Content-Range': `bytes */${size}`, 'X-Content-Type-Options': 'nosniff' })
    }
    const start = parsed.kind === 'range' ? parsed.start : 0
    const end = parsed.kind === 'range' ? parsed.end : Math.max(0, size - 1)
    const headers: MediaHeaders = {
      'Content-Type': mimeForPath(target),
      'Content-Length': String(size > 0 ? end - start + 1 : 0),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    }
    if (parsed.kind === 'range') headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    if (method === 'HEAD' || size === 0) return mediaResponse(parsed.kind === 'range' ? 206 : 200, headers)
    const body = Readable.toWeb(createReadStream(target, { start, end })) as ReadableStream
    return mediaResponse(parsed.kind === 'range' ? 206 : 200, headers, body)
  }

  /** Install the custom protocol handler (Electron `protocol` object). */
  installProtocol(protocol: { handle(scheme: string, handler: (request: MediaRequestLike) => Promise<Response>): void }): void {
    if (this.protocolInstalled) return
    protocol.handle(WALLPAPER_ENGINE_SCHEME, request => this.mediaResponse(request))
    this.protocolInstalled = true
  }

  /** Invalidate caches and drop the token. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.index.clear()
    this.mediaToken = ''
    this.snapshot = null
  }
}

/** Validate and normalize a renderer-supplied project id. */
function normalizeProjectId(id: string): string {
  const normalized = rawText(id).toLowerCase()
  if (!/^[a-f0-9]{24}$/.test(normalized)) throw new Error('WALLPAPER_PROJECT_ID_INVALID')
  return normalized
}
