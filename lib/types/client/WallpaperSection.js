import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Wallpaper Engine library panel, registered as a settings section. It owns
 * search, manual import/remove, the project card grid, background preference
 * sliders, and the native-scene start/stop control. All bridge writes go
 * through the injected controller; components never touch window directly.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { wallpaperMediaUrl } from "./api.js";
import css from './WallpaperSection.module.css';
/** Render the section; return null until every injected share is present. */
export function WallpaperSection(props) {
    if (props.controller === undefined || props.useSnapshot === undefined || props.t === undefined)
        return null;
    return _jsx(LoadedSection, { controller: props.controller, useSnapshot: props.useSnapshot, isDesktop: props.isDesktop === true, t: props.t });
}
function LoadedSection({ controller, useSnapshot, isDesktop, t }) {
    const state = useSnapshot((s) => s);
    useEffect(() => {
        if (state.status === 'idle')
            void controller.load();
    }, [controller, state.status]);
    const filtered = useMemo(() => {
        const query = state.search.trim().toLowerCase();
        if (query === '')
            return state.projects;
        return state.projects.filter(item => item.title.toLowerCase().includes(query)
            || item.projectType.toLowerCase().includes(query)
            || item.sourceLabel.toLowerCase().includes(query));
    }, [state.projects, state.search]);
    return (_jsxs("div", { className: css.section, children: [_jsxs("div", { className: css.head, children: [_jsxs("div", { children: [_jsx("h3", { className: css.title, children: t('title') }), _jsx("p", { className: css.subtitle, children: isDesktop
                                    ? (state.runtimeAvailable ? t('runtimeAvailable') : t('runtimeMissing'))
                                    : t('desktopHint') })] }), _jsxs("div", { className: css.actions, children: [_jsx("button", { className: css.button, type: "button", onClick: () => { void controller.load(true); }, children: t('rescan') }), isDesktop && _jsx("button", { className: css.button, type: "button", onClick: () => { void controller.chooseDirectory(); }, children: t('importDirectory') }), isDesktop && _jsx("button", { className: css.button, type: "button", onClick: () => { void controller.chooseProjectFile(); }, children: t('importProjectFile') })] })] }), !isDesktop && _jsx("div", { className: css.notice, children: t('desktopOnly') }), isDesktop && (_jsxs(_Fragment, { children: [_jsxs("div", { className: css.toolbar, children: [_jsx("input", { className: css.search, type: "search", placeholder: t('searchPlaceholder'), value: state.search, onChange: (event) => { controller.store.actions.setSearch(event.target.value); } }), state.selection.active && (_jsx("button", { className: clsx(css.button, css.danger), type: "button", onClick: () => { controller.clearSelection(); }, children: t('restoreDefault') }))] }), state.status === 'loading' && _jsx("div", { className: css.status, children: t('loading') }), state.status === 'error' && _jsxs("div", { className: clsx(css.status, css.error), children: [t('errorPrefix'), ": ", state.error] }), state.manualRoots.length > 0 && (_jsxs("div", { className: css.roots, children: [_jsx("span", { className: css.rootsLabel, children: t('manualRoots') }), state.manualRoots.map(root => (_jsxs("span", { className: css.rootChip, children: [root.name, _jsx("button", { type: "button", className: css.rootRemove, "aria-label": `${t('remove')} ${root.name}`, onClick: () => { void controller.removeRoot(root.id); }, children: "\u00D7" })] }, root.id)))] })), state.status === 'ready' && filtered.length === 0 && _jsx("div", { className: css.status, children: t('empty') }), _jsx("div", { className: css.grid, children: filtered.map(project => (_jsx(LazyCard, { project: project, token: state.mediaToken, selected: state.selection.active && state.selection.id === project.id, sceneActive: state.scene.active, t: t, onSelect: () => controller.selectProject(project), onOpen: () => { void controller.openProjectDetails(project); }, onStopScene: () => { void controller.stopScene(); } }, project.id))) }), state.selection.active && (_jsx(BackgroundControls, { t: t, opacity: state.selection.opacity, blur: state.selection.blur, fill: state.selection.fill, onOpacity: (value) => { controller.store.actions.setSelection({ ...state.selection, opacity: value }); }, onBlur: (value) => { controller.store.actions.setSelection({ ...state.selection, blur: value }); }, onFill: (fill) => { controller.store.actions.setSelection({ ...state.selection, fill }); } }))] }))] }));
}
function BackgroundControls({ t, opacity, blur, fill, onOpacity, onBlur, onFill }) {
    return (_jsxs("div", { className: css.controls, children: [_jsxs("label", { className: css.control, children: [_jsx("span", { children: t('opacity') }), _jsx("input", { type: "range", min: 0, max: 1, step: 0.05, value: opacity, onChange: (event) => { onOpacity(Number(event.target.value)); } })] }), _jsxs("label", { className: css.control, children: [_jsx("span", { children: t('blur') }), _jsx("input", { type: "range", min: 0, max: 80, step: 1, value: blur, onChange: (event) => { onBlur(Number(event.target.value)); } })] }), _jsxs("label", { className: css.control, children: [_jsx("span", { children: t('fill') }), _jsxs("select", { value: fill, onChange: (event) => { onFill(event.target.value); }, children: [_jsx("option", { value: "cover", children: t('fillCover') }), _jsx("option", { value: "contain", children: t('fillContain') }), _jsx("option", { value: "fill", children: t('fillFill') })] })] })] }));
}
/** IntersectionObserver-gated card: only renders its media once near viewport. */
function LazyCard({ project, token, selected, sceneActive, t, onSelect, onOpen, onStopScene }) {
    const ref = useRef(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const node = ref.current;
        if (node === null || visible)
            return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.isIntersecting)) {
                setVisible(true);
                observer.disconnect();
            }
        }, { rootMargin: '240px' });
        observer.observe(node);
        return () => { observer.disconnect(); };
    }, [visible]);
    const thumb = wallpaperMediaUrl(project.hasPreview ? 'preview' : 'media', project, token);
    const label = project.enginePlayable
        ? t('scene')
        : project.mediaType === 'video'
            ? t('video')
            : project.mediaType === 'image'
                ? t('image')
                : t('previewOnly');
    return (_jsxs("div", { ref: ref, className: clsx(css.card, selected && css.cardSelected), children: [_jsxs("div", { className: css.thumb, children: [visible && thumb !== '' && _jsx("img", { className: css.thumbImage, src: thumb, alt: "", loading: "lazy" }), _jsx("span", { className: css.badge, children: label }), project.workshopId !== '' && _jsx("button", { className: css.cardOpen, type: "button", onClick: onOpen, children: "STEAM" })] }), _jsxs("div", { className: css.cardBody, children: [_jsx("div", { className: css.cardTitle, title: project.title, children: project.title }), _jsx("div", { className: css.cardMeta, children: project.sourceLabel }), _jsxs("div", { className: css.cardActions, children: [_jsx("button", { className: css.button, type: "button", onClick: onSelect, children: selected ? t('applied') : t('setAsBackground') }), selected && project.enginePlayable && sceneActive && (_jsx("button", { className: clsx(css.button, css.danger), type: "button", onClick: onStopScene, children: t('engineStop') }))] })] })] }));
}
//# sourceMappingURL=WallpaperSection.js.map