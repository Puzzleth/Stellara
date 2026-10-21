import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { ease } from './geom.ts'
import { STARS } from './stars.ts'
import type { Vec3 } from './sim.ts'

/** Scene units per astronomical unit. */
export const AU = 10
const SKY_R = 600
const TRAIL_R = 560

/** Layer 0 is the solar system, 1 is the sky seen by the main camera, 2 is the sky band. */
const WORLD = 0
const SKY = 1
const BAND = 2

export const GUESS = '#e0c089'

export type ModelName = 'sun' | 'mercury' | 'venus' | 'earth' | 'mars' | 'kite'
const MODELS: ModelName[] = ['sun', 'mercury', 'venus', 'earth', 'mars', 'kite']

export type LineStyle = {
  color: string
  width: number
  opacity?: number
  dashed?: boolean
  dash?: number
  layers?: number[]
}

export type LabelKind = 'body' | 'star' | 'note' | 'mark' | 'ring' | 'dot' | 'ring-label'
type Label = {
  text: string
  kind: LabelKind
  view: 'main' | 'band'
  world?: THREE.Vector3
  dir?: THREE.Vector3
  dx: number
  dy: number
  alpha: number
  color?: string
}

export type Rect = { x: number; y: number; w: number; h: number }

export type ViewSpec = {
  w: number
  h: number
  /** 0 is the eyepiece at the observer, 1 is the chart camera above the ecliptic. */
  mix: number
  observer: Vec3
  pan: number
  lookLat: number
  /** Screen pixels per radian of sky at the centre of the eyepiece. */
  pxPerRad: number
  lens: boolean
  sysRadiusAU: number
  sysTarget?: Vec3
  azimuth?: number
  elevation?: number
  reserveTop?: number
  /** Fixed chart-camera distance in AU; otherwise it is fitted to sysRadiusAU. */
  sysDistance?: number
  band?: { observer: Vec3; pan: number; lookLat: number; pxPerRad: number; rect: Rect }
}

type Body = { root: THREE.Object3D; base: number; used: boolean }
type LineEntry = { obj: Line2; sig: string; used: boolean }

let renderer: THREE.WebGLRenderer
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(40, 1, 0.02, 4000)
const bandCam = new THREE.PerspectiveCamera(20, 1, 0.02, 4000)
const sky = new THREE.Group()
const models = new Map<ModelName, THREE.Object3D>()
const bodies = new Map<string, Body>()
const lines = new Map<string, LineEntry>()
const skyMaterials: THREE.Material[] = []
const sunLight = new THREE.PointLight('#fff4e2', 3.2, 0, 0)
let labels: Label[] = []
let labelLayer: HTMLDivElement
let maskPath: SVGPathElement
let maskSvg: SVGSVGElement
const labelPool: HTMLDivElement[] = []
let lensState = { cx: 0, cy: 0, r: 0, full: true }
let bandRectState: Rect | null = null
let skyAlphaMain = 1

export const canvas = document.createElement('canvas')
canvas.className = 'gl'

function toV(p: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(p.x * AU, p.z * AU, -p.y * AU)
}

export function skyDir(lon: number, lat: number, out = new THREE.Vector3()): THREE.Vector3 {
  const cl = Math.cos(lat)
  return out.set(cl * Math.cos(lon), Math.sin(lat), -cl * Math.sin(lon))
}

function dirToLonLat(d: THREE.Vector3): { lon: number; lat: number } {
  const lon = Math.atan2(-d.z, d.x)
  return { lon: lon < 0 ? lon + Math.PI * 2 : lon, lat: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) }
}


function mulberry(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function radiusOf(obj: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(obj)
  const size = box.getSize(new THREE.Vector3())
  return Math.max(size.x, size.y, size.z) / 2
}

function meshesOf(obj: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) out.push(child as THREE.Mesh)
  })
  return out
}

function onLayers(obj: THREE.Object3D, layerList: number[]): void {
  obj.traverse((child) => {
    child.layers.disableAll()
    for (const layer of layerList) child.layers.enable(layer)
  })
}

async function loadGLB(loader: GLTFLoader, file: string): Promise<THREE.Object3D> {
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${file}.glb`)
  return gltf.scene
}

function buildSky(starModels: Map<string, THREE.Object3D>, faint: THREE.Object3D): void {
  const unit = new THREE.Vector3()
  for (const star of STARS) {
    if (!star.name) continue
    const source = starModels.get(star.name.toLowerCase())
    if (!source) continue
    const obj = source.clone(true)
    const scale = (SKY_R * Math.tan(0.0105)) / radiusOf(source)
    obj.scale.setScalar(scale)
    obj.position.copy(skyDir(star.lon, star.lat, unit)).multiplyScalar(SKY_R)
    obj.lookAt(0, 0, 0)
    obj.userData.spin = star.lon
    for (const mesh of meshesOf(obj)) {
      const mat = (mesh.material as THREE.Material).clone()
      mat.transparent = true
      mesh.material = mat
      skyMaterials.push(mat)
    }
    onLayers(obj, [SKY, BAND])
    sky.add(obj)
  }

  const faintMesh = meshesOf(faint)[0]
  const faintStars = STARS.filter((s) => !s.name)
  const faintMat = (faintMesh.material as THREE.Material).clone()
  faintMat.transparent = true
  skyMaterials.push(faintMat)
  const inst = new THREE.InstancedMesh(faintMesh.geometry, faintMat, faintStars.length)
  const base = radiusOf(faint)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const look = new THREE.Object3D()
  faintStars.forEach((star, i) => {
    skyDir(star.lon, star.lat, unit).multiplyScalar(SKY_R)
    look.position.copy(unit)
    look.lookAt(0, 0, 0)
    look.rotateZ(i * 0.7)
    q.copy(look.quaternion)
    const size = (SKY_R * Math.tan(0.0015 + (1 - star.mag) * 0.003)) / base
    s.setScalar(size)
    m.compose(unit, q, s)
    inst.setMatrixAt(i, m)
  })
  onLayers(inst, [SKY, BAND])
  sky.add(inst)

  // A thin field of distant points so the chart camera never looks into an empty sky.
  const rand = mulberry(29)
  const pts: number[] = []
  for (let i = 0; i < 1400; i += 1) {
    const z = rand() * 2 - 1
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(1 - z * z)
    pts.push(r * Math.cos(a) * SKY_R * 1.1, z * SKY_R * 1.1, r * Math.sin(a) * SKY_R * 1.1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  const dust = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color: '#c9d4ea', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.55 }),
  )
  onLayers(dust, [WORLD, SKY, BAND])
  sky.add(dust)
}

export async function initWorld(): Promise<void> {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.autoClear = false

  sunLight.layers.enableAll()
  scene.add(sunLight)
  const ambient = new THREE.AmbientLight('#8d97ab', 0.16)
  ambient.layers.enableAll()
  scene.add(ambient)
  scene.add(sky)
  camera.layers.set(WORLD)
  camera.layers.enable(SKY)
  bandCam.layers.set(BAND)

  const loader = new GLTFLoader()
  const named = STARS.filter((s) => s.name).map((s) => s.name!.toLowerCase())
  const [planetObjs, starObjs, faint] = await Promise.all([
    Promise.all(MODELS.map((name) => loadGLB(loader, name))),
    Promise.all(named.map((name) => loadGLB(loader, `star-${name}`))),
    loadGLB(loader, 'star-faint'),
  ])
  MODELS.forEach((name, i) => models.set(name, planetObjs[i]))
  const starModels = new Map<string, THREE.Object3D>()
  named.forEach((name, i) => starModels.set(name, starObjs[i]))
  buildSky(starModels, faint)
}

export function mount(container: HTMLElement): void {
  if (!labelLayer) {
    labelLayer = document.createElement('div')
    labelLayer.className = 'labels'
    maskSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    maskSvg.setAttribute('class', 'lens')
    maskSvg.setAttribute('aria-hidden', 'true')
    maskPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    maskPath.setAttribute('fill-rule', 'evenodd')
    maskSvg.appendChild(maskPath)
  }
  if (canvas.parentElement !== container) {
    container.prepend(canvas)
    canvas.after(maskSvg, labelLayer)
  }
}

/** Starts a frame. Everything not placed again before render is hidden. */
export function beginFrame(): void {
  for (const b of bodies.values()) b.used = false
  for (const l of lines.values()) l.used = false
  labels = []
}

function guessMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: GUESS,
    emissive: GUESS,
    emissiveIntensity: 0.28,
    roughness: 0.55,
    metalness: 0,
  })
}

/** Places a model at a heliocentric position (AU) with a radius in scene units. */
export function placeBody(
  key: string,
  model: ModelName,
  pos: Vec3,
  radius: number,
  opts: { guess?: boolean; spin?: number } = {},
): void {
  let b = bodies.get(key)
  if (!b) {
    const source = models.get(model)!
    const root = source.clone(true)
    if (opts.guess) {
      const mat = guessMaterial()
      for (const mesh of meshesOf(root)) mesh.material = mat
    }
    b = { root, base: radiusOf(source), used: false }
    onLayers(root, [WORLD])
    scene.add(root)
    bodies.set(key, b)
  }
  b.used = true
  toV(pos, b.root.position)
  b.root.scale.setScalar(Math.max(1e-4, radius) / b.base)
  b.root.rotation.y = opts.spin ?? 0
  if (model === 'sun') sunLight.position.copy(b.root.position)
}

/** World-space position of a placed body, for labels and hit tests. */
export function bodyPosition(pos: Vec3): THREE.Vector3 {
  return toV(pos)
}

function signature(pts: number[], style: LineStyle): string {
  const n = pts.length
  const pick = (i: number) => (pts[i] ?? 0).toFixed(3)
  const mid = Math.floor(n / 6) * 3
  return `${n}|${pick(0)},${pick(2)}|${pick(mid)},${pick(mid + 2)}|${pick(n - 3)},${pick(n - 1)}|${style.dashed ? style.dash ?? 1 : 0}`
}

function setLine(key: string, pts: number[], style: LineStyle): void {
  if (pts.length < 6) return
  let entry = lines.get(key)
  const sig = signature(pts, style)
  if (!entry) {
    const mat = new LineMaterial({
      color: style.color,
      linewidth: style.width,
      transparent: true,
      dashed: Boolean(style.dashed),
      dashSize: style.dash ?? 1,
      gapSize: (style.dash ?? 1) * 1.1,
      depthWrite: false,
    })
    const obj = new Line2(new LineGeometry(), mat)
    obj.frustumCulled = false
    obj.renderOrder = 2
    entry = { obj, sig: '', used: false }
    scene.add(obj)
    lines.set(key, entry)
  }
  if (entry.sig !== sig) {
    entry.obj.geometry.dispose()
    const geo = new LineGeometry()
    geo.setPositions(pts)
    entry.obj.geometry = geo
    if (style.dashed) entry.obj.computeLineDistances()
    entry.sig = sig
  }
  const mat = entry.obj.material
  mat.color.set(style.color)
  mat.linewidth = style.width
  mat.opacity = style.opacity ?? 1
  mat.userData.baseOpacity = style.opacity ?? 1
  mat.userData.sky = style.layers?.includes(SKY) ?? false
  onLayers(entry.obj, style.layers ?? [WORLD])
  entry.obj.position.set(0, 0, 0)
  entry.used = true
}

/** A line through heliocentric points (AU). */
export function worldLine(key: string, pts: Vec3[], style: LineStyle): void {
  const flat: number[] = []
  const v = new THREE.Vector3()
  for (const p of pts) {
    toV(p, v)
    flat.push(v.x, v.y, v.z)
  }
  setLine(key, flat, { ...style, layers: [WORLD] })
}

export function circle(cx: number, cy: number, r: number, n = 128): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), z: 0 })
  }
  return out
}

/** A path drawn on the inside of the celestial sphere, centred on whoever is looking. */
export function skyLine(key: string, pts: { lon: number; lat: number }[], style: LineStyle, view: 'main' | 'band' = 'main'): void {
  const flat: number[] = []
  const v = new THREE.Vector3()
  for (const p of pts) {
    skyDir(p.lon, p.lat, v).multiplyScalar(TRAIL_R)
    flat.push(v.x, v.y, v.z)
  }
  const entryKey = `${view}:${key}`
  setLine(entryKey, flat, { ...style, dash: (style.dash ?? 0.012) * TRAIL_R, layers: [view === 'main' ? SKY : BAND] })
  const entry = lines.get(entryKey)
  if (entry) {
    entry.obj.userData.sky = true
    if (entry.obj.parent !== sky) sky.add(entry.obj)
  }
}

export function labelAt(
  text: string,
  pos: Vec3,
  kind: LabelKind = 'body',
  opts: { dx?: number; dy?: number; alpha?: number; color?: string } = {},
): void {
  labels.push({ text, kind, view: 'main', world: toV(pos), dx: opts.dx ?? 0, dy: opts.dy ?? 0, alpha: opts.alpha ?? 1, color: opts.color })
}

export function labelSky(
  text: string,
  lon: number,
  lat: number,
  kind: LabelKind,
  view: 'main' | 'band' = 'main',
  opts: { dx?: number; dy?: number; alpha?: number; color?: string } = {},
): void {
  labels.push({ text, kind, view, dir: skyDir(lon, lat), dx: opts.dx ?? 0, dy: opts.dy ?? 0, alpha: opts.alpha ?? 1, color: opts.color })
}

function lookQuat(eye: THREE.Vector3, target: THREE.Vector3): THREE.Quaternion {
  const m = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0))
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

function telescopeFov(h: number, pxPerRad: number): number {
  return THREE.MathUtils.radToDeg(2 * Math.atan(h / 2 / pxPerRad))
}

const SYS_FOV = 34

function systemPose(spec: ViewSpec): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const target = spec.sysTarget ? toV(spec.sysTarget) : new THREE.Vector3()
  const elev = spec.elevation ?? THREE.MathUtils.degToRad(56)
  const az = spec.azimuth ?? 0
  const aspect = spec.w / Math.max(1, spec.h)
  const usable = (spec.h - (spec.reserveTop ?? 0)) / Math.max(1, spec.h)
  const t = Math.tan(THREE.MathUtils.degToRad(SYS_FOV) / 2)
  const R = spec.sysRadiusAU * AU * 1.06
  const dist = spec.sysDistance
    ? spec.sysDistance * AU
    : Math.max(R / (t * aspect), (R * Math.abs(Math.sin(elev))) / (t * usable)) + R * Math.cos(elev) * 0.35
  const pos = new THREE.Vector3(
    target.x + dist * Math.cos(elev) * Math.sin(az),
    target.y + dist * Math.sin(elev),
    target.z + dist * Math.cos(elev) * Math.cos(az),
  )
  return { pos, target }
}

/** How far the chart camera is from a point: bodies are sized from it so they read at any zoom. */
export function systemScale(spec: Pick<ViewSpec, 'sysRadiusAU'>): number {
  return spec.sysRadiusAU * AU * 0.034
}

/** Angular radius → scene radius for a body seen from the observer. */
export function apparentRadius(observer: Vec3, pos: Vec3, angle: number): number {
  const d = Math.hypot(pos.x - observer.x, pos.y - observer.y, pos.z - observer.z) * AU
  return d * Math.tan(angle)
}

function setSkyOpacity(alpha: number, floor: number): void {
  const a = Math.max(alpha, 0)
  for (const mat of skyMaterials) mat.opacity = a
  sky.traverse((child) => {
    if ((child as THREE.Points).isPoints) {
      ;((child as THREE.Points).material as THREE.PointsMaterial).opacity = 0.55 * Math.max(a, floor)
    }
  })
  for (const entry of lines.values()) {
    const mat = entry.obj.material
    if (mat.userData.sky) mat.opacity = (mat.userData.baseOpacity ?? 1) * a
  }
  for (const mat of skyMaterials) mat.visible = a > 0.01
}

function setLineResolution(w: number, h: number): void {
  for (const entry of lines.values()) entry.obj.material.resolution.set(w, h)
}

function finishFrame(): void {
  for (const b of bodies.values()) b.root.visible = b.used
  for (const l of lines.values()) l.obj.visible = l.used
}

function fitRenderer(w: number, h: number): void {
  const size = renderer.getSize(new THREE.Vector2())
  if (size.x !== w || size.y !== h) renderer.setSize(w, h, false)
}

export function render(spec: ViewSpec): void {
  const { w, h } = spec
  if (w < 2 || h < 2) return
  finishFrame()
  fitRenderer(w, h)
  const e = ease(spec.mix)

  const telPos = toV(spec.observer)
  const telTarget = telPos.clone().add(skyDir(spec.pan, spec.lookLat))
  const sys = systemPose(spec)
  camera.position.lerpVectors(telPos, sys.pos, e)
  camera.quaternion.copy(lookQuat(telPos, telTarget)).slerp(lookQuat(sys.pos, sys.target), e)
  camera.fov = THREE.MathUtils.lerp(telescopeFov(h, spec.pxPerRad), SYS_FOV, e)
  camera.aspect = w / h
  const reserve = (spec.reserveTop ?? 0) * e
  if (reserve > 0.5) camera.setViewOffset(w, h, 0, -reserve / 2, w, h)
  else camera.clearViewOffset()
  camera.updateProjectionMatrix()

  for (const child of sky.children) {
    if (child.userData.spin !== undefined) child.rotateZ(0.0025)
  }

  renderer.setScissorTest(false)
  renderer.setViewport(0, 0, w, h)
  renderer.setClearColor('#07080c', 1)
  renderer.clear()
  sky.position.copy(camera.position)
  skyAlphaMain = 1 - e
  setSkyOpacity(skyAlphaMain, 0.6)
  // Orbits and rays belong to the chart; from inside the eyepiece they would cut across the sky.
  for (const entry of lines.values()) {
    const mat = entry.obj.material
    if (!mat.userData.sky) mat.opacity = (mat.userData.baseOpacity ?? 1) * (spec.lens ? e : 1)
  }
  setLineResolution(w, h)
  renderer.render(scene, camera)

  bandRectState = null
  if (spec.band && e > 0.02) {
    const r = spec.band.rect
    bandRectState = r
    const y = h - r.y - r.h
    renderer.setScissorTest(true)
    renderer.setScissor(r.x, y, r.w, r.h)
    renderer.setViewport(r.x, y, r.w, r.h)
    renderer.setClearColor('#0a0e1a', 1)
    renderer.clear()
    const bandPos = toV(spec.band.observer)
    bandCam.position.copy(bandPos)
    bandCam.quaternion.copy(lookQuat(bandPos, bandPos.clone().add(skyDir(spec.band.pan, spec.band.lookLat))))
    bandCam.aspect = r.w / r.h
    bandCam.fov = telescopeFov(r.h, spec.band.pxPerRad)
    bandCam.updateProjectionMatrix()
    sky.position.copy(bandCam.position)
    setSkyOpacity(1, 1)
    setLineResolution(r.w, r.h)
    renderer.render(scene, bandCam)
    renderer.setScissorTest(false)
  }

  const lensR = Math.min(w, h) * 0.455
  const full = Math.hypot(w, h) / 2 + 4
  lensState = spec.lens
    ? { cx: w / 2, cy: h / 2, r: THREE.MathUtils.lerp(lensR, full, e), full: e > 0.995 }
    : { cx: w / 2, cy: h / 2, r: full, full: true }
  drawMask(w, h)
  drawLabels(w, h)
}

function drawMask(w: number, h: number): void {
  maskSvg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  if (lensState.full) {
    maskPath.setAttribute('d', '')
    return
  }
  const { cx, cy, r } = lensState
  maskPath.setAttribute(
    'd',
    `M0 0H${w}V${h}H0Z M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`,
  )
}

const tmp = new THREE.Vector3()

function project(p: THREE.Vector3, cam: THREE.PerspectiveCamera, rect: Rect): { x: number; y: number; ok: boolean } {
  tmp.copy(p).project(cam)
  return {
    x: rect.x + ((tmp.x + 1) / 2) * rect.w,
    y: rect.y + ((1 - tmp.y) / 2) * rect.h,
    ok: tmp.z > -1 && tmp.z < 1,
  }
}

function drawLabels(w: number, h: number): void {
  const full: Rect = { x: 0, y: 0, w, h }
  let used = 0
  for (const label of labels) {
    const cam = label.view === 'band' ? bandCam : camera
    const rect = label.view === 'band' ? bandRectState : full
    if (!rect) continue
    let alpha = label.alpha
    let world: THREE.Vector3
    if (label.dir) {
      world = label.dir.clone().multiplyScalar(TRAIL_R).add(cam.position)
      if (label.view === 'main') alpha *= skyAlphaMain
    } else {
      world = label.world!
    }
    if (alpha < 0.02) continue
    const s = project(world, cam, rect)
    if (!s.ok) continue
    if (s.x < rect.x || s.x > rect.x + rect.w || s.y < rect.y || s.y > rect.y + rect.h) continue
    if (label.view === 'main' && !lensState.full) {
      if (Math.hypot(s.x - lensState.cx, s.y - lensState.cy) > lensState.r - 6) continue
    }
    let el = labelPool[used]
    if (!el) {
      el = document.createElement('div')
      labelPool.push(el)
      labelLayer.appendChild(el)
    }
    used += 1
    el.className = `tag tag-${label.kind}`
    if (el.textContent !== label.text) el.textContent = label.text
    el.style.transform = `translate(${(s.x + label.dx).toFixed(1)}px, ${(s.y + label.dy).toFixed(1)}px)`
    el.style.opacity = alpha.toFixed(3)
    el.style.color = label.color ?? ''
    el.hidden = false
  }
  for (let i = used; i < labelPool.length; i += 1) labelPool[i].hidden = true
}

/** Pointer → direction on the sky, through the main camera. */
export function pointerToSky(x: number, y: number, w: number, h: number): { lon: number; lat: number } {
  const ndc = new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1)
  const ray = new THREE.Raycaster()
  ray.setFromCamera(ndc, camera)
  return dirToLonLat(ray.ray.direction)
}

/** Pointer → heliocentric point on the ecliptic plane (AU). */
export function pointerToPlane(x: number, y: number, w: number, h: number): { x: number; y: number } | null {
  const ndc = new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1)
  const ray = new THREE.Raycaster()
  ray.setFromCamera(ndc, camera)
  const hit = new THREE.Vector3()
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null
  return { x: hit.x / AU, y: -hit.z / AU }
}

export function screenOf(pos: Vec3, w: number, h: number): { x: number; y: number } {
  return project(toV(pos), camera, { x: 0, y: 0, w, h })
}

export function screenOfSky(lon: number, lat: number, w: number, h: number): { x: number; y: number } {
  const p = skyDir(lon, lat).multiplyScalar(TRAIL_R).add(camera.position)
  return project(p, camera, { x: 0, y: 0, w, h })
}

export function lens(): { cx: number; cy: number; r: number; full: boolean } {
  return lensState
}
