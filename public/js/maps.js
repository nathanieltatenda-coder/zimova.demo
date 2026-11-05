// ZIMOVA map layer. With a Google browser key (served by /api/map-config) the app uses Google Maps;
// otherwise it uses Leaflet + OpenStreetMap so the app still works without Google keys. app.js talks to one small API:
// L.* (Leaflet-compatible subset), MAPS.search(text), MAPS.reverse({lat,lng}), MAPS.google.
window.MAPS = { google: false };
const osmSearch = async q => { const r = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=zw&q=' + encodeURIComponent(q))).json(); return r[0] ? { lat: +r[0].lat, lng: +r[0].lon } : null; };
const osmReverse = async ll => { const j = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&lat=${ll.lat}&lon=${ll.lng}`)).json(); return j.display_name ? j.display_name.split(',').slice(0, 3).join(',') : ''; };
MAPS.search = osmSearch; MAPS.reverse = osmReverse;

window.mapsReady = (async () => {
  let cfg = { provider: 'osm' }; try { cfg = await (await fetch((window.ZIMOVA_API || '') + '/api/map-config')).json(); } catch {}
  if (cfg.provider !== 'google') return;
  try {
    await new Promise((res, rej) => { window.__gmMapId = cfg.mapId; window.__gmReady = res; window.gm_authFailure = () => console.warn('Google Maps rejected the browser key (check API restrictions and billing).');
      const s = document.createElement('script'); s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.key)}&v=weekly&loading=async&callback=__gmReady`; s.onerror = rej; document.head.appendChild(s); });
    await Promise.all(['maps', 'marker', 'places', 'geocoding'].map(l => google.maps.importLibrary(l)));
    install(); MAPS.google = true;
  } catch (e) { console.warn('Google Maps failed to load; using OpenStreetMap instead.', e); }
})();

function install() {
  const ll = (a, b) => Array.isArray(a) ? { lat: a[0], lng: a[1] } : (a && typeof a === 'object') ? { lat: +a.lat, lng: +a.lng } : { lat: a, lng: b };
  const num = v => typeof v === 'function' ? v() : v;
  window.LL = window.L;   // real Leaflet kept for reference
  window.L = {
    latLng: (a, b) => ll(a, b), divIcon: o => o, tileLayer: () => ({ addTo() { return this; } }),
    map(id) {
      const m = new google.maps.Map(document.getElementById(id), { center: { lat: -19, lng: 29.8 }, zoom: 6, minZoom: 5, mapId: window.__gmMapId || 'DEMO_MAP_ID', disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy', clickableIcons: false,
        colorScheme: google.maps.ColorScheme ? google.maps.ColorScheme.DARK : undefined, restriction: { latLngBounds: { north: -14.5, south: -24, west: 24, east: 34 }, strictBounds: false } });
      const api = { _m: m, setView(c, z) { m.setCenter(ll(c)); if (z) m.setZoom(z); return api; }, fitBounds(b) { m.fitBounds(b, 40); return api; },
        on(ev, cb) { if (ev === 'click') m.addListener('click', e => cb({ latlng: { lat: e.latLng.lat(), lng: e.latLng.lng() } })); return api; },
        removeLayer(x) { x && x.remove && x.remove(); }, remove() {}, setMapType(t) { m.setMapTypeId(t === 'sat' ? 'hybrid' : 'roadmap'); } };
      return api;
    },
    marker(p, o = {}) {
      let pos = ll(p), gm = null, tip = ''; const h = {}, wrap = document.createElement('div'); wrap.innerHTML = (o.icon && o.icon.html) || ''; const el = wrap.firstElementChild || wrap; if (o.interactive === false) el.style.transform = 'translateY(50%)';
      const api = { addTo(map) { gm = new google.maps.marker.AdvancedMarkerElement({ map: map._m, position: pos, content: el, gmpDraggable: !!o.draggable, title: tip });
          if (o.draggable) gm.addListener('dragend', () => { const q = gm.position; pos = { lat: num(q.lat), lng: num(q.lng) }; h.dragend && h.dragend({ target: api }); }); return api; },
        bindTooltip(t) { tip = t; if (gm) gm.title = t; return api; }, setLatLng(l) { pos = ll(l); if (gm) gm.position = pos; return api; }, getLatLng() { return pos; },
        on(ev, cb) { h[ev] = cb; return api; }, remove() { if (gm) { gm.map = null; gm = null; } } };
      return api;
    },
    polyline(path, o = {}) {
      const pts = path.map(p => ll(p)); let pl = null;
      const api = { addTo(map) { pl = new google.maps.Polyline({ map: map._m, path: [], strokeColor: o.color || '#d4af37', strokeWeight: o.weight || 5, strokeOpacity: .95 });
          if (pts.length < 3 || matchMedia('(prefers-reduced-motion: reduce)').matches) pl.setPath(pts);
          else { const t0 = performance.now(); (function f(t) { const k = Math.min((t - t0) / 1200, 1); if (pl) pl.setPath(pts.slice(0, Math.max(2, Math.ceil(k * pts.length)))); if (k < 1 && pl) requestAnimationFrame(f); })(t0); } return api; },
        getBounds() { const b = new google.maps.LatLngBounds(); pts.forEach(q => b.extend(q)); return b; }, getElement() { return null; }, remove() { if (pl) { pl.setMap(null); pl = null; } } };
      return api;
    },
    polygon(path, o = {}) {
      let pg = null; const pts = path.map(p => ll(p));
      return { addTo(map) { pg = new google.maps.Polygon({ map: map._m, paths: pts, strokeColor: o.color || '#d4af37', strokeWeight: 1, strokeOpacity: .7, fillColor: o.color || '#d4af37', fillOpacity: o.fillOpacity || .07, clickable: false }); return this; }, remove() { if (pg) { pg.setMap(null); pg = null; } } };
    }
  };
  MAPS.search = async q => { const { places } = await google.maps.places.Place.searchByText({ textQuery: q, fields: ['displayName', 'location'], region: 'zw', locationBias: { west: 25, east: 33.3, south: -22.6, north: -15.5 }, maxResultCount: 1 });
    return places && places[0] ? { lat: places[0].location.lat(), lng: places[0].location.lng() } : null; };
  MAPS.reverse = async p => { const r = await new google.maps.Geocoder().geocode({ location: { lat: p.lat, lng: p.lng } }); return r.results[0] ? r.results[0].formatted_address.split(',').slice(0, 3).join(',') : ''; };
}
