// Minimal TopoJSON decoding and country hit-testing in lon/lat space.
// Avoids pulling in d3-geo/topojson-client for the handful of operations we need.
import { COUNTRY_BY_NUMERIC, ATLAS_NAME_FALLBACK } from './countries.js';
import { LIBS } from './libs.js';

function decodeArcs(topology) {
  const [sx, sy] = topology.transform?.scale ?? [1, 1];
  const [tx, ty] = topology.transform?.translate ?? [0, 0];
  return topology.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
}

function ringFromArcs(arcIdx, arcs) {
  const ring = [];
  for (const i of arcIdx) {
    const arc = i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
    for (let k = ring.length ? 1 : 0; k < arc.length; k++) ring.push(arc[k]);
  }
  return ring;
}

/** Loads world-atlas and returns [{ code, polygons: [[ring, ...holes], ...], bbox }]. */
export async function loadCountryShapes() {
  const res = await fetch(LIBS.atlas);
  if (!res.ok) throw new Error('atlas unavailable');
  const topo = await res.json();
  const arcs = decodeArcs(topo);
  const shapes = [];
  for (const g of topo.objects.countries.geometries) {
    const code = COUNTRY_BY_NUMERIC.get(g.id)?.code ?? ATLAS_NAME_FALLBACK[g.properties?.name];
    if (!code) continue;
    const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    const polygons = polys.map((p) => p.map((r) => ringFromArcs(r, arcs)));
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    for (const poly of polygons) for (const [x, y] of poly[0]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    shapes.push({ code, polygons, bbox: [minX, minY, maxX, maxY] });
  }
  return shapes;
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function countryAt(shapes, lon, lat) {
  for (const s of shapes) {
    const [x0, y0, x1, y1] = s.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    for (const poly of s.polygons) {
      if (inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h))) return s.code;
    }
  }
  return null;
}

/** Traces a shape onto a 2D context using an equirectangular projection of size w×h. */
export function traceShape(ctx, shape, w, h) {
  for (const poly of shape.polygons) {
    for (const ring of poly) {
      ring.forEach(([x, y], i) => {
        const px = ((x + 180) / 360) * w, py = ((90 - y) / 180) * h;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
    }
  }
}

/** SVG path data for the 2D fallback map. */
export function svgPath(shape, w, h) {
  let d = '';
  for (const poly of shape.polygons) for (const ring of poly) {
    d += ring.map(([x, y], i) => `${i ? 'L' : 'M'}${(((x + 180) / 360) * w).toFixed(1)},${(((90 - y) / 180) * h).toFixed(1)}`).join('') + 'Z';
  }
  return d;
}

/** Great-circle angle in degrees between two lat/lon points. */
export function angularDistance(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const c = Math.sin(lat1 * r) * Math.sin(lat2 * r) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon1 - lon2) * r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r;
}
