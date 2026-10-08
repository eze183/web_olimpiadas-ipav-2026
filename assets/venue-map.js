import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X, Navigation, Plus, Minus, RotateCcw } from 'lucide-react';

const h = React.createElement;
let dataPromise, libraryPromise;
const getData = () => {
    if (!dataPromise) dataPromise = fetch(new URL('./venue-map-data.json', import.meta.url))
        .then(response => { if (!response.ok) throw new Error('No se pudieron cargar las sedes.'); return response.json(); })
        .catch(error => { dataPromise = null; throw error; });
    return dataPromise;
};
const getLibrary = () => {
    const load = (id, url, integrity, stylesheet = false) => new Promise((resolve, reject) => {
        const existing = document.getElementById(id);
        if (existing?.dataset.loaded === 'true') { resolve(); return; }
        const element = existing || document.createElement(stylesheet ? 'link' : 'script');
        const fail = () => { clearTimeout(timeout); element.remove(); reject(new Error('No se pudo cargar la cartografía.')); };
        const timeout = setTimeout(fail, 20000);
        element.id = id; element.integrity = integrity; element.crossOrigin = 'anonymous';
        element.onload = () => { clearTimeout(timeout); element.dataset.loaded = 'true'; resolve(); };
        element.onerror = fail;
        if (stylesheet) { element.rel = 'stylesheet'; element.href = url; }
        else { element.src = url; element.async = true; }
        if (!existing) document.head.append(element);
    });
    if (!libraryPromise) libraryPromise = Promise.all([
        load('venue-leaflet-css', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css', 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=', true),
        load('venue-leaflet-js', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js', 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=')
    ]).then(() => { if (!window.L?.map) throw new Error('Cartografía no disponible.'); return window.L; })
        .catch(error => { libraryPromise = null; throw error; });
    return libraryPromise;
};
const directions = venue => 'https://www.google.com/maps/dir/?api=1&destination=' +
    encodeURIComponent(`${venue.name}, ${venue.address}, ${venue.city}, La Pampa, Argentina`);

// OpenStreetMap Carto conserva el trazado completo y sus nombres, sin redibujar ni simplificar calles.
// Solo se solicitan mosaicos de la vista activa; se respeta la caché normal del navegador.
function createMap(host, L, source, { expanded, selected, initialView, onSelect, onTileError, onViewChange }) {
    const latLng = coord => L.latLng(coord[1], coord[0]);
    const bounds = L.latLngBounds(source.venues.map(v => latLng(v.coord)));
    const map = L.map(host, { zoomControl: false, attributionControl: false, keyboard: false,
        dragging: !!expanded, scrollWheelZoom: !!expanded, touchZoom: !!expanded, doubleClickZoom: !!expanded,
        boxZoom: false, tapHold: false, minZoom: 10, maxZoom: source.cartography.maxZoom,
        zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false, trackResize: false,
        maxBounds: bounds.pad(2), maxBoundsViscosity: .8 });
    const tiles = L.tileLayer(source.cartography.tileUrl, { maxZoom: source.cartography.maxZoom, keepBuffer: 0,
        updateWhenIdle: true, updateWhenZooming: false, detectRetina: false });
    let tileErrors = 0;
    tiles.on('loading', () => { tileErrors = 0; });
    tiles.on('tileerror', () => { tileErrors++; });
    tiles.on('load', () => onTileError(tileErrors > 0));
    const markers = document.createElement('div'); markers.className = 'venue-map-markers'; host.append(markers);
    const references = document.createElement('div'); references.className = 'venue-map-references'; host.append(references);
    L.DomEvent.disableClickPropagation(markers);
    const buttons = new Map();
    let selectedId = selected, overview = true, lastSize = '';
    const intersects = (a, b) => a.x < b.x + b.width + 4 && a.x + a.width + 4 > b.x && a.y < b.y + b.height + 4 && a.y + a.height + 4 > b.y;
    function groupsFor() {
        const { x: width, y: height } = map.getSize();
        const groups = source.venues.map(venue => {
            const { x, y } = map.latLngToContainerPoint(latLng(venue.coord)); return { x, y, items: [venue] };
        }).filter(g => g.x > 20 && g.x < width - 20 && g.y > 20 && g.y < height - 20);
        // Agrupa por cercanía y vuelve a comprobar los centros para evitar blancos de toque superpuestos.
        let merged = true;
        while (merged) {
            merged = false;
            for (let i = 0; i < groups.length && !merged; i++) for (let j = i + 1; j < groups.length; j++) {
                if (Math.hypot(groups[i].x - groups[j].x, groups[i].y - groups[j].y) >= 48) continue;
                const a = groups[i], b = groups[j], count = a.items.length + b.items.length;
                a.x = (a.x * a.items.length + b.x * b.items.length) / count;
                a.y = (a.y * a.items.length + b.y * b.items.length) / count;
                a.items.push(...b.items); groups.splice(j, 1); merged = true; break;
            }
        }
        return groups.filter(g => !(g.x > width - 75 && g.y > height - 165));
    }
    function drawReferences(groups) {
        references.replaceChildren();
        const { x: width, y: height } = map.getSize(), zoom = map.getZoom();
        const used = groups.map(g => ({ x: g.x - 22, y: g.y - 22, width: 44, height: 44 }));
        used.push({ x: width - 64, y: height - 172, width: 64, height: 172 });
        used.push({ x: 0, y: height - 22, width, height: 22 });
        for (const ref of source.references.filter(r => zoom >= r.minZoom && zoom <= (r.maxZoom || 19)).sort((a, b) => a.priority - b.priority)) {
            const point = map.latLngToContainerPoint(latLng(ref.coord));
            if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue;
            const label = document.createElement('span'); label.className = 'venue-map-reference-label'; label.textContent = ref.name;
            label.dataset.referenceKind = ref.kind; label.dataset.referenceId = ref.id;
            references.append(label);
            const w = label.offsetWidth, hh = label.offsetHeight;
            const offsets = [[12, -hh - 10], [-w - 12, -hh - 10], [12, 10], [-w - 12, 10], [-w / 2, -hh - 30], [-w / 2, 30], [-w - 24, -hh / 2], [24, -hh / 2], [-w / 2, -hh - 60], [-w / 2, 60]];
            const position = offsets.map(([dx, dy]) => ({ x: point.x + dx, y: point.y + dy, width: w, height: hh })).find(rect => rect.x >= 5 && rect.y >= 5 && rect.x + w <= width - 5 && rect.y + hh <= height - 22 && !used.some(box => intersects(rect, box)));
            if (!position) { label.remove(); continue; }
            label.style.left = `${position.x}px`; label.style.top = `${position.y}px`; used.push(position);
            const end = { x: Math.max(position.x, Math.min(point.x, position.x + w)), y: Math.max(position.y, Math.min(point.y, position.y + hh)) };
            const line = document.createElement('span'); line.className = 'venue-map-reference-line';
            line.style.cssText = `left:${point.x}px;top:${point.y}px;width:${Math.hypot(end.x - point.x, end.y - point.y)}px;transform:rotate(${Math.atan2(end.y - point.y, end.x - point.x)}rad)`;
            line.setAttribute('aria-hidden', 'true'); references.prepend(line);
            if (ref.kind === 'landmark') {
                const dot = document.createElement('span'); dot.className = 'venue-map-reference-dot'; dot.style.left = `${point.x}px`; dot.style.top = `${point.y}px`;
                dot.setAttribute('aria-hidden', 'true'); references.prepend(dot);
            }
        }
    }
    function draw() {
        host.dataset.mapZoom = map.getZoom(); host.dataset.mapCenter = JSON.stringify([map.getCenter().lng, map.getCenter().lat]);
        onViewChange({ center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom(), overview });
        const groups = groupsFor(), keys = new Set();
        for (const g of groups) {
            const key = g.items.map(v => v.id).sort().join('|'); keys.add(key);
            let button = buttons.get(key);
            if (!button) { button = document.createElement('button'); button.type = 'button'; const span = document.createElement('span'); span.setAttribute('aria-hidden', 'true'); button.append(span); markers.append(button); buttons.set(key, button); }
            button.className = `venue-map-marker${g.items.length > 1 ? ' is-cluster' : g.items[0].category === 'general' ? ' is-general' : ''}`;
            button.style.left = `${g.x}px`; button.style.top = `${g.y}px`; button.firstChild.textContent = g.items.length > 1 ? g.items.length : '';
            if (g.items.length === 1) button.setAttribute('aria-pressed', String(g.items[0].id === selectedId)); else button.removeAttribute('aria-pressed');
            button.setAttribute('aria-label', g.items.length > 1 ? `Acercar ${g.items.length} sedes: ${g.items.map(v => v.name).join(', ')}` : `${g.items[0].name} · ${g.items[0].activity}`);
            button.onclick = () => {
                if (g.items.length === 1) onSelect(g.items[0].id);
                else {
                    overview = false;
                    const center = L.latLngBounds(g.items.map(v => latLng(v.coord))).getCenter();
                    map.setView(center, Math.min(map.getZoom() + 2, 19), { animate: false });
                    [...buttons.values()].find(b => g.items.some(v => b.getAttribute('aria-label').includes(v.name)))?.focus({ preventScroll: true });
                }
            };
        }
        for (const [key, button] of buttons) if (!keys.has(key)) { button.remove(); buttons.delete(key); }
        drawReferences(groups);
    }
    const reset = () => { overview = true; map.fitBounds(bounds, { paddingTopLeft: [30, 35], paddingBottomRight: [80, 30], animate: false }); };
    const restore = view => {
        if (!view || view.overview) reset();
        else { overview = false; map.setView(latLng(view.center), view.zoom, { animate: false }); draw(); }
    };
    map.on('move zoom', draw).on('dragstart', () => { overview = false; });
    restore(initialView); tiles.addTo(map);
    function layout() {
        const size = `${host.clientWidth}:${host.clientHeight}`;
        if (size === lastSize || !host.clientWidth || !host.clientHeight) return;
        lastSize = size; map.invalidateSize({ pan: true, animate: false }); if (overview) reset(); else draw();
    }
    layout();
    const observer = new ResizeObserver(layout); observer.observe(host);
    return {
        select(id, center = false) {
            selectedId = id;
            if (center) {
                overview = false; map.setView(latLng(source.venues.find(v => v.id === id).coord), 15, { animate: false });
                while (map.getZoom() < 19 && groupsFor().some(g => g.items.length > 1 && g.items.some(v => v.id === id))) map.setZoom(map.getZoom() + 1, { animate: false });
            }
            draw();
        },
        zoomBy(factor) { overview = false; map.setZoom(map.getZoom() + (factor > 1 ? 1 : -1), { animate: false }); },
        reset,
        restore,
        reload() { tiles.redraw(); },
        destroy() { observer.disconnect(); tiles.off(); map.off(); map.remove(); markers.remove(); references.remove(); delete host.dataset.mapZoom; delete host.dataset.mapCenter; }
    };
}

function MapCanvas({ data, selected, expanded, active, viewRef, onSelect }) {
    const host = useRef(null), engine = useRef(null), selectRef = useRef(onSelect), lastSelected = useRef(selected), activeRef = useRef(active), lastActive = useRef(active);
    const [error, setError] = useState(false), [tileError, setTileError] = useState(false), [ready, setReady] = useState(false), [attempt, setAttempt] = useState(0);
    selectRef.current = onSelect; activeRef.current = active;
    useEffect(() => {
        let cancelled = false;
        setError(false); setTileError(false); setReady(false);
        getLibrary().then(L => {
            if (cancelled) return;
            engine.current = createMap(host.current, L, data, { expanded, selected, initialView: viewRef.current,
                onViewChange: view => { if (activeRef.current) viewRef.current = view; },
                onSelect: id => selectRef.current(id), onTileError: failed => { if (!cancelled) setTileError(failed); } });
            setReady(true);
        }).catch(() => { if (!cancelled) setError(true); });
        return () => { cancelled = true; engine.current?.destroy(); engine.current = null; };
    }, [data, expanded, attempt]);
    useEffect(() => {
        if (!engine.current) return;
        if (active && !lastActive.current) engine.current.restore(viewRef.current);
        engine.current.select(selected, active && selected !== lastSelected.current);
        lastSelected.current = selected; lastActive.current = active;
    }, [selected, ready, active]);
    return h('div', { className: 'venue-map-field' },
        h('div', { ref: host, className: 'venue-map-canvas', role: 'group', 'aria-label': 'Mapa interactivo con calles, referencias urbanas y sedes' }),
        !ready && h('div', { className: 'venue-map-status', role: error ? 'alert' : 'status' }, error ?
            h(React.Fragment, null, h('p', null, 'No se pudo dibujar el mapa. Podés elegir una sede y abrir Cómo llegar.'),
                h('button', { type: 'button', onClick: () => setAttempt(v => v + 1) }, 'Volver a intentar')) : 'Cargando mapa…'),
        ready && h('div', { className: 'venue-map-zoom', 'aria-label': 'Controles del mapa' },
            h('button', { type: 'button', 'aria-label': 'Acercar mapa', onClick: () => engine.current?.zoomBy(1.7) }, h(Plus, { size: 20, 'aria-hidden': true })),
            h('button', { type: 'button', 'aria-label': 'Alejar mapa', onClick: () => engine.current?.zoomBy(1 / 1.7) }, h(Minus, { size: 20, 'aria-hidden': true })),
            h('button', { type: 'button', 'aria-label': 'Ver todas las sedes', onClick: () => engine.current?.reset() }, h(RotateCcw, { size: 17, 'aria-hidden': true }))),
        ready && tileError && h('div', { className: 'venue-map-tile-error', role: 'alert' },
            h('span', null, 'Parte del fondo no cargó. Las sedes siguen disponibles.'),
            h('button', { type: 'button', onClick: () => { setTileError(false); engine.current?.reload(); } }, 'Reintentar fondo')),
        h('div', { className: 'venue-map-attribution' }, h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener noreferrer' }, '© OpenStreetMap'))
    );
}

function MapPanel({ data, selected, expanded, dialogOpen, viewRef, onSelect, onExpand, onClose }) {
    const venue = data.venues.find(v => v.id === selected) || data.venues[0];
    return h('div', { className: `venue-map-card${expanded ? ' is-expanded' : ''}` },
        h('div', { className: 'venue-map-toolbar' },
            h('div', { className: 'venue-map-caption' }, h('p', null, 'Santa Rosa y Toay'),
                h('div', { className: 'venue-map-legend' }, h('span', null, h('b', { className: 'venue-map-dot', 'aria-hidden': true }), 'Deportes'),
                    h('span', null, h('b', { className: 'venue-map-dot is-general', 'aria-hidden': true }), 'Encuentros'))),
            h('button', { type: 'button', className: 'venue-map-expand', 'data-map-close': expanded ? '' : undefined,
                'aria-label': expanded ? 'Cerrar mapa ampliado' : 'Ampliar mapa', 'aria-expanded': !expanded ? !!dialogOpen : undefined,
                'aria-haspopup': !expanded ? 'dialog' : undefined, 'aria-controls': !expanded ? 'venue-expanded-map' : undefined,
                onClick: expanded ? onClose : onExpand }, h(expanded ? X : Maximize2, { size: 17, 'aria-hidden': true }), expanded ? 'Cerrar mapa' : 'Ampliar mapa')),
        h(MapCanvas, { data, selected, expanded, active: expanded || !dialogOpen, viewRef, onSelect }),
        h('div', { className: 'venue-map-information' },
            h('label', { className: 'venue-map-choice' }, h('span', null, 'Sede'),
                h('select', { value: venue.id, 'aria-label': 'Seleccionar una sede', onChange: event => onSelect(event.target.value) },
                    ...data.venues.map(v => h('option', { key: v.id, value: v.id }, `${v.name} · ${v.city}`)))),
            h('p', { className: 'venue-map-note' }, 'Los números agrupan sedes cercanas. Acercá para ver más calles.', !expanded && ' Ampliá para mover el mapa.'),
            h('div', { className: 'venue-map-detail' },
                h('div', { className: 'venue-map-detail-copy', 'aria-live': 'polite', 'aria-atomic': true },
                    h('h3', null, venue.name), h('p', { className: 'venue-map-activity' }, venue.activity),
                    h('p', { className: 'venue-map-address' }, `${venue.address} · ${venue.city}`),
                    venue.approx && h('p', { className: 'venue-map-precision' }, 'Ubicación aproximada por dirección · acceso a verificar')),
                h('a', { className: 'venue-map-directions', href: directions(venue), target: '_blank', rel: 'noopener noreferrer' }, h(Navigation, { size: 16, 'aria-hidden': true }), 'Cómo llegar')))
    );
}

function ExpandedMap({ children, onClose }) {
    const dialog = useRef(null), closeRef = useRef(onClose); closeRef.current = onClose;
    useEffect(() => {
        const previousFocus = document.activeElement, overflow = document.body.style.overflow;
        const root = document.getElementById('root'), previousInert = root.inert;
        document.body.style.overflow = 'hidden'; root.inert = true;
        dialog.current.querySelector('[data-map-close]').focus({ preventScroll: true });
        const onKey = event => {
            if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
            if (event.key !== 'Tab') return;
            const controls = [...dialog.current.querySelectorAll('button, a[href], select')].filter(el => !el.disabled && el.getClientRects().length);
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; root.inert = previousInert; previousFocus?.focus({ preventScroll: true }); };
    }, []);
    return createPortal(h('div', { id: 'venue-expanded-map', className: 'venue-map-overlay', ref: dialog, role: 'dialog', 'aria-modal': true, 'aria-label': 'Mapa ampliado de sedes',
        onClick: event => { if (event.target === event.currentTarget) onClose(); } }, children), document.body);
}

export default function VenueMap() {
    const host = useRef(null), viewRef = useRef(null);
    const [visible, setVisible] = useState(false), [data, setData] = useState(null), [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0), [selected, setSelected] = useState('circulo'), [expanded, setExpanded] = useState(false);
    useEffect(() => {
        if (!('IntersectionObserver' in window)) { setVisible(true); return; }
        const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '300px' });
        observer.observe(host.current); return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (!visible) return;
        let cancelled = false; setError(false);
        getData().then(data => { if (!cancelled) setData(data); }).catch(() => { if (!cancelled) setError(true); });
        return () => { cancelled = true; };
    }, [visible, attempt]);
    return h('div', { ref: host, className: 'venue-map-wrapper' }, data ?
        h(React.Fragment, null, h(MapPanel, { data, selected, dialogOpen: expanded, viewRef, onSelect: setSelected, onExpand: () => setExpanded(true) }),
            expanded && h(ExpandedMap, { onClose: () => setExpanded(false) }, h(MapPanel, { data, selected, expanded: true, viewRef, onSelect: setSelected, onClose: () => setExpanded(false) }))) :
        h('div', { className: 'venue-map-placeholder', role: error ? 'alert' : 'status' }, error ?
            h(React.Fragment, null, h('p', null, 'No se pudo cargar el mapa de sedes.'),
                h('button', { type: 'button', className: 'venue-map-expand', onClick: () => setAttempt(v => v + 1) }, 'Volver a intentar')) : 'Cargando mapa de sedes…'));
}
