// Interactive 3D Earth built with Three.js.
// Country hit-testing uses real boundaries (world-atlas 1:110m) where they are
// available, and falls back to the nearest country centre for small states
// that the dataset omits.
import { COUNTRIES, COUNTRY_BY_CODE } from './countries.js';
import { MOOD_BY_CODE } from './moods.js';
import { LIBS } from './libs.js';
import { countryAt, traceShape, angularDistance } from './geo.js';

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

const DEFAULT_VIEW = { lat: 18, lon: 10, distance: 3.45 };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class Globe {
  constructor(container, { shapes, reducedMotion, lowPower, onHover, onSelect, onAutoRotateChange }) {
    this.container = container;
    this.shapes = shapes || [];
    this.shapeCodes = new Set(this.shapes.map((s) => s.code));
    this.reducedMotion = reducedMotion;
    this.lowPower = lowPower;
    this.onHover = onHover;
    this.onSelect = onSelect;
    this.onAutoRotateChange = onAutoRotateChange;
    this.markerData = new Map();
    this.filterMood = null;
    this.hovered = null;
    this.selected = null;
    this.visible = true;
    this.dirty = true;
  }

  async init() {
    const THREE = (this.THREE = await import(LIBS.three));
    const { OrbitControls } = await import(LIBS.orbitControls);

    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: !this.lowPower, alpha: true, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    this.container.appendChild(renderer.domElement);

    const scene = (this.scene = new THREE.Scene());
    const camera = (this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200));
    scene.add(camera);

    scene.add(new THREE.AmbientLight(0xbfd4ff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-3, 2, 3);
    camera.add(key);

    // Earth
    const seg = this.lowPower ? [64, 48] : [96, 72];
    const geo = new THREE.SphereGeometry(1, ...seg);
    this.earthMat = new THREE.MeshPhongMaterial({ color: 0x0d1a33, specular: 0x1a2a40, shininess: 10 });
    this.earth = new THREE.Mesh(geo, this.earthMat);
    scene.add(this.earth);
    this.loadTextures();

    // Country overlay: borders, mood tint, hover and selection, drawn on a canvas.
    const w = this.lowPower ? 1024 : 2048;
    this.overlayCanvas = Object.assign(document.createElement('canvas'), { width: w, height: w / 2 });
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.overlayTex = new THREE.CanvasTexture(this.overlayCanvas);
    this.overlayTex.colorSpace = THREE.SRGBColorSpace;
    this.overlayTex.anisotropy = 4;
    const overlay = new THREE.Mesh(
      new THREE.SphereGeometry(1.002, ...seg),
      new THREE.MeshBasicMaterial({ map: this.overlayTex, transparent: true, depthWrite: false }),
    );
    scene.add(overlay);

    // Atmosphere: soft outer halo plus an inner fresnel rim.
    const glow = (side, power, scale, strength) => new THREE.Mesh(
      new THREE.SphereGeometry(scale, 64, 48),
      new THREE.ShaderMaterial({
        side, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { color: { value: new THREE.Color(0x45e6ff) } },
        vertexShader: `varying vec3 vN; varying vec3 vV;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: side === THREE.BackSide
          ? `uniform vec3 color; varying vec3 vN; varying vec3 vV;
             void main(){ float d = clamp(-dot(vN, vV) * 1.7, 0.0, 1.0); float i = pow(d, ${power.toFixed(1)}) * ${strength.toFixed(2)}; gl_FragColor = vec4(color, i); }`
          : `uniform vec3 color; varying vec3 vN; varying vec3 vV;
             void main(){ float i = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), ${power.toFixed(1)}) * ${strength.toFixed(2)}; gl_FragColor = vec4(mix(color, vec3(0.61,0.49,1.0), 0.25), i); }`,
      }),
    );
    scene.add(glow(THREE.BackSide, 3.0, 1.16, 0.85));
    scene.add(glow(THREE.FrontSide, 3.0, 1.004, 0.55));

    // Stars
    const starCount = this.lowPower ? 450 : 1400;
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 40);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe8ff, size: 0.12, transparent: true, opacity: 0.75, depthWrite: false })));

    // Markers
    this.markerGroup = new THREE.Group();
    scene.add(this.markerGroup);
    this.markerTexture = this.makeGlowTexture();
    this.materialCache = new Map();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.035, 0.045, 48),
      new THREE.MeshBasicMaterial({ color: 0x45e6ff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.visible = false;
    this.selectionRing = ring;
    scene.add(ring);

    // Controls
    const controls = (this.controls = new OrbitControls(camera, renderer.domElement));
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.7;
    controls.minDistance = 1.45;
    controls.maxDistance = 5;
    controls.autoRotate = !this.reducedMotion;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener('change', () => (this.dirty = true));
    controls.addEventListener('start', () => this.cancelFly());

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.bindPointer();
    this.setView(DEFAULT_VIEW);
    this.drawOverlay();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();

    new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(this.container);
    document.addEventListener('visibilitychange', () => (this.dirty = true));

    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.frame());
  }

  loadTextures() {
    const THREE = this.THREE;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const slow = navigator.connection?.saveData || /2g/.test(navigator.connection?.effectiveType || '');
    loader.load(this.lowPower || slow ? LIBS.earthLite : LIBS.earthDay, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.earthMat.map = tex;
      this.earthMat.color.set(0xffffff);
      this.earthMat.needsUpdate = true;
      this.textured = true;
      this.drawOverlay();
    }, undefined, () => console.info('[WorldPulse] Earth texture unavailable; using vector land fill.'));
    if (!this.lowPower && !slow) {
      loader.load(LIBS.earthBump, (tex) => {
        this.earthMat.bumpMap = tex;
        this.earthMat.bumpScale = 3;
        this.earthMat.needsUpdate = true;
        this.dirty = true;
      }, undefined, () => {});
    }
  }

  makeGlowTexture() {
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.22, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new this.THREE.CanvasTexture(c);
    tex.colorSpace = this.THREE.SRGBColorSpace;
    return tex;
  }

  latLonToVec(lat, lon, r = 1) {
    const phi = ((lon + 180) / 360) * Math.PI * 2;
    const theta = ((90 - lat) * Math.PI) / 180;
    return new this.THREE.Vector3(-Math.cos(phi) * Math.sin(theta) * r, Math.cos(theta) * r, Math.sin(phi) * Math.sin(theta) * r);
  }

  vecToLatLon(v) {
    const n = v.clone().normalize();
    const lat = (Math.asin(n.y) * 180) / Math.PI;
    let lon = (Math.atan2(n.z, -n.x) * 180) / Math.PI - 180;
    if (lon < -180) lon += 360;
    return { lat, lon };
  }

  setView({ lat, lon, distance }) {
    this.camera.position.copy(this.latLonToVec(lat, lon, distance));
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this.dirty = true;
  }

  // ---------------------------------------------------------------- input
  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 6 && performance.now() - down.t < 600) {
        const code = this.pick(e);
        if (code) this.onSelect?.(code);
      }
      down = null;
    });
    let raf = 0;
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => this.setHovered(this.pick(e), e));
    });
    el.addEventListener('pointerleave', () => this.setHovered(null));
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.earth, false)[0];
    if (!hit) return null;
    const { lat, lon } = this.vecToLatLon(hit.point);
    const inShape = countryAt(this.shapes, lon, lat);
    if (inShape) return inShape;
    // Small states missing from the boundary dataset: nearest centre within 2.5°.
    let best = null, bestD = 2.5;
    for (const c of COUNTRIES) {
      if (this.shapeCodes.has(c.code) && this.shapes.length) continue;
      const d = angularDistance(lat, lon, c.lat, c.lon);
      if (d < bestD) { best = c.code; bestD = d; }
    }
    return best;
  }

  setHovered(code, e) {
    if (code !== this.hovered) {
      this.hovered = code;
      this.renderer.domElement.style.cursor = code ? 'pointer' : 'grab';
      this.drawOverlay();
    }
    this.onHover?.(code, e);
  }

  // ---------------------------------------------------------------- data
  setData({ markers, filterMood }) {
    this.markerData = new Map((markers || []).map((m) => [m.code, m]));
    this.filterMood = filterMood || null;
    this.rebuildMarkers();
    this.drawOverlay();
  }

  markerMaterial(color, opacity) {
    const key = `${color}|${opacity.toFixed(2)}`;
    if (!this.materialCache.has(key)) {
      this.materialCache.set(key, new this.THREE.SpriteMaterial({
        map: this.markerTexture, color: new this.THREE.Color(color), transparent: true, opacity,
        depthWrite: false, blending: this.THREE.AdditiveBlending,
      }));
    }
    return this.materialCache.get(key);
  }

  rebuildMarkers() {
    this.markerGroup.clear();
    for (const m of this.markerData.values()) {
      const c = COUNTRY_BY_CODE.get(m.code);
      if (!c) continue;
      let color = '#cfe8ff', opacity = 0.45, size = 0.035;
      if (!m.suppressed) {
        size = 0.05 + 0.025 * Math.log10(m.total);
        if (this.filterMood) {
          color = MOOD_BY_CODE.get(this.filterMood).color;
          opacity = Math.min(1, 0.2 + m.mood_share * 2.2);
          size *= 0.7 + m.mood_share * 1.6;
        } else {
          color = MOOD_BY_CODE.get(m.top_mood)?.color ?? '#45e6ff';
          opacity = 0.95;
        }
      } else if (this.filterMood) {
        opacity = 0.2;
      }
      const sprite = new this.THREE.Sprite(this.markerMaterial(color, opacity));
      sprite.position.copy(this.latLonToVec(c.lat, c.lon, 1.012));
      sprite.scale.setScalar(size);
      sprite.userData = { base: size, phase: Math.random() * Math.PI * 2, live: !m.suppressed };
      this.markerGroup.add(sprite);
    }
    this.dirty = true;
  }

  drawOverlay() {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    const { width: w, height: h } = this.overlayCanvas;
    const s = w / 2048;
    ctx.clearRect(0, 0, w, h);
    for (const shape of this.shapes) {
      const m = this.markerData.get(shape.code);
      let fill = this.textured ? null : '#1c2d52';
      if (m && !m.suppressed) {
        const mood = this.filterMood ? MOOD_BY_CODE.get(this.filterMood) : MOOD_BY_CODE.get(m.top_mood);
        const alpha = this.filterMood ? Math.min(0.7, m.mood_share * 2.4) : 0.32;
        if (mood && alpha > 0.02) fill = hexToRgba(mood.color, alpha);
      }
      if (shape.code === this.selected) fill = 'rgba(69,230,255,0.38)';
      else if (shape.code === this.hovered) fill = 'rgba(255,255,255,0.22)';
      if (!fill) continue;
      ctx.beginPath();
      traceShape(ctx, shape, w, h);
      ctx.fillStyle = fill;
      ctx.fill('evenodd');
    }
    ctx.beginPath();
    for (const shape of this.shapes) traceShape(ctx, shape, w, h);
    ctx.strokeStyle = this.textured ? 'rgba(200,240,255,0.32)' : 'rgba(69,230,255,0.45)';
    ctx.lineWidth = 1.1 * s;
    ctx.stroke();
    for (const code of [this.hovered, this.selected]) {
      const shape = code && this.shapes.find((x) => x.code === code);
      if (!shape) continue;
      ctx.beginPath();
      traceShape(ctx, shape, w, h);
      ctx.strokeStyle = code === this.selected ? '#45E6FF' : 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2.6 * s;
      ctx.stroke();
    }
    if (this.overlayTex) this.overlayTex.needsUpdate = true;
    this.dirty = true;
  }

  setSelected(code) {
    this.selected = code;
    const c = code && COUNTRY_BY_CODE.get(code);
    this.selectionRing.visible = !!c;
    if (c) {
      const p = this.latLonToVec(c.lat, c.lon, 1.015);
      this.selectionRing.position.copy(p);
      this.selectionRing.lookAt(p.clone().multiplyScalar(2));
    }
    this.drawOverlay();
  }

  // ---------------------------------------------------------------- camera
  setAutoRotate(on) {
    this.controls.autoRotate = on;
    this.onAutoRotateChange?.(on);
    this.dirty = true;
  }

  flyTo(code) {
    const c = COUNTRY_BY_CODE.get(code);
    if (!c) return;
    this.setAutoRotate(false);
    const distance = Math.min(Math.max(this.camera.position.length(), 2.2), 2.8);
    this.animateTo(this.latLonToVec(c.lat, c.lon, distance));
  }

  reset() {
    this.setSelected(null);
    this.animateTo(this.latLonToVec(DEFAULT_VIEW.lat, DEFAULT_VIEW.lon, this.defaultDistance()));
    this.setAutoRotate(!this.reducedMotion);
  }

  animateTo(target) {
    if (this.reducedMotion) {
      this.camera.position.copy(target);
      this.controls.update();
      this.dirty = true;
      return;
    }
    const from = this.camera.position.clone();
    this.fly = { from, to: target, fromLen: from.length(), toLen: target.length(), t0: performance.now(), dur: 1400 };
  }

  cancelFly() { this.fly = null; }

  defaultDistance() {
    const { clientWidth: w, clientHeight: h } = this.container;
    return w < 640 || w < h ? DEFAULT_VIEW.distance + 0.35 : DEFAULT_VIEW.distance;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.sized) {
      this.sized = true;
      this.camera.position.setLength(this.defaultDistance());
    }
    this.dirty = true;
  }

  frame() {
    if (!this.visible || document.hidden) return;
    const t = this.clock.getElapsedTime();
    if (this.fly) {
      const k = Math.min(1, (performance.now() - this.fly.t0) / this.fly.dur);
      const e = easeInOut(k);
      const dir = this.fly.from.clone().normalize().lerp(this.fly.to.clone().normalize(), e).normalize();
      this.camera.position.copy(dir.multiplyScalar(this.fly.fromLen + (this.fly.toLen - this.fly.fromLen) * e));
      if (k === 1) this.fly = null;
      this.dirty = true;
    }
    const changed = this.controls.update();
    if (!this.reducedMotion && !this.lowPower) {
      for (const sprite of this.markerGroup.children) {
        if (!sprite.userData.live) continue;
        sprite.scale.setScalar(sprite.userData.base * (1 + 0.12 * Math.sin(t * 2 + sprite.userData.phase)));
      }
      if (this.selectionRing.visible) this.selectionRing.scale.setScalar(1 + 0.15 * Math.sin(t * 3));
      this.dirty = true;
    }
    if (changed || this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  }
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
