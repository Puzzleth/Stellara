import '@fontsource-variable/fraunces/wght-italic.css'
import '@fontsource-variable/fraunces/wght.css'
import '@fontsource-variable/outfit/wght.css'
import './style.css'
import { playSolve, playTick, playWrong, setSound, soundEnabled } from './audio.ts'
import { type Scene, type Trail, drawPlay, drawTitle } from './draw.ts'
import {
  SKY_FOV,
  bandHeight,
  bandRect,
  clamp,
  insideLens,
  lensRect,
  midAngle,
  orreryLayout,
  projectSky,
  screenToWorld,
  unprojectSky,
  worldToScreen,
} from './geom.ts'
import { LEVELS } from './levels.ts'
import {
  DEG,
  EARTH,
  KITE,
  MARS,
  TAU,
  TRANSIT_DAY,
  VENUS,
  agreementFromError,
  bodyAt,
  fitPathError,
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
  sunLook,
  transitPhase,
  venusLook,
  venusOnSun,
  wrap,
  type BodySpec,
} from './sim.ts'

type ViewName = 'telescope' | 'system'
type DragMode = 'pan' | 'marker' | 'venus' | 'kite' | 'none'

type Save = { cleared: boolean[]; sound: boolean }

const L1 = level1Window()
const SAVE_KEY = 'stellara-progress'

const titleEl = document.querySelector<HTMLElement>('#title')!
const playEl = document.querySelector<HTMLElement>('#play')!
const levelList = document.querySelector<HTMLElement>('#level-list')!
const panel = document.querySelector<HTMLElement>('#panel')!
const sky = document.querySelector<HTMLCanvasElement>('#sky')!
const titleSky = document.querySelector<HTMLCanvasElement>('#title-sky')!
const backBtn = document.querySelector<HTMLButtonElement>('#back')!
const tabTelescope = document.querySelector<HTMLButtonElement>('#tab-telescope')!
const tabSystem = document.querySelector<HTMLButtonElement>('#tab-system')!
const dayLabel = document.querySelector<HTMLElement>('#day-label')!
const soundBtn = document.querySelector<HTMLButtonElement>('#sound')!

const state = {
  screen: 'title' as 'title' | 'play',
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

type Drag = {
  id: number
  x: number
  y: number
  lastX: number
  lastY: number
  moved: boolean
  mode: DragMode
}
let drag: Drag | null = null

function loadSave(): Save {
  const empty = { cleared: [false, false, false, false, false], sound: true }
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Save
    if (!Array.isArray(parsed.cleared) || parsed.cleared.length !== 5) return empty
    return { cleared: parsed.cleared.map(Boolean), sound: parsed.sound !== false }
  } catch {
    return empty
  }
}

function writeSave(): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify(save))
}

function orbitOf(spec: BodySpec): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= 140; i += 1) {
    const p = bodyAt(spec, (i / 140) * spec.period)
    pts.push({ x: p.x, y: p.y })
  }
  return pts
}

const EARTH_ORBIT = orbitOf(EARTH)
const MARS_ORBIT = orbitOf(MARS)
const VENUS_ORBIT = orbitOf(VENUS)

function guessSpec(radius: number): BodySpec {
  return {
    name: 'Guess',
    color: '#e0c089',
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

function fovFor(level = state.level): number {
  return level === 2 ? 1.28 : SKY_FOV
}

function maxAU(): number {
  if (state.level === 0) return 2.15
  if (state.level === 1) return 1.45
  if (state.level === 2) return 4.6
  if (state.level === 3) return Math.max(2.3, state.radius + 0.75)
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
          <span class="idx">${level.numeral}</span>
          <span>
            <strong>${level.title}</strong>
            <em>${level.concept}</em>
          </span>
          <span class="tick">${save.cleared[i] ? '✓' : ''}</span>
        </button>
      </li>`,
  ).join('')}</ol>`
}

function updateTabs(): void {
  const frames = state.level === 4
  tabTelescope.textContent = frames ? 'From Earth' : 'Telescope'
  tabSystem.textContent = frames ? 'From the Sun' : 'System'
  tabTelescope.setAttribute('aria-selected', state.view === 'telescope' ? 'true' : 'false')
  tabSystem.setAttribute('aria-selected', state.view === 'system' ? 'true' : 'false')
}

function paintSound(): void {
  soundBtn.textContent = soundEnabled() ? 'Sound' : 'Muted'
  soundBtn.setAttribute('aria-pressed', soundEnabled() ? 'true' : 'false')
}

function showTitle(): void {
  state.screen = 'title'
  state.playing = false
  titleEl.hidden = false
  playEl.hidden = true
  document.title = 'Stellara'
  renderLevels()
}

function showPlay(): void {
  titleEl.hidden = true
  playEl.hidden = false
  document.title = `Stellara · ${LEVELS[state.level].title}`
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

function markCleared(level: number): void {
  save.cleared[level] = true
  writeSave()
}

function solve(lesson: string): void {
  if (state.solved) return
  state.solved = true
  state.lesson = lesson
  state.playing = false
  state.message = ''
  markCleared(state.level)
  playSolve()
  buildPanel(false)
  renderLevels()
}

function hintHTML(): string {
  return LEVELS[state.level].hints
    .slice(0, state.hint)
    .map((hint) => `<p class="hint">${hint}</p>`)
    .join('')
}

function lessonHTML(): string {
  return state.lesson ? `<p class="lesson">${state.lesson}</p>` : ''
}

function nextLabel(): string {
  return state.level === 4 ? 'Back to the observatory' : 'Next observation'
}

function actionsHTML(action: string): string {
  return `<div class="actions">
    <button type="button" class="ghost" data-action="hint">Hint</button>
    <button type="button" class="primary" data-action="${state.solved ? 'next' : 'check'}">${state.solved ? nextLabel() : action}</button>
  </div>`
}

function timeControl(min: number, max: number, left: string, right: string): string {
  return `<div class="control">
    <div class="control-row"><span>${left}</span><span id="dial-readout"></span><span>${right}</span></div>
    <input data-slider="time" aria-label="Time" type="range" min="${min}" max="${max}" step="0.5" value="${state.time}" />
    <div class="row-buttons">
      <button type="button" data-action="nudge" data-days="-7">−7 days</button>
      <button type="button" id="play-toggle" data-action="play">Play</button>
      <button type="button" data-action="nudge" data-days="7">+7 days</button>
    </div>
  </div>`
}

function buildPanel(focus: boolean): void {
  const level = LEVELS[state.level]
  const meter = state.level >= 3 ? `<div class="meter" aria-hidden="true"><span id="meter-bar"></span></div>` : ''
  let controls = ''
  if (state.level === 0) {
    controls = timeControl(L1.t0, L1.t1, 'Tonight', `+${Math.round(L1.t1 - L1.t0)} days`)
  } else if (state.level === 1) {
    controls = ''
  } else if (state.level === 2) {
    controls = `<div class="row-buttons">
      <button type="button" class="choice" data-action="station" data-which="0">Night A</button>
      <button type="button" class="choice" data-action="station" data-which="1">Night B</button>
    </div>`
  } else if (state.level === 3) {
    controls = `${timeControl(40, 640, 'Start of record', 'End')}
      <div class="slider-line"><span>Orbit size</span><span id="radius-readout"></span></div>
      <input data-slider="radius" aria-label="Orbit size" type="range" min="0.45" max="5" step="0.01" value="${state.radius}" />`
  } else {
    controls = `${timeControl(0, 740, 'Trace', 'Two years')}
      <div class="slider-line"><span>Small circle</span><span id="epi-readout"></span></div>
      <input data-slider="epi" aria-label="Epicycle radius" type="range" min="0.25" max="1.6" step="0.01" value="${state.epiR}" />
      <div class="slider-line"><span>Big-circle year</span><span id="period-readout"></span></div>
      <input data-slider="period" aria-label="Deferent period" type="range" min="420" max="980" step="1" value="${state.defPeriod}" />`
  }

  panel.innerHTML = `
    <p class="kicker">Observation ${level.numeral} · ${level.concept}</p>
    <h2 tabindex="-1">${level.title}</h2>
    <p class="ask">${level.ask}</p>
    <p class="help">${level.help}</p>
    ${controls}
    ${meter}
    <p id="status" class="status"></p>
    <p id="message" class="message">${state.message}</p>
    <div id="hints">${hintHTML()}</div>
    ${lessonHTML()}
    ${actionsHTML(level.action)}
  `
  if (focus) panel.querySelector('h2')?.focus()
}

function statusText(): string {
  if (state.solved && state.level === 0) return 'The white trail is where Mars actually went.'
  if (state.level === 0) {
    if (!state.marker) return 'Tap the telescope sky to place a brass mark.'
    if (state.time < L1.t1 - 1) return 'Your mark is set. Now take the dial to the last night.'
    return 'On the sky band, your diamond should sit on Mars.'
  }
  if (state.level === 1) {
    const sep = lookBetween(sunLook(TRANSIT_DAY), venusLook(state.venusPhase))
    if (venusOnSun(state.venusPhase)) return 'Venus is crossing the Sun.'
    if (!venusCloser(state.venusPhase) && sep < 0.28) return 'Venus is behind the Sun. Bring it in front.'
    return `Venus is ${(sep / DEG).toFixed(0)}° from the center of the Sun.`
  }
  if (state.level === 2) {
    const measured = jumpAngle(KITE) / DEG
    const predicted = jumpAngle({ x: state.kite.x, y: state.kite.y, z: 0 }) / DEG
    const dist = Math.hypot(state.kite.x, state.kite.y)
    return `Your mark is ${dist.toFixed(1)} AU out. Jump there: ${predicted.toFixed(0)}°. The nights measured ${measured.toFixed(0)}°.`
  }
  if (state.level === 3) {
    const side = state.radius < 1 ? 'Inside Earth’s orbit' : 'Outside Earth’s orbit'
    const pct = Math.round(meterValue() * 100)
    return `${side} · year ${Math.round(keplerPeriod(state.radius))} days · agreement ${pct}%`
  }
  const pct = Math.round(meterValue() * 100)
  return `Fit ${pct}% · small circle ${state.epiR.toFixed(2)} · big year ${Math.round(state.defPeriod)} days`
}

function meterValue(): number {
  if (state.level === 3) return agreementFromError(fitPathError(state.radius), 0.55)
  if (state.level === 4) return agreementFromError(frameError(state.epiR, state.defPeriod), 0.85)
  return 0
}

function syncReadouts(): void {
  if (state.level === 0 || state.level === 3) dayLabel.textContent = `Day ${Math.round(state.time)}`
  else if (state.level === 1) dayLabel.textContent = 'Day 120'
  else if (state.level === 2) dayLabel.textContent = state.station === 0 ? 'Night A' : 'Night B'
  else dayLabel.textContent = state.view === 'system' ? 'Sun frame' : 'Earth frame'

  const dial = document.getElementById('dial-readout')
  if (dial) dial.textContent = `Day ${Math.round(state.time)}`
  const slider = panel.querySelector<HTMLInputElement>('[data-slider="time"]')
  if (slider && document.activeElement !== slider) slider.value = String(state.time)
  const playBtn = document.getElementById('play-toggle')
  if (playBtn) playBtn.textContent = state.playing ? 'Pause' : 'Play'
  const status = document.getElementById('status')
  if (status) status.textContent = statusText()
  const bar = document.getElementById('meter-bar')
  if (bar) bar.style.width = `${Math.round(meterValue() * 100)}%`
  const radiusReadout = document.getElementById('radius-readout')
  if (radiusReadout) radiusReadout.textContent = `${state.radius.toFixed(2)} AU`
  const epiReadout = document.getElementById('epi-readout')
  if (epiReadout) epiReadout.textContent = state.epiR.toFixed(2)
  const periodReadout = document.getElementById('period-readout')
  if (periodReadout) periodReadout.textContent = `${Math.round(state.defPeriod)} days`
  panel.querySelectorAll<HTMLButtonElement>('[data-action="station"]').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.which === String(state.station) ? 'true' : 'false')
  })
}

function sampleLook(
  spec: BodySpec,
  t0: number,
  t1: number,
  step: number,
  phase = spec.phase,
): { lon: number; lat: number }[] {
  const pts: { lon: number; lat: number }[] = []
  for (let t = t0; t <= t1; t += step) {
    const look = observe(bodyAt(spec, t, phase), bodyAt(EARTH, t))
    pts.push({ lon: look.lon, lat: look.lat })
  }
  return pts
}

function baseScene(clock: number): Scene {
  return {
    mix: state.mix,
    mode: 'sky',
    fov: fovFor(),
    pan: state.pan,
    trails: [],
    dots: [],
    showBand: false,
    bandTrails: [],
    bandDots: [],
    orbits: [],
    bodies: [],
    rays: [],
    auRings: [1],
    maxAU: maxAU(),
    transitSep: 1,
    transitBearing: 0,
    inFront: true,
    epiR: state.epiR,
    defPeriod: state.defPeriod,
    frameT: state.time,
    frameMix: state.frameMix,
    reveal: state.solved,
    clock,
  }
}

function buildScene(clock: number): Scene {
  const scene = baseScene(clock)
  if (state.level === 0) {
    const past = sampleLook(MARS, L1.t0 - 80, L1.t0, 1.5)
    const future = sampleLook(MARS, L1.t0, state.time, 1.5)
    const full = sampleLook(MARS, L1.t0, L1.t1, 1.5)
    const now = marsLook(L1.t0)
    const dial = marsLook(state.time)
    const earth = bodyAt(EARTH, state.time)
    const mars = bodyAt(MARS, state.time)
    scene.showBand = true
    scene.trails = [{ pts: past, color: MARS.color, width: 2, alpha: 0.9 }]
    if (state.solved) scene.trails.push({ pts: full, color: '#f3ecdf', width: 2, alpha: 0.85 })
    scene.dots = [{ lon: now.lon, lat: now.lat, color: MARS.color, r: 6, label: 'Mars', kind: 'body' }]
    if (state.marker) {
      scene.dots.push({
        lon: state.marker.lon,
        lat: state.marker.lat,
        color: '#f3ecdf',
        r: 6,
        label: 'Mark',
        kind: 'mark',
      })
    }
    scene.bandTrails = [
      { pts: past, color: MARS.color, width: 2, alpha: 0.55 },
      { pts: future, color: MARS.color, width: 2.4, alpha: 1 },
    ]
    scene.bandDots = [{ lon: dial.lon, lat: dial.lat, color: MARS.color, r: 5.5, label: 'Mars', kind: 'body' }]
    if (state.marker) {
      scene.bandDots.push({
        lon: state.marker.lon,
        lat: state.marker.lat,
        color: '#f3ecdf',
        r: 6,
        kind: 'mark',
      })
    }
    scene.orbits = [
      { pts: EARTH_ORBIT, color: 'rgba(142, 200, 240, 0.75)', width: 1.25 },
      { pts: MARS_ORBIT, color: 'rgba(226, 120, 91, 0.8)', width: 1.25 },
    ]
    scene.bodies = [
      { name: 'Earth', color: EARTH.color, x: earth.x, y: earth.y, r: 7 },
      { name: 'Mars', color: MARS.color, x: mars.x, y: mars.y, r: 6 },
    ]
    scene.rays = [{ x: earth.x, y: earth.y, ang: observe(mars, earth).lon, color: 'rgba(226, 120, 91, 0.9)' }]
    if (state.marker) {
      scene.rays.push({ x: earth.x, y: earth.y, ang: state.marker.lon, color: 'rgba(224, 192, 137, 0.9)', dashed: true })
    }
    scene.auRings = [1]
    return scene
  }

  if (state.level === 1) {
    const sun = sunLook(TRANSIT_DAY)
    const venus = venusLook(state.venusPhase)
    scene.mode = 'transit'
    scene.transitSep = lookBetween(sun, venus)
    scene.transitBearing = Math.atan2(venus.lat - sun.lat, signedDeltaSafe(sun.lon, venus.lon))
    scene.inFront = venusCloser(state.venusPhase)
    const earth = bodyAt(EARTH, TRANSIT_DAY)
    const venusPos = bodyAt(VENUS, TRANSIT_DAY, state.venusPhase)
    scene.orbits = [
      { pts: VENUS_ORBIT, color: 'rgba(243, 215, 164, 0.8)', width: 1.25 },
      { pts: EARTH_ORBIT, color: 'rgba(142, 200, 240, 0.75)', width: 1.25 },
    ]
    scene.bodies = [
      { name: 'Venus', color: VENUS.color, x: venusPos.x, y: venusPos.y, r: 7 },
      { name: 'Earth', color: EARTH.color, x: earth.x, y: earth.y, r: 7 },
    ]
    scene.rays = [{ x: earth.x, y: earth.y, ang: sun.lon, color: 'rgba(255, 196, 90, 0.85)' }]
    scene.auRings = []
    return scene
  }

  if (state.level === 2) {
    const { tA, tB } = parallaxTimes()
    const earthA = bodyAt(EARTH, tA)
    const earthB = bodyAt(EARTH, tB)
    const lookA = kiteLook(earthA)
    const lookB = kiteLook(earthB)
    scene.dots = [
      {
        lon: lookA.lon,
        lat: lookA.lat,
        color: '#f3ecdf',
        r: 5,
        label: 'A',
        kind: state.station === 0 ? 'body' : 'ghost',
      },
      {
        lon: lookB.lon,
        lat: lookB.lat,
        color: '#e0c089',
        r: 5,
        label: 'B',
        kind: state.station === 1 ? 'body' : 'ghost',
      },
    ]
    scene.orbits = [{ pts: EARTH_ORBIT, color: 'rgba(142, 200, 240, 0.7)', width: 1.2 }]
    scene.bodies = [
      { name: 'A', color: EARTH.color, x: earthA.x, y: earthA.y, r: state.station === 0 ? 8 : 6 },
      { name: 'B', color: '#9bb7d4', x: earthB.x, y: earthB.y, r: state.station === 1 ? 8 : 6 },
      { name: 'Kite?', color: '#e0c089', x: state.kite.x, y: state.kite.y, r: 7 },
    ]
    scene.rays = [
      { x: earthA.x, y: earthA.y, ang: lookA.lon, color: 'rgba(243, 236, 223, 0.8)' },
      { x: earthB.x, y: earthB.y, ang: lookB.lon, color: 'rgba(224, 192, 137, 0.85)' },
    ]
    scene.auRings = [1, 2, 3, 4]
    return scene
  }

  if (state.level === 3) {
    const recorded = sampleLook(MARS, 40, 640, 3)
    const sunTrail = sampleLook(sunBody(), 40, 640, 6)
    const ghost = sampleLook(guessSpec(state.radius), 40, 640, 3)
    const recNow = observe(bodyAt(MARS, state.time), bodyAt(EARTH, state.time))
    const ghostNow = observe(bodyAt(guessSpec(state.radius), state.time), bodyAt(EARTH, state.time))
    const trails: Trail[] = [
      { pts: sunTrail, color: 'rgba(255, 196, 90, 0.9)', width: 1, alpha: 0.35 },
      { pts: recorded, color: MARS.color, width: 2.2, alpha: 0.95 },
      { pts: ghost, color: '#e0c089', width: 2, alpha: 0.9, dashed: true },
    ]
    scene.mode = 'strip'
    scene.trails = trails
    scene.dots = [
      { lon: recNow.lon, lat: recNow.lat, color: MARS.color, r: 5, label: 'Recorded', kind: 'body' },
      { lon: ghostNow.lon, lat: ghostNow.lat, color: '#e0c089', r: 5, label: 'Guess', kind: 'ghost' },
    ]
    const earth = bodyAt(EARTH, state.time)
    const guess = bodyAt(guessSpec(state.radius), state.time)
    scene.orbits = [
      { pts: EARTH_ORBIT, color: 'rgba(142, 200, 240, 0.75)', width: 1.2 },
      { pts: orbitOf(guessSpec(state.radius)), color: 'rgba(224, 192, 137, 0.9)', width: 1.4, dashed: true },
    ]
    if (state.solved) {
      scene.orbits.push({ pts: MARS_ORBIT, color: 'rgba(226, 120, 91, 0.9)', width: 1.6 })
    }
    scene.bodies = [
      { name: 'Earth', color: EARTH.color, x: earth.x, y: earth.y, r: 7 },
      { name: 'Guess', color: '#e0c089', x: guess.x, y: guess.y, r: 6 },
    ]
    scene.auRings = [1]
    return scene
  }

  scene.mode = 'frames'
  return scene
}

function sunBody(): BodySpec {
  return { name: 'Sun', color: '#ffb627', radius: 0, period: 365.25, phase: 0, inc: 0, node: 0 }
}

function signedDeltaSafe(from: number, to: number): number {
  const d = to - from
  if (d > Math.PI) return d - TAU
  if (d < -Math.PI) return d + TAU
  return d
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
      setMessage('Tap the telescope to mark a place among the stars.')
      playWrong()
      return
    }
    const target = marsLook(L1.t1)
    const missLon = Math.abs(signedDeltaSafe(state.marker.lon, target.lon))
    const missLat = Math.abs(state.marker.lat - target.lat)
    if (missLon < 8 * DEG && missLat < 8 * DEG) solve(LEVELS[0].success)
    else if (missLon < 16 * DEG && missLat < 14 * DEG) {
      setMessage('Close. On the sky band, slide the mark until it covers Mars at the end of the dial.')
      playWrong()
    } else {
      setMessage('That is a different part of the sky. Watch the line of sight swing, then match those stars.')
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
      setMessage('The ghost still misses the recording. Match the hook, where the trail doubles back.')
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
    setMessage('The loops agree. Watch the center change.')
    setView('system')
  } else {
    setMessage('The curve still misses the dots. Chase the fit meter — both sliders matter.')
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
  buildPanel(true)
}

function nudge(days: number): void {
  const bounds = timeBounds()
  if (!bounds) return
  state.playing = false
  state.time = clamp(state.time + days, bounds.min, bounds.max)
}

function pointerXY(e: PointerEvent): { x: number; y: number; w: number; h: number } {
  const rect = sky.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height }
}

function hitMode(x: number, y: number, w: number, h: number): DragMode {
  if (state.level === 4 || state.level === 3) return 'none'
  if (state.view === 'telescope') {
    if (state.level === 0 && state.marker && insideLens(w, h, x, y)) {
      const spot = projectSky(lensRect(w, h), state.pan, state.marker.lon, state.marker.lat, SKY_FOV)
      if (Math.hypot(spot.x - x, spot.y - y) < 28) return 'marker'
    }
    if (state.level === 0 || state.level === 2) return 'pan'
    return 'none'
  }
  const layout = orreryLayout(w, h, maxAU(), state.level === 0 ? bandHeight(h) : 28)
  if (state.level === 1) {
    const venus = bodyAt(VENUS, TRANSIT_DAY, state.venusPhase)
    const spot = worldToScreen(venus.x, venus.y, layout)
    if (Math.hypot(spot.x - x, spot.y - y) < 48) return 'venus'
  }
  if (state.level === 2) {
    const spot = worldToScreen(state.kite.x, state.kite.y, layout)
    if (Math.hypot(spot.x - x, spot.y - y) < 52) return 'kite'
  }
  if (state.level === 0) return 'pan'
  return 'none'
}

function onPointerDown(e: PointerEvent): void {
  if (state.screen !== 'play') return
  const p = pointerXY(e)
  try {
    sky.setPointerCapture(e.pointerId)
  } catch {
    // The pointer can already be gone; dragging still tracks move events.
  }
  drag = { id: e.pointerId, x: p.x, y: p.y, lastX: p.x, lastY: p.y, moved: false, mode: hitMode(p.x, p.y, p.w, p.h) }
}

function onPointerMove(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.id) return
  const p = pointerXY(e)
  const dx = p.x - drag.lastX
  if (Math.hypot(p.x - drag.x, p.y - drag.y) > 6) drag.moved = true
  drag.lastX = p.x
  drag.lastY = p.y
  if (drag.mode === 'pan') {
    const width = state.view === 'system' ? bandRect(p.w, p.h).w : lensRect(p.w, p.h).w
    state.pan = wrap(state.pan - (dx / width) * fovFor())
  } else if (drag.mode === 'marker') {
    state.marker = unprojectSky(lensRect(p.w, p.h), state.pan, p.x, p.y, SKY_FOV)
  } else if (drag.mode === 'venus') {
    const world = screenToWorld(p.x, p.y, orreryLayout(p.w, p.h, maxAU(), 28))
    state.venusPhase = Math.atan2(world.y, world.x) - (TAU * TRANSIT_DAY) / VENUS.period
  } else if (drag.mode === 'kite') {
    const world = screenToWorld(p.x, p.y, orreryLayout(p.w, p.h, maxAU(), 28))
    const radius = Math.hypot(world.x, world.y) || 0.001
    const limited = clamp(radius, 0.75, 4.35)
    state.kite = { x: (world.x / radius) * limited, y: (world.y / radius) * limited }
  }
}

function onPointerUp(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.id) return
  if (!drag.moved && state.level === 0 && state.view === 'telescope') {
    const p = pointerXY(e)
    if (insideLens(p.w, p.h, p.x, p.y)) {
      state.marker = unprojectSky(lensRect(p.w, p.h), state.pan, p.x, p.y, SKY_FOV)
    }
  }
  drag = null
}

function step(dt: number): void {
  const bounds = timeBounds()
  if (state.playing && bounds) {
    const rate = state.level === 4 ? 42 : state.level === 3 ? 28 : 11
    state.time = Math.min(bounds.max, state.time + dt * rate)
    if (state.time >= bounds.max - 0.05) state.playing = false
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (state.level === 4) {
    const target = state.view === 'system' ? 1 : 0
    state.frameMix = reduced ? target : state.frameMix + (target - state.frameMix) * (1 - Math.exp(-dt * 2.2))
    if (state.unlocked && !state.solved && state.frameMix > 0.92) solve(LEVELS[4].success)
  } else {
    const target = state.view === 'system' ? 1 : 0
    state.mix = reduced ? target : state.mix + (target - state.mix) * (1 - Math.exp(-dt * 7))
  }
}

function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const rect = canvas.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return null
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const bw = Math.round(rect.width * dpr)
  const bh = Math.round(rect.height * dpr)
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w: rect.width, h: rect.height }
}

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  if (state.screen === 'play') step(dt)
  if (state.screen === 'title') {
    const fitted = fitCanvas(titleSky)
    if (fitted) drawTitle(fitted.ctx, fitted.w, fitted.h, 130 + (now / 1000) * 7, now / 1000)
  } else {
    const fitted = fitCanvas(sky)
    if (fitted) drawPlay(fitted.ctx, fitted.w, fitted.h, buildScene(now / 1000))
    syncReadouts()
  }
  requestAnimationFrame(frame)
}

levelList.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-level]')
  if (!button) return
  enter(Number(button.dataset.level))
})

backBtn.addEventListener('click', () => showTitle())
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
    if (state.hint >= LEVELS[state.level].hints.length) setMessage('That’s the last hint.')
    else {
      state.hint += 1
      buildPanel(false)
    }
    return
  }
  if (action === 'play') {
    state.playing = !state.playing
    if (state.playing && state.level === 0 && state.view === 'telescope') setView('system')
    return
  }
  if (action === 'nudge') nudge(Number(target.dataset.days))
  if (action === 'station') state.station = target.dataset.which === '1' ? 1 : 0
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

sky.addEventListener('pointerdown', onPointerDown)
sky.addEventListener('pointermove', onPointerMove)
sky.addEventListener('pointerup', onPointerUp)
sky.addEventListener('pointercancel', onPointerUp)
sky.addEventListener(
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

renderLevels()
paintSound()
requestAnimationFrame(frame)
