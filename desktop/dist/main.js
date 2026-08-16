import { execFile, spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { BrowserWindow, Menu, app, desktopCapturer, dialog, ipcMain, nativeTheme, protocol, screen, shell } from "electron";
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
//#region lib/types/src/main/home-paths.js
const DSH_HOME_DIR_NAME = ".dsh";
/**
* Join path segments onto the DeepSeek Harness home. The standalone desktop
* shell does not depend on the harness workspace, so it resolves the same
* default as dsh: $DSH_HOME or ~/.dsh.
* @param segments - path segments appended to the harness home.
* @returns the normalized absolute joined path.
*/
function dshHomePath(...segments) {
	const fromEnv = process.env.DSH_HOME;
	return join(fromEnv !== void 0 && fromEnv.trim() !== "" ? resolve(fromEnv) : join(homedir(), DSH_HOME_DIR_NAME), ...segments);
}
//#endregion
//#region lib/types/src/main/wallpaper-engine-library.js
/**
* Wallpaper Engine local-library discovery and indexing for the DSH desktop
* shell. Design is informed by Mineradio's GPL-3.0 wallpaper-engine-library.js
* (reference design only; this is an independent implementation for DSH and
* only indexes `project.json` metadata — it never executes Web/Application
* projects and never reads files outside a project root).
*
* @module apps/desktop/src/main/wallpaper-engine-library
*/
/** Wallpaper Engine Steam app id used for workshop/library containers. */
const WALLPAPER_ENGINE_APP_ID = "431960";
/** Custom protocol scheme the shell installs for project media/preview files. */
const WALLPAPER_ENGINE_SCHEME = "dsh-wallpaper";
/** Scene package extensions and their PKGV header signature. */
const SCENE_PACKAGE_EXTENSIONS = new Set([".pkg", ".pak"]);
const SCENE_PACKAGE_SIGNATURE = /^PKGV\d{4}$/;
/** Media extensions the shell is allowed to serve. */
const IMAGE_EXTENSIONS = new Set([
	".jpg",
	".jpeg",
	".png",
	".webp",
	".gif"
]);
const VIDEO_EXTENSIONS = new Set([
	".mp4",
	".webm",
	".m4v",
	".mov"
]);
const SAFE_MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);
const IMAGE_MIME = new Map([
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".png", "image/png"],
	[".webp", "image/webp"],
	[".gif", "image/gif"]
]);
const VIDEO_MIME = new Map([
	[".mp4", "video/mp4"],
	[".webm", "video/webm"],
	[".m4v", "video/mp4"],
	[".mov", "video/quicktime"]
]);
const SAFE_MIME = new Map([...IMAGE_MIME, ...VIDEO_MIME]);
/** Directory names that never participate in a manual scan. */
const SKIPPED_DIRECTORY_NAMES = new Set([
	"node_modules",
	"cache",
	"temp",
	"tmp"
]);
/** project.json property guardrails. */
const MAX_SCENE_PROPERTIES = 256;
const MAX_PROPERTY_OPTIONS = 64;
const BLOCKED_PROPERTY_KEYS = new Set([
	"__proto__",
	"prototype",
	"constructor"
]);
/** Audio-related property keys recognized for the default-mute policy. */
const AUDIO_PROPERTY_KEY = /* @__PURE__ */ new RegExp("^(?:volume|dbvolume|musicvolume|music_volume|audiovolume|audio_volume|soundvolume|sound_volume|bgmvolume|bgm_volume|muteaudio|audiomute|mutemusic|musicmute|audioenable|audioenabled|musicenable|musicenabled|soundenable|soundenabled|bgmenable|bgmenabled|music|audio|sound|bgm)$", "i");
/** A small, independent audio-property heuristic: keys/labels mentioning sound. */
const AUDIO_HINT = /(?:volume|mute|muted|silent|audio|music|sound|bgm|音量|静音|无声|音乐|声音|音效)/i;
/** An option label that means "no sound" for combo audio properties. */
const AUDIO_OFF_HINT = /(?:none|off|mute|muted|silent|disabled?|关闭|静音|无声|不要音乐|无音)/i;
/** Audio enable-toggle keys that mute by being set to false. */
const AUDIO_ENABLE_HINT = /* @__PURE__ */ new RegExp("^(?:audioenable|audioenabled|musicenable|musicenabled|soundenable|soundenabled|bgmenable|bgmenabled)$", "i");
/** A label that names a visualizer/equalizer control, not the audible track. */
const AUDIO_VISUAL_HINT = /* @__PURE__ */ new RegExp("(?:visuali[sz](?:er|ation)|\\bbars?\\b|\\bring\\b|\\bpulse\\b|\\bthreshold\\b|\\bsensitiv(?:e|ity)\\b|\\bintensity\\b|\\bcolou?r\\b|\\bopacity\\b|\\btransparen(?:cy|t)\\b|\\bbounce\\b|\\bflicker\\b|\\balbum\\b|\\binformation\\b|\\bresponse\\b|\\breactive\\b|\\bfrequency\\b|\\bspectrum\\b|\\bwave\\b|\\bnote\\b|可视|频谱|跳动|闪烁|响应|颜色|透明|专辑|封面|信息)", "i");
/** Base dirs tried on Windows when neither the registry nor library VDF yields Steam. */
const FALLBACK_STEAM_ROOTS = [
	"C:\\Program Files (x86)\\Steam",
	"C:\\Program Files\\Steam",
	"D:\\Steam",
	"D:\\SteamLibrary",
	"E:\\Steam",
	"E:\\SteamLibrary",
	"F:\\Steam",
	"F:\\SteamLibrary"
];
/** Resolve a possibly quoted/loose absolute path. */
function normalizeAbsolutePath(value) {
	const raw = rawText(value).trim().replace(/^"|"$/g, "");
	if (!raw) return "";
	try {
		return resolve(raw);
	} catch {
		return "";
	}
}
/** Canonical, case-folded identity key for a path on Windows. */
function pathKey(value) {
	return normalizeAbsolutePath(value).replace(/[\\/]+$/, "").toLowerCase();
}
/** Opaque project id: sha256 of the case-folded absolute path, first 24 hex chars. */
function opaqueId(value) {
	return createHash("sha256").update(pathKey(value)).digest("hex").slice(0, 24);
}
/** Read a value as text, or a fallback when it is not a string. */
function rawText(value, fallback = "") {
	return typeof value === "string" ? value : fallback;
}
/** Collapse control chars/whitespace and bound the length of user-facing text. */
function sanitizeText(value, fallback) {
	return rawText(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || fallback;
}
/** Strip HTML-ish fragments and zero-width/control marks from property labels. */
function sanitizePropertyLabel(value, fallback) {
	return sanitizeText(rawText(value).replace(/<[^>]{0,512}>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, " "), fallback);
}
/** True when `target` stays at or under `root` without leaving it. */
function isInside(root, target) {
	const rel = relative(root, target);
	return rel === "" || !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolutePath(rel);
}
function isAbsolutePath(value) {
	return isAbsolute(value);
}
/** Normalize one scene property value to a JSON-safe scalar or null. */
function normalizePropertyValue(value, maximumLength = 512) {
	if (typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximumLength);
	return null;
}
/**
* Scan a scene project's `general.properties` for audio controls and decide
* the default-silent values the shell applies before the first frame is
* captured. The policy is intentionally conservative: only controls whose
* key or label clearly names audio are muted, and visualizer/equalizer keys
* are excluded so the scene's look does not change.
*/
function analyzeSceneProperties(project) {
	const descriptors = [];
	const muteProperties = { volume: 0 };
	let audioPropertyCount = 0;
	let mutedAudioPropertyCount = 0;
	const properties = readGeneralProperties(project);
	if (properties === null) return {
		properties: descriptors,
		muteProperties: { ...muteProperties },
		propertyCount: 0,
		audioPropertyCount: 0,
		mutedAudioPropertyCount: 0
	};
	for (const [rawKey, rawProperty] of Object.entries(properties)) {
		if (descriptors.length >= MAX_SCENE_PROPERTIES) break;
		const key = rawText(rawKey).trim();
		const property = rawProperty !== null && typeof rawProperty === "object" && !Array.isArray(rawProperty) ? rawProperty : null;
		if (property === null) continue;
		if (!/^[a-z0-9_.-]{1,128}$/i.test(key) || BLOCKED_PROPERTY_KEYS.has(key.toLowerCase())) continue;
		const type = rawText(property.type).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "unknown";
		const label = sanitizePropertyLabel(property.text, key);
		const normalizedKey = key.replace(/[_.-]/g, "").toLowerCase();
		const hint = `${key} ${label}`;
		const exactAudioKey = AUDIO_PROPERTY_KEY.test(key);
		const explicitAudio = AUDIO_HINT.test(hint);
		const audioProperty = !(AUDIO_VISUAL_HINT.test(hint) && !exactAudioKey) && (exactAudioKey || explicitAudio);
		const options = Array.isArray(property.options) ? property.options.slice(0, MAX_PROPERTY_OPTIONS).map((option, index) => {
			const source = option !== null && typeof option === "object" && !Array.isArray(option) ? option : {};
			return {
				label: sanitizePropertyLabel(source.label, `选项 ${index + 1}`),
				value: normalizePropertyValue(source.value, 256)
			};
		}).filter((option) => option.value !== null) : [];
		const descriptor = {
			key,
			label,
			type,
			value: normalizePropertyValue(property.value),
			audio: audioProperty,
			autoMuted: false
		};
		const minimum = Number(property.min);
		const maximum = Number(property.max);
		const step = Number(property.step);
		if (Number.isFinite(minimum)) descriptor.min = minimum;
		if (Number.isFinite(maximum)) descriptor.max = maximum;
		if (Number.isFinite(step) && step > 0) descriptor.step = step;
		if (options.length > 0) descriptor.options = options;
		if (audioProperty) {
			audioPropertyCount += 1;
			const muteValue = decideMuteValue(type, property.value, normalizedKey, hint, minimum, maximum, options);
			if (muteValue !== void 0) {
				muteProperties[key] = muteValue;
				descriptor.autoMuted = true;
				descriptor.muteValue = muteValue;
				mutedAudioPropertyCount += 1;
			}
		}
		descriptors.push(descriptor);
	}
	return {
		properties: descriptors,
		muteProperties: { ...muteProperties },
		propertyCount: descriptors.length,
		audioPropertyCount,
		mutedAudioPropertyCount
	};
}
function readGeneralProperties(project) {
	if (project === null || typeof project !== "object" || Array.isArray(project)) return null;
	const general = project.general;
	if (general === null || typeof general !== "object" || Array.isArray(general)) return null;
	const properties = general.properties;
	if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return null;
	return properties;
}
/** Decide the silent value for one recognized audio property, or undefined. */
function decideMuteValue(type, rawValue, normalizedKey, hint, minimum, maximum, options) {
	const isMuteKey = /^(?:muteaudio|audiomute|mutemusic|musicmute)$/.test(normalizedKey);
	const isDecibelKey = normalizedKey === "dbvolume";
	if (type === "bool" || typeof rawValue === "boolean") {
		if (isMuteKey) return true;
		if (AUDIO_ENABLE_HINT.test(normalizedKey)) return false;
		return hint.includes("静音") || hint.includes("mute") || hint.includes("silent") ? true : false;
	}
	if (type === "slider" || typeof rawValue === "number") {
		if (isDecibelKey || Number.isFinite(minimum) && minimum < 0 && Number.isFinite(maximum) && maximum <= 0) return Number.isFinite(minimum) ? minimum : -60;
		if ((!Number.isFinite(minimum) || minimum <= 0) && (!Number.isFinite(maximum) || maximum >= 0)) return 0;
		if (Number.isFinite(minimum)) return minimum;
		return 0;
	}
	if (type === "combo" && options.length > 0) {
		const offOption = options.find((option) => AUDIO_OFF_HINT.test(option.label)) ?? options.find((option) => String(option.value) === "0");
		if (offOption !== void 0) return offOption.value;
		return;
	}
}
/** Extract a Steam workshop id from project fields, then the directory name. */
function deriveWorkshopId(project, projectRoot, sourceKind) {
	if (project !== null && typeof project === "object" && !Array.isArray(project)) {
		const record = project;
		const directCandidates = [
			record.workshopid,
			record.workshopId,
			record.publishedfileid,
			record.publishedFileId
		];
		for (const candidate of directCandidates) {
			const value = rawText(candidate).trim();
			if (/^\d{5,32}$/.test(value)) return value;
		}
		const urlCandidates = [
			record.workshopurl,
			record.workshopUrl,
			record.url
		];
		for (const candidate of urlCandidates) {
			const match = /(?:[?&]id=|\/filedetails\/?)(\d{5,32})/i.exec(rawText(candidate));
			if (match?.[1] !== void 0) return match[1];
		}
	}
	const directoryId = basename(projectRoot);
	return sourceKind === "workshop" && /^\d{5,32}$/.test(directoryId) ? directoryId : "";
}
async function statSafe(target) {
	try {
		return await stat(target);
	} catch {
		return null;
	}
}
async function isDirectory(target) {
	const found = await statSafe(target);
	return found !== null && found.isDirectory();
}
/**
* Resolve one project-relative media reference to a real file that stays
* inside the real project root and carries an allowed extension.
*/
async function resolveProjectFile(projectRoot, value, allowedExtensions) {
	const raw = rawText(value).trim().replace(/\//g, sep);
	if (raw.length === 0 || raw.includes("\0") || raw.includes(":") || isAbsolutePath(raw)) return "";
	const lexicalRoot = resolve(projectRoot);
	const lexicalTarget = resolve(lexicalRoot, raw);
	if (!isInside(lexicalRoot, lexicalTarget)) return "";
	if (!allowedExtensions.has(extname(lexicalTarget).toLowerCase())) return "";
	try {
		const [realRoot, realTarget] = await Promise.all([realpath(lexicalRoot), realpath(lexicalTarget)]);
		if (!isInside(realRoot, realTarget)) return "";
		const found = await statSafe(realTarget);
		return found !== null && found.isFile() ? realTarget : "";
	} catch {
		return "";
	}
}
/** First resolvable file among `values`, or an empty string. */
async function firstProjectFile(projectRoot, values, allowedExtensions) {
	for (const value of values) {
		if (value === void 0 || value === null || rawText(value).trim() === "") continue;
		const target = await resolveProjectFile(projectRoot, value, allowedExtensions);
		if (target) return target;
	}
	return "";
}
/** Validate a scene package header (`PKGV` + 4 digits at offset 0 or 4). */
async function validateScenePackage(file) {
	if (!file || !SCENE_PACKAGE_EXTENSIONS.has(extname(file).toLowerCase())) return "";
	try {
		const handle = await import("node:fs/promises").then(({ open }) => open(file, "r"));
		try {
			const header = Buffer.alloc(12);
			if ((await handle.read(header, 0, header.length, 0)).bytesRead !== header.length) return "";
			const atStart = header.subarray(0, 8).toString("ascii");
			const afterLength = header.subarray(4, 12).toString("ascii");
			return SCENE_PACKAGE_SIGNATURE.test(atStart) || SCENE_PACKAGE_SIGNATURE.test(afterLength) ? file : "";
		} finally {
			await handle.close();
		}
	} catch {
		return "";
	}
}
async function execFileText(file, args) {
	return new Promise((resolvePromise) => {
		execFile(file, args, {
			encoding: "utf8",
			windowsHide: true,
			timeout: 2500,
			maxBuffer: 256 * 1024
		}, (error, stdout) => {
			resolvePromise(error !== null ? "" : stdout || "");
		});
	});
}
/** Query Steam install roots from the Windows registry. */
async function windowsSteamRegistryRoots() {
	if (process.platform !== "win32") return [];
	const queries = [
		["HKCU\\Software\\Valve\\Steam", "SteamPath"],
		["HKCU\\Software\\Valve\\Steam", "SteamExe"],
		["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"],
		["HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"]
	];
	const roots = /* @__PURE__ */ new Set();
	for (const [key, value] of queries) {
		const output = await execFileText("reg.exe", [
			"query",
			key,
			"/v",
			value
		]);
		const match = new RegExp(`${value}\\s+REG_\\w+\\s+(.+)$`, "mi").exec(output);
		if (match?.[1] === void 0) continue;
		let found = normalizeAbsolutePath(match[1].replace(/\//g, sep));
		if (/steam\.exe$/i.test(found)) found = dirname(found);
		if (found) roots.add(found);
	}
	return [...roots];
}
/** Read one Steam root plus every `"path"` entry in its libraryfolders.vdf. */
async function readSteamLibraryFolders(steamRoot) {
	const roots = new Set([normalizeAbsolutePath(steamRoot)].filter(Boolean));
	const files = [join(steamRoot, "steamapps", "libraryfolders.vdf"), join(steamRoot, "config", "libraryfolders.vdf")];
	for (const file of files) try {
		const text = (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
		for (const match of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
			const found = normalizeAbsolutePath((match[1] ?? "").replace(/\\\\/g, "\\"));
			if (found) roots.add(found);
		}
	} catch {}
	return [...roots];
}
/** Discover all Steam library roots: registry, environment, and known paths. */
async function discoverSteamLibraries() {
	const candidates = new Set([
		...FALLBACK_STEAM_ROOTS,
		...process.env.ProgramFiles !== void 0 ? [join(process.env.ProgramFiles, "Steam")] : [],
		...process.env["ProgramFiles(x86)"] !== void 0 ? [join(process.env["ProgramFiles(x86)"], "Steam")] : [],
		...process.env.ProgramW6432 !== void 0 ? [join(process.env.ProgramW6432, "Steam")] : []
	].map((value) => normalizeAbsolutePath(value)).filter(Boolean));
	for (const root of await windowsSteamRegistryRoots()) candidates.add(root);
	const libraries = /* @__PURE__ */ new Set();
	for (const candidate of candidates) {
		if (!await isDirectory(candidate)) continue;
		for (const library of await readSteamLibraryFolders(candidate)) if (await isDirectory(library)) libraries.add(normalizeAbsolutePath(library));
	}
	return [...libraries];
}
/** Known Wallpaper Engine containers inside one Steam library. */
function knownWallpaperContainers(steamLibrary) {
	return [join(steamLibrary, "steamapps", "workshop", "content", WALLPAPER_ENGINE_APP_ID), join(steamLibrary, "steamapps", "common", "wallpaper_engine", "projects", "myprojects")];
}
/** Direct child project directories of a container (project.json one level down). */
async function directProjectDirectories(container) {
	const output = [];
	let entries;
	try {
		entries = await readdir(container, { withFileTypes: true });
	} catch {
		return output;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const projectRoot = join(container, entry.name);
		const found = await statSafe(join(projectRoot, "project.json"));
		if (found !== null && found.isFile()) output.push(projectRoot);
	}
	return output;
}
/**
* Find project directories under a manually chosen root. A root that is
* itself a project wins; known WE containers are scanned directly; otherwise
* a bounded BFS walks at most two directory levels below the root.
*/
async function manualProjectDirectories(root) {
	const normalized = normalizeAbsolutePath(root);
	if (!normalized || !await isDirectory(normalized)) return [];
	const rootProject = await statSafe(join(normalized, "project.json"));
	if (rootProject !== null && rootProject.isFile()) return [normalized];
	const known = /* @__PURE__ */ new Set();
	for (const container of knownWallpaperContainers(normalized)) {
		if (!await isDirectory(container)) continue;
		for (const projectRoot of await directProjectDirectories(container)) known.add(projectRoot);
	}
	if (known.size > 0) return [...known];
	const output = [];
	const seen = /* @__PURE__ */ new Set();
	const queue = [{
		dir: normalized,
		depth: 0
	}];
	let visitedEntries = 0;
	while (queue.length > 0 && visitedEntries < 4e3) {
		const current = queue.shift();
		if (current === void 0) break;
		let entries;
		try {
			entries = await readdir(current.dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (visitedEntries >= 4e3) break;
			visitedEntries += 1;
			const entryDepth = current.depth + 1;
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".") || SKIPPED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) continue;
			const child = join(current.dir, entry.name);
			const key = pathKey(child);
			if (seen.has(key)) continue;
			seen.add(key);
			const projectFile = await statSafe(join(child, "project.json"));
			if (projectFile !== null && projectFile.isFile()) output.push(child);
			else if (entryDepth < 2) queue.push({
				dir: child,
				depth: entryDepth
			});
		}
	}
	return output;
}
/** Read and validate a project.json: size cap, BOM, realpath inside its root. */
async function readProjectManifest(projectRoot) {
	const file = join(projectRoot, "project.json");
	const found = await statSafe(file);
	if (found === null || !found.isFile() || found.size <= 0 || found.size > 1048576) return null;
	try {
		const [rawText, realRoot, realFile] = await Promise.all([
			readFile(file, "utf8"),
			realpath(projectRoot),
			realpath(file)
		]);
		if (!isInside(realRoot, realFile)) return null;
		const value = JSON.parse(rawText.replace(/^\uFEFF/, ""));
		if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
		return {
			value,
			file: realFile,
			mtimeMs: Math.round(found.mtimeMs) || 0
		};
	} catch {
		return null;
	}
}
/** Build one indexed project from a project root plus its source. */
async function indexProject(projectRoot, source, scenePackageOverride = "") {
	const manifest = await readProjectManifest(projectRoot);
	if (manifest === null) return null;
	const project = manifest.value;
	const projectType = rawText(project.type).trim().toLowerCase();
	const directExt = extname(rawText(project.file)).toLowerCase();
	const inferredMedia = VIDEO_EXTENSIONS.has(directExt) ? "video" : IMAGE_EXTENSIONS.has(directExt) ? "image" : "";
	const media = projectType === "video" || projectType === "image" || projectType === "" && inferredMedia !== "" ? await firstProjectFile(projectRoot, [project.file], SAFE_MEDIA_EXTENSIONS) : "";
	const overrideRelative = scenePackageOverride !== "" ? relative(projectRoot, scenePackageOverride) : "";
	const scenePackage = await validateScenePackage(projectType === "scene" ? await firstProjectFile(projectRoot, [
		overrideRelative,
		SCENE_PACKAGE_EXTENSIONS.has(directExt) ? project.file : "",
		"scene.pkg",
		"scene.pak"
	], SCENE_PACKAGE_EXTENSIONS) : "");
	const preview = await firstProjectFile(projectRoot, [
		project.preview,
		project.cover,
		project.poster,
		"preview.jpg",
		"preview.jpeg",
		"preview.png",
		"preview.webp",
		"preview.gif",
		"cover.jpg",
		"cover.png",
		"cover.webp",
		"cover.gif"
	], IMAGE_EXTENSIONS);
	if (media === "" && preview === "" && scenePackage === "") return null;
	const id = opaqueId(projectRoot);
	const mediaExt = extname(media).toLowerCase();
	const previewExt = extname(preview).toLowerCase();
	const mediaType = VIDEO_EXTENSIONS.has(mediaExt) ? "video" : IMAGE_EXTENSIONS.has(mediaExt) ? "image" : "";
	const enginePlayable = scenePackage !== "";
	const analysis = projectType === "scene" ? analyzeSceneProperties(project) : null;
	const workshopId = deriveWorkshopId(project, projectRoot, source.kind);
	return {
		item: {
			id,
			title: sanitizeText(project.title, basename(projectRoot)),
			projectType: projectType || mediaType || "unknown",
			mediaType,
			mediaAnimated: mediaExt === ".gif",
			playable: media !== "",
			enginePlayable,
			previewOnly: media === "" && !enginePlayable,
			hasPreview: preview !== "",
			previewAnimated: previewExt === ".gif",
			source: source.kind,
			sourceLabel: source.label,
			workshopId,
			propertyCount: analysis?.propertyCount ?? 0,
			audioPropertyCount: analysis?.audioPropertyCount ?? 0,
			mutedAudioPropertyCount: analysis?.mutedAudioPropertyCount ?? 0,
			updatedAt: manifest.mtimeMs,
			safetyMode: media !== "" ? "direct-media" : enginePlayable ? "native-engine" : "preview-only"
		},
		record: {
			id,
			projectRoot: await realpath(projectRoot),
			projectFile: manifest.file,
			media,
			preview,
			scenePackage,
			workshopId
		}
	};
}
/** Parse an HTTP `Range` header value against a file size. */
function parseByteRange(headerValue, size) {
	if (headerValue === null || headerValue === void 0) return { kind: "absent" };
	const match = /^bytes=(\d*)-(\d*)$/i.exec(headerValue.trim());
	if (match === null) return { kind: "absent" };
	if (match[1] === "" && match[2] === "") return { kind: "invalid" };
	let start;
	let end;
	if (match[1] === "" && match[2] !== "") {
		const suffix = Math.max(0, Number(match[2]) || 0);
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Math.max(0, Number(match[1]) || 0);
		end = match[2] !== "" ? Math.min(size - 1, Number(match[2])) : size - 1;
	}
	if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return { kind: "invalid" };
	return {
		kind: "range",
		start,
		end
	};
}
function mimeForPath(file) {
	return SAFE_MIME.get(extname(file).toLowerCase()) ?? "application/octet-stream";
}
function mediaResponse(status, headers, body) {
	return new Response(body ?? null, {
		status,
		headers
	});
}
/**
* Wallpaper Engine library: discovery, indexing, persistence, and the media
* protocol handler. It is deliberately Electron-free except for the
* `installProtocol` seam, so the scanning logic runs in plain Node tests.
*/
var WallpaperEngineLibrary = class {
	configPath;
	autoDiscover;
	manualRoots;
	manualProjectFiles;
	index = /* @__PURE__ */ new Map();
	snapshot = null;
	scanPromise = null;
	queuedForceScan = null;
	generation = 0;
	disposed = false;
	mediaToken = randomBytes(24).toString("hex");
	protocolInstalled = false;
	/** @param options - config path override and auto-discover toggle for tests. */
	constructor(options = {}) {
		this.configPath = options.configPath ?? dshHomePath("wallpaper-engine-library.json");
		this.autoDiscover = options.autoDiscover !== false;
		const config = this.readConfig();
		this.manualRoots = config.manualRoots;
		this.manualProjectFiles = config.manualProjectFiles;
	}
	/** Read the persisted manual roots/files, with bounds and dedupe. */
	readConfig() {
		try {
			const raw = JSON.parse(readFileSync(this.configPath, "utf8"));
			const record = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
			const manualRoots = Array.isArray(record.manualRoots) ? record.manualRoots.map((value) => normalizeAbsolutePath(value)).filter(Boolean).slice(0, 32) : [];
			const manualProjectFiles = Array.isArray(record.manualProjectFiles) ? record.manualProjectFiles.map((value) => normalizeAbsolutePath(value)).filter(Boolean).slice(0, 64) : [];
			return {
				version: 2,
				manualRoots: [...new Set(manualRoots)],
				manualProjectFiles: [...new Set(manualProjectFiles)]
			};
		} catch {
			return {
				version: 2,
				manualRoots: [],
				manualProjectFiles: []
			};
		}
	}
	async saveConfig() {
		await mkdir(dirname(this.configPath), { recursive: true });
		const temporary = `${this.configPath}.tmp`;
		await writeFile(temporary, JSON.stringify({
			version: 2,
			manualRoots: this.manualRoots,
			manualProjectFiles: this.manualProjectFiles
		}, null, 2), "utf8");
		try {
			await rename(temporary, this.configPath);
		} catch {
			await writeFile(this.configPath, await readFile(temporary, "utf8"), "utf8");
		}
	}
	manualRootSummary() {
		return this.manualRoots.map((root) => ({
			id: opaqueId(root),
			name: basename(root) || parse(root).root || "导入目录"
		}));
	}
	/** Add a directory root, rescan, and return the new snapshot. */
	async addManualRoot(root) {
		const normalized = normalizeAbsolutePath(root);
		if (!normalized || !await isDirectory(normalized)) throw new Error("所选目录不存在");
		if ((await manualProjectDirectories(normalized)).length === 0) throw new Error("所选目录中没有识别到 project.json");
		if (!this.manualRoots.some((value) => pathKey(value) === pathKey(normalized))) {
			this.manualRoots = [...this.manualRoots, normalized].slice(-32);
			await this.saveConfig();
		}
		return this.list({ force: true });
	}
	/** Add one project.json (as its directory) or a scene package file. */
	async addManualProjectFile(file) {
		const normalized = normalizeAbsolutePath(file);
		const found = await statSafe(normalized);
		if (found === null || !found.isFile()) throw new Error("所选项目文件不存在");
		if (basename(normalized).toLowerCase() === "project.json") return this.addManualRoot(dirname(normalized));
		if (!SCENE_PACKAGE_EXTENSIONS.has(extname(normalized).toLowerCase())) throw new Error("请选择 project.json 或 Wallpaper Engine 场景包（.pkg/.pak）");
		const scenePackage = await validateScenePackage(normalized);
		if (scenePackage === "") throw new Error("所选文件不是有效的 Wallpaper Engine PKGV 场景包");
		const projectRoot = dirname(scenePackage);
		const manifest = await readProjectManifest(projectRoot);
		if (manifest === null || rawText(manifest.value.type).trim().toLowerCase() !== "scene") throw new Error("场景包同目录缺少有效的 Scene project.json");
		if (!this.manualRoots.some((value) => pathKey(value) === pathKey(projectRoot))) this.manualRoots = [...this.manualRoots, projectRoot].slice(-32);
		if (!this.manualProjectFiles.some((value) => pathKey(value) === pathKey(scenePackage))) this.manualProjectFiles = [...this.manualProjectFiles, scenePackage].slice(-64);
		await this.saveConfig();
		return this.list({ force: true });
	}
	/** Remove a manual root and any scene-package files it owns. */
	async removeManualRoot(rootId) {
		const removed = this.manualRoots.filter((root) => opaqueId(root) === rootId);
		const beforeRoots = this.manualRoots.length;
		const beforeFiles = this.manualProjectFiles.length;
		this.manualRoots = this.manualRoots.filter((root) => !removed.includes(root));
		this.manualProjectFiles = this.manualProjectFiles.filter((file) => !removed.some((root) => isInside(resolve(root), resolve(file))));
		if (this.manualRoots.length !== beforeRoots || this.manualProjectFiles.length !== beforeFiles) await this.saveConfig();
		return this.list({ force: true });
	}
	/** Compose the ordered source list for one scan. */
	async discoverSources() {
		const output = [];
		const seen = /* @__PURE__ */ new Set();
		if (this.autoDiscover) for (const library of await discoverSteamLibraries()) for (const container of knownWallpaperContainers(library)) {
			if (!await isDirectory(container)) continue;
			const key = pathKey(container);
			if (seen.has(key)) continue;
			seen.add(key);
			output.push({
				root: container,
				kind: /workshop[\\/]content/i.test(container) ? "workshop" : "local",
				label: /workshop[\\/]content/i.test(container) ? "Steam 创意工坊" : "Wallpaper Engine 本地项目",
				direct: true
			});
		}
		for (const root of this.manualRoots) {
			const key = pathKey(root);
			if (seen.has(key) || !await isDirectory(root)) continue;
			seen.add(key);
			output.push({
				root,
				kind: "imported",
				label: "手动导入",
				direct: false
			});
		}
		return output;
	}
	/** Run one full scan and publish the snapshot. */
	async performScan() {
		const startedAt = Date.now();
		const generation = ++this.generation;
		const sources = await this.discoverSources();
		const manualPackageByRoot = /* @__PURE__ */ new Map();
		for (const file of this.manualProjectFiles) manualPackageByRoot.set(pathKey(dirname(file)), file);
		const projectSources = /* @__PURE__ */ new Map();
		for (const source of sources) {
			const projects = source.direct ? await directProjectDirectories(source.root) : await manualProjectDirectories(source.root);
			for (const projectRoot of projects) {
				const key = pathKey(projectRoot);
				if (!projectSources.has(key)) projectSources.set(key, {
					projectRoot,
					source
				});
			}
		}
		const projects = [];
		const nextIndex = /* @__PURE__ */ new Map();
		for (const value of projectSources.values()) {
			if (this.disposed || generation !== this.generation) break;
			let indexed = null;
			try {
				indexed = await indexProject(value.projectRoot, value.source, manualPackageByRoot.get(pathKey(value.projectRoot)) ?? "");
			} catch {
				continue;
			}
			if (indexed === null || nextIndex.has(indexed.item.id)) continue;
			projects.push(indexed.item);
			nextIndex.set(indexed.item.id, indexed.record);
		}
		projects.sort((a, b) => Number(b.playable) - Number(a.playable) || Number(b.enginePlayable) - Number(a.enginePlayable) || a.title.localeCompare(b.title, "zh-CN"));
		if (!this.disposed && generation === this.generation) this.index = nextIndex;
		const snapshot = {
			ok: true,
			projects,
			count: projects.length,
			dynamicCount: projects.filter((item) => item.playable && item.mediaType === "video").length,
			enginePlayableCount: projects.filter((item) => item.enginePlayable).length,
			previewOnlyCount: projects.filter((item) => item.previewOnly).length,
			sourceCount: sources.length,
			manualRoots: this.manualRootSummary(),
			scannedAt: Date.now(),
			elapsedMs: Date.now() - startedAt,
			mediaToken: this.mediaToken
		};
		if (!this.disposed && generation === this.generation) this.snapshot = snapshot;
		return snapshot;
	}
	/** List projects, using a 30s cache unless `force` is set. */
	async list(options = {}) {
		if (this.disposed) throw new Error("WALLPAPER_ENGINE_LIBRARY_CLOSED");
		const force = options.force === true;
		if (!force && this.snapshot !== null && Date.now() - this.snapshot.scannedAt < 3e4) return this.snapshot;
		if (this.scanPromise !== null) {
			if (!force) return this.scanPromise;
			if (this.queuedForceScan !== null) return this.queuedForceScan;
			const tracked = this.scanPromise.catch(() => null).then(() => this.performScan()).finally(() => {
				if (this.scanPromise === tracked) this.scanPromise = null;
				if (this.queuedForceScan === tracked) this.queuedForceScan = null;
			});
			this.queuedForceScan = tracked;
			this.scanPromise = tracked;
			return tracked;
		}
		const tracked = this.performScan().finally(() => {
			if (this.scanPromise === tracked) this.scanPromise = null;
		});
		this.scanPromise = tracked;
		return tracked;
	}
	/** Re-validate one record file against its real project root. */
	async validatedRecordFile(record, kind) {
		const target = kind === "media" ? record.media : record.preview;
		if (target === "") return "";
		try {
			const [realRoot, realTarget] = await Promise.all([realpath(record.projectRoot), realpath(target)]);
			if (!isInside(realRoot, realTarget) || !SAFE_MEDIA_EXTENSIONS.has(extname(realTarget).toLowerCase())) return "";
			const found = await statSafe(realTarget);
			return found !== null && found.isFile() ? realTarget : "";
		} catch {
			return "";
		}
	}
	/** Resolve a native scene target (manifest + validated scene package). */
	async getNativeSceneTarget(id) {
		const normalized = normalizeProjectId(id);
		if (this.snapshot === null && this.scanPromise === null) await this.list();
		const record = this.index.get(normalized);
		if (record === void 0 || record.scenePackage === "") throw new Error("WALLPAPER_SCENE_NOT_FOUND");
		const scenePackage = await validateScenePackage(await resolveProjectFile(record.projectRoot, relative(record.projectRoot, record.scenePackage), SCENE_PACKAGE_EXTENSIONS));
		if (scenePackage === "") throw new Error("WALLPAPER_SCENE_PACKAGE_INVALID");
		const manifest = await readProjectManifest(record.projectRoot);
		if (manifest === null || rawText(manifest.value.type).trim().toLowerCase() !== "scene") throw new Error("WALLPAPER_SCENE_MANIFEST_INVALID");
		const analysis = analyzeSceneProperties(manifest.value);
		return {
			id: normalized,
			projectFile: manifest.file,
			scenePackage,
			muteProperties: analysis.muteProperties,
			propertyCount: analysis.propertyCount,
			audioPropertyCount: analysis.audioPropertyCount,
			mutedAudioPropertyCount: analysis.mutedAudioPropertyCount
		};
	}
	/** Get one project's manifest-derived details for the renderer drawer. */
	async getProjectDetails(id) {
		const normalized = normalizeProjectId(id);
		if (this.snapshot === null && this.scanPromise === null) await this.list();
		const record = this.index.get(normalized);
		if (record === void 0) throw new Error("WALLPAPER_PROJECT_NOT_FOUND");
		const manifest = await readProjectManifest(record.projectRoot);
		if (manifest === null) throw new Error("WALLPAPER_PROJECT_MANIFEST_INVALID");
		const project = manifest.value;
		const analysis = analyzeSceneProperties(project);
		return {
			ok: true,
			id: normalized,
			title: sanitizeText(project.title, basename(record.projectRoot)),
			projectType: rawText(project.type, "unknown").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "unknown",
			workshopId: record.workshopId || deriveWorkshopId(project, record.projectRoot, ""),
			propertyCount: analysis.propertyCount,
			audioPropertyCount: analysis.audioPropertyCount,
			mutedAudioPropertyCount: analysis.mutedAudioPropertyCount,
			properties: analysis.properties
		};
	}
	/** Serve one media/preview file with token + range + nosniff + containment. */
	async mediaResponse(request) {
		const method = (request.method ?? "GET").toUpperCase();
		if (method !== "GET" && method !== "HEAD") return mediaResponse(405, {
			Allow: "GET, HEAD",
			"X-Content-Type-Options": "nosniff"
		});
		if (this.snapshot === null && this.scanPromise === null) await this.list();
		let url;
		let id;
		try {
			url = new URL(request.url);
			id = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
		} catch {
			return mediaResponse(404, { "X-Content-Type-Options": "nosniff" });
		}
		const kind = url.hostname === "media" ? "media" : url.hostname === "preview" ? "preview" : "";
		if (url.searchParams.get("token") !== this.mediaToken) return mediaResponse(404, { "X-Content-Type-Options": "nosniff" });
		const normalized = id.toLowerCase();
		if (!/^[a-f0-9]{24}$/.test(normalized) || kind === "") return mediaResponse(404, { "X-Content-Type-Options": "nosniff" });
		const record = this.index.get(normalized);
		if (record === void 0) return mediaResponse(404, { "X-Content-Type-Options": "nosniff" });
		const target = await this.validatedRecordFile(record, kind);
		if (target === "") return mediaResponse(404, { "X-Content-Type-Options": "nosniff" });
		const found = await statSafe(target);
		if (found === null || !found.isFile()) return mediaResponse(404, { "X-Content-Type-Options": "nosniff" });
		const size = Math.max(0, found.size);
		const parsed = parseByteRange(request.headers?.get("range") ?? null, size);
		if (parsed.kind === "invalid") return mediaResponse(416, {
			"Content-Range": `bytes */${size}`,
			"X-Content-Type-Options": "nosniff"
		});
		const start = parsed.kind === "range" ? parsed.start : 0;
		const end = parsed.kind === "range" ? parsed.end : Math.max(0, size - 1);
		const headers = {
			"Content-Type": mimeForPath(target),
			"Content-Length": String(size > 0 ? end - start + 1 : 0),
			"Accept-Ranges": "bytes",
			"Cache-Control": "private, max-age=300",
			"X-Content-Type-Options": "nosniff"
		};
		if (parsed.kind === "range") headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
		if (method === "HEAD" || size === 0) return mediaResponse(parsed.kind === "range" ? 206 : 200, headers);
		const body = Readable.toWeb(createReadStream(target, {
			start,
			end
		}));
		return mediaResponse(parsed.kind === "range" ? 206 : 200, headers, body);
	}
	/** Install the custom protocol handler (Electron `protocol` object). */
	installProtocol(protocol) {
		if (this.protocolInstalled) return;
		protocol.handle(WALLPAPER_ENGINE_SCHEME, (request) => this.mediaResponse(request));
		this.protocolInstalled = true;
	}
	/** Invalidate caches and drop the token. */
	dispose() {
		this.disposed = true;
		this.generation += 1;
		this.index.clear();
		this.mediaToken = "";
		this.snapshot = null;
	}
};
/** Validate and normalize a renderer-supplied project id. */
function normalizeProjectId(id) {
	const normalized = rawText(id).toLowerCase();
	if (!/^[a-f0-9]{24}$/.test(normalized)) throw new Error("WALLPAPER_PROJECT_ID_INVALID");
	return normalized;
}
//#endregion
//#region lib/types/src/main/wallpaper-engine-runtime.js
/**
* Simplified Wallpaper Engine native-scene runtime for the DSH desktop shell.
* Design is informed by Mineradio's GPL-3.0 wallpaper-engine-runtime.js
* (reference design only; this independent implementation covers the M4
* scope: probe the WE installation, open a scene in a titled window, discover
* the window through desktopCapturer so the renderer can capture it, apply
* default-mute audio properties, and close the scene on stop). It does NOT
* embed into WorkerW or manipulate desktop icons (deferred M5).
*
* @module apps/desktop/src/main/wallpaper-engine-runtime
*/
/** Launch bounds are clamped into the same range the reference shell uses. */
const MIN_WIDTH = 640;
const MAX_WIDTH = 7680;
const MIN_HEIGHT = 360;
const MAX_HEIGHT = 4320;
const SOURCE_POLL_INTERVAL_MS = 220;
const SOURCE_TIMEOUT_MS = 12e3;
const ENGINE_READY_DELAY_MS = 1200;
const MUTE_RETRY_DELAYS_MS = [
	180,
	420,
	900
];
function clampInteger(value, minimum, maximum, fallback) {
	const numeric = Math.round(Number(value));
	return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}
function safeRuntimeOptions(options = {}) {
	return {
		width: clampInteger(options.width, MIN_WIDTH, MAX_WIDTH, 1280),
		height: clampInteger(options.height, MIN_HEIGHT, MAX_HEIGHT, 720),
		x: clampInteger(options.x, -16e3, 16e3, 0),
		y: clampInteger(options.y, -16e3, 16e3, 0),
		fps: clampInteger(options.fps, 1, 240, 30)
	};
}
/** Keep only valid, JSON-safe mute entries so malformed projects cannot inject keys. */
function sanitizeMuteProperties(value) {
	const output = { volume: 0 };
	if (value === null || typeof value !== "object" || Array.isArray(value)) return output;
	for (const [rawKey, rawValue] of Object.entries(value)) {
		if (!/^[a-z0-9_.-]{1,128}$/i.test(rawKey)) continue;
		if (rawKey === "__proto__" || rawKey === "prototype" || rawKey === "constructor") continue;
		if (typeof rawValue === "boolean") output[rawKey] = rawValue;
		else if (typeof rawValue === "number" && Number.isFinite(rawValue)) output[rawKey] = rawValue;
		else if (typeof rawValue === "string") output[rawKey] = rawValue.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 512);
	}
	return output;
}
/**
* Wallpaper Engine runtime: probe, start, confirm, stop. Electron-free; the
* desktopCapturer and spawn seams are injected by the main process.
*/
var WallpaperEngineRuntime = class {
	library;
	desktopCapturer;
	discoverSteamLibraries;
	spawnImpl;
	platform;
	arch;
	sleepImpl;
	executableCache = null;
	active = null;
	generation = 0;
	disposed = false;
	constructor(options) {
		this.library = options.library;
		this.desktopCapturer = options.desktopCapturer ?? null;
		this.discoverSteamLibraries = options.discoverSteamLibraries ?? discoverSteamLibraries;
		this.spawnImpl = options.spawn ?? spawn;
		this.platform = options.platform ?? process.platform;
		this.arch = options.arch ?? process.arch;
		this.sleepImpl = options.sleep ?? ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
	}
	/** Candidate WE executables for one Steam library, in architecture order. */
	candidateExecutables(libraries) {
		const names = this.arch === "x64" ? ["wallpaper64.exe", "wallpaper32.exe"] : ["wallpaper32.exe", "wallpaper64.exe"];
		const seen = /* @__PURE__ */ new Set();
		const output = [];
		for (const library of libraries) {
			const root = resolve(library.trim());
			if (!root) continue;
			for (const name of names) {
				const executable = join(root, "steamapps", "common", "wallpaper_engine", name);
				const key = executable.toLowerCase();
				if (seen.has(key)) continue;
				seen.add(key);
				output.push(executable);
			}
		}
		return output;
	}
	/** Find a WE installation by file existence across discovered Steam libraries. */
	async discoverExecutable(force = false) {
		if (this.platform !== "win32") return {
			ok: true,
			available: false,
			reason: "WALLPAPER_ENGINE_WINDOWS_ONLY"
		};
		if (force) this.executableCache = null;
		if (this.executableCache !== null) return {
			ok: true,
			...this.executableCache
		};
		let libraries = [];
		try {
			libraries = await this.discoverSteamLibraries();
		} catch {
			libraries = [];
		}
		for (const executable of this.candidateExecutables(libraries)) try {
			if ((await import("node:fs/promises").then(({ stat }) => stat(executable))).isFile()) {
				this.executableCache = {
					executable,
					available: true
				};
				return {
					ok: true,
					available: true,
					executable
				};
			}
		} catch {}
		this.executableCache = {
			available: false,
			reason: "WALLPAPER_ENGINE_NOT_INSTALLED"
		};
		return {
			ok: true,
			available: false,
			reason: "WALLPAPER_ENGINE_NOT_INSTALLED"
		};
	}
	/** Lightweight probe for the renderer status API. */
	async probe(force = false) {
		return this.discoverExecutable(force);
	}
	/** Ask WE to reveal one workshop item in its browser (best effort). */
	async revealWorkshop(workshopId) {
		const normalized = workshopId.trim();
		if (!/^\d{5,32}$/.test(normalized)) throw new Error("WALLPAPER_ENGINE_WORKSHOP_ID_INVALID");
		const installation = await this.discoverExecutable(false);
		if (!installation.available || installation.executable === void 0) throw new Error(installation.reason ?? "WALLPAPER_ENGINE_NOT_INSTALLED");
		await this.ensureEngineReady(installation.executable);
		await this.spawnControl(installation.executable, [
			"-control",
			"revealWallpaper",
			"-id",
			normalized
		]);
		return {
			ok: true,
			workshopId: normalized
		};
	}
	getStatus() {
		const session = this.active;
		if (session === null) return {
			ok: true,
			active: false,
			id: "",
			sessionId: "",
			sourceId: "",
			width: 0,
			height: 0,
			fps: 0,
			audioMuted: false
		};
		return {
			ok: true,
			active: true,
			id: session.id,
			sessionId: session.sessionId,
			sourceId: session.sourceId,
			width: session.width,
			height: session.height,
			fps: session.fps,
			audioMuted: true
		};
	}
	spawnControl(executable, args) {
		return new Promise((resolvePromise, reject) => {
			let settled = false;
			const finish = (error) => {
				if (settled) return;
				settled = true;
				if (error !== null) reject(error);
				else resolvePromise();
			};
			let child;
			try {
				child = this.spawnImpl(executable, args, {
					windowsHide: true,
					stdio: "ignore"
				});
			} catch (error) {
				finish(error);
				return;
			}
			child.once("error", finish);
			child.once("spawn", () => {
				child.unref();
				finish(null);
			});
		});
	}
	/** Make sure the WE main process is up before sending control commands. */
	async ensureEngineReady(executable) {
		await this.spawnControl(executable, []);
		await this.sleepImpl(ENGINE_READY_DELAY_MS);
	}
	async findWindowSource(locationTitle) {
		if (this.desktopCapturer === null || typeof this.desktopCapturer.getSources !== "function") throw new Error("WALLPAPER_ENGINE_CAPTURE_UNAVAILABLE");
		const deadline = Date.now() + SOURCE_TIMEOUT_MS;
		while (Date.now() <= deadline) {
			if (this.disposed) throw new Error("WALLPAPER_ENGINE_RUNTIME_DISPOSED");
			let sources = [];
			try {
				sources = await this.desktopCapturer.getSources({
					types: ["window"],
					thumbnailSize: {
						width: 0,
						height: 0
					},
					fetchWindowIcons: false
				});
			} catch {
				sources = [];
			}
			const exact = sources.find((source) => source.name === locationTitle && source.id !== "");
			if (exact !== void 0) return exact;
			await this.sleepImpl(SOURCE_POLL_INTERVAL_MS);
		}
		throw new Error("WALLPAPER_ENGINE_WINDOW_TIMEOUT");
	}
	async applyMute(session) {
		if (session.executable === "") return;
		await this.spawnControl(session.executable, [
			"-control",
			"applyProperties",
			"-properties",
			`RAW~(${JSON.stringify(session.muteProperties)})~END`,
			"-location",
			session.locationTitle
		]);
	}
	async muteSession(session) {
		let lastError = null;
		for (const delay of MUTE_RETRY_DELAYS_MS) {
			await this.sleepImpl(delay);
			if (this.active !== session && this.disposed) throw new Error("WALLPAPER_ENGINE_START_SUPERSEDED");
			try {
				await this.applyMute(session);
				return;
			} catch (error) {
				lastError = error;
			}
		}
		if (lastError !== null) throw lastError;
		throw new Error("WALLPAPER_ENGINE_AUDIO_SUPPRESSION_FAILED");
	}
	/** Open a scene window and return its capture source id for the renderer. */
	async start(id, options = {}) {
		if (this.disposed) throw new Error("WALLPAPER_ENGINE_RUNTIME_DISPOSED");
		const generation = ++this.generation;
		const runtimeOptions = safeRuntimeOptions(options);
		const sessionId = randomBytes(12).toString("hex");
		const target = await this.library.getNativeSceneTarget(id);
		const installation = await this.discoverExecutable(false);
		if (!installation.available || installation.executable === void 0) throw new Error(installation.reason ?? "WALLPAPER_ENGINE_NOT_INSTALLED");
		const session = {
			id: target.id,
			sessionId,
			locationTitle: `DSH Wallpaper ${sessionId}`,
			sourceId: "",
			width: runtimeOptions.width,
			height: runtimeOptions.height,
			fps: runtimeOptions.fps,
			executable: installation.executable,
			muteProperties: sanitizeMuteProperties(target.muteProperties),
			launched: false,
			stopping: false
		};
		try {
			await this.ensureEngineReady(session.executable);
			if (generation !== this.generation) throw new Error("WALLPAPER_ENGINE_START_SUPERSEDED");
			await this.spawnControl(session.executable, [
				"-control",
				"openWallpaper",
				"-file",
				target.scenePackage,
				"-playInWindow",
				session.locationTitle,
				"-width",
				String(session.width),
				"-height",
				String(session.height),
				"-x",
				String(runtimeOptions.x),
				"-y",
				String(runtimeOptions.y),
				"-borderless"
			]);
			session.launched = true;
			const source = await this.findWindowSource(session.locationTitle);
			if (generation !== this.generation) throw new Error("WALLPAPER_ENGINE_START_SUPERSEDED");
			session.sourceId = source.id;
			await this.muteSession(session);
			this.active = session;
			return this.getStatus();
		} catch (error) {
			if (session.launched) await this.closeSession(session);
			throw error instanceof Error ? error : /* @__PURE__ */ new Error("WALLPAPER_ENGINE_START_FAILED");
		}
	}
	/** Renderer ACK after its video element decoded the first captured frame. */
	async confirmCaptureReady(expectedSessionId) {
		const session = this.active;
		if (session === null || expectedSessionId !== session.sessionId) return false;
		try {
			await this.applyMute(session);
			return true;
		} catch {
			return false;
		}
	}
	async closeSession(session) {
		session.stopping = true;
		if (session.launched && session.executable !== "") try {
			await this.spawnControl(session.executable, [
				"-control",
				"closeWallpaper",
				"-location",
				session.locationTitle
			]);
		} catch {}
		if (this.active === session) this.active = null;
	}
	/** Stop one session (or all sessions when sessionId is empty). */
	async stop(expectedSessionId = "") {
		const normalized = expectedSessionId;
		const targets = this.active === null ? [] : [this.active];
		if (normalized !== "" && this.active?.sessionId !== normalized) return {
			ok: true,
			stopped: false,
			active: this.active !== null,
			sessionId: this.active?.sessionId ?? ""
		};
		for (const session of targets) await this.closeSession(session);
		return {
			ok: true,
			stopped: true,
			active: false,
			sessionId: ""
		};
	}
	/** Close everything and drop caches. */
	async dispose() {
		this.disposed = true;
		this.generation += 1;
		await this.stop();
		this.executableCache = null;
	}
};
//#endregion
//#region lib/types/src/main/desktop-mode.js
/**
* M5 desktop-mode runtimes for the DSH desktop shell:
* - DesktopWallpaperRuntime: a dedicated frameless wallpaper window attached
*   to the WorkerW desktop window behind the desktop icons.
* - DesktopModeRuntime: embeds the main BrowserWindow into Explorer's desktop
*   icon host (SHELLDLL_DefView) and controls desktop-icon visibility,
*   software-interaction lock, pointer routing, and keyboard focus.
*
* The Win32 interop is an independent implementation for DSH: it sends the
* standard Progman/WorkerW shell window messages, changes WS_CHILD/WS_POPUP
* styles, and reparents windows with SetParent. It never patches Explorer and
* always restores the original parent/style on disable.
*
* @module apps/desktop/src/main/desktop-mode
*/
function textOf(value, fallback = "") {
	return typeof value === "string" ? value : fallback;
}
/** The C# surface every generated PowerShell script shares. */
function desktopWin32Class() {
	return [
		"using System;",
		"using System.Runtime.InteropServices;",
		"using System.Text;",
		"public static class DshDesktopWin32 {",
		"  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);",
		"  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
		"  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }",
		"  [DllImport(\"user32.dll\", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr FindWindow(string className, string windowName);",
		"  [DllImport(\"user32.dll\", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string windowName);",
		"  [DllImport(\"user32.dll\", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);",
		"  [DllImport(\"user32.dll\", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);",
		"  [DllImport(\"user32.dll\", SetLastError=true)] public static extern IntPtr GetParent(IntPtr child);",
		"  [DllImport(\"user32.dll\", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindow(IntPtr hWnd);",
		"  [DllImport(\"user32.dll\", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr hWnd);",
		"  [DllImport(\"user32.dll\", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ShowWindow(IntPtr hWnd, int command);",
		"  [DllImport(\"user32.dll\", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);",
		"  [DllImport(\"user32.dll\", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);",
		"  [DllImport(\"user32.dll\", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ScreenToClient(IntPtr hWnd, ref POINT point);",
		"  [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder value, int maxCount);",
		"  [DllImport(\"user32.dll\", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);",
		"  [DllImport(\"user32.dll\", EntryPoint=\"GetWindowLongPtrW\", SetLastError=true)] private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);",
		"  [DllImport(\"user32.dll\", EntryPoint=\"GetWindowLongW\", SetLastError=true)] private static extern IntPtr GetWindowLong32(IntPtr hWnd, int index);",
		"  [DllImport(\"user32.dll\", EntryPoint=\"SetWindowLongPtrW\", SetLastError=true)] private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);",
		"  [DllImport(\"user32.dll\", EntryPoint=\"SetWindowLongW\", SetLastError=true)] private static extern IntPtr SetWindowLong32(IntPtr hWnd, int index, IntPtr value);",
		"  [DllImport(\"user32.dll\")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);",
		"  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int index) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, index) : GetWindowLong32(hWnd, index); }",
		"  public static IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value) { return IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, index, value) : SetWindowLong32(hWnd, index, value); }",
		"}"
	].join("\n");
}
/** Generate one self-contained PowerShell script around a body string. */
function desktopPowerShellScript(body) {
	return [
		"$ErrorActionPreference = \"Stop\"",
		"if (-not (\"DshDesktopWin32\" -as [type])) { Add-Type -TypeDefinition @\"",
		desktopWin32Class(),
		"\"@ }",
		"$previousDpiContext = [IntPtr]::Zero",
		"try {",
		"  try { $previousDpiContext = [DshDesktopWin32]::SetThreadDpiAwarenessContext([IntPtr]::new([Int64]-4)) } catch { }",
		"  " + body.replace(/\n/g, "\n  "),
		"} finally {",
		"  if ($previousDpiContext -ne [IntPtr]::Zero) {",
		"    try { [DshDesktopWin32]::SetThreadDpiAwarenessContext($previousDpiContext) | Out-Null } catch { }",
		"  }",
		"}"
	].join("\n");
}
function normalizeBounds(value, fallback) {
	const source = value ?? fallback;
	return {
		x: Math.round(source.x || 0),
		y: Math.round(source.y || 0),
		width: Math.max(1, Math.round(source.width || 1)),
		height: Math.max(1, Math.round(source.height || 1))
	};
}
function nativeWindowHandleDecimal(win) {
	const handle = win.getNativeWindowHandle();
	if (!Buffer.isBuffer(handle) || handle.length < 4) throw new Error("DSH_DESKTOP_NATIVE_HANDLE_INVALID");
	if (handle.length >= 8) return handle.readBigUInt64LE(0).toString();
	return String(handle.readUInt32LE(0));
}
/** WorkerW attach: Progman -> WorkerW behind SHELLDLL_DefView -> child-style reparent. */
function workerWAttachScript(input) {
	const hwnd = input.hwnd;
	if (!/^\d+$/.test(hwnd)) throw new Error("DSH_DESKTOP_NATIVE_HANDLE_INVALID");
	const bounds = normalizeBounds(input, {
		x: 0,
		y: 0,
		width: 1,
		height: 1
	});
	return desktopPowerShellScript([
		"$target = [IntPtr]::new([Int64]" + hwnd + ")",
		"if (-not [DshDesktopWin32]::IsWindow($target)) { throw \"DSH_DESKTOP_TARGET_NOT_FOUND\" }",
		"$progman = [DshDesktopWin32]::FindWindow(\"Progman\", $null)",
		"if ($progman -eq [IntPtr]::Zero) { throw \"DSH_DESKTOP_PROGMAN_NOT_FOUND\" }",
		"$sendResult = [IntPtr]::Zero",
		"[DshDesktopWin32]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$sendResult) | Out-Null",
		"$script:workerw = [IntPtr]::Zero",
		"$callback = [DshDesktopWin32+EnumWindowsProc]{ param([IntPtr]$top, [IntPtr]$state)",
		"  $shellView = [DshDesktopWin32]::FindWindowEx($top, [IntPtr]::Zero, \"SHELLDLL_DefView\", $null)",
		"  if ($shellView -ne [IntPtr]::Zero) {",
		"    $candidate = [DshDesktopWin32]::FindWindowEx([IntPtr]::Zero, $top, \"WorkerW\", $null)",
		"    if ($candidate -ne [IntPtr]::Zero) { $script:workerw = $candidate }",
		"  }",
		"  return $true",
		"}",
		"[DshDesktopWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null",
		"if ($script:workerw -eq [IntPtr]::Zero) { throw \"DSH_DESKTOP_WORKERW_NOT_FOUND\" }",
		"$GWL_STYLE = -16",
		"$WS_POPUP = [Int64]0x80000000",
		"$WS_CHILD = [Int64]0x40000000",
		"$style = [DshDesktopWin32]::GetWindowLongPtr($target, $GWL_STYLE).ToInt64()",
		"$childStyle = ($style -band (-bnot $WS_POPUP)) -bor $WS_CHILD",
		"[DshDesktopWin32]::SetWindowLongPtr($target, $GWL_STYLE, [IntPtr]::new([Int64]$childStyle)) | Out-Null",
		"[DshDesktopWin32]::SetParent($target, $script:workerw) | Out-Null",
		"if ([DshDesktopWin32]::GetParent($target) -ne $script:workerw) { throw \"DSH_DESKTOP_WORKERW_ATTACH_FAILED\" }",
		"$origin = New-Object DshDesktopWin32+POINT",
		"$origin.X = " + String(bounds.x),
		"$origin.Y = " + String(bounds.y),
		"if (-not [DshDesktopWin32]::ScreenToClient($script:workerw, [ref]$origin)) { throw \"DSH_DESKTOP_WORKERW_BOUNDS_FAILED\" }",
		"if (-not [DshDesktopWin32]::SetWindowPos($target, [IntPtr]::new([Int64]1), $origin.X, $origin.Y, " + String(bounds.width) + ", " + String(bounds.height) + ", 0x0030)) { throw \"DSH_DESKTOP_WORKERW_POSITION_FAILED\" }",
		"$className = New-Object System.Text.StringBuilder 128",
		"[DshDesktopWin32]::GetClassName($script:workerw, $className, $className.Capacity) | Out-Null",
		"[pscustomobject]@{ ok = $true; targetWindowId = $target.ToInt64().ToString(); parentWindowId = $script:workerw.ToInt64().ToString(); parentClassName = $className.ToString(); x = " + String(bounds.x) + "; y = " + String(bounds.y) + "; width = " + String(bounds.width) + "; height = " + String(bounds.height) + " } | ConvertTo-Json -Compress"
	].join("\n"));
}
/** Detach a WorkerW-attached window back to a top-level popup. */
function workerWDetachScript(input) {
	const hwnd = input.hwnd;
	if (!/^\d+$/.test(hwnd)) throw new Error("DSH_DESKTOP_NATIVE_HANDLE_INVALID");
	const bounds = normalizeBounds(input, {
		x: 0,
		y: 0,
		width: 1280,
		height: 720
	});
	return desktopPowerShellScript([
		"$target = [IntPtr]::new([Int64]" + hwnd + ")",
		"if (-not [DshDesktopWin32]::IsWindow($target)) { throw \"DSH_DESKTOP_TARGET_NOT_FOUND\" }",
		"[DshDesktopWin32]::SetParent($target, [IntPtr]::Zero) | Out-Null",
		"$GWL_STYLE = -16",
		"$WS_POPUP = [Int64]0x80000000",
		"$WS_CHILD = [Int64]0x40000000",
		"$style = [DshDesktopWin32]::GetWindowLongPtr($target, $GWL_STYLE).ToInt64()",
		"$topStyle = ($style -band (-bnot $WS_CHILD)) -bor $WS_POPUP",
		"[DshDesktopWin32]::SetWindowLongPtr($target, $GWL_STYLE, [IntPtr]::new([Int64]$topStyle)) | Out-Null",
		"if (-not [DshDesktopWin32]::SetWindowPos($target, [IntPtr]::Zero, " + String(bounds.x) + ", " + String(bounds.y) + ", " + String(bounds.width) + ", " + String(bounds.height) + ", 0x0030)) { throw \"DSH_DESKTOP_DETACH_POSITION_FAILED\" }",
		"[pscustomobject]@{ ok = $true; targetWindowId = $target.ToInt64().ToString(); parentWindowId = \"0\"; parentClassName = \"\"; child = $false; popup = $true; x = " + String(bounds.x) + "; y = " + String(bounds.y) + "; width = " + String(bounds.width) + "; height = " + String(bounds.height) + " } | ConvertTo-Json -Compress"
	].join("\n"));
}
/** Find Explorer's desktop icon host (top-level window -> SHELLDLL_DefView -> SysListView32). */
function desktopIconHostScript() {
	return desktopPowerShellScript([
		"$iconHost = [IntPtr]::Zero",
		"$defView = [IntPtr]::Zero",
		"$listView = [IntPtr]::Zero",
		"$hostClass = \"\"",
		"$callback = [DshDesktopWin32+EnumWindowsProc]{ param([IntPtr]$top, [IntPtr]$state)",
		"  $view = [DshDesktopWin32]::FindWindowEx($top, [IntPtr]::Zero, \"SHELLDLL_DefView\", $null)",
		"  if ($view -eq [IntPtr]::Zero) { return $true }",
		"  $list = [DshDesktopWin32]::FindWindowEx($view, [IntPtr]::Zero, \"SysListView32\", $null)",
		"  if ($list -eq [IntPtr]::Zero) { return $true }",
		"  $className = New-Object System.Text.StringBuilder 128",
		"  [DshDesktopWin32]::GetClassName($top, $className, $className.Capacity) | Out-Null",
		"  $script:iconHost = $top; $script:defView = $view; $script:listView = $list; $script:hostClass = $className.ToString()",
		"  return $false",
		"}",
		"[DshDesktopWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null",
		"if ($script:defView -eq [IntPtr]::Zero -or $script:listView -eq [IntPtr]::Zero) { throw \"DSH_DESKTOP_ICON_HOST_NOT_FOUND\" }",
		"[pscustomobject]@{ ok = $true; topLevelHostWindowId = $script:iconHost.ToInt64().ToString(); desktopViewWindowId = $script:defView.ToInt64().ToString(); desktopListWindowId = $script:listView.ToInt64().ToString(); hostClassName = $script:hostClass; listVisible = [DshDesktopWin32]::IsWindowVisible($script:listView) } | ConvertTo-Json -Compress"
	].join("\n"));
}
/** Reparent a window into Explorer's SHELLDLL_DefView and position it over the desktop. */
function desktopIconHostAttachScript(input) {
	const hwnd = input.hwnd;
	if (!/^\d+$/.test(hwnd)) throw new Error("DSH_DESKTOP_NATIVE_HANDLE_INVALID");
	const bounds = normalizeBounds(input, {
		x: 0,
		y: 0,
		width: 1,
		height: 1
	});
	return desktopPowerShellScript([
		"$target = [IntPtr]::new([Int64]" + hwnd + ")",
		"if (-not [DshDesktopWin32]::IsWindow($target)) { throw \"DSH_DESKTOP_TARGET_NOT_FOUND\" }",
		"$iconHost = [IntPtr]::Zero",
		"$defView = [IntPtr]::Zero",
		"$listView = [IntPtr]::Zero",
		"$callback = [DshDesktopWin32+EnumWindowsProc]{ param([IntPtr]$top, [IntPtr]$state)",
		"  $view = [DshDesktopWin32]::FindWindowEx($top, [IntPtr]::Zero, \"SHELLDLL_DefView\", $null)",
		"  if ($view -eq [IntPtr]::Zero) { return $true }",
		"  $list = [DshDesktopWin32]::FindWindowEx($view, [IntPtr]::Zero, \"SysListView32\", $null)",
		"  if ($list -eq [IntPtr]::Zero) { return $true }",
		"  $script:iconHost = $top; $script:defView = $view; $script:listView = $list",
		"  return $false",
		"}",
		"[DshDesktopWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null",
		"if ($script:defView -eq [IntPtr]::Zero -or $script:listView -eq [IntPtr]::Zero) { throw \"DSH_DESKTOP_ICON_HOST_NOT_FOUND\" }",
		"$parentRect = New-Object DshDesktopWin32+RECT",
		"if (-not [DshDesktopWin32]::GetWindowRect($script:defView, [ref]$parentRect)) { throw \"DSH_DESKTOP_ICON_HOST_BOUNDS_FAILED\" }",
		"$GWL_STYLE = -16",
		"$WS_POPUP = [Int64]0x80000000",
		"$WS_CHILD = [Int64]0x40000000",
		"$style = [DshDesktopWin32]::GetWindowLongPtr($target, $GWL_STYLE).ToInt64()",
		"$childStyle = ($style -band (-bnot $WS_POPUP)) -bor $WS_CHILD",
		"[DshDesktopWin32]::SetWindowLongPtr($target, $GWL_STYLE, [IntPtr]::new([Int64]$childStyle)) | Out-Null",
		"[DshDesktopWin32]::SetParent($target, $script:defView) | Out-Null",
		"if ([DshDesktopWin32]::GetParent($target) -ne $script:defView) { throw \"DSH_DESKTOP_ICON_HOST_ATTACH_FAILED\" }",
		"$localX = " + String(bounds.x) + " - $parentRect.Left",
		"$localY = " + String(bounds.y) + " - $parentRect.Top",
		"if (-not [DshDesktopWin32]::SetWindowPos($target, [IntPtr]::new([Int64]1), $localX, $localY, " + String(bounds.width) + ", " + String(bounds.height) + ", 0x0030)) { throw \"DSH_DESKTOP_ICON_HOST_POSITION_FAILED\" }",
		"[pscustomobject]@{ ok = $true; targetWindowId = $target.ToInt64().ToString(); parentWindowId = $script:defView.ToInt64().ToString(); parentClassName = \"SHELLDLL_DefView\"; topLevelHostWindowId = $script:iconHost.ToInt64().ToString(); desktopViewWindowId = $script:defView.ToInt64().ToString(); desktopListWindowId = $script:listView.ToInt64().ToString(); child = $true; popup = $false } | ConvertTo-Json -Compress"
	].join("\n"));
}
/** Show or hide Explorer's desktop icon list (SysListView32). */
function desktopIconsVisibleScript(visible) {
	return desktopPowerShellScript([
		"$iconHost = [IntPtr]::Zero",
		"$defView = [IntPtr]::Zero",
		"$listView = [IntPtr]::Zero",
		"$callback = [DshDesktopWin32+EnumWindowsProc]{ param([IntPtr]$top, [IntPtr]$state)",
		"  $view = [DshDesktopWin32]::FindWindowEx($top, [IntPtr]::Zero, \"SHELLDLL_DefView\", $null)",
		"  if ($view -eq [IntPtr]::Zero) { return $true }",
		"  $list = [DshDesktopWin32]::FindWindowEx($view, [IntPtr]::Zero, \"SysListView32\", $null)",
		"  if ($list -eq [IntPtr]::Zero) { return $true }",
		"  $script:iconHost = $top; $script:defView = $view; $script:listView = $list",
		"  return $false",
		"}",
		"[DshDesktopWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null",
		"if ($script:defView -eq [IntPtr]::Zero -or $script:listView -eq [IntPtr]::Zero) { throw \"DSH_DESKTOP_ICON_HOST_NOT_FOUND\" }",
		"if (-not [DshDesktopWin32]::ShowWindow($script:listView, " + (visible ? "5" : "0") + ")) { throw \"DSH_DESKTOP_ICON_VISIBILITY_FAILED\" }",
		"[pscustomobject]@{ ok = $true; desktopListWindowId = $script:listView.ToInt64().ToString(); visible = [DshDesktopWin32]::IsWindowVisible($script:listView) } | ConvertTo-Json -Compress"
	].join("\n"));
}
/** Parse the last JSON line of native PowerShell stdout. */
function parseJsonLine(stdout) {
	const lines = (stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	for (let index = lines.length - 1; index >= 0; index -= 1) try {
		const value = JSON.parse(lines[index] ?? "");
		if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
	} catch {}
	throw new Error("DSH_DESKTOP_NATIVE_ACK_INVALID");
}
function nativeErrorCode(error, stderr, fallback) {
	const detail = stderr || error?.message || fallback;
	const match = /DSH_DESKTOP_[A-Z0-9_]+/.exec(detail);
	if (match?.[0] !== void 0) return match[0];
	return fallback;
}
/** Run one generated PowerShell script and resolve its JSON ack. */
function runDesktopNativeScript(script, options = {}) {
	const execFileImpl = options.execFileImpl ?? execFile;
	const timeoutMs = Math.max(1e3, Math.min(2e4, Number(options.timeoutMs) || 8e3));
	return new Promise((resolvePromise, reject) => {
		execFileImpl("powershell.exe", [
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			script
		], {
			encoding: "utf8",
			windowsHide: true,
			timeout: timeoutMs,
			maxBuffer: 256 * 1024,
			env: options.nativeTempPath !== void 0 ? {
				...process.env,
				TEMP: options.nativeTempPath,
				TMP: options.nativeTempPath
			} : process.env
		}, (error, stdout, stderr) => {
			if (error !== null) {
				const code = nativeErrorCode(error, stderr || "", "DSH_DESKTOP_NATIVE_SCRIPT_FAILED");
				reject(new Error(code));
				return;
			}
			try {
				resolvePromise(parseJsonLine(stdout || ""));
			} catch (parseError) {
				reject(parseError instanceof Error ? parseError : /* @__PURE__ */ new Error("DSH_DESKTOP_NATIVE_ACK_INVALID"));
			}
		});
	});
}
/** Bounds of the primary display in DIPs and physical pixels. */
function primaryDisplayBounds(screen) {
	const bounds = normalizeBounds(screen.getPrimaryDisplay().bounds, {
		x: 0,
		y: 0,
		width: 1920,
		height: 1080
	});
	let physicalBounds = bounds;
	if (typeof screen.dipToScreenRect === "function") try {
		const converted = screen.dipToScreenRect(null, bounds);
		if (converted !== null) physicalBounds = normalizeBounds(converted, bounds);
	} catch {}
	return {
		bounds,
		physicalBounds
	};
}
/** Render the wallpaper window page for one media URL. */
function wallpaperDataUrl(url, kind) {
	const html = [
		"<!doctype html><html><head><meta charset=\"utf-8\"><style>",
		"html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050608}",
		"img,video{position:absolute;inset:0;width:100%;height:100%}",
		"img{object-fit:cover}video{object-fit:cover}",
		"</style></head><body>",
		kind === "video" ? "<video id=\"media\" autoplay muted loop playsinline src=\"" + url + "\"></video>" : "<img id=\"media\" alt=\"\" src=\"" + url + "\">",
		"</body></html>"
	].join("");
	return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}
/** A frameless wallpaper window embedded into WorkerW behind desktop icons. */
var DesktopWallpaperRuntime = class {
	BrowserWindowClass;
	screen;
	nativeOptions;
	window = null;
	attachment = null;
	enabled = false;
	error = "";
	constructor(options) {
		this.BrowserWindowClass = options.BrowserWindow;
		this.screen = options.screen;
		this.nativeOptions = {
			execFileImpl: options.execFileImpl,
			nativeTempPath: options.nativeTempPath
		};
	}
	isSupported() {
		return process.platform === "win32";
	}
	getStatus() {
		return {
			ok: this.error === "",
			supported: this.isSupported(),
			enabled: this.enabled,
			active: this.enabled && this.window !== null && !this.window.isDestroyed() && this.attachment !== null,
			windowId: this.window !== null && !this.window.isDestroyed() ? this.window.id : null,
			nativeWindowId: this.attachment?.targetWindowId ?? "",
			parentWindowId: this.attachment?.parentWindowId ?? "",
			parentClassName: this.attachment?.parentClassName ?? "",
			bounds: this.attachment !== null ? {
				x: this.attachment.x,
				y: this.attachment.y,
				width: this.attachment.width,
				height: this.attachment.height
			} : null,
			error: this.error
		};
	}
	async attach(win) {
		const { physicalBounds } = primaryDisplayBounds(this.screen);
		const ack = await runDesktopNativeScript(workerWAttachScript({
			hwnd: nativeWindowHandleDecimal(win),
			...physicalBounds
		}), this.nativeOptions);
		if (ack.ok !== true || !/^\d+$/.test(textOf(ack.parentWindowId))) throw new Error("DSH_DESKTOP_WORKERW_ACK_INVALID");
		return {
			targetWindowId: textOf(ack.targetWindowId),
			parentWindowId: textOf(ack.parentWindowId),
			parentClassName: textOf(ack.parentClassName),
			x: Number(ack.x) || 0,
			y: Number(ack.y) || 0,
			width: Math.max(1, Number(ack.width) || 1),
			height: Math.max(1, Number(ack.height) || 1)
		};
	}
	async start(url, kind) {
		if (!this.isSupported()) {
			this.error = "DSH_DESKTOP_PLATFORM_UNSUPPORTED";
			return this.getStatus();
		}
		if (this.window !== null && !this.window.isDestroyed()) await this.stop();
		const { bounds } = primaryDisplayBounds(this.screen);
		const win = new this.BrowserWindowClass({
			...bounds,
			frame: false,
			transparent: false,
			backgroundColor: "#050608",
			hasShadow: false,
			resizable: false,
			movable: false,
			focusable: false,
			skipTaskbar: true,
			show: false,
			title: "DSH Desktop Wallpaper",
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: false
			}
		});
		this.window = win;
		win.setIgnoreMouseEvents(true);
		try {
			await win.loadURL(wallpaperDataUrl(url, kind));
			this.attachment = await this.attach(win);
			this.enabled = true;
			this.error = "";
			win.showInactive();
			return this.getStatus();
		} catch (cause) {
			this.enabled = false;
			this.attachment = null;
			this.error = cause instanceof Error ? cause.message : "DSH_DESKTOP_WALLPAPER_START_FAILED";
			if (!win.isDestroyed()) win.destroy();
			this.window = null;
			return this.getStatus();
		}
	}
	async update(url, kind) {
		const win = this.window;
		if (win === null || win.isDestroyed()) return this.start(url, kind);
		try {
			await win.loadURL(wallpaperDataUrl(url, kind));
			this.error = "";
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : "DSH_DESKTOP_WALLPAPER_UPDATE_FAILED";
		}
		return this.getStatus();
	}
	async stop() {
		const win = this.window;
		this.enabled = false;
		if (win !== null && !win.isDestroyed() && this.attachment !== null) try {
			await runDesktopNativeScript(workerWDetachScript({
				hwnd: this.attachment.targetWindowId,
				x: this.attachment.x,
				y: this.attachment.y,
				width: this.attachment.width,
				height: this.attachment.height
			}), this.nativeOptions);
		} catch {}
		this.attachment = null;
		if (win !== null && !win.isDestroyed()) win.destroy();
		this.window = null;
		this.error = "";
		return this.getStatus();
	}
	async dispose() {
		await this.stop();
	}
};
/** Embeds the main window into Explorer's desktop icon host and manages desktop-icon controls. */
var DesktopModeRuntime = class {
	screen;
	nativeOptions;
	window = null;
	snapshot = null;
	attachment = null;
	enabled = false;
	interactive = true;
	softwareInteractionLocked = false;
	desktopIconsVisible = true;
	pointerRoute = {
		overSoftwareUi: false,
		overDesktopControls: false
	};
	error = "";
	reason = "";
	listeners = /* @__PURE__ */ new Set();
	constructor(options) {
		this.screen = options.screen;
		this.nativeOptions = {
			execFileImpl: options.execFileImpl,
			nativeTempPath: options.nativeTempPath
		};
	}
	isSupported() {
		return process.platform === "win32";
	}
	onStatus(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	getStatus(reason = this.reason) {
		const win = this.window;
		const alive = win !== null && !win.isDestroyed();
		return {
			ok: this.error === "",
			supported: this.isSupported(),
			enabled: this.enabled,
			interactive: this.enabled && this.interactive,
			attached: this.enabled && alive && this.attachment !== null,
			windowId: alive ? win.id : null,
			nativeWindowId: this.attachment?.targetWindowId ?? "",
			parentWindowId: this.attachment?.parentWindowId ?? "",
			parentClassName: this.attachment?.parentClassName ?? "",
			topLevelHostWindowId: this.attachment?.topLevelHostWindowId ?? "",
			desktopViewWindowId: this.attachment?.desktopViewWindowId ?? "",
			desktopListWindowId: this.attachment?.desktopListWindowId ?? "",
			desktopIconsVisible: this.desktopIconsVisible,
			softwareInteractionLocked: this.softwareInteractionLocked,
			ignoreMouseEvents: this.softwareInteractionLocked || this.enabled && this.pointerRoute.overDesktopControls && !this.pointerRoute.overSoftwareUi,
			pointerRoute: { ...this.pointerRoute },
			error: this.error,
			reason
		};
	}
	emitStatus(reason) {
		const status = this.getStatus(reason);
		for (const listener of this.listeners) listener(status);
		return status;
	}
	capture(win) {
		const bounds = win.getBounds();
		const minimum = win.getMinimumSize();
		const maximum = win.getMaximumSize();
		const minimumWidth = minimum[0] ?? 0;
		const minimumHeight = minimum[1] ?? 0;
		const maximumWidth = maximum[0] ?? 0;
		const maximumHeight = maximum[1] ?? 0;
		return {
			bounds: normalizeBounds(bounds, {
				x: 0,
				y: 0,
				width: 1440,
				height: 900
			}),
			maximized: win.isMaximized(),
			fullScreen: win.isFullScreen(),
			minimized: win.isMinimized(),
			resizable: win.isResizable(),
			movable: win.isMovable(),
			focusable: win.isFocusable(),
			hasShadow: win.hasShadow(),
			minimumSize: minimumWidth > 0 || minimumHeight > 0 ? [minimumWidth, minimumHeight] : null,
			maximumSize: maximumWidth > 0 || maximumHeight > 0 ? [maximumWidth, maximumHeight] : null
		};
	}
	restore(win, snapshot) {
		win.setResizable(snapshot.resizable);
		win.setMovable(snapshot.movable);
		win.setFocusable(snapshot.focusable);
		win.setHasShadow(snapshot.hasShadow);
		win.setMinimumSize(snapshot.minimumSize?.[0] ?? 0, snapshot.minimumSize?.[1] ?? 0);
		win.setMaximumSize(snapshot.maximumSize?.[0] ?? 0, snapshot.maximumSize?.[1] ?? 0);
		win.setBounds(snapshot.bounds);
		if (snapshot.maximized) win.maximize();
		if (snapshot.minimized) win.minimize();
	}
	async enable(win, options = {}) {
		if (!this.isSupported()) {
			this.error = "DSH_DESKTOP_PLATFORM_UNSUPPORTED";
			return this.emitStatus("enable-failed");
		}
		if (this.enabled && this.window === win) {
			this.interactive = options.interactive !== false;
			this.error = "";
			return this.emitStatus("enabled");
		}
		if (this.enabled) await this.disable("replaced");
		this.window = win;
		this.snapshot = this.capture(win);
		const { physicalBounds } = primaryDisplayBounds(this.screen);
		try {
			const ack = await runDesktopNativeScript(desktopIconHostAttachScript({
				hwnd: nativeWindowHandleDecimal(win),
				...physicalBounds
			}), this.nativeOptions);
			if (ack.ok !== true || !/^\d+$/.test(textOf(ack.parentWindowId))) throw new Error("DSH_DESKTOP_ICON_HOST_ACK_INVALID");
			this.attachment = {
				targetWindowId: textOf(ack.targetWindowId),
				parentWindowId: textOf(ack.parentWindowId),
				parentClassName: textOf(ack.parentClassName),
				topLevelHostWindowId: textOf(ack.topLevelHostWindowId),
				desktopViewWindowId: textOf(ack.desktopViewWindowId),
				desktopListWindowId: textOf(ack.desktopListWindowId),
				child: ack.child === true,
				popup: ack.popup === true
			};
			this.enabled = true;
			this.interactive = options.interactive !== false;
			this.error = "";
			this.reason = options.reason ?? "renderer-enabled";
			if (win.isMinimized()) win.restore();
			win.showInactive();
			return this.emitStatus("enabled");
		} catch (cause) {
			this.enabled = false;
			this.attachment = null;
			this.error = cause instanceof Error ? cause.message : "DSH_DESKTOP_ICON_HOST_ATTACH_FAILED";
			this.emitStatus("enable-failed");
			return this.getStatus("enable-failed");
		}
	}
	async disable(reason = "renderer-disabled") {
		const win = this.window;
		if (!this.enabled && this.attachment === null) return this.getStatus(reason);
		if (win !== null && !win.isDestroyed() && this.attachment !== null) {
			const snapshot = this.snapshot ?? {
				bounds: {
					x: 0,
					y: 0,
					width: 1440,
					height: 900
				},
				maximized: false,
				fullScreen: false,
				minimized: false,
				resizable: true,
				movable: true,
				focusable: true,
				hasShadow: true,
				minimumSize: null,
				maximumSize: null
			};
			try {
				await runDesktopNativeScript(workerWDetachScript({
					hwnd: this.attachment.targetWindowId,
					...snapshot.bounds
				}), this.nativeOptions);
			} catch {
				this.error = "DSH_DESKTOP_DETACH_FAILED";
			}
			this.restore(win, snapshot);
		}
		this.enabled = false;
		this.interactive = true;
		this.attachment = null;
		this.window = null;
		this.reason = reason;
		if (win !== null && !win.isDestroyed() && !win.isVisible()) win.show();
		return this.emitStatus(reason);
	}
	async setDesktopIconsVisible(visible) {
		try {
			const ack = await runDesktopNativeScript(desktopIconsVisibleScript(visible), this.nativeOptions);
			this.desktopIconsVisible = ack.visible === true;
			this.error = "";
			this.emitStatus("desktop-icons-visible");
			return {
				ok: true,
				visible: this.desktopIconsVisible,
				error: ""
			};
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : "DSH_DESKTOP_ICON_VISIBILITY_FAILED";
			return {
				ok: false,
				visible: this.desktopIconsVisible,
				error: this.error
			};
		}
	}
	async probeDesktopIcons() {
		try {
			const ack = await runDesktopNativeScript(desktopIconHostScript(), this.nativeOptions);
			const visible = ack.listVisible === true;
			this.desktopIconsVisible = visible;
			this.error = "";
			return {
				ok: true,
				found: true,
				visible,
				desktopListWindowId: textOf(ack.desktopListWindowId),
				error: ""
			};
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : "DSH_DESKTOP_ICON_HOST_NOT_FOUND";
			return {
				ok: false,
				found: false,
				visible: this.desktopIconsVisible,
				desktopListWindowId: "",
				error: this.error
			};
		}
	}
	setSoftwareInteractionLocked(locked) {
		this.softwareInteractionLocked = locked;
		const win = this.window;
		if (win !== null && !win.isDestroyed() && typeof win.setIgnoreMouseEvents === "function") win.setIgnoreMouseEvents(locked);
		return this.emitStatus(locked ? "software-locked" : "software-unlocked");
	}
	updatePointerRoute(payload) {
		this.pointerRoute = {
			overSoftwareUi: payload.overSoftwareUi === true,
			overDesktopControls: payload.overDesktopControls === true
		};
		const win = this.window;
		if (this.enabled && win !== null && !win.isDestroyed() && typeof win.setIgnoreMouseEvents === "function") {
			const ignoreMouse = this.softwareInteractionLocked || this.pointerRoute.overDesktopControls && !this.pointerRoute.overSoftwareUi;
			win.setIgnoreMouseEvents(ignoreMouse);
		}
		return this.getStatus("pointer-route");
	}
	requestKeyboardFocus() {
		const win = this.window;
		if (!this.enabled || win === null || win.isDestroyed()) return {
			ok: false,
			focused: false
		};
		win.focus();
		return {
			ok: true,
			focused: win.isFocused()
		};
	}
	async dispose() {
		if (this.enabled) await this.disable("dispose");
		this.listeners.clear();
	}
};
//#endregion
//#region lib/types/src/main/index.js
/**
* DSH desktop shell main process: Electron window over the dsh web UI plus
* the Wallpaper Engine library/runtime bridge. The window loads the local dsh
* web server (http://127.0.0.1:3080); the shell adds only a window and the
* preload bridge — it never re-hosts or rewrites the chat UI.
*
* @module apps/desktop/src/main
*/
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DESKTOP_WEB_URL = process.env.DSH_DESKTOP_URL ?? "http://127.0.0.1:3080";
const ALLOWED_ORIGINS = new Set(["http://127.0.0.1:3080", "http://localhost:3080"]);
app.disableHardwareAcceleration();
app.setAppUserModelId("com.deepseek.dsh.desktop");
nativeTheme.themeSource = "light";
let mainWindow = null;
let library = null;
let runtime = null;
let desktopWallpaper = null;
let desktopMode = null;
let boundsTimer = null;
protocol.registerSchemesAsPrivileged([{
	scheme: WALLPAPER_ENGINE_SCHEME,
	privileges: {
		standard: true,
		secure: true,
		supportFetchAPI: true,
		corsEnabled: true,
		stream: true
	}
}]);
/** IPC trust fence: main frame of our window and an allowed origin only. */
function isTrustedSender(event) {
	if (mainWindow === null || mainWindow.isDestroyed()) return false;
	const frame = event.senderFrame;
	if (frame === null || frame !== event.sender.mainFrame) return false;
	const url = new URL(frame.url);
	return ALLOWED_ORIGINS.has(url.origin) && event.sender === mainWindow.webContents;
}
function stringArg(value) {
	return typeof value === "string" ? value : "";
}
function failUntrusted() {
	return {
		ok: false,
		error: "DESKTOP_UNTRUSTED_CALLER"
	};
}
function isPortListening(port) {
	return new Promise((resolvePromise) => {
		const socket = connect({
			port,
			host: "127.0.0.1",
			timeout: 1200
		});
		const finish = (listening) => {
			socket.destroy();
			resolvePromise(listening);
		};
		socket.once("connect", () => {
			finish(true);
		});
		socket.once("timeout", () => {
			finish(false);
		});
		socket.once("error", () => {
			finish(false);
		});
	});
}
let installerWindow = null;
let installCancelRequested = false;
function emitInstallProgress(payload) {
	if (installerWindow !== null && !installerWindow.isDestroyed()) installerWindow.webContents.send("dsh-install-progress", payload);
}
function runCommand(file, args, timeoutMs = 12e4) {
	return new Promise((resolvePromise) => {
		execFile(file, args, {
			encoding: "utf8",
			windowsHide: true,
			timeout: timeoutMs,
			maxBuffer: 4 * 1024 * 1024
		}, (error, stdout, stderr) => {
			resolvePromise({
				code: error === null ? 0 : Number(error.code) || 1,
				stdout: stdout || "",
				stderr: stderr || ""
			});
		});
	});
}
function findDshCommand() {
	const candidates = [join(process.env.APPDATA ?? "", "npm", "dsh.cmd"), "dsh"];
	for (const candidate of candidates) {
		if (candidate === "dsh") continue;
		if (existsSync(candidate)) return candidate;
	}
	return "dsh";
}
async function dshCommandWorks(command) {
	if (command === "dsh") return (await runCommand("dsh", ["--version"], 1e4)).code === 0;
	return existsSync(command);
}
function setupWindowHtml(initialPhase) {
	return "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>DeepSeek Harness桌面版安装</title>
<style>
  body{margin:0;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;background:#f6f7f9;color:#1a1b1f;display:flex;align-items:center;justify-content:center;height:100vh}
  .card{width:460px;padding:28px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08)}
  h1{font-size:20px;margin:0 0 8px}
  p{font-size:14px;line-height:22px;color:#555}
  .status{margin:14px 0;padding:10px 12px;background:#f0f4ff;border-radius:8px;font-size:13px;line-height:20px}
  .error{background:#fff0f0;color:#b42318}
  button{border:0;padding:10px 16px;border-radius:8px;background:#3964fe;color:#fff;font-size:14px;cursor:pointer}
  button.ghost{background:#eef0f3;color:#333;margin-left:8px}
  button:disabled{opacity:.5;cursor:default}
</style></head>
<body><div class="card">
  <h1>DeepSeek Harness桌面版</h1>
  <p id="title">首次使用需要安装 DeepSeek Harness 运行环境。</p>
  <div class="status" id="status">${initialPhase === "missing-dsh" ? "未检测到 dsh，点击下方按钮开始一键安装。" : "正在检查运行环境…"}</div>
  <div>
    <button id="install" type="button">一键安装</button>
    <button id="manual" class="ghost" type="button">手动安装说明</button>
    <button id="quit" class="ghost" type="button">退出</button>
  </div>
</div>
<script>
  const status = document.getElementById('status')
  const install = document.getElementById('install')
  const manual = document.getElementById('manual')
  const quit = document.getElementById('quit')
  window.desktopWindow.onDshInstallProgress(payload => {
    status.className = 'status' + (payload.phase === 'error' ? ' error' : '')
    status.textContent = payload.message
    install.disabled = ['installing-node','installing-dsh'].includes(payload.phase)
    if (payload.phase === 'done') setTimeout(() => window.close(), 700)
  })
  install.addEventListener('click', () => window.desktopWindow.startDshInstall())
  manual.addEventListener('click', () => window.desktopWindow.openDshInstallHelp())
  quit.addEventListener('click', () => window.desktopWindow.cancelDshInstall())
<\/script></body></html>`);
}
async function showInstallerWindow(initialPhase) {
	if (installerWindow !== null && !installerWindow.isDestroyed()) {
		installerWindow.focus();
		return false;
	}
	installCancelRequested = false;
	const win = new BrowserWindow({
		width: 560,
		height: 420,
		resizable: false,
		frame: true,
		title: "DeepSeek Harness桌面版安装",
		autoHideMenuBar: true,
		icon: join(__dirname, "..", "assets", "icon.ico"),
		webPreferences: {
			preload: join(__dirname, "preload.mjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false
		}
	});
	installerWindow = win;
	win.on("closed", () => {
		if (installerWindow === win) installerWindow = null;
	});
	await win.loadURL(setupWindowHtml(initialPhase));
	return true;
}
/**
* Install the dsh CLI when it is missing. The installer uses winget for
* Node.js (when needed), then `npm install -g @deepseek-ai/dsh`, and finally
* asks the caller to start `dsh web` again.
*/
async function runDshInstall() {
	emitInstallProgress({
		phase: "checking",
		message: "正在检查 Node.js 和 npm…"
	});
	let nodeExe = "node";
	let npmCmd = "npm";
	const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
	const nodeExePath = join(programFiles, "nodejs", "node.exe");
	const npmCmdPath = join(programFiles, "nodejs", "npm.cmd");
	if ((await runCommand(nodeExe, ["--version"], 15e3)).code !== 0) if (existsSync(nodeExePath)) nodeExe = nodeExePath;
	else {
		emitInstallProgress({
			phase: "installing-node",
			message: "未检测到 Node.js，正在用 winget 安装…"
		});
		const winget = await runCommand("winget.exe", [
			"install",
			"-e",
			"--id",
			"OpenJS.NodeJS.LTS",
			"--scope",
			"user",
			"--silent",
			"--accept-package-agreements",
			"--accept-source-agreements"
		], 6e5);
		if (winget.code !== 0) {
			emitInstallProgress({
				phase: "error",
				message: "Node.js 安装失败。",
				detail: winget.stderr || winget.stdout
			});
			return "";
		}
		nodeExe = existsSync(nodeExePath) ? nodeExePath : "node";
	}
	if (existsSync(npmCmdPath)) npmCmd = npmCmdPath;
	emitInstallProgress({
		phase: "installing-dsh",
		message: "正在安装 DeepSeek Harness（首次安装需要下载，请稍候）…"
	});
	const install = await runCommand(npmCmd, [
		"install",
		"-g",
		"@deepseek-ai/dsh@0.1.0-rc.5"
	], 6e5);
	if (install.code !== 0) {
		emitInstallProgress({
			phase: "error",
			message: "DeepSeek Harness 安装失败。",
			detail: install.stderr || install.stdout
		});
		return "";
	}
	const dshCmd = join(process.env.APPDATA ?? "", "npm", "dsh.cmd");
	if (!existsSync(dshCmd)) {
		emitInstallProgress({
			phase: "error",
			message: "安装完成但找不到 dsh 命令，请重启电脑后重试。"
		});
		return "";
	}
	emitInstallProgress({
		phase: "done",
		message: "安装完成，正在启动…"
	});
	return dshCmd;
}
/**
* Start `dsh web` with a resolved command and wait for its port.
* @param command - resolved dsh command path.
*/
async function startDshWeb(command) {
	const port = Number(new URL(DESKTOP_WEB_URL).port || 3080);
	if (await isPortListening(port)) return;
	try {
		const child = spawn(command, ["web"], {
			detached: true,
			windowsHide: true,
			stdio: "ignore"
		});
		child.on("error", () => {});
		child.unref();
	} catch {}
	for (let attempt = 0; attempt < 60; attempt += 1) {
		if (await isPortListening(port)) return;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 1e3));
	}
}
/**
* Bring up dsh web, installing the CLI first when necessary. Returns the
* resolved dsh command, an empty string when the installer window took over.
*/
async function ensureDshWebRunning() {
	const port = Number(new URL(DESKTOP_WEB_URL).port || 3080);
	if (process.env.DSH_DESKTOP_FORCE_INSTALLER === "1") {
		await showInstallerWindow("missing-dsh");
		return "";
	}
	if (await isPortListening(port)) return "already-running";
	const command = findDshCommand();
	if (!await dshCommandWorks(command)) {
		await showInstallerWindow("missing-dsh");
		return "";
	}
	await startDshWeb(command);
	return command;
}
/** Send a debounced host-bounds update so the renderer can freeze/recover. */
function scheduleHostBoundsChanged() {
	if (boundsTimer !== null) clearTimeout(boundsTimer);
	boundsTimer = setTimeout(() => {
		boundsTimer = null;
		if (mainWindow === null || mainWindow.isDestroyed()) return;
		const bounds = mainWindow.getContentBounds();
		mainWindow.webContents.send("dsh-wallpaper-engine-host-bounds-changed", {
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
			suspended: mainWindow.isMinimized() || !mainWindow.isVisible()
		});
	}, 120);
}
/**
* Wait for the dsh web boot to finish before showing the desktop window.
* Readiness = the loader has left the boot page (no "Loading plugins" /
* "Failed to load plugins") and the real UI root has children. The timeout is
* a fallback so the window never stays invisible forever.
*/
async function waitForWebReady(window, onReady) {
	const timeoutMs = Math.max(5e3, Number(process.env.DSH_DESKTOP_WEB_READY_TIMEOUT_MS) || 18e4);
	const deadline = Date.now() + timeoutMs;
	const probe = [
		"(() => {",
		"  if (document.readyState !== \"complete\") return false",
		"  if (document.querySelector('button[aria-haspopup=\"dialog\"]') !== null) return true",
		"  const text = document.body ? document.body.innerText : \"\"",
		"  if (text.includes(\"Loading plugins\") || text.includes(\"Failed to load plugins\")) return false",
		"  const root = document.querySelector(\"#root\")",
		"  return root !== null && root.childElementCount > 0",
		"})()"
	].join("\n");
	while (Date.now() < deadline) {
		if (window.isDestroyed()) return;
		let ready = false;
		try {
			ready = await window.webContents.executeJavaScript(probe, true) === true;
		} catch {
			ready = false;
		}
		if (ready) {
			onReady();
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	onReady();
}
function createMainWindow() {
	const window = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 940,
		minHeight: 600,
		show: false,
		backgroundColor: "#0f1115",
		title: "DeepSeek Harness桌面版",
		icon: join(__dirname, "..", "assets", "icon.ico"),
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(__dirname, "preload.mjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			backgroundThrottling: false
		}
	});
	mainWindow = window;
	let webReady = false;
	let windowShown = false;
	const showMainWindow = () => {
		if (windowShown || window.isDestroyed()) return;
		windowShown = true;
		window.show();
	};
	window.on("page-title-updated", (event) => {
		event.preventDefault();
	});
	window.once("ready-to-show", () => {
		if (process.env.DSH_DESKTOP_SMOKE === "1") {
			const marker = process.env.DSH_DESKTOP_SMOKE_FILE;
			if (marker !== void 0) writeFileSync(marker, "ready-to-show");
		}
		if (webReady) showMainWindow();
	});
	let loadAttempts = 0;
	window.webContents.on("did-fail-load", (_event, code, description) => {
		if (process.env.DSH_DESKTOP_SMOKE === "1") {
			const marker = process.env.DSH_DESKTOP_SMOKE_FILE;
			if (marker !== void 0) writeFileSync(marker, `did-fail-load:${code}:${description}`);
			app.quit();
			return;
		}
		if (loadAttempts >= 5) return;
		loadAttempts += 1;
		setTimeout(() => {
			window.loadURL(DESKTOP_WEB_URL);
		}, 900);
	});
	window.webContents.on("did-finish-load", () => {
		loadAttempts = 0;
		if (process.env.DSH_DESKTOP_SMOKE !== "1") {
			waitForWebReady(window, () => {
				webReady = true;
				showMainWindow();
			});
			return;
		}
		const marker = process.env.DSH_DESKTOP_SMOKE_FILE;
		window.webContents.executeJavaScript("window.desktopWindow ? window.desktopWindow.ping() : { ok: false, error: \"DESKTOP_BRIDGE_MISSING\" }", true).then((result) => {
			if (marker !== void 0) writeFileSync(marker, JSON.stringify(result));
		}).catch((error) => {
			if (marker !== void 0) writeFileSync(marker, `bridge-error:${error instanceof Error ? error.message : String(error)}`);
		}).finally(() => {
			setTimeout(() => {
				app.quit();
			}, 300);
		});
	});
	window.on("resize", scheduleHostBoundsChanged);
	window.on("move", scheduleHostBoundsChanged);
	window.on("restore", scheduleHostBoundsChanged);
	window.on("minimize", scheduleHostBoundsChanged);
	window.on("maximize", scheduleHostBoundsChanged);
	window.loadURL(DESKTOP_WEB_URL);
}
function registerWindowIpc() {
	ipcMain.handle("desktop-window-ping", (event) => {
		if (!isTrustedSender(event)) return failUntrusted();
		return {
			ok: true,
			isDesktop: true,
			version: app.getVersion(),
			platform: process.platform
		};
	});
	ipcMain.handle("desktop-window-get-version", (event) => {
		if (!isTrustedSender(event)) return failUntrusted();
		return {
			ok: true,
			version: app.getVersion(),
			electron: process.versions.electron
		};
	});
	ipcMain.handle("desktop-window-minimize", (event) => {
		if (!isTrustedSender(event)) return failUntrusted();
		mainWindow?.minimize();
		return { ok: true };
	});
	ipcMain.handle("desktop-window-restore", (event) => {
		if (!isTrustedSender(event)) return failUntrusted();
		if (mainWindow?.isMinimized() === true) mainWindow.restore();
		return { ok: true };
	});
	ipcMain.handle("desktop-window-toggle-maximize", (event) => {
		if (!isTrustedSender(event)) return failUntrusted();
		if (mainWindow?.isMaximized() === true) mainWindow.unmaximize();
		else mainWindow?.maximize();
		return { ok: true };
	});
	ipcMain.handle("desktop-window-toggle-fullscreen", (event) => {
		if (!isTrustedSender(event)) return failUntrusted();
		const win = mainWindow;
		if (win !== null) win.setFullScreen(!win.isFullScreen());
		return { ok: true };
	});
	ipcMain.handle("desktop-window-get-state", (event) => {
		if (!isTrustedSender(event)) return failUntrusted();
		return {
			ok: true,
			minimized: mainWindow?.isMinimized() ?? false,
			maximized: mainWindow?.isMaximized() ?? false,
			fullscreen: mainWindow?.isFullScreen() ?? false,
			visible: mainWindow?.isVisible() ?? false
		};
	});
	ipcMain.handle("desktop-window-close", (event) => {
		if (!isTrustedSender(event)) return failUntrusted();
		mainWindow?.close();
		return { ok: true };
	});
}
function registerWallpaperIpc() {
	if (library === null || runtime === null) throw new Error("desktop: wallpaper services not initialized");
	const lib = library;
	const rt = runtime;
	ipcMain.handle("dsh-wallpaper-engine-list", async (event, payload = {}) => {
		if (!isTrustedSender(event)) return {
			ok: false,
			projects: [],
			count: 0,
			error: "DESKTOP_UNTRUSTED_CALLER"
		};
		try {
			const snapshot = await lib.list({ force: payload.force === true });
			const runtimeProbe = await rt.probe(false);
			return {
				...snapshot,
				runtime: runtimeProbe
			};
		} catch (error) {
			return {
				ok: false,
				projects: [],
				count: 0,
				error: error instanceof Error ? error.message : "WALLPAPER_ENGINE_SCAN_FAILED"
			};
		}
	});
	ipcMain.handle("dsh-wallpaper-engine-project-details", async (event, id) => {
		if (!isTrustedSender(event)) return {
			ok: false,
			error: "DESKTOP_UNTRUSTED_CALLER"
		};
		try {
			return await lib.getProjectDetails(stringArg(id));
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : "WALLPAPER_ENGINE_PROJECT_DETAILS_FAILED"
			};
		}
	});
	ipcMain.handle("dsh-wallpaper-engine-open-project-details", async (event, payload = {}) => {
		if (!isTrustedSender(event)) return {
			ok: false,
			error: "DESKTOP_UNTRUSTED_CALLER"
		};
		try {
			const workshopId = (await lib.getProjectDetails(payload.id ?? "")).workshopId;
			if (!/^\d{5,32}$/.test(workshopId)) return {
				ok: false,
				error: "WALLPAPER_ENGINE_WORKSHOP_DETAILS_UNAVAILABLE"
			};
			const target = payload.target === "workshop" ? "workshop" : "we";
			let revealError = "";
			if (target === "we") try {
				await rt.revealWorkshop(workshopId);
				return {
					ok: true,
					opened: "wallpaper-engine",
					workshopId
				};
			} catch (error) {
				revealError = error instanceof Error ? error.message : "WALLPAPER_ENGINE_REVEAL_FAILED";
			}
			const steamUri = `steam://url/CommunityFilePage/${workshopId}`;
			try {
				await shell.openExternal(steamUri);
				return {
					ok: true,
					opened: "steam-workshop",
					workshopId,
					fallback: target === "we",
					revealError
				};
			} catch {
				await shell.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`);
				return {
					ok: true,
					opened: "web-workshop",
					workshopId,
					fallback: target === "we",
					revealError
				};
			}
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : "WALLPAPER_ENGINE_OPEN_PROJECT_DETAILS_FAILED"
			};
		}
	});
	ipcMain.handle("dsh-wallpaper-engine-choose-directory", async (event) => {
		if (!isTrustedSender(event)) return {
			ok: false,
			canceled: false,
			projects: [],
			count: 0,
			error: "DESKTOP_UNTRUSTED_CALLER"
		};
		try {
			const options = {
				title: "识别并导入 Wallpaper Engine 项目",
				buttonLabel: "识别此目录",
				properties: ["openDirectory"]
			};
			const result = mainWindow !== null && !mainWindow.isDestroyed() ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
			if (result.canceled || result.filePaths[0] === void 0) return {
				ok: true,
				canceled: true
			};
			return {
				...await lib.addManualRoot(result.filePaths[0]),
				runtime: await rt.probe(false),
				canceled: false
			};
		} catch (error) {
			return {
				ok: false,
				canceled: false,
				projects: [],
				count: 0,
				error: error instanceof Error ? error.message : "WALLPAPER_ENGINE_IMPORT_FAILED"
			};
		}
	});
	ipcMain.handle("dsh-wallpaper-engine-choose-project-file", async (event) => {
		if (!isTrustedSender(event)) return {
			ok: false,
			canceled: false,
			projects: [],
			count: 0,
			error: "DESKTOP_UNTRUSTED_CALLER"
		};
		try {
			const options = {
				title: "选择 Wallpaper Engine 的 project.json 或场景包（.pkg/.pak）",
				buttonLabel: "导入此项目",
				properties: ["openFile"],
				filters: [{
					name: "Wallpaper Engine 项目",
					extensions: [
						"pkg",
						"pak",
						"json"
					]
				}]
			};
			const result = mainWindow !== null && !mainWindow.isDestroyed() ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
			if (result.canceled || result.filePaths[0] === void 0) return {
				ok: true,
				canceled: true
			};
			return {
				...await lib.addManualProjectFile(result.filePaths[0]),
				runtime: await rt.probe(false),
				canceled: false
			};
		} catch (error) {
			return {
				ok: false,
				canceled: false,
				projects: [],
				count: 0,
				error: error instanceof Error ? error.message : "WALLPAPER_ENGINE_IMPORT_PROJECT_FAILED"
			};
		}
	});
	ipcMain.handle("dsh-wallpaper-engine-remove-directory", async (event, rootId) => {
		if (!isTrustedSender(event)) return {
			ok: false,
			projects: [],
			count: 0,
			error: "DESKTOP_UNTRUSTED_CALLER"
		};
		try {
			return {
				...await lib.removeManualRoot(stringArg(rootId)),
				runtime: await rt.probe(false)
			};
		} catch (error) {
			return {
				ok: false,
				projects: [],
				count: 0,
				error: error instanceof Error ? error.message : "WALLPAPER_ENGINE_REMOVE_ROOT_FAILED"
			};
		}
	});
	ipcMain.handle("dsh-wallpaper-engine-runtime-status", async (event, payload = {}) => {
		if (!isTrustedSender(event)) return {
			ok: false,
			available: false,
			error: "DESKTOP_UNTRUSTED_CALLER"
		};
		try {
			return {
				...await rt.probe(payload.force === true),
				...rt.getStatus()
			};
		} catch (error) {
			return {
				ok: false,
				available: false,
				error: error instanceof Error ? error.message : "WALLPAPER_ENGINE_RUNTIME_PROBE_FAILED"
			};
		}
	});
	ipcMain.handle("dsh-wallpaper-engine-start-scene", async (event, payload = {}) => {
		if (!isTrustedSender(event)) return {
			ok: false,
			error: "DESKTOP_UNTRUSTED_CALLER"
		};
		try {
			const bounds = mainWindow?.getContentBounds() ?? {
				x: 0,
				y: 0,
				width: 1280,
				height: 720
			};
			const startOptions = {
				width: payload.width ?? bounds.width,
				height: payload.height ?? bounds.height,
				x: payload.x ?? bounds.x,
				y: payload.y ?? bounds.y
			};
			if (payload.fps !== void 0) startOptions.fps = payload.fps;
			return {
				...await rt.start(payload.id ?? "", startOptions),
				capturePrepared: true,
				captureMode: "desktop-capture"
			};
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : "WALLPAPER_ENGINE_SCENE_START_FAILED"
			};
		}
	});
	ipcMain.handle("dsh-wallpaper-engine-capture-result", async (event, payload = {}) => {
		if (!isTrustedSender(event)) return {
			ok: false,
			error: "DESKTOP_UNTRUSTED_CALLER"
		};
		const sessionId = payload.sessionId ?? "";
		if (!/^[a-f0-9]{24}$/i.test(sessionId)) return {
			ok: false,
			error: "WALLPAPER_ENGINE_SESSION_INVALID"
		};
		const confirmed = payload.ok === true && await rt.confirmCaptureReady(sessionId);
		if (!confirmed) await rt.stop(sessionId);
		return {
			ok: confirmed,
			captureReady: confirmed,
			error: confirmed ? "" : "WALLPAPER_ENGINE_CAPTURE_CONFIRM_FAILED"
		};
	});
	ipcMain.handle("dsh-wallpaper-engine-stop-scene", async (event, payload = {}) => {
		if (!isTrustedSender(event)) return {
			ok: false,
			error: "DESKTOP_UNTRUSTED_CALLER"
		};
		try {
			return await rt.stop(payload.all === true || payload.sessionId === void 0 ? "" : payload.sessionId);
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : "WALLPAPER_ENGINE_SCENE_STOP_FAILED"
			};
		}
	});
}
function registerDesktopModeIpc() {
	if (desktopWallpaper === null || desktopMode === null) throw new Error("desktop: desktop-mode services not initialized");
	const wallpaper = desktopWallpaper;
	const mode = desktopMode;
	ipcMain.handle("dsh-desktop-wallpaper-get-status", (event) => {
		if (!isTrustedSender(event)) return failUntrusted();
		return wallpaper.getStatus();
	});
	ipcMain.handle("dsh-desktop-wallpaper-set-enabled", async (event, payload = {}) => {
		if (!isTrustedSender(event)) return failUntrusted();
		try {
			if (!(payload.enabled === true)) return await wallpaper.stop();
			const url = typeof payload.url === "string" ? payload.url : "";
			if (url === "") return {
				ok: false,
				error: "DSH_DESKTOP_WALLPAPER_URL_REQUIRED"
			};
			return await wallpaper.start(url, payload.kind === "video" ? "video" : "image");
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : "DSH_DESKTOP_WALLPAPER_START_FAILED"
			};
		}
	});
	ipcMain.handle("dsh-desktop-wallpaper-update", async (event, payload = {}) => {
		if (!isTrustedSender(event)) return failUntrusted();
		const url = typeof payload.url === "string" ? payload.url : "";
		if (url === "") return {
			ok: false,
			error: "DSH_DESKTOP_WALLPAPER_URL_REQUIRED"
		};
		return await wallpaper.update(url, payload.kind === "video" ? "video" : "image");
	});
	ipcMain.handle("dsh-desktop-mode-get-status", (event) => {
		if (!isTrustedSender(event)) return failUntrusted();
		return mode.getStatus();
	});
	ipcMain.handle("dsh-desktop-mode-set-enabled", async (event, payload = {}) => {
		if (!isTrustedSender(event)) return failUntrusted();
		const win = mainWindow;
		if (win === null || win.isDestroyed()) return {
			ok: false,
			error: "DSH_DESKTOP_WINDOW_UNAVAILABLE"
		};
		if (payload.enabled !== true) return await mode.disable("renderer-disabled");
		return await mode.enable(win, {
			interactive: payload.interactive !== false,
			reason: "renderer-enabled"
		});
	});
	ipcMain.handle("dsh-desktop-mode-set-icons-visible", async (event, visible) => {
		if (!isTrustedSender(event)) return failUntrusted();
		return await mode.setDesktopIconsVisible(visible !== false);
	});
	ipcMain.handle("dsh-desktop-mode-probe-icons", async (event) => {
		if (!isTrustedSender(event)) return failUntrusted();
		return await mode.probeDesktopIcons();
	});
	ipcMain.handle("dsh-desktop-mode-set-software-lock", (event, locked) => {
		if (!isTrustedSender(event)) return failUntrusted();
		return mode.setSoftwareInteractionLocked(locked === true);
	});
	ipcMain.handle("dsh-desktop-mode-request-keyboard-focus", (event) => {
		if (!isTrustedSender(event)) return failUntrusted();
		return mode.requestKeyboardFocus();
	});
	ipcMain.on("dsh-desktop-mode-pointer-route", (event, payload = {}) => {
		if (!isTrustedSender(event)) return;
		mode.updatePointerRoute(payload);
	});
	mode.onStatus((status) => {
		if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.webContents.send("dsh-desktop-mode-state", status);
	});
}
async function runDesktopModeSmoke() {
	const marker = process.env.DSH_DESKTOP_SMOKE_FILE;
	const result = {};
	try {
		if (desktopMode === null) throw new Error("DSH_DESKTOP_MODE_UNAVAILABLE");
		result.iconProbe = await desktopMode.probeDesktopIcons();
		const testWindow = new BrowserWindow({
			width: 640,
			height: 360,
			show: false
		});
		try {
			await testWindow.loadURL("data:text/html,<body style=\"background:%23000\">dsh desktop mode smoke</body>");
			if (desktopWallpaper === null) throw new Error("DSH_DESKTOP_WALLPAPER_UNAVAILABLE");
			result.wallpaperStart = await desktopWallpaper.start("data:image/svg+xml;charset=utf-8," + encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><rect width=\"16\" height=\"16\" fill=\"black\"/></svg>"), "image");
			result.wallpaperStop = await desktopWallpaper.stop();
		} finally {
			if (!testWindow.isDestroyed()) testWindow.destroy();
		}
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
	}
	if (marker !== void 0) writeFileSync(marker, JSON.stringify(result));
	app.quit();
}
function registerInstallerIpc() {
	const isInstallerSender = (event) => installerWindow !== null && !installerWindow.isDestroyed() && event.sender === installerWindow.webContents;
	ipcMain.handle("dsh-install-start", async (event) => {
		if (!isInstallerSender(event)) return {
			ok: false,
			error: "DESKTOP_INSTALLER_UNTRUSTED"
		};
		if (installCancelRequested) return {
			ok: false,
			error: "DESKTOP_INSTALL_CANCELLED"
		};
		const command = await runDshInstall();
		if (command === "") return {
			ok: false,
			error: "DESKTOP_INSTALL_FAILED"
		};
		await startDshWeb(command);
		if (installerWindow !== null && !installerWindow.isDestroyed()) installerWindow.close();
		createMainWindow();
		return { ok: true };
	});
	ipcMain.handle("dsh-install-open-help", (event) => {
		if (!isInstallerSender(event)) return { ok: false };
		shell.openExternal("https://deepseek-harness.github.io/deepseek-harness/");
		return { ok: true };
	});
	ipcMain.handle("dsh-install-cancel", (event) => {
		if (!isInstallerSender(event)) return { ok: false };
		installCancelRequested = true;
		app.quit();
		return { ok: true };
	});
}
app.whenReady().then(async () => {
	Menu.setApplicationMenu(null);
	const lib = new WallpaperEngineLibrary({ configPath: dshHomePath("wallpaper-engine-library.json") });
	library = lib;
	runtime = new WallpaperEngineRuntime({
		library: lib,
		desktopCapturer,
		spawn
	});
	desktopWallpaper = new DesktopWallpaperRuntime({
		BrowserWindow,
		screen
	});
	desktopMode = new DesktopModeRuntime({ screen });
	if (process.env.DSH_DESKTOP_M5_SMOKE === "1") {
		runDesktopModeSmoke();
		return;
	}
	protocol.handle(WALLPAPER_ENGINE_SCHEME, (request) => lib.mediaResponse({
		url: request.url,
		method: request.method,
		headers: request.headers
	}));
	registerWindowIpc();
	registerWallpaperIpc();
	registerDesktopModeIpc();
	registerInstallerIpc();
	if (await ensureDshWebRunning() === "") return;
	createMainWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
	});
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
	if (desktopMode !== null) desktopMode.dispose();
	if (desktopWallpaper !== null) desktopWallpaper.dispose();
	if (runtime !== null) runtime.dispose();
	if (library !== null) library.dispose();
});
//#endregion
export {};
