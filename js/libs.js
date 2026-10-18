// Third-party libraries, pinned to exact versions and loaded only when needed.
const CDN = 'https://cdn.jsdelivr.net/npm';

export const LIBS = {
  // jsDelivr's +esm builds rewrite OrbitControls' bare `three` import to the same
  // `three@0.160.0/+esm` module, so both share one Three.js instance without an import map.
  three: `${CDN}/three@0.160.0/+esm`,
  orbitControls: `${CDN}/three@0.160.0/examples/jsm/controls/OrbitControls.js/+esm`,
  supabase: `${CDN}/@supabase/supabase-js@2.45.4/dist/umd/supabase.js`,
  chart: `${CDN}/chart.js@4.4.1/dist/chart.umd.js`,
  atlas: `${CDN}/world-atlas@2.0.2/countries-110m.json`,
  earthDay: `${CDN}/three-globe@2.31.0/example/img/earth-blue-marble.jpg`,
  earthLite: `${CDN}/three-globe@2.31.0/example/img/earth-day.jpg`,
  earthBump: `${CDN}/three-globe@2.31.0/example/img/earth-topology.png`,
};

const pending = new Map();

export function loadScript(src) {
  if (!pending.has(src)) {
    pending.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => { pending.delete(src); reject(new Error(`Failed to load ${src}`)); };
      document.head.appendChild(s);
    }));
  }
  return pending.get(src);
}
