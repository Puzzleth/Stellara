import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import './style.css'
import { playSolve, playTick, playWrong, setSound, soundEnabled, startMusic } from './audio.ts'
import { drawStrip, type ChartTrail } from './chart.ts'
import { bandRect, clamp, ease, lensRadius, midAngle } from './geom.ts'
import { LEVELS } from './levels.ts'
import {
  DEG,
  EARTH,
  FRAME,
  KITE,
  MARS,
  MERCURY,
  SUN_DISC,
  TAU,
  TRANSIT_DAY,
  VENUS,
  agreementFromError,
  bodyAt,
  fitPathError,
  frameEarth,
  frameError,
  jumpAngle,
  keplerPeriod,
  kiteLook,
  level1Window,
  lookBetween,
  marsLook,
  observe,
  parallaxDistance,
  parallaxTimes,
  signedDelta,
  sunLook,
  transitPhase,
  venusLook,
  venusOnSun,
  wrap,
  type BodySpec,
  type Vec3,
} from './sim.ts'
import { enterSandbox, frameSandbox, initSandbox, sandboxKey } from './sandbox.ts'
import { STARS } from './stars.ts'
import {
  GUESS,
  apparentRadius,
  beginFrame,

  circle,
  initWorld,
  labelAt,
  labelSky,
  lens,
  mount,
  placeBody,
  pointerToPlane,
  pointerToSky,
  render,
  screenOf,
  screenOfSky,
  skyLine,
  systemScale,
  worldLine,
  type ViewSpec,
} from './world.ts'

type ViewName = 'telescope' | 'system'
type DragMode = 'pan' | 'band' | 'marker' | 'venus' | 'kite' | 'none'

type Save = { cleared: boolean[]; sound: boolean }

const L1 = level1Window()
const SAVE_KEY = 'stellaras-progress'
/** Saves from before the rename, read once so nobody loses their nights. */
const OLD_SAVE_KEY = 'stellara-progress'
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }
/** Angular radius planets get through the eyepiece. Real planets are far smaller. */
const PLANET_DISC = 0.011
const LEVEL1_LAT = 6.5 * DEG

const COLORS = {
  earthOrbit: '#8ec8f0',
  marsOrbit: '#e2785b',
  venusOrbit: '#f3d7a4',
  faintOrbit: '#6b5d45',
  ring: '#4a3f2c',
  mars: '#e2785b',
  sun: '#ffc45a',
  sight: '#f3ecdf',
}

const homeEl = document.querySelector<HTMLElement>('#home')!
const playEl = document.querySelector<HTMLElement>('#play')!
const levelList = document.querySelector<HTMLElement>('#level-list')!
const panel = document.querySelector<HTMLElement>('#panel')!
const homeWell = document.querySelector<HTMLElement>('#home-well')!
const playWell = document.querySelector<HTMLElement>('#play-well')!
const homeCaption = document.querySelector<HTMLElement>('#home-caption')!
const playNote = document.querySelector<HTMLElement>('#play-note')!
const strip = document.querySelector<SVGSVGElement>('#strip')!
const backBtn = document.querySelector<HTMLButtonElement>('#back')!
const tabTelescope = document.querySelector<HTMLButtonElement>('#tab-telescope')!
const tabSystem = document.querySelector<HTMLButtonElement>('#tab-system')!
const dayLabel = document.querySelector<HTMLElement>('#day-label')!
const soundBtn = document.querySelector<HTMLButtonElement>('#sound')!
const crumbTitle = document.querySelector<HTMLElement>('#crumb-title')!
const crumbConcept = document.querySelector<HTMLElement>('#crumb-concept')!
const crumbPill = document.querySelector<HTMLElement>('#crumb-pill')!
const sandboxEl = document.querySelector<HTMLElement>('#sandbox')!
const sandboxWell = document.querySelector<HTMLElement>('#sb-well')!

const state = {
  screen: 'title' as 'title' | 'play' | 'sandbox',
  level: 0,
  view: 'telescope' as ViewName,
  mix: 0,
  frameMix: 0,
  time: L1.t0,
  playing: false,
  pan: 0,
  marker: null as { lon: number; lat: number } | null,
  venusPhase: 0,
  kite: { x: 1.55, y: 0.85 },
  station: 0 as 0 | 1,
  radius: 2.85,
  epiR: 0.42,
  defPeriod: 520,
  unlocked: false,
  solved: false,
  hint: 0,
  message: '',
  lesson: null as string | null,
}

let save = loadSave()
setSound(save.sound)
let ready = false

type Drag = {
  id: number
  x: number
  y: number
  lastX: number
  moved: boolean
  mode: DragMode
}
let drag: Drag | null = null

function loadSave(): Save {
  const empty = { cleared: [false, false, false, false, false], sound: true }
  try {
    const raw = localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(OLD_SAVE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Save
    if (!Array.isArray(parsed.cleared) || parsed.cleared.length !== 5) return empty
    return { cleared: parsed.cleared.map(Boolean), sound: parsed.sound !== false }
  } catch {
    return empty
  }
}

function writeSave(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
  } catch {
    // Private windows can refuse storage; progress then lasts for the visit.
  }
}

function orbitOf(spec: BodySpec, n = 160): Vec3[] {
  const pts: Vec3[] = []
  for (let i = 0; i <= n; i += 1) pts.push(bodyAt(spec, (i / n) * spec.period))
  return pts
}

const EARTH_ORBIT = orbitOf(EARTH)
const MARS_ORBIT = orbitOf(MARS)
const VENUS_ORBIT = orbitOf(VENUS)
const MERCURY_ORBIT = orbitOf(MERCURY)

function guessSpec(radius: number): BodySpec {
  return {
    name: 'Guess',
    color: GUESS,
    radius,
    period: keplerPeriod(radius),
    phase: MARS.phase,
    inc: MARS.inc,
    node: MARS.node,
  }
}

function timeBounds(): { min: number; max: number } | null {
  if (state.level === 0) return { min: L1.t0, max: L1.t1 }
  if (state.level === 3) return { min: 40, max: 640 }
  if (state.level === 4) return { min: 0, max: 740 }
  return null
}

function maxAU(): number {
  if (state.level === 0) return 2.0
  if (state.level === 1) return 1.3
  if (state.level === 2) return 4.4
  if (state.level === 3) return Math.max(2.1, state.radius + 0.6)
  return 2.75
}

function venusCloser(phase: number): boolean {
  const venus = bodyAt(VENUS, TRANSIT_DAY, phase)
  const earth = bodyAt(EARTH, TRANSIT_DAY)
  return Math.hypot(venus.x - earth.x, venus.y - earth.y) < Math.hypot(earth.x, earth.y)
}

function renderLevels(): void {
  levelList.innerHTML = `<ol class="levels">${LEVELS.map(
    (level, i) => `
      <li>
        <button type="button" data-level="${i}">
          <span class="numeral">${level.numeral}</span>
          <span class="row-main">
            <span class="row-title">${level.title}</span>
            <span class="row-sub">${level.concept}</span>
          </span>
          ${save.cleared[i] ? '<span class="pill">Solved</span>' : '<span class="row-open">Open</span>'}
        </button>
      </li>`,
  ).join('')}</ol>`
}

function updateTabs(): void {
  const frames = state.level === 4
  tabTelescope.textContent = frames ? 'From Earth' : state.level === 3 ? 'Record' : 'Telescope'
  tabSystem.textContent = frames ? 'From the Sun' : 'System'
  tabTelescope.setAttribute('aria-selected', state.view === 'telescope' ? 'true' : 'false')
  tabSystem.setAttribute('aria-selected', state.view === 'system' ? 'true' : 'false')
}

function paintSound(): void {
  soundBtn.textContent = soundEnabled() ? 'Sound on' : 'Sound off'
  soundBtn.setAttribute('aria-pressed', soundEnabled() ? 'true' : 'false')
}

function paintCrumb(): void {
  const level = LEVELS[state.level]
  crumbTitle.textContent = `${level.numeral}. ${level.title}`
  crumbConcept.textContent = level.concept
  crumbPill.hidden = !state.solved
}

function showTitle(): void {
  state.screen = 'title'
  state.playing = false
  homeEl.hidden = false
  playEl.hidden = true
  sandboxEl.hidden = true
  document.title = 'Stellaras'
  mount(homeWell)
  renderLevels()
}

function showPlay(): void {
  homeEl.hidden = true
  playEl.hidden = false
  document.title = `${LEVELS[state.level].title} · Stellaras`
  mount(playWell)
}

function showSandbox(): void {
  state.screen = 'sandbox'
  homeEl.hidden = true
  playEl.hidden = true
  sandboxEl.hidden = false
  document.title = 'Sandbox · Stellaras'
  mount(sandboxWell)
  enterSandbox()
}

function setView(view: ViewName): void {
  if (state.level === 4 && view === 'system' && !state.unlocked) {
    setMessage('Match the loops first. The simpler frame is the reward.')
    playWrong()
    return
  }
  if (state.view !== view) playTick()
  state.view = view
  updateTabs()
}

function setMessage(text: string): void {
  state.message = text
  const el = document.getElementById('message')
  if (el) el.textContent = text
}

function solve(lesson: string): void {
  if (state.solved) return
  state.solved = true
  state.lesson = lesson
  state.playing = false
  state.message = ''
  save.cleared[state.level] = true
  writeSave()
  playSolve()
  buildPanel(false)
  paintCrumb()
  renderLevels()
}

function hintHTML(): string {
  return LEVELS[state.level].hints
    .slice(0, state.hint)
    .map((hint) => `<p class="hint">${hint}</p>`)
    .join('')
}

function lessonHTML(): string {
  return state.lesson ? `<div class="lesson"><h3>What you saw</h3><p>${state.lesson}</p></div>` : ''
}

function nextLabel(): string {
  return state.level === 4 ? 'Back to all nights' : 'Next night'
}

function actionsHTML(action: string): string {
  const hintsLeft = LEVELS[state.level].hints.length - state.hint
  return `<div class="actions">
    <button type="button" class="primary" data-action="${state.solved ? 'next' : 'check'}">${state.solved ? nextLabel() : action}</button>
    ${state.solved ? '' : `<button type="button" class="secondary" data-action="hint"${hintsLeft ? '' : ' disabled'}>${hintsLeft ? `Hint (${hintsLeft} left)` : 'No hints left'}</button>`}
  </div>`
}

function timeControl(min: number, max: number, left: string, right: string): string {
  return `<div class="control">
    <div class="control-row"><span>${left}</span><span id="dial-readout" class="num"></span><span>${right}</span></div>
    <input data-slider="time" aria-label="Time" type="range" min="${min}" max="${max}" step="0.5" value="${state.time}" />
    <div class="row-buttons">
      <button type="button" class="secondary" data-action="nudge" data-days="-7">−7 days</button>
      <button type="button" class="secondary" id="play-toggle" data-action="play">Play</button>
      <button type="button" class="secondary" data-action="nudge" data-days="7">+7 days</button>
    </div>
  </div>`
}

function slider(key: string, label: string, readout: string, min: number, max: number, step: number, value: number): string {
  return `<div class="control">
    <label class="control-row" for="slider-${key}"><span>${label}</span><span id="${readout}" class="num"></span></label>
    <input id="slider-${key}" data-slider="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
  </div>`
}

function buildPanel(focus: boolean): void {
  const level = LEVELS[state.level]
  const meter =
    state.level >= 3
      ? `<div class="meter-block">
          <div class="control-row"><span>Agreement with the record</span><span id="meter-value" class="num"></span></div>
          <div class="meter" aria-hidden="true"><span id="meter-bar"></span></div>
        </div>`
      : ''
  let controls = ''
  if (state.level === 0) {
    controls = timeControl(L1.t0, L1.t1, 'Tonight', `+${Math.round(L1.t1 - L1.t0)} days`)
  } else if (state.level === 2) {
    controls = `<div class="segmented" role="group" aria-label="Observation night">
      <button type="button" data-action="station" data-which="0">Night A</button>
      <button type="button" data-action="station" data-which="1">Night B</button>
    </div>`
  } else if (state.level === 3) {
    controls = `${timeControl(40, 640, 'Start of record', 'End')}
      ${slider('radius', 'Orbit size', 'radius-readout', 0.45, 5, 0.01, state.radius)}`
  } else if (state.level === 4) {
    controls = `${timeControl(0, 740, 'Trace', 'Two years')}
      ${slider('epi', 'Small circle', 'epi-readout', 0.25, 1.6, 0.01, state.epiR)}
      ${slider('period', 'Big circle’s year', 'period-readout', 420, 980, 1, state.defPeriod)}`
  }

  panel.innerHTML = `
    <h2 tabindex="-1">${level.ask}</h2>
    <p class="help">${level.help}</p>
    ${controls}
    ${meter}
    <p id="status" class="status"></p>
    <p id="message" class="message" role="status">${state.message}</p>
    <div id="hints">${hintHTML()}</div>
    ${lessonHTML()}
    ${actionsHTML(level.action)}
  `
  if (focus) panel.querySelector('h2')?.focus({ preventScroll: true })
}

function statusText(): string {
  if (state.solved && state.level === 0) return 'The white trail is where Mars actually went.'
  if (state.level === 0) {
    if (!state.marker) return 'Tap the sky in the telescope to place your mark.'
    if (state.time < L1.t1 - 1) return 'Your mark is set. Now take the dial to the last night.'
    return 'In the sky band, your mark should sit on Mars.'
  }
  if (state.level === 1) {
    const sep = lookBetween(sunLook(TRANSIT_DAY), venusLook(state.venusPhase))
    if (venusOnSun(state.venusPhase)) return 'Venus is crossing the Sun.'
    if (!venusCloser(state.venusPhase) && sep < 0.28) return 'Venus is behind the Sun. Bring it in front.'
    return `Venus is ${(sep / DEG).toFixed(0)}° from the centre of the Sun.`
  }
  if (state.level === 2) {
    const measured = jumpAngle(KITE) / DEG
    const predicted = jumpAngle({ x: state.kite.x, y: state.kite.y, z: 0 }) / DEG
    const dist = Math.hypot(state.kite.x, state.kite.y)
    return `Your mark is ${dist.toFixed(1)} AU out. From there the jump would be ${predicted.toFixed(0)}°. The two nights measured ${measured.toFixed(0)}°.`
  }
  if (state.level === 3) {
    const side = state.radius < 1 ? 'Inside Earth’s orbit' : 'Outside Earth’s orbit'
    return `${side}, with a year of ${Math.round(keplerPeriod(state.radius))} days.`
  }
  return state.unlocked ? 'The loops agree. Change the frame.' : 'Match the curve to the recorded dots.'
}

function meterValue(): number {
  if (state.level === 3) return agreementFromError(fitPathError(state.radius), 0.55)
  if (state.level === 4) return agreementFromError(frameError(state.epiR, state.defPeriod), 0.85)
  return 0
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id)
  if (el && el.textContent !== text) el.textContent = text
}

function syncReadouts(): void {
  let day = ''
  if (state.level === 0 || state.level === 3) day = `Day ${Math.round(state.time)}`
  else if (state.level === 1) day = `Day ${TRANSIT_DAY}`
  else if (state.level === 2) day = state.station === 0 ? 'Night A' : 'Night B'
  else day = state.view === 'system' ? 'Sun at the centre' : 'Earth at the centre'
  if (dayLabel.textContent !== day) dayLabel.textContent = day

  setText('dial-readout', `Day ${Math.round(state.time)}`)
  const timeSlider = panel.querySelector<HTMLInputElement>('[data-slider="time"]')
  if (timeSlider && document.activeElement !== timeSlider) timeSlider.value = String(state.time)
  setText('play-toggle', state.playing ? 'Pause' : 'Play')
  setText('status', statusText())
  const pct = Math.round(meterValue() * 100)
  setText('meter-value', `${pct}%`)
  const bar = document.getElementById('meter-bar')
  if (bar) bar.style.transform = `scaleX(${pct / 100})`
  setText('radius-readout', `${state.radius.toFixed(2)} AU`)
  setText('epi-readout', `${state.epiR.toFixed(2)} AU`)
  setText('period-readout', `${Math.round(state.defPeriod)} days`)
  panel.querySelectorAll<HTMLButtonElement>('[data-action="station"]').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.which === String(state.station) ? 'true' : 'false')
  })
}

function sampleLook(spec: BodySpec, t0: number, t1: number, step: number, phase = spec.phase): { lon: number; lat: number }[] {
  const pts: { lon: number; lat: number }[] = []
  for (let t = t0; t <= t1; t += step) {
    const look = observe(bodyAt(spec, t, phase), bodyAt(EARTH, t))
    pts.push({ lon: look.lon, lat: look.lat })
  }
  return pts
}

const SUN_BODY: BodySpec = { name: 'Sun', color: '#ffb627', radius: 0, period: 365.25, phase: 0, inc: 0, node: 0 }

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** A body that reads as a disc through the eyepiece and as a marker on the chart. */
function bodySize(observer: Vec3, pos: Vec3, sys: number, e: number, angle = PLANET_DISC): number {
  return lerp(apparentRadius(observer, pos, angle), sys, e)
}

function ray(key: string, from: Vec3, ang: number, length: number, color: string, opts: { dashed?: boolean; width?: number; opacity?: number } = {}): void {
  worldLine(key, [from, { x: from.x + Math.cos(ang) * length, y: from.y + Math.sin(ang) * length, z: 0 }], {
    color,
    width: opts.width ?? 1.6,
    opacity: opts.opacity ?? 0.9,
    dashed: opts.dashed,
    dash: 0.6,
  })
}

/** A line of sight from one body through another, in 3D, so it really passes through a tilted orbit. */
function sightThrough(key: string, from: Vec3, to: Vec3, stretch: number): void {
  const end = { x: from.x + (to.x - from.x) * stretch, y: from.y + (to.y - from.y) * stretch, z: from.z + (to.z - from.z) * stretch }
  worldLine(key, [from, end], { color: COLORS.mars, width: 1.5, opacity: 0.85, dashed: true, dash: 0.5 })
}

function auRings(rings: number[], alpha: number): void {
  for (const au of rings) {
    worldLine(`ring-${au}`, circle(0, 0, au), { color: COLORS.ring, width: 1, opacity: alpha })
    labelAt(`${au} AU`, { x: 0, y: au, z: 0 }, 'ring-label', { dx: 6, dy: -4, alpha })
  }
}

function namedStarLabels(view: 'main' | 'band', alpha = 1): void {
  for (const star of STARS) {
    if (star.name) labelSky(star.name, star.lon, star.lat, 'star', view, { dy: -12, alpha })
  }
}

function wellSize(well: HTMLElement): { w: number; h: number } {
  const rect = well.getBoundingClientRect()
  return { w: Math.round(rect.width), h: Math.round(rect.height) }
}

function baseSpec(w: number, h: number): ViewSpec {
  return {
    w,
    h,
    mix: state.mix,
    observer: bodyAt(EARTH, state.time),
    pan: state.pan,
    lookLat: 0,
    pxPerRad: (Math.min(w, h) * 0.84) / 0.98,
    lens: true,
    sysRadiusAU: maxAU(),
  }
}

function frameLevel0(spec: ViewSpec): void {
  const e = ease(state.mix)
  const tRender = L1.t0 + (state.time - L1.t0) * e
  const earth = bodyAt(EARTH, tRender)
  const mars = bodyAt(MARS, tRender)
  const sys = systemScale(spec)
  spec.observer = earth
  spec.lookLat = LEVEL1_LAT
  spec.reserveTop = bandRect(spec.w, spec.h).h + 24
  spec.band = {
    observer: bodyAt(EARTH, state.time),
    pan: state.pan,
    lookLat: LEVEL1_LAT,
    pxPerRad: bandRect(spec.w, spec.h).w / 1.6,
    rect: bandRect(spec.w, spec.h),
  }

  placeBody('sun', 'sun', ORIGIN, lerp(apparentRadius(earth, ORIGIN, 0.03), sys * 1.7, e), { spin: tRender * 0.01 })
  placeBody('earth', 'earth', earth, sys * e, { spin: tRender * 0.3 })
  placeBody('mars', 'mars', mars, bodySize(earth, mars, sys * 0.85, e), { spin: tRender * 0.3 })
  labelAt('Mars', mars, 'body', { dy: -18 })
  labelAt('Earth', earth, 'body', { dy: -18, alpha: e })
  labelAt('Sun', ORIGIN, 'body', { dy: -24, alpha: e })

  const past = sampleLook(MARS, L1.t0 - 80, L1.t0, 1.5)
  skyLine('past', past, { color: COLORS.mars, width: 2, opacity: 0.9 })
  if (state.solved) skyLine('full', sampleLook(MARS, L1.t0, L1.t1, 1.5), { color: '#f3ecdf', width: 2, opacity: 0.85 })
  skyLine('ecliptic', circleOnSky(), { color: '#e0c089', width: 1, opacity: 0.35, dashed: true, dash: 0.01 })
  skyLine('ecliptic', circleOnSky(), { color: '#e0c089', width: 1, opacity: 0.35, dashed: true, dash: 0.01 }, 'band')
  namedStarLabels('main')
  if (state.marker) {
    labelSky('', state.marker.lon, state.marker.lat, 'mark')
    labelSky('Your mark', state.marker.lon, state.marker.lat, 'star', 'main', { dy: -12, color: GUESS })
  }

  skyLine('band-past', past, { color: COLORS.mars, width: 2, opacity: 0.5 }, 'band')
  skyLine('band-future', sampleLook(MARS, L1.t0, state.time, 1.5), { color: COLORS.mars, width: 2.4 }, 'band')
  const dial = marsLook(state.time)
  labelSky('Mars', dial.lon, dial.lat, 'dot', 'band', { color: COLORS.mars })
  if (state.marker) labelSky('', state.marker.lon, state.marker.lat, 'mark', 'band')
  namedStarLabels('band')
  labelSky('Sky from Earth tonight', state.pan + 0.7, LEVEL1_LAT - 0.13, 'note', 'band')

  worldLine('earth-orbit', EARTH_ORBIT, { color: COLORS.earthOrbit, width: 1.4, opacity: 0.75 })
  worldLine('mars-orbit', MARS_ORBIT, { color: COLORS.marsOrbit, width: 1.4, opacity: 0.75 })
  sightThrough('sight', earth, mars, 4)
  if (state.marker) ray('mark-ray', earth, state.marker.lon, 6, GUESS, { dashed: true })
  auRings([1], e)
}

function circleOnSky(): { lon: number; lat: number }[] {
  const pts: { lon: number; lat: number }[] = []
  for (let i = 0; i <= 180; i += 1) pts.push({ lon: (i / 180) * TAU, lat: 0 })
  return pts
}

function frameLevel1(spec: ViewSpec): void {
  const e = ease(state.mix)
  const earth = bodyAt(EARTH, TRANSIT_DAY)
  const venus = bodyAt(VENUS, TRANSIT_DAY, state.venusPhase)
  const sys = systemScale(spec)
  const lensR = lensRadius(spec.w, spec.h)
  spec.observer = earth
  spec.pan = sunLook(TRANSIT_DAY).lon
  spec.pxPerRad = (lensR * 0.36) / SUN_DISC

  placeBody('sun', 'sun', ORIGIN, bodySize(earth, ORIGIN, sys * 1.8, e, SUN_DISC), { spin: 0.4 })
  placeBody('earth', 'earth', earth, sys * e, { spin: 1.2 })
  placeBody('venus', 'venus', venus, bodySize(earth, venus, sys * 0.9, e, 0.0085), { spin: 0.2 })
  labelAt('Venus', venus, 'body', { dy: lerp(-16, -20, e) })
  labelAt('Earth', earth, 'body', { dy: -20, alpha: e })
  labelAt('Sun', ORIGIN, 'body', { dy: -28, alpha: e })

  worldLine('venus-orbit', VENUS_ORBIT, { color: COLORS.venusOrbit, width: 1.4, opacity: 0.8 })
  worldLine('earth-orbit', EARTH_ORBIT, { color: COLORS.earthOrbit, width: 1.4, opacity: 0.75 })
  ray('sun-ray', earth, sunLook(TRANSIT_DAY).lon, 1.6, COLORS.sun, { opacity: 0.8 })

  const look = venusLook(state.venusPhase)
  const sep = lookBetween(sunLook(TRANSIT_DAY), look)
  playNote.textContent = state.view === 'telescope' && sep > 0.42 ? 'Venus is outside the eyepiece. Move it in the system view.' : ''
}

function frameLevel2(spec: ViewSpec): void {
  const e = ease(state.mix)
  const { tA, tB } = parallaxTimes()
  const earthA = bodyAt(EARTH, tA)
  const earthB = bodyAt(EARTH, tB)
  const station = state.station === 0 ? earthA : earthB
  const lookA = kiteLook(earthA)
  const lookB = kiteLook(earthB)
  const sys = systemScale(spec)
  const guess: Vec3 = { x: state.kite.x, y: state.kite.y, z: 0 }
  spec.observer = station
  spec.pxPerRad = (Math.min(spec.w, spec.h) * 0.84) / 1.28

  placeBody('sun', 'sun', ORIGIN, lerp(apparentRadius(station, ORIGIN, 0.03), sys * 1.5, e), { spin: 0.3 })
  placeBody('earth-a', 'earth', earthA, state.station === 0 ? sys * e : sys * 0.9, { spin: 0.4 })
  placeBody('earth-b', 'earth', earthB, state.station === 1 ? sys * e : sys * 0.9, { spin: 2.1 })
  if (e < 0.03 || state.solved) placeBody('kite', 'kite', KITE, bodySize(station, KITE, sys * 1.1, e, 0.02), { spin: 0.6 })
  placeBody('kite-guess', 'kite', guess, sys * 1.1 * e, { guess: true, spin: 0.6 })

  const other = state.station === 0 ? lookB : lookA
  const current = state.station === 0 ? lookA : lookB
  labelSky('', other.lon, other.lat, 'ring')
  labelSky(state.station === 0 ? 'Night B' : 'Night A', other.lon, other.lat, 'star', 'main', { dy: -16, color: COLORS.sun })
  labelSky('Kite', current.lon, current.lat, 'star', 'main', { dy: -22, color: '#f3ecdf' })
  namedStarLabels('main')

  labelAt('Night A', earthA, 'body', { dy: -18, alpha: state.station === 0 ? e : 1 })
  labelAt('Night B', earthB, 'body', { dy: -18, alpha: state.station === 1 ? e : 1 })
  labelAt('Your Kite', guess, 'body', { dy: -20, alpha: e, color: GUESS })
  if (state.solved) labelAt('Kite', KITE, 'body', { dy: 24, alpha: e })
  worldLine('earth-orbit', EARTH_ORBIT, { color: COLORS.earthOrbit, width: 1.4, opacity: 0.75 })
  ray('ray-a', earthA, lookA.lon, 6, '#f3ecdf', { opacity: 0.85 })
  ray('ray-b', earthB, lookB.lon, 6, '#e0c089', { opacity: 0.85 })
  auRings([1, 2, 3, 4], e)
  playNote.textContent = state.view === 'telescope' ? (state.station === 0 ? 'Night A' : 'Night B, half a year later') : ''
}

function frameLevel3(spec: ViewSpec): void {
  const earth = bodyAt(EARTH, state.time)
  const guessPos = bodyAt(guessSpec(state.radius), state.time)
  const sys = systemScale(spec)
  spec.mix = 1
  spec.lens = false

  placeBody('sun', 'sun', ORIGIN, sys * 1.7, { spin: 0.2 })
  placeBody('earth', 'earth', earth, sys, { spin: state.time * 0.3 })
  placeBody('guess', 'mars', guessPos, sys * 0.9, { guess: true, spin: state.time * 0.2 })
  labelAt('Earth', earth, 'body', { dy: -18 })
  labelAt('Your planet', guessPos, 'body', { dy: -18, color: GUESS })
  worldLine('earth-orbit', EARTH_ORBIT, { color: COLORS.earthOrbit, width: 1.4, opacity: 0.75 })
  worldLine('guess-orbit', orbitOf(guessSpec(state.radius)), { color: GUESS, width: 1.6, opacity: 0.9, dashed: true, dash: 0.5 })
  if (state.solved) worldLine('mars-orbit', MARS_ORBIT, { color: COLORS.marsOrbit, width: 1.6, opacity: 0.9 })
  ray('guess-sight', earth, observe(guessPos, earth).lon, 3.2, GUESS, { dashed: true, opacity: 0.7 })
  auRings([1], 1)
}

function paintStrip(w: number, h: number): void {
  const recNow = observe(bodyAt(MARS, state.time), bodyAt(EARTH, state.time))
  const ghostNow = observe(bodyAt(guessSpec(state.radius), state.time), bodyAt(EARTH, state.time))
  const trails: ChartTrail[] = [
    { pts: sampleLook(SUN_BODY, 40, 640, 6), color: COLORS.sun, width: 1, opacity: 0.45 },
    { pts: sampleLook(MARS, 40, 640, 3), color: COLORS.mars, width: 2.2, opacity: 0.95 },
    { pts: sampleLook(guessSpec(state.radius), 40, 640, 3), color: GUESS, width: 2, opacity: 0.95, dashed: true },
  ]
  drawStrip(strip, w, h, trails, [
    { lon: recNow.lon, lat: recNow.lat, color: COLORS.mars, label: 'Recorded' },
    { lon: ghostNow.lon, lat: ghostNow.lat, color: GUESS, label: 'Yours', ring: true },
  ])
}

function frameLevel4(spec: ViewSpec): void {
  const m = ease(state.frameMix)
  const t = state.time
  const sys = systemScale(spec)
  spec.mix = 1
  spec.lens = false
  spec.elevation = 66 * DEG

  const E = (τ: number) => frameEarth(τ)
  const def = (τ: number, period: number) => {
    const a = FRAME.defPhase + (TAU * τ) / period
    return { x: FRAME.defR * Math.cos(a), y: FRAME.defR * Math.sin(a) }
  }
  // Slide the centre from Earth to the Sun: every point shifts by the part of Earth's motion not yet undone.
  const shown = (p: { x: number; y: number }, τ: number, k = 1): Vec3 => {
    const earth = E(τ)
    return { x: p.x - (1 - m) * k * earth.x, y: p.y - (1 - m) * k * earth.y, z: 0 }
  }
  const earthNow = E(t)
  const earthShown: Vec3 = { x: m * earthNow.x, y: m * earthNow.y, z: 0 }
  const sunShown: Vec3 = { x: -(1 - m) * earthNow.x, y: -(1 - m) * earthNow.y, z: 0 }
  const centre = def(t, state.defPeriod)
  const planet = shown(centre, t, state.epiR)

  placeBody('sun', 'sun', sunShown, sys * lerp(1.1, 1.7, m), { spin: t * 0.01 })
  placeBody('earth', 'earth', earthShown, sys, { spin: t * 0.3 })
  placeBody('planet', 'mars', planet, sys * 0.9, { spin: t * 0.2 })

  worldLine('deferent', circle(0, 0, FRAME.defR), { color: lerp(0, 1, m) > 0.5 ? COLORS.marsOrbit : '#e0c089', width: 1.4, opacity: 0.8 })
  const epiCentre = { x: centre.x, y: centre.y, z: 0 }
  if (m < 0.98) worldLine('epicycle', circle(epiCentre.x, epiCentre.y, Math.max(0.001, (1 - m) * state.epiR), 72), { color: COLORS.mars, width: 1.4, opacity: 0.85 })
  if (m > 0.02) worldLine('earth-orbit', circle(0, 0, m, 128), { color: COLORS.earthOrbit, width: 1.4, opacity: 0.8 * m })

  const trace: Vec3[] = []
  for (let i = 0; i <= 220; i += 1) {
    const τ = (i / 220) * 740
    trace.push(shown(def(τ, state.defPeriod), τ, state.epiR))
  }
  worldLine('trace', trace, { color: GUESS, width: 2, opacity: 0.95 })
  for (let i = 0; i <= 48; i += 1) {
    const τ = (i / 48) * 740
    labelAt('', shown(def(τ, FRAME.defPeriod), τ, FRAME.epiR), 'dot', { alpha: 0.9 })
  }
  worldLine('sight', [earthShown, planet], { color: COLORS.sight, width: 1.2, opacity: 0.6, dashed: true, dash: 0.25 })
  labelAt('Earth', earthShown, 'body', { dy: -18 })
  labelAt('Planet', planet, 'body', { dy: -18 })
  labelAt('Sun', sunShown, 'body', { dy: -22 })
  playNote.textContent = m < 0.5 ? 'Earth held still at the centre' : 'The Sun at the centre'
}

function framePlay(): void {
  const { w, h } = wellSize(playWell)
  if (w < 2 || h < 2) return
  beginFrame()
  playNote.textContent = ''
  const spec = baseSpec(w, h)
  if (state.level === 0) frameLevel0(spec)
  else if (state.level === 1) frameLevel1(spec)
  else if (state.level === 2) frameLevel2(spec)
  else if (state.level === 3) frameLevel3(spec)
  else frameLevel4(spec)

  const showStrip = state.level === 3
  strip.style.opacity = showStrip ? String(1 - ease(state.mix)) : '0'
  strip.style.visibility = showStrip && state.mix < 0.99 ? 'visible' : 'hidden'
  if (showStrip && state.mix < 0.99) paintStrip(w, h)
  render(spec)
}

let homeDay = 130
function frameTitle(clock: number, dt: number): void {
  const { w, h } = wellSize(homeWell)
  if (w < 2 || h < 2) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduced) homeDay += dt * 9
  const day = homeDay
  beginFrame()
  const spec: ViewSpec = {
    w,
    h,
    mix: 1,
    observer: bodyAt(EARTH, day),
    pan: 0,
    lookLat: 0,
    pxPerRad: 600,
    lens: false,
    sysRadiusAU: w < 640 ? 1.75 : 1.6,
    azimuth: reduced ? 0.3 : 0.3 + clock * 0.018,
    elevation: 34 * DEG,
  }
  const sys = 0.55
  const earth = bodyAt(EARTH, day)
  const mars = bodyAt(MARS, day)
  placeBody('sun', 'sun', ORIGIN, 0.85, { spin: clock * 0.05 })
  placeBody('mercury', 'mercury', bodyAt(MERCURY, day), sys * 0.55, { spin: clock * 0.2 })
  placeBody('venus', 'venus', bodyAt(VENUS, day), sys * 0.85, { spin: clock * 0.1 })
  placeBody('earth', 'earth', earth, sys, { spin: clock * 0.4 })
  placeBody('mars', 'mars', mars, sys * 0.75, { spin: clock * 0.35 })
  worldLine('t-mercury', MERCURY_ORBIT, { color: COLORS.faintOrbit, width: 1, opacity: 0.8 })
  worldLine('t-venus', VENUS_ORBIT, { color: COLORS.faintOrbit, width: 1, opacity: 0.8 })
  worldLine('t-earth', EARTH_ORBIT, { color: COLORS.earthOrbit, width: 1.2, opacity: 0.8 })
  worldLine('t-mars', MARS_ORBIT, { color: COLORS.marsOrbit, width: 1.2, opacity: 0.8 })
  const look = observe(mars, earth)
  sightThrough('t-sight', earth, mars, 2.6)
  labelAt('Earth', earth, 'body', { dy: -18 })
  labelAt('Mars', mars, 'body', { dy: -16 })

  const ahead = observe(bodyAt(MARS, day + 1), bodyAt(EARTH, day + 1))
  const backward = signedDelta(look.lon, ahead.lon) < 0
  const caption = `Day ${Math.round(day)} · Mars ${backward ? 'drifting backward against the stars' : 'moving east against the stars'}`
  if (homeCaption.textContent !== caption) homeCaption.textContent = caption
  render(spec)
}

function grade(): void {
  if (state.solved) return
  if (state.level === 0) {
    if (state.time < L1.t1 - 1) {
      setMessage('Take the dial to the last night. The question is about that sky.')
      playWrong()
      return
    }
    if (!state.marker) {
      setMessage('Tap the sky in the telescope to place your mark.')
      playWrong()
      return
    }
    const target = marsLook(L1.t1)
    const missLon = Math.abs(signedDelta(state.marker.lon, target.lon))
    const missLat = Math.abs(state.marker.lat - target.lat)
    if (missLon < 8 * DEG && missLat < 8 * DEG) solve(LEVELS[0].success)
    else if (missLon < 16 * DEG && missLat < 14 * DEG) {
      setMessage('Close. In the sky band, see which stars Mars sits between at the end of the dial.')
      playWrong()
    } else {
      setMessage('That is a different part of the sky. Watch the line of sight swing, then find those stars.')
      playWrong()
    }
    return
  }
  if (state.level === 1) {
    if (venusOnSun(state.venusPhase)) solve(LEVELS[1].success)
    else if (!venusCloser(state.venusPhase)) {
      setMessage('Venus is behind the Sun. A transit needs it between you and the Sun.')
      playWrong()
    } else {
      setMessage('Not on the disc yet. In the system view, set Venus on the line from Earth to the Sun.')
      playWrong()
    }
    return
  }
  if (state.level === 2) {
    const miss = Math.hypot(state.kite.x - KITE.x, state.kite.y - KITE.y)
    if (miss < 0.32) {
      const jump = jumpAngle(KITE)
      const half = jump / 2
      const dist = parallaxDistance(jump)
      solve(
        `${LEVELS[2].success} On these two nights the jump is ${(jump / DEG).toFixed(0)}°. Half of that is ${(half / DEG).toFixed(0)}°, and 1 / tan(${(half / DEG).toFixed(0)}°) is ${dist.toFixed(1)} AU.`,
      )
    } else {
      setMessage('Not on the crossing yet. Each night is a line. Kite is where the lines meet.')
      playWrong()
    }
    return
  }
  if (state.level === 3) {
    if (fitPathError(state.radius) < 8 * DEG) solve(LEVELS[3].success)
    else {
      setMessage('Your path still misses the record. Match the hook, where the trail doubles back.')
      playWrong()
    }
    return
  }
  if (state.unlocked) {
    setView('system')
    return
  }
  if (frameError(state.epiR, state.defPeriod) < 0.18) {
    state.unlocked = true
    setMessage('The loops agree. Watch the centre change.')
    setView('system')
  } else {
    setMessage('The curve still misses the dots. Watch the agreement while you move each slider.')
    playWrong()
  }
}

function enter(level: number): void {
  state.screen = 'play'
  state.level = level
  state.view = 'telescope'
  state.mix = 0
  state.frameMix = 0
  state.playing = false
  state.marker = null
  state.solved = false
  state.lesson = null
  state.message = ''
  state.hint = 0
  state.unlocked = false
  state.station = 0
  state.venusPhase = transitPhase() + 1.15
  state.kite = { x: 1.55, y: 0.85 }
  state.radius = 2.85
  state.epiR = 0.42
  state.defPeriod = 520
  if (level === 0) {
    state.time = L1.t0
    state.pan = marsLook(L1.t0).lon
  } else if (level === 1) {
    state.time = TRANSIT_DAY
    state.pan = 0
  } else if (level === 2) {
    const { tA, tB } = parallaxTimes()
    state.pan = midAngle(kiteLook(bodyAt(EARTH, tA)).lon, kiteLook(bodyAt(EARTH, tB)).lon)
    state.time = tA
  } else if (level === 3) {
    state.time = 180
    state.pan = 0
  } else {
    state.time = 80
    state.pan = 0
  }
  showPlay()
  updateTabs()
  paintCrumb()
  buildPanel(true)
}

function nudge(days: number): void {
  const bounds = timeBounds()
  if (!bounds) return
  state.playing = false
  state.time = clamp(state.time + days, bounds.min, bounds.max)
}

function pointerXY(e: PointerEvent): { x: number; y: number; w: number; h: number } {
  const rect = playWell.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height }
}

function settled(): boolean {
  return state.view === 'telescope' ? state.mix < 0.02 : state.mix > 0.98
}

function insideLens(x: number, y: number): boolean {
  const l = lens()
  return Math.hypot(x - l.cx, y - l.cy) <= l.r
}

function hitMode(x: number, y: number, w: number, h: number): DragMode {
  if (!settled() || state.level >= 3) return 'none'
  if (state.view === 'telescope') {
    if (!insideLens(x, y)) return 'none'
    if (state.level === 0 && state.marker) {
      const spot = screenOfSky(state.marker.lon, state.marker.lat, w, h)
      if (Math.hypot(spot.x - x, spot.y - y) < 28) return 'marker'
    }
    return state.level === 0 || state.level === 2 ? 'pan' : 'none'
  }
  if (state.level === 0) {
    const band = bandRect(w, h)
    if (x >= band.x && x <= band.x + band.w && y >= band.y && y <= band.y + band.h) return 'band'
    return 'none'
  }
  if (state.level === 1) {
    const spot = screenOf(bodyAt(VENUS, TRANSIT_DAY, state.venusPhase), w, h)
    if (Math.hypot(spot.x - x, spot.y - y) < 48) return 'venus'
  }
  if (state.level === 2) {
    const spot = screenOf({ x: state.kite.x, y: state.kite.y, z: 0 }, w, h)
    if (Math.hypot(spot.x - x, spot.y - y) < 52) return 'kite'
  }
  return 'none'
}

function onPointerDown(e: PointerEvent): void {
  if (state.screen !== 'play' || !ready) return
  const p = pointerXY(e)
  try {
    playWell.setPointerCapture(e.pointerId)
  } catch {
    // The pointer can already be gone; dragging still tracks move events.
  }
  const mode = hitMode(p.x, p.y, p.w, p.h)
  drag = { id: e.pointerId, x: p.x, y: p.y, lastX: p.x, moved: false, mode }
  playWell.dataset.drag = mode
}

function onPointerMove(e: PointerEvent): void {
  const p = pointerXY(e)
  if (!drag || e.pointerId !== drag.id) {
    if (state.screen === 'play' && ready && e.pointerType === 'mouse') playWell.dataset.hover = hitMode(p.x, p.y, p.w, p.h)
    return
  }
  const dx = p.x - drag.lastX
  if (Math.hypot(p.x - drag.x, p.y - drag.y) > 6) drag.moved = true
  drag.lastX = p.x
  if (drag.mode === 'pan') {
    const spec = baseSpec(p.w, p.h)
    const pxPerRad = state.level === 2 ? (Math.min(p.w, p.h) * 0.84) / 1.28 : spec.pxPerRad
    state.pan = wrap(state.pan + dx / pxPerRad)
  } else if (drag.mode === 'band') {
    state.pan = wrap(state.pan + dx / (bandRect(p.w, p.h).w / 1.6))
  } else if (drag.mode === 'marker') {
    state.marker = pointerToSky(p.x, p.y, p.w, p.h)
  } else if (drag.mode === 'venus') {
    const world = pointerToPlane(p.x, p.y, p.w, p.h)
    if (world) state.venusPhase = Math.atan2(world.y, world.x) - (TAU * TRANSIT_DAY) / VENUS.period
  } else if (drag.mode === 'kite') {
    const world = pointerToPlane(p.x, p.y, p.w, p.h)
    if (world) {
      const radius = Math.hypot(world.x, world.y) || 0.001
      const limited = clamp(radius, 0.75, 4.35)
      state.kite = { x: (world.x / radius) * limited, y: (world.y / radius) * limited }
    }
  }
}

function onPointerUp(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.id) return
  if (!drag.moved && state.level === 0 && state.view === 'telescope' && settled()) {
    const p = pointerXY(e)
    if (insideLens(p.x, p.y)) {
      state.marker = pointerToSky(p.x, p.y, p.w, p.h)
      playTick()
    }
  }
  drag = null
  delete playWell.dataset.drag
}

function step(dt: number): void {
  const bounds = timeBounds()
  if (state.playing && bounds) {
    const rate = state.level === 4 ? 42 : state.level === 3 ? 28 : 11
    state.time = Math.min(bounds.max, state.time + dt * rate)
    if (state.time >= bounds.max - 0.05) state.playing = false
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const target = state.view === 'system' ? 1 : 0
  if (state.level === 4) {
    state.frameMix = reduced ? target : state.frameMix + (target - state.frameMix) * (1 - Math.exp(-dt * 1.6))
    if (state.unlocked && !state.solved && state.frameMix > 0.95) solve(LEVELS[4].success)
  } else {
    state.mix = reduced ? target : state.mix + (target - state.mix) * (1 - Math.exp(-dt * 3.4))
    if (Math.abs(state.mix - target) < 0.001) state.mix = target
  }
}

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  if (ready) {
    if (state.screen === 'play') {
      step(dt)
      framePlay()
      syncReadouts()
    } else if (state.screen === 'sandbox') {
      frameSandbox(now / 1000, dt)
    } else {
      frameTitle(now / 1000, dt)
    }
  }
  requestAnimationFrame(frame)
}

levelList.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-level]')
  if (!button) return
  enter(Number(button.dataset.level))
})

backBtn.addEventListener('click', () => showTitle())
document.querySelector('#sb-back')!.addEventListener('click', () => showTitle())
document.querySelector('#open-sandbox')!.addEventListener('click', () => showSandbox())
initSandbox(
  document.querySelector<HTMLElement>('#sb-panel')!,
  sandboxWell,
  document.querySelector<HTMLElement>('#sb-note')!,
  document.querySelector<HTMLElement>('#sb-day-label')!,
)
tabTelescope.addEventListener('click', () => setView('telescope'))
tabSystem.addEventListener('click', () => setView('system'))
soundBtn.addEventListener('click', () => {
  save.sound = !soundEnabled()
  setSound(save.sound)
  writeSave()
  paintSound()
  if (save.sound) playTick()
})

panel.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')
  if (!target) return
  const action = target.dataset.action
  if (action === 'hint') {
    if (state.hint < LEVELS[state.level].hints.length) {
      state.hint += 1
      buildPanel(false)
    }
    return
  }
  if (action === 'play') {
    state.playing = !state.playing
    if (state.playing && state.level === 0 && state.view === 'telescope') setView('system')
    if (state.playing && state.level === 3 && state.view === 'telescope') setView('system')
    return
  }
  if (action === 'nudge') nudge(Number(target.dataset.days))
  if (action === 'station') {
    const next = target.dataset.which === '1' ? 1 : 0
    if (next !== state.station) playTick()
    state.station = next
  }
  if (action === 'check') grade()
  if (action === 'next') {
    if (state.level >= 4) showTitle()
    else enter(state.level + 1)
  }
})

panel.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement
  const key = input.dataset.slider
  if (key === 'time') {
    state.playing = false
    state.time = Number(input.value)
  } else if (key === 'radius') state.radius = Number(input.value)
  else if (key === 'epi') state.epiR = Number(input.value)
  else if (key === 'period') state.defPeriod = Number(input.value)
})

playWell.addEventListener('pointerdown', onPointerDown)
playWell.addEventListener('pointermove', onPointerMove)
playWell.addEventListener('pointerup', onPointerUp)
playWell.addEventListener('pointercancel', onPointerUp)
playWell.addEventListener(
  'wheel',
  (event) => {
    const bounds = timeBounds()
    if (!bounds || state.screen !== 'play') return
    event.preventDefault()
    state.playing = false
    state.time = clamp(state.time + event.deltaY * 0.045, bounds.min, bounds.max)
  },
  { passive: false },
)

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return
  if (state.screen === 'sandbox') {
    if (event.key === 'Escape' && !sandboxWell.dataset.armed?.startsWith('t')) showTitle()
    else sandboxKey(event)
    return
  }
  if (state.screen !== 'play') return
  if (event.key === '1') setView('telescope')
  if (event.key === '2') setView('system')
  if (event.key === ' ') {
    event.preventDefault()
    if (timeBounds()) state.playing = !state.playing
  }
  if (event.key === 'ArrowRight') nudge(3)
  if (event.key === 'ArrowLeft') nudge(-3)
  if (event.key === 'Escape') showTitle()
})

for (const type of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(type, () => startMusic(), { passive: true })
}

renderLevels()
paintSound()
mount(homeWell)
homeWell.dataset.loading = 'true'
initWorld()
  .then(() => {
    ready = true
    delete homeWell.dataset.loading
  })
  .catch(() => {
    homeCaption.textContent = 'The sky could not load. WebGL may be switched off in this browser.'
  })
requestAnimationFrame(frame)


if (import.meta.env.DEV) {
  Object.assign(window, { stellaras: { state, enter, setView, showTitle, showSandbox } })
}
