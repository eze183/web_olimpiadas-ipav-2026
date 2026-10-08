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
    if (window.d3?.geoMercator) return Promise.resolve(window.d3);
    if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timeout = setTimeout(() => fail(), 20000);
        const fail = () => { clearTimeout(timeout); script.remove(); reject(new Error('No se pudo cargar la cartografía.')); };
        script.src = 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js'; script.async = true;
        script.onload = () => { clearTimeout(timeout); window.d3?.geoMercator ? resolve(window.d3) : fail(); };
        script.onerror = fail; document.head.append(script);
    }).catch(error => { libraryPromise = null; throw error; });
    return libraryPromise;
};
const directions = venue => 'https://www.google.com/maps/dir/?api=1&destination=' +
    encodeURIComponent(`${venue.name}, ${venue.address}, ${venue.city}, La Pampa, Argentina`);

// La cartografía se sirve desde el propio sitio: no necesita API key ni mosaicos externos.
function createMap(host, d3, source, { expanded, selected, onSelect }) {
    const geometry = structuredClone(source.geometry);
    for (const feature of geometry.features) if (feature.geometry.type === 'MultiPolygon') {
        for (const polygon of feature.geometry.coordinates) {
            if (d3.geoArea({ type: 'Polygon', coordinates: polygon }) > 2 * Math.PI) polygon[0].reverse();
        }
    }
    const svg = d3.select(host).append('svg').attr('class', 'venue-map-geography')
        .attr('role', 'img').attr('aria-label', 'Calles de Santa Rosa y Toay');
    const geography = svg.append('g');
    const labels = svg.append('g');
    const markers = d3.select(host).append('div').attr('class', 'venue-map-markers');
    const order = ['water', 'park', 'minor', 'local', 'secondary', 'major'];
    const styles = { major: ['#c5ad81', 2.2], secondary: ['#d2c2a5', 1.6], local: ['#fafaf4', 1.1], minor: ['#f4f5ed', .7] };
    const paths = geography.selectAll('path').data(geometry.features.sort((a, b) => order.indexOf(a.properties.kind) - order.indexOf(b.properties.kind))).join('path')
        .attr('fill', f => f.properties.kind === 'water' ? '#afd3d8' : f.properties.kind === 'park' ? '#cad8b6' : 'none')
        .attr('stroke', f => styles[f.properties.kind]?.[0] || 'none')
        .attr('stroke-width', f => styles[f.properties.kind]?.[1] || 0).attr('vector-effect', 'non-scaling-stroke');
    let width, height, projection, lastSize = '', selectedId = selected;
    const zoom = d3.zoom().scaleExtent([1, 12]).touchable(() => navigator.maxTouchPoints > 0)
        .filter(event => expanded && !event.button && event.type !== 'dblclick')
        .on('zoom', event => draw(event.transform));
    svg.call(zoom).on('dblclick.zoom', null);
    // En la vista compacta el gesto de deslizar sigue desplazando la página.
    if (!expanded) svg.on('wheel.zoom', null).on('touchstart.zoom', null).on('touchmove.zoom', null).on('touchend.zoom touchcancel.zoom', null);

    function groupsFor(transform) {
        const groups = source.venues.map(venue => {
            const [x, y] = transform.apply(projection(venue.coord));
            return { x, y, items: [venue] };
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
    function drawMarkers(transform) {
        const groups = groupsFor(transform);
        markers.selectAll('button').data(groups, g => g.items.map(v => v.id).sort().join('|')).join(
            enter => { const button = enter.append('button').attr('type', 'button'); button.append('span').attr('aria-hidden', 'true'); return button; }
        ).attr('class', g => `venue-map-marker${g.items.length > 1 ? ' is-cluster' : g.items[0].category === 'general' ? ' is-general' : ''}`)
            .style('left', g => `${g.x}px`).style('top', g => `${g.y}px`)
            .attr('aria-pressed', g => g.items.length === 1 ? String(g.items[0].id === selectedId) : null)
            .attr('aria-label', g => g.items.length > 1 ? `Acercar ${g.items.length} sedes: ${g.items.map(v => v.name).join(', ')}` : `${g.items[0].name} · ${g.items[0].activity}`)
            .on('click', (_event, g) => {
                if (g.items.length === 1) onSelect(g.items[0].id);
                else {
                    const average = g.items.reduce((p, v) => { const xy = projection(v.coord); return [p[0] + xy[0] / g.items.length, p[1] + xy[1] / g.items.length]; }, [0, 0]);
                    const scale = Math.min(transform.k * 2.4, 12);
                    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2 - scale * average[0], height / 2 - scale * average[1]).scale(scale));
                    // El botón agrupado desaparece al acercar. Mantiene una posición útil en el orden de foco.
                    markers.selectAll('button').filter(next => next.items.some(v => g.items.some(original => original.id === v.id))).node()?.focus({ preventScroll: true });
                }
            }).select('span').text(g => g.items.length > 1 ? g.items.length : '');
    }
    function draw(transform) {
        geography.attr('transform', transform); labels.attr('transform', transform);
        labels.selectAll('text').style('font-size', `${12 / transform.k}px`).style('stroke-width', `${4 / transform.k}px`);
        drawMarkers(transform);
    }
    function layout() {
        const size = `${host.clientWidth}:${host.clientHeight}`;
        if (size === lastSize || !host.clientWidth || !host.clientHeight) return;
        const previousTransform = d3.zoomTransform(svg.node());
        const center = projection && previousTransform.k > 1 ? projection.invert(previousTransform.invert([width / 2, height / 2])) : null;
        lastSize = size; width = host.clientWidth; height = host.clientHeight;
        svg.attr('viewBox', `0 0 ${width} ${height}`);
        projection = d3.geoMercator().fitExtent([[34, 40], [width - 82, height - 35]], {
            type: 'FeatureCollection', features: source.venues.map(v => ({ type: 'Feature', geometry: { type: 'Point', coordinates: v.coord } }))
        });
        paths.attr('d', d3.geoPath(projection));
        labels.selectAll('text').data(source.labels).join('text').attr('class', 'venue-map-place-label')
            .attr('x', d => projection(d.coord)[0]).attr('y', d => projection(d.coord)[1] - 25).attr('text-anchor', 'middle').text(d => d.name);
        if (center) {
            const point = projection(center), scale = previousTransform.k;
            svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2 - scale * point[0], height / 2 - scale * point[1]).scale(scale));
        } else svg.call(zoom.transform, d3.zoomIdentity);
    }
    layout();
    const observer = new ResizeObserver(layout); observer.observe(host);
    return {
        select(id, center = false) {
            selectedId = id;
            if (center) {
                const point = projection(source.venues.find(v => v.id === id).coord);
                let scale = 3;
                const transform = () => d3.zoomIdentity.translate(width / 2 - scale * point[0], height / 2 - scale * point[1]).scale(scale);
                while (scale < 12 && groupsFor(transform()).some(g => g.items.length > 1 && g.items.some(v => v.id === id))) scale = Math.min(scale * 1.7, 12);
                svg.call(zoom.transform, transform());
            } else drawMarkers(d3.zoomTransform(svg.node()));
        },
        zoomBy(factor) { svg.call(zoom.scaleBy, factor); },
        reset() { svg.call(zoom.transform, d3.zoomIdentity); },
        destroy() { observer.disconnect(); svg.on('.zoom', null); svg.remove(); markers.remove(); }
    };
}

function MapCanvas({ data, selected, expanded, onSelect }) {
    const host = useRef(null), engine = useRef(null), selectRef = useRef(onSelect), lastSelected = useRef(selected);
    const [error, setError] = useState(false), [ready, setReady] = useState(false), [attempt, setAttempt] = useState(0);
    selectRef.current = onSelect;
    useEffect(() => {
        let cancelled = false;
        setError(false); setReady(false);
        getLibrary().then(d3 => {
            if (cancelled) return;
            engine.current = createMap(host.current, d3, data, { expanded, selected, onSelect: id => selectRef.current(id) });
            setReady(true);
        }).catch(() => { if (!cancelled) setError(true); });
        return () => { cancelled = true; engine.current?.destroy(); engine.current = null; };
    }, [data, expanded, attempt]);
    useEffect(() => {
        if (!engine.current) return;
        engine.current.select(selected, selected !== lastSelected.current);
        lastSelected.current = selected;
    }, [selected, ready]);
    return h('div', { className: 'venue-map-field' },
        h('div', { ref: host, className: 'venue-map-canvas', role: 'group', 'aria-label': 'Mapa interactivo de sedes' }),
        !ready && h('div', { className: 'venue-map-status', role: error ? 'alert' : 'status' }, error ?
            h(React.Fragment, null, h('p', null, 'No se pudo dibujar el mapa. Podés elegir una sede y abrir Cómo llegar.'),
                h('button', { type: 'button', onClick: () => setAttempt(v => v + 1) }, 'Volver a intentar')) : 'Cargando mapa…'),
        ready && h('div', { className: 'venue-map-zoom', 'aria-label': 'Controles del mapa' },
            h('button', { type: 'button', 'aria-label': 'Acercar mapa', onClick: () => engine.current?.zoomBy(1.7) }, h(Plus, { size: 20, 'aria-hidden': true })),
            h('button', { type: 'button', 'aria-label': 'Alejar mapa', onClick: () => engine.current?.zoomBy(1 / 1.7) }, h(Minus, { size: 20, 'aria-hidden': true })),
            h('button', { type: 'button', 'aria-label': 'Ver todas las sedes', onClick: () => engine.current?.reset() }, h(RotateCcw, { size: 17, 'aria-hidden': true }))),
        h('div', { className: 'venue-map-attribution' }, h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener noreferrer' }, '© OpenStreetMap'))
    );
}

function MapPanel({ data, selected, expanded, dialogOpen, onSelect, onExpand, onClose }) {
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
        h(MapCanvas, { data, selected, expanded, onSelect }),
        h('div', { className: 'venue-map-information' },
            h('label', { className: 'venue-map-choice' }, h('span', null, 'Sede'),
                h('select', { value: venue.id, 'aria-label': 'Seleccionar una sede', onChange: event => onSelect(event.target.value) },
                    ...data.venues.map(v => h('option', { key: v.id, value: v.id }, `${v.name} · ${v.city}`)))),
            h('p', { className: 'venue-map-note' }, 'Los números agrupan sedes cercanas.', !expanded && ' Ampliá para mover el mapa.'),
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
    const host = useRef(null);
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
        h(React.Fragment, null, h(MapPanel, { data, selected, dialogOpen: expanded, onSelect: setSelected, onExpand: () => setExpanded(true) }),
            expanded && h(ExpandedMap, { onClose: () => setExpanded(false) }, h(MapPanel, { data, selected, expanded: true, onSelect: setSelected, onClose: () => setExpanded(false) }))) :
        h('div', { className: 'venue-map-placeholder', role: error ? 'alert' : 'status' }, error ?
            h(React.Fragment, null, h('p', null, 'No se pudo cargar el mapa de sedes.'),
                h('button', { type: 'button', className: 'venue-map-expand', onClick: () => setAttempt(v => v + 1) }, 'Volver a intentar')) : 'Cargando mapa de sedes…'));
}
