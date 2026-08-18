window.__ModuleLoader__.load({
	id: "dsh-wallpaper-engine",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_web_react = require("@deepseek-ai/dsh-client-web-react");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react_dom = require("react-dom");
		//#region ../src/client/api.ts
		/** Read the optional bridge once and cache the verdict. */
		function getDesktopWindowApi() {
			const value = window.desktopWindow;
			return value !== void 0 && value.isDesktop ? value : null;
		}
		/** Build a `dsh-wallpaper://` media URL for an indexed project. */
		function wallpaperMediaUrl(kind, item, token) {
			if (item === null || token === "") return "";
			return `dsh-wallpaper://${kind}/${encodeURIComponent(item.id)}?v=${encodeURIComponent(String(item.updatedAt || 0))}&token=${encodeURIComponent(token)}`;
		}
		//#endregion
		//#region ../src/client/selection.ts
		/**
		* Wallpaper selection persistence. The renderer owns this preference; the
		* desktop main process never reads it. Storage is localStorage so a refresh
		* restores the chosen wallpaper before the first library scan returns.
		*/
		const WALLPAPER_SELECTION_STORAGE_KEY = "dsh.wallpaper-engine.selection";
		/** Bound a number between min and max, returning the fallback for NaN. */
		function bound(value, minimum, maximum, fallback) {
			const numeric = Number(value);
			return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
		}
		/** Validate a string against the 24-hex project id format. */
		function normalizeId(value) {
			const raw = (typeof value === "string" ? value : "").replace(/[^a-f0-9]/gi, "").slice(0, 24).toLowerCase();
			return /^[a-f0-9]{24}$/.test(raw) ? raw : "";
		}
		/** Sanitize a title the same way the library sanitizes project titles. */
		function normalizeTitle(value) {
			return (typeof value === "string" ? value : "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
		}
		/** Read and validate the persisted selection. */
		function readWallpaperSelection() {
			try {
				const raw = JSON.parse(localStorage.getItem("dsh.wallpaper-engine.selection") ?? "{}");
				const id = normalizeId(raw.id);
				const kind = raw.kind === "engine" ? "engine" : raw.kind === "media" ? "media" : "preview";
				return {
					active: raw.active === true && id.length === 24,
					id,
					title: normalizeTitle(raw.title),
					kind,
					mediaType: raw.mediaType === "video" ? "video" : "image",
					mediaAnimated: raw.mediaAnimated === true,
					projectType: (typeof raw.projectType === "string" ? raw.projectType : "unknown").slice(0, 32),
					hasPreview: raw.hasPreview === true,
					previewAnimated: raw.previewAnimated === true,
					updatedAt: Math.max(0, Number(raw.updatedAt) || 0),
					opacity: bound(raw.opacity, 0, 1, 1),
					blur: bound(raw.blur, 0, 80, 0),
					fill: raw.fill === "contain" ? "contain" : raw.fill === "fill" ? "fill" : "cover"
				};
			} catch {
				return emptyWallpaperSelection();
			}
		}
		/** Default selection: inactive, original app background. */
		function emptyWallpaperSelection() {
			return {
				active: false,
				id: "",
				title: "",
				kind: "preview",
				mediaType: "image",
				mediaAnimated: false,
				projectType: "unknown",
				hasPreview: false,
				previewAnimated: false,
				updatedAt: 0,
				opacity: 1,
				blur: 0,
				fill: "cover"
			};
		}
		/** Persist the selection. */
		function writeWallpaperSelection(selection) {
			try {
				localStorage.setItem(WALLPAPER_SELECTION_STORAGE_KEY, JSON.stringify(selection));
			} catch {}
		}
		//#endregion
		//#region ../src/client/store.ts
		/**
		* Shared viewing/interaction state for the wallpaper UI: library snapshot,
		* active selection, native-scene capture session, and desktop customisation
		* (opacity, blur, colour, radius, border, shadow). Business data stays in
		* the desktop main process; this store only mirrors the renderer-visible
		* projection.
		*/
		const CUSTOM_STYLE_KEY = "dsh.wallpaper-engine.customStyle";
		const DEFAULT_CUSTOM_STYLE = Object.freeze({
			mainOpacity: 1,
			mainBlur: 0,
			sidebarOpacity: 1,
			sidebarBlur: 0,
			chatOpacity: 1,
			chatBlur: 0,
			inputOpacity: 1,
			inputBlur: 0,
			panelOpacity: 1,
			panelBlur: 0,
			tintColor: "",
			accentColor: "",
			radius: 0,
			borderWidth: 0,
			borderColor: "",
			shadowStrength: 0,
			scrimStrength: 0
		});
		function readCustomStyle() {
			try {
				const raw = JSON.parse(localStorage.getItem(CUSTOM_STYLE_KEY) ?? "{}");
				return {
					mainOpacity: clamp(raw.mainOpacity, 0, 1, 1),
					mainBlur: clamp(raw.mainBlur, 0, 40, 0),
					sidebarOpacity: clamp(raw.sidebarOpacity, 0, 1, 1),
					sidebarBlur: clamp(raw.sidebarBlur, 0, 40, 0),
					chatOpacity: clamp(raw.chatOpacity, 0, 1, 1),
					chatBlur: clamp(raw.chatBlur, 0, 40, 0),
					inputOpacity: clamp(raw.inputOpacity, 0, 1, 1),
					inputBlur: clamp(raw.inputBlur, 0, 40, 0),
					panelOpacity: clamp(raw.panelOpacity, 0, 1, 1),
					panelBlur: clamp(raw.panelBlur, 0, 40, 0),
					tintColor: colorValue(raw.tintColor),
					accentColor: colorValue(raw.accentColor),
					radius: clamp(raw.radius, 0, 24, 0),
					borderWidth: clamp(raw.borderWidth, 0, 4, 0),
					borderColor: colorValue(raw.borderColor),
					shadowStrength: clamp(raw.shadowStrength, 0, 1, 0),
					scrimStrength: clamp(raw.scrimStrength, 0, 1, 0)
				};
			} catch {
				return { ...DEFAULT_CUSTOM_STYLE };
			}
		}
		function writeCustomStyle(style) {
			try {
				localStorage.setItem(CUSTOM_STYLE_KEY, JSON.stringify(style));
			} catch {}
		}
		function clamp(value, min, max, fallback) {
			const n = Number(value);
			return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
		}
		function colorValue(value) {
			const s = String(value ?? "").trim();
			if (/^#[0-9a-f]{3,8}$/i.test(s)) return s.toLowerCase();
			if (/^rgba?\([\d,.%\s]+\)$/i.test(s)) return s;
			return "";
		}
		const DEDUP_KEY = "dsh.wallpaper-engine.dedupStrategy";
		function readDedupStrategy() {
			try {
				const v = localStorage.getItem(DEDUP_KEY);
				return v === "manual" ? "manual" : v === "none" ? "none" : "workshop";
			} catch {
				return "workshop";
			}
		}
		function writeDedupStrategy(strategy) {
			try {
				localStorage.setItem(DEDUP_KEY, strategy);
			} catch {}
		}
		/**
		* Create the wallpaper UI store handle. The handle is constructed in apply
		* world and shared by the desktop-customisation entry, the library entry,
		* and the background entry, so all three read and write the same instance.
		* @returns the shared store handle.
		*/
		function createWallpaperEngineStore() {
			return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
				init: () => ({
					status: "idle",
					projects: [],
					manualRoots: [],
					mediaToken: "",
					runtimeAvailable: false,
					search: "",
					selection: readWallpaperSelection(),
					scene: {
						active: false,
						sessionId: "",
						sourceId: "",
						error: "",
						freeze: false,
						windowParked: false,
						parkError: ""
					},
					customStyle: readCustomStyle(),
					dedupStrategy: readDedupStrategy(),
					carousel: readCarousel(),
					error: ""
				}),
				actions: {
					setLoading: (d) => {
						d.status = "loading";
						d.error = "";
					},
					setReady: (d, projects, manualRoots, mediaToken, runtimeAvailable) => {
						d.status = "ready";
						d.projects = projects;
						d.manualRoots = manualRoots;
						d.mediaToken = mediaToken;
						d.runtimeAvailable = runtimeAvailable;
						d.error = "";
					},
					setError: (d, message) => {
						d.status = "error";
						d.error = message;
					},
					setSearch: (d, search) => {
						d.search = search;
					},
					setSelection: (d, selection) => {
						d.selection = selection;
						writeWallpaperSelection(selection);
					},
					setScene: (d, scene) => {
						d.scene = {
							...d.scene,
							...scene
						};
					},
					setCustomStyle: (d, style) => {
						d.customStyle = style;
						writeCustomStyle(style);
					},
					setDedupStrategy: (d, strategy) => {
						d.dedupStrategy = strategy;
						writeDedupStrategy(strategy);
					},
					setCarousel: (d, carousel) => {
						d.carousel = carousel;
						writeCarousel(carousel);
					},
					clearSceneError: (d) => {
						d.scene.error = "";
					}
				}
			});
		}
		const CAROUSEL_KEY = "dsh.wallpaper-engine.carousel";
		function readCarousel() {
			try {
				const raw = JSON.parse(localStorage.getItem(CAROUSEL_KEY) ?? "{}");
				return {
					enabled: raw.enabled === true,
					activePlaylistId: typeof raw.activePlaylistId === "string" ? raw.activePlaylistId : "",
					playlists: Array.isArray(raw.playlists) ? raw.playlists.filter((p) => p && typeof p.id === "string" && p.id).map((p) => ({
						id: p.id,
						name: typeof p.name === "string" ? p.name : "Playlist",
						wallpaperIds: Array.isArray(p.wallpaperIds) ? p.wallpaperIds.filter((id) => typeof id === "string" && id) : [],
						interval: typeof p.interval === "number" && p.interval >= 30 ? p.interval : 300,
						order: p.order === "random" ? "random" : "sequence"
					})) : []
				};
			} catch {
				return {
					enabled: false,
					activePlaylistId: "",
					playlists: []
				};
			}
		}
		function writeCarousel(carousel) {
			try {
				localStorage.setItem(CAROUSEL_KEY, JSON.stringify(carousel));
			} catch {}
		}
		//#endregion
		//#region ../src/client/controller.ts
		var WallpaperEngineController = class {
			store = createWallpaperEngineStore().create();
			api;
			constructor(api) {
				this.api = api;
			}
			get isDesktop() {
				return this.api !== null;
			}
			get snapshot() {
				return this.store.getSnapshot();
			}
			/** Refresh the library snapshot from the desktop main process. */
			async load(force = false) {
				if (this.api === null) {
					this.store.actions.setError("DESKTOP_ONLY");
					return;
				}
				this.store.actions.setLoading();
				try {
					const snapshot = await this.api.listWallpaperEngineProjects({ force });
					if (snapshot.ok) this.store.actions.setReady(snapshot.projects, snapshot.manualRoots, snapshot.mediaToken, snapshot.runtime?.available === true);
					else this.store.actions.setError("WALLPAPER_ENGINE_SCAN_FAILED");
				} catch {
					this.store.actions.setError("WALLPAPER_ENGINE_SCAN_FAILED");
				}
			}
			/** Choose and import a directory, then refresh. */
			async chooseDirectory() {
				if (this.api === null) return;
				this.store.actions.setLoading();
				try {
					const snapshot = await this.api.chooseWallpaperEngineDirectory();
					if (snapshot.canceled === true) {
						this.load();
						return;
					}
					if (snapshot.ok) this.store.actions.setReady(snapshot.projects, snapshot.manualRoots, snapshot.mediaToken, snapshot.runtime?.available === true);
					else this.store.actions.setError(snapshot.error ?? "WALLPAPER_ENGINE_IMPORT_FAILED");
				} catch {
					this.store.actions.setError("WALLPAPER_ENGINE_IMPORT_FAILED");
				}
			}
			/** Choose and import a project.json or scene package, then refresh. */
			async chooseProjectFile() {
				if (this.api === null) return;
				this.store.actions.setLoading();
				try {
					const snapshot = await this.api.chooseWallpaperEngineProjectFile();
					if (snapshot.canceled === true) {
						this.load();
						return;
					}
					if (snapshot.ok) this.store.actions.setReady(snapshot.projects, snapshot.manualRoots, snapshot.mediaToken, snapshot.runtime?.available === true);
					else this.store.actions.setError(snapshot.error ?? "WALLPAPER_ENGINE_IMPORT_PROJECT_FAILED");
				} catch {
					this.store.actions.setError("WALLPAPER_ENGINE_IMPORT_PROJECT_FAILED");
				}
			}
			/** Remove a manual root and refresh. */
			async removeRoot(rootId) {
				if (this.api === null) return;
				this.store.actions.setLoading();
				try {
					const snapshot = await this.api.removeWallpaperEngineDirectory(rootId);
					if (snapshot.ok) this.store.actions.setReady(snapshot.projects, snapshot.manualRoots, snapshot.mediaToken, snapshot.runtime?.available === true);
					else this.store.actions.setError("WALLPAPER_ENGINE_REMOVE_ROOT_FAILED");
				} catch {
					this.store.actions.setError("WALLPAPER_ENGINE_REMOVE_ROOT_FAILED");
				}
			}
			/** Build the best selection for a project item. */
			selectProject(project) {
				const kind = project.enginePlayable ? "engine" : project.playable ? "media" : "preview";
				const selection = {
					...emptyWallpaperSelection(),
					active: true,
					id: project.id,
					title: project.title,
					kind,
					mediaType: project.mediaType === "video" ? "video" : "image",
					mediaAnimated: project.mediaAnimated,
					projectType: project.projectType,
					hasPreview: project.hasPreview,
					previewAnimated: project.previewAnimated,
					updatedAt: project.updatedAt
				};
				this.store.actions.setSelection(selection);
				return selection;
			}
			/** Restore the default app background. */
			clearSelection() {
				this.store.actions.setSelection(emptyWallpaperSelection());
			}
			/** Start a WE native scene through the main process. */
			async startScene(projectId) {
				if (this.api === null) return {
					ok: false,
					error: "DESKTOP_ONLY"
				};
				const result = await this.api.startWallpaperEngineScene({ id: projectId });
				if (result.ok && result.sessionId !== void 0) this.store.actions.setScene({
					active: true,
					sessionId: result.sessionId,
					sourceId: result.sourceId ?? "",
					error: "",
					windowParked: result.windowParked === true,
					parkError: result.parkError ?? ""
				});
				else this.store.actions.setScene({
					active: false,
					sessionId: "",
					sourceId: "",
					error: result.error ?? "WALLPAPER_ENGINE_SCENE_START_FAILED",
					windowParked: false,
					parkError: ""
				});
				return result;
			}
			/** Report the renderer's first-frame capture ACK to the main process. */
			async reportCapture(sessionId, ok) {
				if (this.api === null) return;
				try {
					await this.api.reportWallpaperEngineCaptureResult({
						sessionId,
						ok
					});
				} catch {}
				if (!ok) this.store.actions.setScene({
					active: false,
					sessionId: "",
					sourceId: "",
					error: "WALLPAPER_ENGINE_CAPTURE_CONFIRM_FAILED",
					windowParked: false,
					parkError: ""
				});
			}
			/** Stop the active native scene. */
			async stopScene() {
				const { scene } = this.store.getSnapshot();
				if (this.api !== null) try {
					await this.api.stopWallpaperEngineScene({ sessionId: scene.sessionId });
				} catch {}
				this.store.actions.setScene({
					active: false,
					sessionId: "",
					sourceId: "",
					error: "",
					freeze: false,
					windowParked: false,
					parkError: ""
				});
			}
			/** Compute the current wallpaper URL for the WorkerW desktop window. */
			desktopWallpaperPayload() {
				const state = this.store.getSnapshot();
				const project = state.projects.find((item) => item.id === state.selection.id) ?? null;
				const kind = state.selection.mediaType === "video" ? "video" : "image";
				return {
					url: wallpaperMediaUrl(project?.playable === true ? "media" : "preview", project, state.mediaToken),
					kind
				};
			}
			/** Get the WorkerW wallpaper-window status. */
			async getWallpaperModeStatus() {
				return this.api === null ? {
					ok: false,
					supported: false,
					enabled: false
				} : this.api.getWallpaperModeStatus();
			}
			/** Enable or disable the WorkerW wallpaper window. */
			async setWallpaperMode(enabled) {
				if (this.api === null) return {
					ok: false,
					enabled: false
				};
				if (enabled) {
					const payload = this.desktopWallpaperPayload();
					if (payload.url === "") return {
						ok: false,
						enabled: false,
						error: "WALLPAPER_SELECTION_REQUIRED"
					};
					return this.api.setWallpaperMode({
						enabled: true,
						...payload
					});
				}
				return this.api.setWallpaperMode({ enabled: false });
			}
			/** Get the full-desktop embed status. */
			async getDesktopModeStatus() {
				return this.api === null ? {
					ok: false,
					supported: false,
					enabled: false
				} : this.api.getDesktopModeStatus();
			}
			/** Embed the main window into the desktop icon host. */
			async setDesktopMode(enabled, interactive = true) {
				if (this.api === null) return {
					ok: false,
					enabled: false
				};
				return this.api.setDesktopMode({
					enabled,
					interactive
				});
			}
			async setDesktopIconsVisible(visible) {
				return this.api === null ? { ok: false } : this.api.setDesktopIconsVisible(visible);
			}
			async probeDesktopIcons() {
				return this.api === null ? {
					ok: false,
					found: false
				} : this.api.probeDesktopIcons();
			}
			async setDesktopSoftwareLocked(locked) {
				return this.api === null ? { ok: false } : this.api.setDesktopSoftwareLocked(locked);
			}
			requestDesktopKeyboardFocus() {
				return this.api === null ? Promise.resolve({ ok: false }) : this.api.requestDesktopKeyboardFocus();
			}
			/** Open the WE/Steam workshop page for one project. */
			async openProjectDetails(project) {
				if (this.api === null || project.workshopId === "") return;
				await this.api.openWallpaperEngineProjectDetails(project.id, project.source === "workshop" ? "workshop" : "we");
			}
		};
		/** Bind a snapshot selector hook to the shared store (apply-world only). */
		function bindWallpaperSnapshot(controller) {
			return (0, _deepseek_ai_dsh_client_web_react.bindSnapshotSelector)(controller.store);
		}
		//#endregion
		//#region ../../../../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion
		//#region \0dsh-css:D:\deepseek-harness\plugin-package\dsh-wallpaper-engine\packages\dsh-wallpaper-engine\src\client\WallpaperSection.module.css.mjs
		const css$1 = ".O_XpsG_section{flex-direction:column;gap:16px;min-width:0;display:flex}.O_XpsG_head{justify-content:space-between;align-items:flex-start;gap:16px;display:flex}.O_XpsG_title{color:var(--dsw-alias-label-primary);margin:0;font-size:15px;font-weight:600;line-height:22px}.O_XpsG_subtitle{color:var(--dsw-alias-label-tertiary);margin:4px 0 0;font-size:12px;line-height:18px}.O_XpsG_actions{flex-wrap:wrap;justify-content:flex-end;gap:8px;display:flex}.O_XpsG_button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:8px;padding:6px 10px;font-size:12px;line-height:18px}.O_XpsG_button:hover{background:var(--dsw-alias-bg-hover,#0000000d)}.O_XpsG_presets{flex-wrap:wrap;gap:8px;margin-bottom:16px;display:flex}.O_XpsG_presetBtn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:20px;padding:6px 16px;font-size:13px;line-height:20px;transition:background .15s,color .15s,border-color .15s}.O_XpsG_presetBtn:hover{background:var(--dsw-alias-bg-hover,#0000000d)}.O_XpsG_presetBtnActive{background:var(--dsw-specific-accent,#3964fe);color:#fff;border-color:#0000}.O_XpsG_control{align-items:center;gap:10px;margin-bottom:12px;display:flex}.O_XpsG_controlLabel{min-width:100px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.O_XpsG_control input[type=range]{height:6px;accent-color:var(--dsw-specific-accent,#3964fe);cursor:pointer;flex:1}.O_XpsG_controlVal{color:var(--dsw-alias-label-primary);text-align:right;min-width:40px;font-size:13px}.O_XpsG_colorInput{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;flex:1;padding:5px 10px;font-size:13px;line-height:20px}.O_XpsG_dedupSelect{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:8px;padding:6px 10px;font-size:12px;line-height:18px}.O_XpsG_danger{color:var(--dsw-specific-danger,#c0392b)}.O_XpsG_notice{border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:12px;padding:16px;font-size:13px;line-height:20px}.O_XpsG_toolbar{align-items:center;gap:8px;display:flex}.O_XpsG_search{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);min-width:0;color:var(--dsw-alias-label-primary);border-radius:8px;flex:1;padding:7px 10px;font-size:13px;line-height:18px}.O_XpsG_status{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.O_XpsG_sceneNote{color:var(--dsw-alias-label-secondary);margin-top:10px;font-size:13px;line-height:20px}.O_XpsG_error{color:var(--dsw-specific-danger,#c0392b)}.O_XpsG_roots{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.O_XpsG_rootsLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.O_XpsG_rootChip{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:999px;align-items:center;gap:6px;padding:3px 8px;font-size:12px;line-height:18px;display:inline-flex}.O_XpsG_rootRemove{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;padding:0;font-size:14px;line-height:14px}.O_XpsG_grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;display:grid}.O_XpsG_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);border-radius:12px;flex-direction:column;display:flex;overflow:hidden}.O_XpsG_cardSelected{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}.O_XpsG_thumb{aspect-ratio:16/9;background:#0000001f;position:relative;overflow:hidden}.O_XpsG_thumbImage{object-fit:cover;width:100%;height:100%;display:block}.O_XpsG_badge{color:#fff;background:#0000009e;border-radius:999px;padding:2px 8px;font-size:11px;line-height:16px;position:absolute;top:8px;left:8px}.O_XpsG_cardOpen{color:#0f1115;cursor:pointer;background:#ffffffd6;border:0;border-radius:6px;padding:2px 8px;font-size:10px;line-height:16px;position:absolute;top:8px;right:8px}.O_XpsG_cardBody{flex-direction:column;gap:6px;padding:10px;display:flex}.O_XpsG_cardTitle{color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;font-size:13px;font-weight:600;line-height:18px;overflow:hidden}.O_XpsG_cardMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.O_XpsG_cardActions{gap:8px;margin-top:2px;display:flex}.O_XpsG_desktopMode{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:10px;padding:12px;display:flex}.O_XpsG_desktopModeTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px}.O_XpsG_controls{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-wrap:wrap;gap:16px;padding:12px;display:flex}.O_XpsG_control{color:var(--dsw-alias-label-secondary);align-items:center;gap:8px;font-size:12px;line-height:18px;display:flex}.O_XpsG_control input[type=range]{width:140px}.O_XpsG_control select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px}.O_XpsG_carousel{border-top:1px solid var(--dsw-alias-border-l2);margin-top:16px;padding-top:16px}.O_XpsG_carouselHead{justify-content:space-between;align-items:center;display:flex}.O_XpsG_carouselToggle{cursor:pointer;color:var(--dsw-alias-label-primary);align-items:center;gap:8px;font-size:13px;display:flex}.O_XpsG_carouselBody{flex-direction:column;gap:10px;margin-top:12px;display:flex}.O_XpsG_carouselNew,.O_XpsG_carouselImport{gap:8px;display:flex}.O_XpsG_carouselItem{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px}.O_XpsG_carouselItemActive{border-color:var(--dsw-specific-accent,#3964fe)}.O_XpsG_carouselItemHead{align-items:center;gap:8px;display:flex}.O_XpsG_carouselEdit{flex-direction:column;gap:10px;margin-top:10px;display:flex}.O_XpsG_carouselWps{flex-direction:column;gap:6px;display:flex}.O_XpsG_carouselGrid{flex-direction:column;gap:4px;max-height:180px;display:flex;overflow-y:auto}.O_XpsG_carouselWp{cursor:pointer;align-items:center;gap:6px;font-size:12px;display:flex}.O_XpsG_carouselWarn{color:var(--dsw-specific-danger,#c0392b);font-size:12px}.O_XpsG_carouselStatus{color:var(--dsw-specific-accent,#3964fe);font-size:12px}";
		const tagId$1 = "dsh-wallpaper-engine/WallpaperSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-wallpaper-engine";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var WallpaperSection_module_css_default = {
			"carouselGrid": "O_XpsG_carouselGrid",
			"head": "O_XpsG_head",
			"subtitle": "O_XpsG_subtitle",
			"rootRemove": "O_XpsG_rootRemove",
			"controlVal": "O_XpsG_controlVal",
			"button": "O_XpsG_button",
			"rootChip": "O_XpsG_rootChip",
			"cardSelected": "O_XpsG_cardSelected",
			"actions": "O_XpsG_actions",
			"cardTitle": "O_XpsG_cardTitle",
			"title": "O_XpsG_title",
			"controlLabel": "O_XpsG_controlLabel",
			"carouselWarn": "O_XpsG_carouselWarn",
			"status": "O_XpsG_status",
			"control": "O_XpsG_control",
			"controls": "O_XpsG_controls",
			"desktopMode": "O_XpsG_desktopMode",
			"rootsLabel": "O_XpsG_rootsLabel",
			"carouselHead": "O_XpsG_carouselHead",
			"error": "O_XpsG_error",
			"cardActions": "O_XpsG_cardActions",
			"carouselToggle": "O_XpsG_carouselToggle",
			"carouselBody": "O_XpsG_carouselBody",
			"carouselWps": "O_XpsG_carouselWps",
			"carouselWp": "O_XpsG_carouselWp",
			"carouselStatus": "O_XpsG_carouselStatus",
			"card": "O_XpsG_card",
			"carouselEdit": "O_XpsG_carouselEdit",
			"desktopModeTitle": "O_XpsG_desktopModeTitle",
			"cardMeta": "O_XpsG_cardMeta",
			"presetBtn": "O_XpsG_presetBtn",
			"carousel": "O_XpsG_carousel",
			"carouselImport": "O_XpsG_carouselImport",
			"roots": "O_XpsG_roots",
			"cardOpen": "O_XpsG_cardOpen",
			"cardBody": "O_XpsG_cardBody",
			"search": "O_XpsG_search",
			"thumb": "O_XpsG_thumb",
			"danger": "O_XpsG_danger",
			"carouselItem": "O_XpsG_carouselItem",
			"section": "O_XpsG_section",
			"thumbImage": "O_XpsG_thumbImage",
			"badge": "O_XpsG_badge",
			"sceneNote": "O_XpsG_sceneNote",
			"presetBtnActive": "O_XpsG_presetBtnActive",
			"grid": "O_XpsG_grid",
			"colorInput": "O_XpsG_colorInput",
			"carouselItemHead": "O_XpsG_carouselItemHead",
			"carouselNew": "O_XpsG_carouselNew",
			"presets": "O_XpsG_presets",
			"dedupSelect": "O_XpsG_dedupSelect",
			"toolbar": "O_XpsG_toolbar",
			"carouselItemActive": "O_XpsG_carouselItemActive",
			"notice": "O_XpsG_notice"
		};
		//#endregion
		//#region ../src/client/CarouselControls.tsx
		/**
		* Carousel (auto-rotation) controls: create and manage wallpaper playlists
		* that auto-switch at a configurable interval.
		*/
		const INTERVALS = [
			30,
			60,
			120,
			300,
			600,
			1800,
			3600
		];
		function CarouselControls({ controller, useSnapshot, t }) {
			const state = useSnapshot((s) => s);
			const carousel = state.carousel;
			const [open, setOpen] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)(null);
			const [newName, setNewName] = (0, react.useState)("");
			const activeList = carousel.playlists.find((p) => p.id === carousel.activePlaylistId) ?? null;
			const save = (c) => {
				controller.store.actions.setCarousel(c);
			};
			const toggleEnabled = () => {
				save({
					...carousel,
					enabled: !carousel.enabled
				});
			};
			const addPlaylist = () => {
				if (newName.trim() === "") return;
				const id = Math.random().toString(36).slice(2, 10);
				const list = {
					id,
					name: newName.trim(),
					wallpaperIds: [],
					interval: 300,
					order: "sequence"
				};
				save({
					...carousel,
					playlists: [...carousel.playlists, list],
					activePlaylistId: carousel.activePlaylistId || id
				});
				setNewName("");
				setEditing(id);
			};
			const importFromSource = (source, name) => {
				const ids = state.projects.filter((p) => p.playable && p.source === source).map((p) => p.id);
				if (ids.length === 0) return;
				if (carousel.playlists.some((p) => p.name === name)) return;
				const id = Math.random().toString(36).slice(2, 10);
				const list = {
					id,
					name,
					wallpaperIds: ids,
					interval: 300,
					order: "sequence"
				};
				save({
					...carousel,
					playlists: [...carousel.playlists, list],
					activePlaylistId: carousel.activePlaylistId || id
				});
			};
			const updatePlaylist = (id, patch) => {
				save({
					...carousel,
					playlists: carousel.playlists.map((p) => p.id === id ? {
						...p,
						...patch
					} : p)
				});
			};
			const deletePlaylist = (id) => {
				save({
					...carousel,
					playlists: carousel.playlists.filter((p) => p.id !== id),
					activePlaylistId: carousel.activePlaylistId === id ? "" : carousel.activePlaylistId
				});
				if (editing === id) setEditing(null);
			};
			const toggleWallpaper = (listId, wpId) => {
				const list = carousel.playlists.find((p) => p.id === listId);
				if (!list) return;
				updatePlaylist(listId, { wallpaperIds: list.wallpaperIds.includes(wpId) ? list.wallpaperIds.filter((id) => id !== wpId) : [...list.wallpaperIds, wpId] });
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: WallpaperSection_module_css_default.carousel,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: WallpaperSection_module_css_default.carouselHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: WallpaperSection_module_css_default.carouselToggle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: carousel.enabled,
							onChange: toggleEnabled
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("carousel") })]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: WallpaperSection_module_css_default.button,
						type: "button",
						onClick: () => {
							setOpen(!open);
						},
						children: open ? t("close") : t("carouselManage")
					})]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: WallpaperSection_module_css_default.carouselBody,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: WallpaperSection_module_css_default.carouselNew,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: WallpaperSection_module_css_default.colorInput,
								type: "text",
								value: newName,
								placeholder: t("carouselNewPlaceholder"),
								onChange: (e) => {
									setNewName(e.target.value);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: WallpaperSection_module_css_default.button,
								type: "button",
								onClick: addPlaylist,
								children: t("carouselAdd")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: WallpaperSection_module_css_default.carouselImport,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: WallpaperSection_module_css_default.button,
								type: "button",
								onClick: () => {
									importFromSource("workshop", t("carouselImportWorkshop"));
								},
								children: t("carouselImportWorkshop")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: WallpaperSection_module_css_default.button,
								type: "button",
								onClick: () => {
									importFromSource("imported", t("carouselImportManual"));
								},
								children: t("carouselImportManual")
							})]
						}),
						carousel.playlists.map((list) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: clsx(WallpaperSection_module_css_default.carouselItem, list.id === carousel.activePlaylistId && WallpaperSection_module_css_default.carouselItemActive),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: WallpaperSection_module_css_default.carouselItemHead,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										className: clsx(WallpaperSection_module_css_default.button, list.id === carousel.activePlaylistId && WallpaperSection_module_css_default.presetBtnActive),
										type: "button",
										onClick: () => {
											save({
												...carousel,
												activePlaylistId: list.id
											});
										},
										children: [
											list.name,
											" (",
											list.wallpaperIds.length,
											")"
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: WallpaperSection_module_css_default.button,
										type: "button",
										onClick: () => {
											setEditing(editing === list.id ? null : list.id);
										},
										children: t("carouselEdit")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: clsx(WallpaperSection_module_css_default.button, WallpaperSection_module_css_default.danger),
										type: "button",
										onClick: () => {
											deletePlaylist(list.id);
										},
										children: t("remove")
									})
								]
							}), editing === list.id && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: WallpaperSection_module_css_default.carouselEdit,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: WallpaperSection_module_css_default.control,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: WallpaperSection_module_css_default.controlLabel,
											children: t("carouselInterval")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
											value: list.interval,
											onChange: (e) => {
												updatePlaylist(list.id, { interval: Number(e.target.value) });
											},
											children: INTERVALS.map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: v,
												children: v >= 60 ? `${v / 60} min` : `${v} s`
											}, v))
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: WallpaperSection_module_css_default.control,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: WallpaperSection_module_css_default.controlLabel,
											children: t("carouselOrder")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											value: list.order,
											onChange: (e) => {
												updatePlaylist(list.id, { order: e.target.value });
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "sequence",
												children: t("carouselOrderSeq")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "random",
												children: t("carouselOrderRand")
											})]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: WallpaperSection_module_css_default.carouselWps,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: WallpaperSection_module_css_default.controlLabel,
											children: t("carouselPick")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: WallpaperSection_module_css_default.carouselGrid,
											children: state.projects.filter((p) => p.playable).map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: WallpaperSection_module_css_default.carouselWp,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													checked: list.wallpaperIds.includes(p.id),
													onChange: () => {
														toggleWallpaper(list.id, p.id);
													}
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: p.title.slice(0, 30) })]
											}, p.id))
										})]
									})
								]
							})]
						}, list.id)),
						carousel.enabled && activeList && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: activeList.wallpaperIds.length > 1 ? WallpaperSection_module_css_default.carouselStatus : WallpaperSection_module_css_default.carouselWarn,
							children: activeList.wallpaperIds.length > 1 ? `${t("carouselActive")}: ${activeList.name} — ${activeList.interval >= 60 ? `${activeList.interval / 60} min` : `${activeList.interval} s`}` : t("carouselNeedMore")
						})
					]
				})]
			});
		}
		//#endregion
		//#region ../src/client/WallpaperSection.tsx
		/**
		* Wallpaper Engine library panel, registered as a settings section. It owns
		* search, manual import/remove, the project card grid, background preference
		* sliders, and the native-scene start/stop control. All bridge writes go
		* through the injected controller; components never touch window directly.
		*/
		function WallpaperSection(props) {
			if (props.controller === void 0 || props.useSnapshot === void 0 || props.t === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadedSection, {
				controller: props.controller,
				useSnapshot: props.useSnapshot,
				isDesktop: props.isDesktop === true,
				t: props.t
			});
		}
		function LoadedSection({ controller, useSnapshot, isDesktop, t }) {
			const state = useSnapshot((s) => s);
			(0, react.useEffect)(() => {
				if (state.status === "idle") controller.load();
			}, [controller, state.status]);
			const filtered = (0, react.useMemo)(() => {
				const query = state.search.trim().toLowerCase();
				let list = state.projects;
				if (state.dedupStrategy !== "none") {
					const preferred = state.dedupStrategy === "manual" ? "imported" : "workshop";
					const map = /* @__PURE__ */ new Map();
					for (const p of list) {
						if (p.workshopId === "") {
							map.set(p.id, p);
							continue;
						}
						const existing = map.get(p.workshopId);
						if (existing === void 0 || p.source === preferred && existing.source !== preferred || existing.source !== preferred && p.source === preferred) map.set(p.workshopId, p);
					}
					list = [...map.values()];
				}
				if (query === "") return list;
				return list.filter((item) => item.title.toLowerCase().includes(query) || item.projectType.toLowerCase().includes(query) || item.sourceLabel.toLowerCase().includes(query));
			}, [
				state.projects,
				state.search,
				state.dedupStrategy
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: WallpaperSection_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: WallpaperSection_module_css_default.head,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: WallpaperSection_module_css_default.title,
							children: t("title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: WallpaperSection_module_css_default.subtitle,
							children: isDesktop ? state.runtimeAvailable ? t("runtimeAvailable") : t("runtimeMissing") : t("desktopHint")
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: WallpaperSection_module_css_default.actions,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: WallpaperSection_module_css_default.button,
									type: "button",
									onClick: () => {
										controller.load(true);
									},
									children: t("rescan")
								}),
								isDesktop && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: WallpaperSection_module_css_default.button,
									type: "button",
									onClick: () => {
										controller.chooseDirectory();
									},
									children: t("importDirectory")
								}),
								isDesktop && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: WallpaperSection_module_css_default.button,
									type: "button",
									onClick: () => {
										controller.chooseProjectFile();
									},
									children: t("importProjectFile")
								})
							]
						})]
					}),
					!isDesktop && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: WallpaperSection_module_css_default.notice,
						children: t("desktopOnly")
					}),
					isDesktop && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: WallpaperSection_module_css_default.toolbar,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: WallpaperSection_module_css_default.search,
									type: "search",
									placeholder: t("searchPlaceholder"),
									value: state.search,
									onChange: (event) => {
										controller.store.actions.setSearch(event.target.value);
									}
								}),
								state.selection.active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: clsx(WallpaperSection_module_css_default.button, WallpaperSection_module_css_default.danger),
									type: "button",
									onClick: () => {
										controller.clearSelection();
									},
									children: t("restoreDefault")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: WallpaperSection_module_css_default.dedupSelect,
									value: state.dedupStrategy,
									onChange: (e) => {
										controller.store.actions.setDedupStrategy(e.target.value);
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "workshop",
											children: t("dedupWorkshop")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "manual",
											children: t("dedupManual")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "none",
											children: t("dedupNone")
										})
									]
								})
							]
						}),
						state.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: WallpaperSection_module_css_default.status,
							children: t("loading")
						}),
						state.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: clsx(WallpaperSection_module_css_default.status, WallpaperSection_module_css_default.error),
							children: [
								t("errorPrefix"),
								": ",
								state.error
							]
						}),
						state.manualRoots.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: WallpaperSection_module_css_default.roots,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: WallpaperSection_module_css_default.rootsLabel,
								children: t("manualRoots")
							}), state.manualRoots.map((root) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: WallpaperSection_module_css_default.rootChip,
								children: [root.name, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: WallpaperSection_module_css_default.rootRemove,
									"aria-label": `${t("remove")} ${root.name}`,
									onClick: () => {
										controller.removeRoot(root.id);
									},
									children: "×"
								})]
							}, root.id))]
						}),
						state.status === "ready" && filtered.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: WallpaperSection_module_css_default.status,
							children: t("empty")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: WallpaperSection_module_css_default.grid,
							children: filtered.map((project) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LazyCard, {
								project,
								token: state.mediaToken,
								selected: state.selection.active && state.selection.id === project.id,
								sceneActive: state.scene.active,
								t,
								onSelect: () => controller.selectProject(project),
								onOpen: () => {
									controller.openProjectDetails(project);
								},
								onStopScene: () => {
									controller.stopScene();
								}
							}, project.id))
						}),
						state.selection.active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BackgroundControls, {
							t,
							opacity: state.selection.opacity,
							blur: state.selection.blur,
							fill: state.selection.fill,
							onOpacity: (value) => {
								controller.store.actions.setSelection({
									...state.selection,
									opacity: value
								});
							},
							onBlur: (value) => {
								controller.store.actions.setSelection({
									...state.selection,
									blur: value
								});
							},
							onFill: (fill) => {
								controller.store.actions.setSelection({
									...state.selection,
									fill
								});
							}
						}),
						state.scene.active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: state.scene.windowParked ? WallpaperSection_module_css_default.sceneNote : clsx(WallpaperSection_module_css_default.sceneNote, WallpaperSection_module_css_default.error),
							children: state.scene.windowParked ? t("windowParked") : state.scene.parkError !== "" ? `${t("windowParkFailed")}（${state.scene.parkError}）` : t("engineRun")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CarouselControls, {
							controller,
							useSnapshot,
							t
						})
					] })
				]
			});
		}
		function BackgroundControls({ t, opacity, blur, fill, onOpacity, onBlur, onFill }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: WallpaperSection_module_css_default.controls,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: WallpaperSection_module_css_default.control,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("opacity") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "range",
							min: 0,
							max: 1,
							step: .05,
							value: opacity,
							onChange: (event) => {
								onOpacity(Number(event.target.value));
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: WallpaperSection_module_css_default.control,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("blur") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "range",
							min: 0,
							max: 80,
							step: 1,
							value: blur,
							onChange: (event) => {
								onBlur(Number(event.target.value));
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: WallpaperSection_module_css_default.control,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("fill") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: fill,
							onChange: (event) => {
								onFill(event.target.value);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "cover",
									children: t("fillCover")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "contain",
									children: t("fillContain")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "fill",
									children: t("fillFill")
								})
							]
						})]
					})
				]
			});
		}
		/** IntersectionObserver-gated card: only renders its media once near viewport. */
		function LazyCard({ project, token, selected, sceneActive, t, onSelect, onOpen, onStopScene }) {
			const ref = (0, react.useRef)(null);
			const [visible, setVisible] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const node = ref.current;
				if (node === null || visible) return;
				const observer = new IntersectionObserver((entries) => {
					if (entries.some((entry) => entry.isIntersecting)) {
						setVisible(true);
						observer.disconnect();
					}
				}, { rootMargin: "240px" });
				observer.observe(node);
				return () => {
					observer.disconnect();
				};
			}, [visible]);
			const thumb = wallpaperMediaUrl(project.hasPreview ? "preview" : "media", project, token);
			const label = project.enginePlayable ? t("scene") : project.mediaType === "video" ? t("video") : project.mediaType === "image" ? t("image") : t("previewOnly");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref,
				className: clsx(WallpaperSection_module_css_default.card, selected && WallpaperSection_module_css_default.cardSelected),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: WallpaperSection_module_css_default.thumb,
					children: [
						visible && thumb !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							className: WallpaperSection_module_css_default.thumbImage,
							src: thumb,
							alt: "",
							loading: "lazy"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: WallpaperSection_module_css_default.badge,
							children: label
						}),
						project.workshopId !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: WallpaperSection_module_css_default.cardOpen,
							type: "button",
							onClick: onOpen,
							children: "STEAM"
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: WallpaperSection_module_css_default.cardBody,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: WallpaperSection_module_css_default.cardTitle,
							title: project.title,
							children: project.title
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: WallpaperSection_module_css_default.cardMeta,
							children: project.sourceLabel
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: WallpaperSection_module_css_default.cardActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: WallpaperSection_module_css_default.button,
								type: "button",
								onClick: onSelect,
								children: selected ? t("applied") : t("setAsBackground")
							}), selected && project.enginePlayable && sceneActive && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: clsx(WallpaperSection_module_css_default.button, WallpaperSection_module_css_default.danger),
								type: "button",
								onClick: onStopScene,
								children: t("engineStop")
							})]
						})
					]
				})]
			});
		}
		//#endregion
		//#region ../src/client/DesktopCustomSection.tsx
		/**
		* Desktop customisation panel: presets and sliders that control the
		* DSH app frame's opacity, blur, colour, radius, border, and shadow.
		* Registered as the "Desktop" settings section.
		*/
		function DesktopCustomSection(props) {
			if (props.controller === void 0 || props.useSnapshot === void 0 || props.t === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadedDesktop, {
				controller: props.controller,
				useSnapshot: props.useSnapshot,
				t: props.t
			});
		}
		const PRESETS = [
			{
				key: "presetDefault",
				style: { ...DEFAULT_CUSTOM_STYLE }
			},
			{
				key: "presetGlass",
				style: {
					mainOpacity: .5,
					mainBlur: 24,
					sidebarOpacity: .35,
					sidebarBlur: 16,
					chatOpacity: .45,
					chatBlur: 20,
					inputOpacity: .4,
					inputBlur: 12,
					panelOpacity: .5,
					panelBlur: 18,
					tintColor: "",
					accentColor: "",
					radius: 12,
					borderWidth: 1,
					borderColor: "rgba(255,255,255,0.15)",
					shadowStrength: .3,
					scrimStrength: .15
				}
			},
			{
				key: "presetAcrylic",
				style: {
					mainOpacity: .65,
					mainBlur: 8,
					sidebarOpacity: .45,
					sidebarBlur: 4,
					chatOpacity: .6,
					chatBlur: 6,
					inputOpacity: .5,
					inputBlur: 4,
					panelOpacity: .6,
					panelBlur: 6,
					tintColor: "",
					accentColor: "",
					radius: 8,
					borderWidth: 1,
					borderColor: "rgba(255,255,255,0.12)",
					shadowStrength: .2
				}
			},
			{
				key: "presetTransparent",
				style: {
					mainOpacity: .15,
					mainBlur: 0,
					sidebarOpacity: .1,
					sidebarBlur: 0,
					chatOpacity: .12,
					chatBlur: 0,
					inputOpacity: .1,
					inputBlur: 0,
					panelOpacity: .15,
					panelBlur: 0,
					tintColor: "",
					accentColor: "",
					radius: 0,
					borderWidth: 0,
					borderColor: "",
					shadowStrength: 0
				}
			}
		];
		function stylesEqual(a, b) {
			return a.mainOpacity === b.mainOpacity && a.mainBlur === b.mainBlur && a.sidebarOpacity === b.sidebarOpacity && a.sidebarBlur === b.sidebarBlur && a.chatOpacity === b.chatOpacity && a.chatBlur === b.chatBlur && a.inputOpacity === b.inputOpacity && a.inputBlur === b.inputBlur && a.panelOpacity === b.panelOpacity && a.panelBlur === b.panelBlur && a.tintColor === b.tintColor && a.accentColor === b.accentColor && a.radius === b.radius && a.borderWidth === b.borderWidth && a.borderColor === b.borderColor && a.shadowStrength === b.shadowStrength && a.scrimStrength === b.scrimStrength;
		}
		function LoadedDesktop({ controller, useSnapshot, t }) {
			const cs = useSnapshot((s) => s).customStyle;
			const activePreset = PRESETS.findIndex((p) => stylesEqual(p.style, cs));
			const set = (patch) => {
				controller.store.actions.setCustomStyle({
					...cs,
					...patch
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: WallpaperSection_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: WallpaperSection_module_css_default.head,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: WallpaperSection_module_css_default.title,
							children: t("desktopTitle")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: WallpaperSection_module_css_default.subtitle,
							children: t("desktopSubtitle")
						})] })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: WallpaperSection_module_css_default.presets,
						children: PRESETS.map((preset, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: clsx(WallpaperSection_module_css_default.presetBtn, i === activePreset && WallpaperSection_module_css_default.presetBtnActive),
							type: "button",
							onClick: () => {
								controller.store.actions.setCustomStyle(preset.style);
							},
							children: t(preset.key)
						}, preset.key))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: WallpaperSection_module_css_default.controls,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("mainOpacity"),
								value: cs.mainOpacity,
								min: .05,
								max: 1,
								step: .05,
								onChange: (v) => {
									set({ mainOpacity: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("mainBlur"),
								value: cs.mainBlur,
								min: 0,
								max: 40,
								step: 1,
								onChange: (v) => {
									set({ mainBlur: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("sidebarOpacity"),
								value: cs.sidebarOpacity,
								min: .05,
								max: 1,
								step: .05,
								onChange: (v) => {
									set({ sidebarOpacity: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("sidebarBlur"),
								value: cs.sidebarBlur,
								min: 0,
								max: 40,
								step: 1,
								onChange: (v) => {
									set({ sidebarBlur: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("chatOpacity"),
								value: cs.chatOpacity,
								min: .05,
								max: 1,
								step: .05,
								onChange: (v) => {
									set({ chatOpacity: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("chatBlur"),
								value: cs.chatBlur,
								min: 0,
								max: 40,
								step: 1,
								onChange: (v) => {
									set({ chatBlur: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("inputOpacity"),
								value: cs.inputOpacity,
								min: .05,
								max: 1,
								step: .05,
								onChange: (v) => {
									set({ inputOpacity: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("inputBlur"),
								value: cs.inputBlur,
								min: 0,
								max: 40,
								step: 1,
								onChange: (v) => {
									set({ inputBlur: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("panelOpacity"),
								value: cs.panelOpacity,
								min: .05,
								max: 1,
								step: .05,
								onChange: (v) => {
									set({ panelOpacity: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("panelBlur"),
								value: cs.panelBlur,
								min: 0,
								max: 40,
								step: 1,
								onChange: (v) => {
									set({ panelBlur: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ColorRow, {
								label: t("tintColor"),
								value: cs.tintColor,
								onChange: (v) => {
									set({ tintColor: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ColorRow, {
								label: t("accentColor"),
								value: cs.accentColor,
								onChange: (v) => {
									set({ accentColor: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("radius"),
								value: cs.radius,
								min: 0,
								max: 24,
								step: 1,
								onChange: (v) => {
									set({ radius: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("borderWidth"),
								value: cs.borderWidth,
								min: 0,
								max: 4,
								step: 1,
								onChange: (v) => {
									set({ borderWidth: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ColorRow, {
								label: t("borderColor"),
								value: cs.borderColor,
								onChange: (v) => {
									set({ borderColor: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("shadowStrength"),
								value: cs.shadowStrength,
								min: 0,
								max: 1,
								step: .05,
								onChange: (v) => {
									set({ shadowStrength: v });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderRow, {
								label: t("scrimStrength"),
								value: cs.scrimStrength,
								min: 0,
								max: 1,
								step: .05,
								onChange: (v) => {
									set({ scrimStrength: v });
								}
							})
						]
					})
				]
			});
		}
		function SliderRow({ label, value, min, max, step, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: WallpaperSection_module_css_default.control,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: WallpaperSection_module_css_default.controlLabel,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "range",
						min,
						max,
						step,
						value,
						onChange: (e) => {
							onChange(Number(e.target.value));
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: WallpaperSection_module_css_default.controlVal,
						children: value
					})
				]
			});
		}
		function ColorRow({ label, value, onChange }) {
			const [current, setCurrent] = (0, react.useState)(value);
			(0, react.useEffect)(() => {
				setCurrent(value);
			}, [value]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: WallpaperSection_module_css_default.control,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: WallpaperSection_module_css_default.controlLabel,
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "text",
					className: WallpaperSection_module_css_default.colorInput,
					value: current,
					placeholder: "rgba(255,255,255,0.15)",
					onChange: (e) => {
						setCurrent(e.target.value);
					},
					onBlur: () => {
						onChange(current);
					}
				})]
			});
		}
		//#endregion
		//#region \0dsh-css:D:\deepseek-harness\plugin-package\dsh-wallpaper-engine\packages\dsh-wallpaper-engine\src\client\WallpaperBackground.module.css.mjs
		const css = ".mm6n-q_host{z-index:-1;pointer-events:none;position:fixed;inset:0;overflow:hidden}.mm6n-q_layer{transition:opacity var(--ds-transition-duration-slow,.2s) var(--ds-ease-in-out,ease-in-out);position:absolute;inset:0;overflow:hidden}.mm6n-q_image,.mm6n-q_video{border:0;width:100%;height:100%;position:absolute;inset:0}.mm6n-q_image{background-position:50%;background-repeat:no-repeat}.mm6n-q_video{object-fit:cover}.mm6n-q_fill_cover.mm6n-q_image{background-size:cover}.mm6n-q_fill_contain.mm6n-q_image{background-size:contain}.mm6n-q_fill_fill.mm6n-q_image{background-size:100% 100%}.mm6n-q_fill_cover.mm6n-q_video{object-fit:cover}.mm6n-q_fill_contain.mm6n-q_video{object-fit:contain}.mm6n-q_fill_fill.mm6n-q_video{object-fit:fill}.mm6n-q_fallbackNote{color:#fff;pointer-events:none;background:#0000008c;border-radius:8px;max-width:480px;padding:6px 10px;font-size:12px;line-height:18px;position:absolute;bottom:12px;left:12px}.mm6n-q_scrim{pointer-events:none;background:#000;position:absolute;inset:0}";
		const tagId = "dsh-wallpaper-engine/WallpaperBackground.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-wallpaper-engine";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var WallpaperBackground_module_css_default = {
			"fallbackNote": "mm6n-q_fallbackNote",
			"fill_contain": "mm6n-q_fill_contain",
			"fill_cover": "mm6n-q_fill_cover",
			"video": "mm6n-q_video",
			"layer": "mm6n-q_layer",
			"fill_fill": "mm6n-q_fill_fill",
			"scrim": "mm6n-q_scrim",
			"host": "mm6n-q_host",
			"image": "mm6n-q_image"
		};
		//#endregion
		//#region ../src/client/WallpaperBackground.tsx
		/**
		* Full-viewport wallpaper background layer. Rendered through a portal onto
		* `document.body` (behind #root) so the three-column app frame stays above
		* it; when a wallpaper is active the component also injects a stylesheet that
		* makes the app frame and sidebar transparent. Media/preview projects render
		* as CSS backgrounds or a muted looping `<video>`; WE Scene projects are
		* captured from the native WE window through the desktop-capture source-id
		* path and fall back to the preview image on any error.
		*/
		const TRANSPARENT_APP_STYLE_ID = "dsh-wallpaper-transparent-app";
		const CUSTOM_STYLE_ID = "dsh-wallpaper-custom-style";
		/** Capture one Chromium desktop source id into a MediaStream. */
		async function captureDesktopSource(sourceId) {
			return navigator.mediaDevices.getUserMedia({
				audio: false,
				video: { mandatory: {
					chromeMediaSource: "desktop",
					chromeMediaSourceId: sourceId,
					maxWidth: 7680,
					maxHeight: 4320
				} }
			});
		}
		function stopStream(stream) {
			if (stream === null) return;
			for (const track of stream.getTracks()) track.stop();
		}
		function projectById(state, id) {
			return state.projects.find((item) => item.id === id) ?? null;
		}
		function LayerStyle({ selection }) {
			const blur = selection.blur > 0 ? `blur(${selection.blur}px)` : "";
			return {
				opacity: selection.opacity,
				filter: blur
			};
		}
		/**
		* Render the wallpaper layer. The overlay slot outlet renders nothing; the
		* actual element is portalled to a body child with negative z-index, which
		* paints below the app frame.
		* @param props - injected controller, store hook, and desktop flag.
		* @returns null (the portal owns the visible element).
		*/
		function WallpaperBackground(props) {
			if (props.controller === void 0 || props.useSnapshot === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadedBackground, {
				controller: props.controller,
				useSnapshot: props.useSnapshot,
				isDesktop: props.isDesktop === true
			});
		}
		function LoadedBackground({ controller, useSnapshot, isDesktop }) {
			const state = useSnapshot((s) => s);
			const [portalHost] = (0, react.useState)(() => {
				const host = document.createElement("div");
				host.className = WallpaperBackground_module_css_default.host ?? "dsh-wallpaper-bg-host";
				host.setAttribute("aria-hidden", "true");
				document.body.appendChild(host);
				return host;
			});
			const [engineStream, setEngineStream] = (0, react.useState)(null);
			const videoRef = (0, react.useRef)(null);
			const selection = state.selection;
			const scene = state.scene;
			const token = state.mediaToken;
			const project = selection.active ? projectById(state, selection.id) : null;
			(0, react.useEffect)(() => {
				if (selection.active && token === "" && state.status === "idle") controller.load();
			}, [
				controller,
				selection.active,
				token,
				state.status
			]);
			(0, react.useEffect)(() => {
				if (!selection.active) return;
				let style = document.getElementById(TRANSPARENT_APP_STYLE_ID);
				if (style === null) {
					style = document.createElement("style");
					style.id = TRANSPARENT_APP_STYLE_ID;
					style.textContent = "#root > div { background: transparent; } #root { --dsw-specific-sidebar-fill: transparent; }";
					document.head.appendChild(style);
				}
				return () => {
					style.remove();
				};
			}, [selection.active]);
			(0, react.useEffect)(() => {
				const c = state.carousel;
				if (!selection.active || !c.enabled) return;
				const list = c.playlists.find((p) => p.id === c.activePlaylistId);
				if (!list || list.wallpaperIds.length <= 1) return;
				const ids = list.wallpaperIds;
				const currentId = selection.id;
				const projects = state.projects;
				let cancelled = false;
				const timer = setTimeout(() => {
					if (cancelled) return;
					const idx = ids.indexOf(currentId);
					if (idx < 0) return;
					const nextId = list.order === "random" ? ids[Math.floor(Math.random() * ids.length)] : ids[(idx + 1) % ids.length];
					if (nextId === currentId) return;
					const project = projects.find((p) => p.id === nextId);
					if (project) controller.selectProject(project);
				}, list.interval * 1e3);
				return () => {
					cancelled = true;
					clearTimeout(timer);
				};
			}, [
				controller,
				selection.active,
				selection.id,
				state.carousel.enabled,
				state.carousel.activePlaylistId,
				state.carousel.playlists
			]);
			(0, react.useEffect)(() => {
				const cs = state.customStyle;
				let style = document.getElementById(CUSTOM_STYLE_ID);
				if (style !== null) style.remove();
				if (isDefaultStyle(cs)) return;
				style = document.createElement("style");
				style.id = CUSTOM_STYLE_ID;
				const v = [];
				function addVar(name, value) {
					v.push(`--dsh-custom-${name}: ${value}`);
				}
				addVar("main-opacity", cs.mainOpacity);
				addVar("main-blur", `${cs.mainBlur}px`);
				addVar("sidebar-opacity", cs.sidebarOpacity);
				addVar("sidebar-blur", `${cs.sidebarBlur}px`);
				addVar("chat-opacity", cs.chatOpacity);
				addVar("chat-blur", `${cs.chatBlur}px`);
				addVar("input-opacity", cs.inputOpacity);
				addVar("input-blur", `${cs.inputBlur}px`);
				addVar("panel-opacity", cs.panelOpacity);
				addVar("panel-blur", `${cs.panelBlur}px`);
				if (cs.tintColor !== "") addVar("tint", cs.tintColor);
				if (cs.accentColor !== "") addVar("accent", cs.accentColor);
				if (cs.radius > 0) addVar("radius", `${cs.radius}px`);
				if (cs.borderWidth > 0 && cs.borderColor !== "") addVar("border", `${cs.borderWidth}px solid ${cs.borderColor}`);
				if (cs.shadowStrength > 0) addVar("shadow", `0 8px 32px rgba(0,0,0,${(cs.shadowStrength * .4).toFixed(2)})`);
				if (cs.scrimStrength > 0) addVar("scrim", cs.scrimStrength);
				style.textContent = `#root { ${v.join("; ")} }
#root > div {
  background: rgba(15,17,21, var(--dsh-custom-main-opacity, 1)) !important;
  backdrop-filter: blur(var(--dsh-custom-main-blur, 0px)) !important;
  -webkit-backdrop-filter: blur(var(--dsh-custom-main-blur, 0px)) !important;
  border-radius: var(--dsh-custom-radius, 0px) !important;
  border: var(--dsh-custom-border, none) !important;
}
#root {
  --dsw-specific-sidebar-fill: rgba(15,17,21, var(--dsh-custom-sidebar-opacity, 1)) !important;
}
/* Clear the composer white gradient and detail-panel opaque background
   (dsh-client-ui-conversation rc.7 injects a sticky white gradient on the
   composer seat and a solid background on the detail panel). */
#root [data-composer-seat] { background: transparent !important; }
#root [data-slot="details"] > div { background: transparent !important; }
/* Tint overlays the main panel with the user's chosen colour via an
   inner box-shadow; accent overrides the DSH theme accent variable. */
#root > div {
  box-shadow: var(--dsh-custom-shadow, none), inset 0 0 0 9999px var(--dsh-custom-tint, transparent) !important;
}
#root { --dsw-specific-accent: var(--dsh-custom-accent, #3964fe) !important; }`;
				document.head.appendChild(style);
			}, [state.customStyle]);
			(0, react.useEffect)(() => {
				if (selection.kind !== "engine" || !selection.active) {
					setEngineStream(null);
					controller.stopScene();
					return;
				}
				const cancelled = { value: false };
				const isCancelled = () => cancelled.value;
				let stream = null;
				setEngineStream(null);
				const run = async () => {
					const started = await controller.startScene(selection.id);
					if (isCancelled()) return;
					if (!started.ok || started.sourceId === void 0 || started.sessionId === void 0) {
						controller.store.actions.setScene({
							active: false,
							sessionId: "",
							sourceId: "",
							error: started.error || "WALLPAPER_ENGINE_START_FAILED",
							windowParked: false,
							parkError: ""
						});
						return;
					}
					try {
						stream = await captureDesktopSource(started.sourceId);
					} catch {
						await controller.reportCapture(started.sessionId, false);
						return;
					}
					if (isCancelled()) {
						stopStream(stream);
						return;
					}
					setEngineStream(stream);
					const deadline = Date.now() + 6e3;
					while (Date.now() < deadline && !isCancelled()) {
						const video = videoRef.current;
						if (video !== null && video.videoWidth > 0) {
							await controller.reportCapture(started.sessionId, true);
							return;
						}
						await new Promise((resolve) => setTimeout(resolve, 120));
					}
					await controller.reportCapture(started.sessionId, false);
				};
				run();
				return () => {
					cancelled.value = true;
					stopStream(stream);
					setEngineStream(null);
					if (selection.active) controller.stopScene();
				};
			}, [
				controller,
				selection.active,
				selection.id,
				selection.kind
			]);
			(0, react.useEffect)(() => {
				const api = window.desktopWindow;
				if (api?.onWallpaperEngineHostBoundsChanged === void 0) return;
				let timer = 0;
				const unsubscribe = api.onWallpaperEngineHostBoundsChanged(() => {
					const video = videoRef.current;
					if (video === null) return;
					video.pause();
					window.clearTimeout(timer);
					timer = window.setTimeout(() => {
						if (video.srcObject !== null) video.play().catch(() => {});
					}, 180);
				});
				return () => {
					window.clearTimeout(timer);
					unsubscribe();
				};
			}, [controller]);
			(0, react.useEffect)(() => {
				const video = videoRef.current;
				if (video === null || engineStream === null) return;
				if (video.srcObject === engineStream) return;
				video.srcObject = engineStream;
				video.play().catch(() => {});
			}, [engineStream]);
			(0, react.useEffect)(() => () => {
				portalHost.remove();
			}, [portalHost]);
			if (!selection.active) return (0, react_dom.createPortal)(null, portalHost);
			const showEngineVideo = selection.kind === "engine" && engineStream !== null;
			const fallbackUrl = wallpaperMediaUrl(project?.hasPreview === true || project?.playable !== true ? "preview" : "media", project, token);
			const mediaUrl = wallpaperMediaUrl("media", project, token);
			const sourceUrl = showEngineVideo ? "" : selection.kind === "media" && isDesktop && mediaUrl !== "" ? mediaUrl : fallbackUrl;
			const layerStyle = LayerStyle({ selection });
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: WallpaperBackground_module_css_default.layer,
				style: layerStyle,
				"data-kind": selection.kind,
				children: [
					showEngineVideo ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
						ref: videoRef,
						className: clsx(WallpaperBackground_module_css_default.video, WallpaperBackground_module_css_default[`fill_${selection.fill}`]),
						autoPlay: true,
						muted: true,
						loop: true,
						playsInline: true
					}) : sourceUrl !== "" && (selection.kind === "media" && selection.mediaType === "video" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
						className: clsx(WallpaperBackground_module_css_default.video, WallpaperBackground_module_css_default[`fill_${selection.fill}`]),
						src: sourceUrl,
						autoPlay: true,
						muted: true,
						loop: true,
						playsInline: true
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: clsx(WallpaperBackground_module_css_default.image, WallpaperBackground_module_css_default[`fill_${selection.fill}`]),
						style: { backgroundImage: `url("${sourceUrl}")` }
					})),
					selection.kind === "engine" && scene.error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: WallpaperBackground_module_css_default.fallbackNote,
						children: scene.error
					}),
					state.customStyle.scrimStrength > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: WallpaperBackground_module_css_default.scrim,
						style: { background: `rgba(0,0,0,${state.customStyle.scrimStrength})` }
					})
				]
			}), portalHost);
		}
		function isDefaultStyle(cs) {
			return cs.mainOpacity === 1 && cs.mainBlur === 0 && cs.sidebarOpacity === 1 && cs.sidebarBlur === 0 && cs.chatOpacity === 1 && cs.chatBlur === 0 && cs.inputOpacity === 1 && cs.inputBlur === 0 && cs.panelOpacity === 1 && cs.panelBlur === 0 && cs.tintColor === "" && cs.accentColor === "" && cs.radius === 0 && cs.borderWidth === 0 && cs.borderColor === "" && cs.shadowStrength === 0 && cs.scrimStrength === 0;
		}
		//#endregion
		//#region ../src/client/locales.ts
		/** Wallpaper Engine section copy (zh/en). Product copy is Chinese-first. */
		const zh = {
			desktopNav: "桌面",
			wallpaperNav: "壁纸",
			desktopTitle: "界面自定义",
			desktopSubtitle: "调整 DSH 界面模块的透明度、模糊、颜色、圆角、边框和阴影，实时预览，一键预设。",
			presetDefault: "默认",
			presetGlass: "毛玻璃",
			presetAcrylic: "亚克力",
			presetTransparent: "透明",
			mainOpacity: "主框架透明度",
			mainBlur: "主框架模糊",
			sidebarOpacity: "侧边栏透明度",
			sidebarBlur: "侧边栏模糊",
			chatOpacity: "对话区透明度",
			chatBlur: "对话区模糊",
			inputOpacity: "输入栏透明度",
			inputBlur: "输入栏模糊",
			panelOpacity: "设置面板透明度",
			panelBlur: "设置面板模糊",
			tintColor: "背景色调",
			accentColor: "强调色",
			radius: "全局圆角",
			borderWidth: "边框宽度",
			borderColor: "边框颜色",
			shadowStrength: "阴影强度",
			scrimStrength: "遮罩强度",
			carousel: "自动轮播",
			carouselManage: "管理列表",
			carouselNewPlaceholder: "新列表名称",
			carouselAdd: "新建",
			carouselEdit: "编辑",
			carouselInterval: "切换间隔",
			carouselOrder: "播放顺序",
			carouselOrderSeq: "顺序",
			carouselOrderRand: "随机",
			carouselPick: "选择壁纸",
			carouselActive: "轮播中",
			carouselNeedMore: "至少需要 2 张壁纸才能轮播",
			carouselImportWorkshop: "从创意工坊导入",
			carouselImportManual: "从手动导入创建",
			close: "收起",
			title: "Wallpaper Engine 壁纸库",
			desktopOnly: "当前为网页版。安装并启动 DSH 桌面版后，这里可以识别本地 Wallpaper Engine 项目并设为聊天背景。",
			searchPlaceholder: "搜索壁纸项目",
			importDirectory: "导入目录",
			importProjectFile: "导入 project.json / 场景包",
			rescan: "重新扫描",
			restoreDefault: "恢复默认背景",
			setAsBackground: "设为背景",
			applied: "已设为背景",
			engineRun: "WE 原生运行",
			engineStop: "停止 Scene",
			remove: "移除",
			scene: "Scene",
			video: "视频",
			image: "图片",
			previewOnly: "仅预览",
			opacity: "不透明度",
			blur: "模糊",
			fill: "填充方式",
			fillCover: "覆盖",
			fillContain: "包含",
			fillFill: "拉伸",
			empty: "未发现 Wallpaper Engine 项目。点击\"导入目录\"选择一个包含 project.json 的目录，或点击右上角按钮导入单个项目文件。",
			loading: "正在识别本地项目…",
			errorPrefix: "识别失败",
			runtimeAvailable: "已检测到 Wallpaper Engine",
			runtimeMissing: "未检测到 Wallpaper Engine 本体，Scene 项目将以预览图显示",
			manualRoots: "手动导入",
			nativeSceneFailed: "WE Scene 启动失败，已回退到预览图",
			windowParked: "播放窗口已移出屏幕，不遮挡桌面",
			windowParkFailed: "播放窗口未能移出屏幕",
			dedupWorkshop: "创意工坊优先",
			dedupManual: "手动导入优先",
			dedupNone: "全部保留",
			desktopHint: "桌面版支持"
		};
		const en = {
			desktopNav: "Desktop",
			wallpaperNav: "Wallpaper",
			desktopTitle: "Appearance",
			desktopSubtitle: "Customise opacity, blur, colour, radius, border, and shadow for the DSH interface. Changes apply instantly.",
			presetDefault: "Default",
			presetGlass: "Glass",
			presetAcrylic: "Acrylic",
			presetTransparent: "Transparent",
			mainOpacity: "Frame opacity",
			mainBlur: "Frame blur",
			sidebarOpacity: "Sidebar opacity",
			sidebarBlur: "Sidebar blur",
			chatOpacity: "Chat opacity",
			chatBlur: "Chat blur",
			inputOpacity: "Input bar opacity",
			inputBlur: "Input bar blur",
			panelOpacity: "Panel opacity",
			panelBlur: "Panel blur",
			tintColor: "Tint",
			accentColor: "Accent",
			radius: "Corner radius",
			borderWidth: "Border width",
			borderColor: "Border colour",
			shadowStrength: "Shadow",
			scrimStrength: "Scrim",
			carousel: "Auto-rotate",
			carouselManage: "Manage",
			carouselNewPlaceholder: "New playlist name",
			carouselAdd: "Create",
			carouselEdit: "Edit",
			carouselInterval: "Switch interval",
			carouselOrder: "Order",
			carouselOrderSeq: "Sequence",
			carouselOrderRand: "Random",
			carouselPick: "Pick wallpapers",
			carouselActive: "Rotating",
			carouselNeedMore: "Need at least 2 wallpapers",
			carouselImportWorkshop: "Import from Workshop",
			carouselImportManual: "Import from Manual",
			close: "Close",
			title: "Wallpaper Engine Library",
			desktopOnly: "You are using the web version. Install and launch the DSH desktop app to discover local Wallpaper Engine projects and set them as the chat background.",
			searchPlaceholder: "Search wallpaper projects",
			importDirectory: "Import directory",
			importProjectFile: "Import project.json / scene package",
			rescan: "Rescan",
			restoreDefault: "Restore default background",
			setAsBackground: "Set as background",
			applied: "Applied",
			engineRun: "Run WE Scene",
			engineStop: "Stop Scene",
			remove: "Remove",
			scene: "Scene",
			video: "Video",
			image: "Image",
			previewOnly: "Preview only",
			opacity: "Opacity",
			blur: "Blur",
			fill: "Fill",
			fillCover: "Cover",
			fillContain: "Contain",
			fillFill: "Stretch",
			empty: "No Wallpaper Engine projects found. Import a directory containing project.json, or import a single project file.",
			loading: "Discovering local projects…",
			errorPrefix: "Scan failed",
			runtimeAvailable: "Wallpaper Engine detected",
			runtimeMissing: "Wallpaper Engine not detected; Scene projects use their preview image",
			manualRoots: "Manual imports",
			nativeSceneFailed: "WE Scene failed to start, fell back to the preview image",
			windowParked: "Playback window moved off-screen so it never covers the desktop",
			windowParkFailed: "Could not move the playback window off-screen",
			dedupWorkshop: "Workshop first",
			dedupManual: "Manual first",
			dedupNone: "Keep all",
			desktopHint: "Desktop version"
		};
		//#endregion
		//#region ../src/client/index.ts
		const NS = "settings.wallpaper-engine";
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-wallpaper-engine: copy dictionaries");
			const t = ctx.locale.bind(NS);
			const api = getDesktopWindowApi();
			const controller = new WallpaperEngineController(api);
			const useSnapshot = bindWallpaperSnapshot(controller);
			const libraryInjected = () => ({
				controller,
				useSnapshot,
				isDesktop: api !== null,
				t
			});
			const desktopInjected = () => ({
				controller,
				useSnapshot,
				isDesktop: api !== null,
				t
			});
			const backgroundInjected = () => ({
				controller,
				useSnapshot,
				isDesktop: api !== null
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "wallpaper-desktop",
				order: 900,
				label: () => t("desktopNav"),
				inject: desktopInjected
			}, DesktopCustomSection));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "wallpaper-library",
				order: 910,
				label: () => t("wallpaperNav"),
				inject: libraryInjected
			}, WallpaperSection));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "wallpaper-engine-background",
				order: -100,
				inject: backgroundInjected
			}, WallpaperBackground));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map