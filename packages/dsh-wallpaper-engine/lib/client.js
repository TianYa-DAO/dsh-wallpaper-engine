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
		* active selection, and the native-scene capture session. Business data
		* (which files exist on disk, what WE is doing) stays in the desktop main
		* process; this store only mirrors the renderer-visible projection.
		*/
		/**
		* Create the wallpaper UI store handle. The handle is constructed in apply
		* world and shared by the settings-section entry and the background entry, so
		* both read and write the same instance.
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
					clearSceneError: (d) => {
						d.scene.error = "";
					}
				}
			});
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
		const css$1 = ".O_XpsG_section{flex-direction:column;gap:16px;min-width:0;display:flex}.O_XpsG_head{justify-content:space-between;align-items:flex-start;gap:16px;display:flex}.O_XpsG_title{color:var(--dsw-alias-label-primary);margin:0;font-size:15px;font-weight:600;line-height:22px}.O_XpsG_subtitle{color:var(--dsw-alias-label-tertiary);margin:4px 0 0;font-size:12px;line-height:18px}.O_XpsG_actions{flex-wrap:wrap;justify-content:flex-end;gap:8px;display:flex}.O_XpsG_button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:8px;padding:6px 10px;font-size:12px;line-height:18px}.O_XpsG_button:hover{background:var(--dsw-alias-bg-hover,#0000000d)}.O_XpsG_danger{color:var(--dsw-specific-danger,#c0392b)}.O_XpsG_notice{border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:12px;padding:16px;font-size:13px;line-height:20px}.O_XpsG_toolbar{align-items:center;gap:8px;display:flex}.O_XpsG_search{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);min-width:0;color:var(--dsw-alias-label-primary);border-radius:8px;flex:1;padding:7px 10px;font-size:13px;line-height:18px}.O_XpsG_status{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.O_XpsG_sceneNote{color:var(--dsw-alias-label-secondary);margin-top:10px;font-size:13px;line-height:20px}.O_XpsG_error{color:var(--dsw-specific-danger,#c0392b)}.O_XpsG_roots{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.O_XpsG_rootsLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.O_XpsG_rootChip{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:999px;align-items:center;gap:6px;padding:3px 8px;font-size:12px;line-height:18px;display:inline-flex}.O_XpsG_rootRemove{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;padding:0;font-size:14px;line-height:14px}.O_XpsG_grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;display:grid}.O_XpsG_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);border-radius:12px;flex-direction:column;display:flex;overflow:hidden}.O_XpsG_cardSelected{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}.O_XpsG_thumb{aspect-ratio:16/9;background:#0000001f;position:relative;overflow:hidden}.O_XpsG_thumbImage{object-fit:cover;width:100%;height:100%;display:block}.O_XpsG_badge{color:#fff;background:#0000009e;border-radius:999px;padding:2px 8px;font-size:11px;line-height:16px;position:absolute;top:8px;left:8px}.O_XpsG_cardOpen{color:#0f1115;cursor:pointer;background:#ffffffd6;border:0;border-radius:6px;padding:2px 8px;font-size:10px;line-height:16px;position:absolute;top:8px;right:8px}.O_XpsG_cardBody{flex-direction:column;gap:6px;padding:10px;display:flex}.O_XpsG_cardTitle{color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;font-size:13px;font-weight:600;line-height:18px;overflow:hidden}.O_XpsG_cardMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.O_XpsG_cardActions{gap:8px;margin-top:2px;display:flex}.O_XpsG_desktopMode{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:10px;padding:12px;display:flex}.O_XpsG_desktopModeTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px}.O_XpsG_controls{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-wrap:wrap;gap:16px;padding:12px;display:flex}.O_XpsG_control{color:var(--dsw-alias-label-secondary);align-items:center;gap:8px;font-size:12px;line-height:18px;display:flex}.O_XpsG_control input[type=range]{width:140px}.O_XpsG_control select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px}";
		const tagId$1 = "dsh-wallpaper-engine/WallpaperSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-wallpaper-engine";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var WallpaperSection_module_css_default = {
			"button": "O_XpsG_button",
			"cardTitle": "O_XpsG_cardTitle",
			"card": "O_XpsG_card",
			"toolbar": "O_XpsG_toolbar",
			"badge": "O_XpsG_badge",
			"control": "O_XpsG_control",
			"cardSelected": "O_XpsG_cardSelected",
			"error": "O_XpsG_error",
			"sceneNote": "O_XpsG_sceneNote",
			"grid": "O_XpsG_grid",
			"title": "O_XpsG_title",
			"head": "O_XpsG_head",
			"cardBody": "O_XpsG_cardBody",
			"status": "O_XpsG_status",
			"section": "O_XpsG_section",
			"cardMeta": "O_XpsG_cardMeta",
			"thumbImage": "O_XpsG_thumbImage",
			"controls": "O_XpsG_controls",
			"rootChip": "O_XpsG_rootChip",
			"cardOpen": "O_XpsG_cardOpen",
			"roots": "O_XpsG_roots",
			"subtitle": "O_XpsG_subtitle",
			"rootRemove": "O_XpsG_rootRemove",
			"rootsLabel": "O_XpsG_rootsLabel",
			"cardActions": "O_XpsG_cardActions",
			"search": "O_XpsG_search",
			"actions": "O_XpsG_actions",
			"desktopModeTitle": "O_XpsG_desktopModeTitle",
			"danger": "O_XpsG_danger",
			"thumb": "O_XpsG_thumb",
			"desktopMode": "O_XpsG_desktopMode",
			"notice": "O_XpsG_notice"
		};
		//#endregion
		//#region ../src/client/WallpaperSection.tsx
		/**
		* Wallpaper Engine library panel, registered as a settings section. It owns
		* search, manual import/remove, the project card grid, background preference
		* sliders, and the native-scene start/stop control. All bridge writes go
		* through the injected controller; components never touch window directly.
		*/
		/** Render the section; return null until every injected share is present. */
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
				if (query === "") return state.projects;
				return state.projects.filter((item) => item.title.toLowerCase().includes(query) || item.projectType.toLowerCase().includes(query) || item.sourceLabel.toLowerCase().includes(query));
			}, [state.projects, state.search]);
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
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: WallpaperSection_module_css_default.search,
								type: "search",
								placeholder: t("searchPlaceholder"),
								value: state.search,
								onChange: (event) => {
									controller.store.actions.setSearch(event.target.value);
								}
							}), state.selection.active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: clsx(WallpaperSection_module_css_default.button, WallpaperSection_module_css_default.danger),
								type: "button",
								onClick: () => {
									controller.clearSelection();
								},
								children: t("restoreDefault")
							})]
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
						controller.isDesktop ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopModeControls, {
							controller,
							t
						}) : null
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
		function DesktopModeControls({ controller, t }) {
			const [wallpaperActive, setWallpaperActive] = (0, react.useState)(false);
			const [desktopActive, setDesktopActive] = (0, react.useState)(false);
			const [iconsVisible, setIconsVisible] = (0, react.useState)(true);
			const [supported, setSupported] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				controller.getWallpaperModeStatus().then((status) => {
					if (status !== null && typeof status === "object") {
						setWallpaperActive(status.enabled === true);
						setSupported(status.supported !== false);
					}
				}).catch(() => {});
				controller.getDesktopModeStatus().then((status) => {
					if (status !== null && typeof status === "object") {
						setDesktopActive(status.enabled === true);
						setSupported(status.supported !== false);
					}
				}).catch(() => {});
				controller.probeDesktopIcons().then((probe) => {
					if (probe !== null && typeof probe === "object") setIconsVisible(probe.visible !== false);
				}).catch(() => {});
			}, [controller]);
			const toggleWallpaper = async () => {
				setError("");
				const result = await controller.setWallpaperMode(!wallpaperActive);
				if (result !== null && typeof result === "object") {
					const value = result;
					setWallpaperActive(value.enabled === true || value.ok === true);
					if (value.error !== void 0 && value.error !== "") setError(value.error);
				}
			};
			const toggleDesktop = async () => {
				setError("");
				const result = await controller.setDesktopMode(!desktopActive);
				if (result !== null && typeof result === "object") {
					const value = result;
					setDesktopActive(value.enabled === true);
					if (value.error !== void 0 && value.error !== "") setError(value.error);
				}
			};
			const toggleIcons = async () => {
				setError("");
				const result = await controller.setDesktopIconsVisible(!iconsVisible);
				if (result !== null && typeof result === "object") {
					const value = result;
					setIconsVisible(value.visible === true);
					if (value.error !== void 0 && value.error !== "") setError(value.error);
				}
			};
			if (!supported) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: WallpaperSection_module_css_default.notice,
				children: t("desktopModeUnsupported")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: WallpaperSection_module_css_default.desktopMode,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: WallpaperSection_module_css_default.desktopModeTitle,
						children: t("desktopMode")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: WallpaperSection_module_css_default.cardActions,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: WallpaperSection_module_css_default.button,
								type: "button",
								onClick: () => {
									toggleWallpaper();
								},
								children: wallpaperActive ? t("wallpaperModeOff") : t("wallpaperModeOn")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: WallpaperSection_module_css_default.button,
								type: "button",
								onClick: () => {
									toggleDesktop();
								},
								children: desktopActive ? t("desktopModeOff") : t("desktopModeOn")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: WallpaperSection_module_css_default.button,
								type: "button",
								onClick: () => {
									toggleIcons();
								},
								children: iconsVisible ? t("desktopIconsHide") : t("desktopIconsShow")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: WallpaperSection_module_css_default.button,
								type: "button",
								onClick: () => {
									controller.requestDesktopKeyboardFocus();
								},
								children: t("desktopModeFocus")
							})
						]
					}),
					error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: WallpaperSection_module_css_default.error,
						children: error
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
		//#region \0dsh-css:D:\deepseek-harness\plugin-package\dsh-wallpaper-engine\packages\dsh-wallpaper-engine\src\client\WallpaperBackground.module.css.mjs
		const css = ".mm6n-q_host{z-index:-1;pointer-events:none;position:fixed;inset:0;overflow:hidden}.mm6n-q_layer{transition:opacity var(--ds-transition-duration-slow,.2s) var(--ds-ease-in-out,ease-in-out);position:absolute;inset:0;overflow:hidden}.mm6n-q_image,.mm6n-q_video{border:0;width:100%;height:100%;position:absolute;inset:0}.mm6n-q_image{background-position:50%;background-repeat:no-repeat}.mm6n-q_video{object-fit:cover}.mm6n-q_fill_cover.mm6n-q_image{background-size:cover}.mm6n-q_fill_contain.mm6n-q_image{background-size:contain}.mm6n-q_fill_fill.mm6n-q_image{background-size:100% 100%}.mm6n-q_fill_cover.mm6n-q_video{object-fit:cover}.mm6n-q_fill_contain.mm6n-q_video{object-fit:contain}.mm6n-q_fill_fill.mm6n-q_video{object-fit:fill}.mm6n-q_fallbackNote{color:#fff;pointer-events:none;background:#0000008c;border-radius:8px;max-width:480px;padding:6px 10px;font-size:12px;line-height:18px;position:absolute;bottom:12px;left:12px}";
		const tagId = "dsh-wallpaper-engine/WallpaperBackground.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-wallpaper-engine";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var WallpaperBackground_module_css_default = {
			"video": "mm6n-q_video",
			"fill_contain": "mm6n-q_fill_contain",
			"layer": "mm6n-q_layer",
			"image": "mm6n-q_image",
			"fill_fill": "mm6n-q_fill_fill",
			"fallbackNote": "mm6n-q_fallbackNote",
			"host": "mm6n-q_host",
			"fill_cover": "mm6n-q_fill_cover"
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
				useSnapshot: props.useSnapshot
			});
		}
		function LoadedBackground({ controller, useSnapshot }) {
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
					if (isCancelled() || !started.ok || started.sourceId === void 0 || started.sessionId === void 0) return;
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
			const sourceUrl = showEngineVideo ? "" : selection.kind === "media" && mediaUrl !== "" ? mediaUrl : fallbackUrl;
			const layerStyle = LayerStyle({ selection });
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: WallpaperBackground_module_css_default.layer,
				style: layerStyle,
				"data-kind": selection.kind,
				children: [showEngineVideo ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
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
				})), selection.kind === "engine" && scene.error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: WallpaperBackground_module_css_default.fallbackNote,
					children: scene.error
				})]
			}), portalHost);
		}
		//#endregion
		//#region ../src/client/locales.ts
		/** Wallpaper Engine section copy (zh/en). Product copy is Chinese-first. */
		const zh = {
			nav: "桌面与壁纸",
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
			empty: "未发现 Wallpaper Engine 项目。点击“导入目录”选择一个包含 project.json 的目录，或点击右上角按钮导入单个项目文件。",
			loading: "正在识别本地项目…",
			errorPrefix: "识别失败",
			runtimeAvailable: "已检测到 Wallpaper Engine",
			runtimeMissing: "未检测到 Wallpaper Engine 本体，Scene 项目将以预览图显示",
			manualRoots: "手动导入",
			nativeSceneFailed: "WE Scene 启动失败，已回退到预览图",
			windowParked: "播放窗口已移出屏幕，不遮挡桌面",
			windowParkFailed: "播放窗口未能移出屏幕",
			desktopHint: "桌面版支持",
			desktopMode: "桌面模式",
			desktopModeOn: "嵌入桌面",
			desktopModeOff: "退出桌面",
			wallpaperModeOn: "开启桌面壁纸",
			wallpaperModeOff: "关闭桌面壁纸",
			desktopIconsShow: "显示桌面图标",
			desktopIconsHide: "隐藏桌面图标",
			desktopModeFocus: "聚焦桌面",
			desktopModeUnsupported: "当前系统不支持桌面模式（仅 Windows）"
		};
		const en = {
			nav: "Desktop & Wallpaper",
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
			desktopHint: "Desktop version",
			desktopMode: "Desktop mode",
			desktopModeOn: "Embed desktop",
			desktopModeOff: "Exit desktop",
			wallpaperModeOn: "Enable desktop wallpaper",
			wallpaperModeOff: "Disable desktop wallpaper",
			desktopIconsShow: "Show desktop icons",
			desktopIconsHide: "Hide desktop icons",
			desktopModeFocus: "Focus desktop",
			desktopModeUnsupported: "Desktop mode is unsupported on this system (Windows only)"
		};
		//#endregion
		//#region ../src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.wallpaper-engine";
		/** Required services (cordis fiber inject). */
		const inject = ["slots", "locale"];
		/**
		* Register the wallpaper dictionary, settings section, and background layer.
		* Both entries share one controller (and therefore one store instance).
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-wallpaper-engine: copy dictionaries");
			const t = ctx.locale.bind(NS);
			const api = getDesktopWindowApi();
			const controller = new WallpaperEngineController(api);
			const useSnapshot = bindWallpaperSnapshot(controller);
			const sectionInjected = () => ({
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
				id: "wallpaper-engine",
				order: 900,
				label: () => t("nav"),
				inject: sectionInjected
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