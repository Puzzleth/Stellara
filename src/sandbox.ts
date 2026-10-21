import { playSolve, playTick, playWrong } from './audio.ts'
import { clamp } from './geom.ts'
import { EARTH, MARS, MERCURY, VENUS, bodyAt, type BodySpec, type Vec3 } from './sim.ts'
import {
  AU,
  GUESS,
  beginFrame,
  labelAt,
  placeBody,
  pointerToPlane,
  render,
  screenOf,
  worldLine,
  type ModelName,
  type ViewSpec,
} from './world.ts'

/** Gaussian gravitational constant: GM of the Sun is K² in AU³ per day². */
const K = 0.01720209895
const SOFTEN = 0.004
const STEP = 0.25
const KM_S = 1731.46
const EARTH_MASS = 3.003e-6

type Kind = 'rock' | 'mars' | 'earth' | 'venus' | 'star'

type Body = {
  id: number
  name: string
  model: ModelName
  /** Mass in solar masses. */
  mass: number
  pos: Vec3
  vel: Vec3
  acc: Vec3
  /** Collision radius in AU. Generous, so throws can land. */
  hit: number
  /** Drawn size relative to Earth. */
  size: number
  color: string
  trail: Vec3[]
  thrown: boolean
}

const KINDS: Record<Kind, { label: string; model: ModelName; mass: number; size: number; hit: number; color: string }> = {
  rock: { label: 'Rock', model: 'kite', mass: 1e-10, size: 0.55, hit: 0.006, color: '#c9c3b6' },
  mars: { label: 'Small planet', model: 'mars', mass: 3.2e-7, size: 0.75, hit: 0.01, color: '#e2785b' },
  earth: { label: 'Earth-sized', model: 'earth', mass: EARTH_MASS, size: 1, hit: 0.012, color: '#8ec8f0' },
  venus: { label: 'Cloudy world', model: 'venus', mass: 2.45e-6, size: 0.95, hit: 0.012, color: '#f3d7a4' },
  star: { label: 'Star', model: 'sun', mass: 0.5, size: 2.4, hit: 0.035, color: '#ffc45a' },
}

const sb = {
  bodies: [] as Body[],
  nextId: 1,
  day: 0,
  rate: 30,
  armed: null as Kind | null,
  selected: null as number | null,
  follow: false,
  target: { x: 0, y: 0, z: 0 } as Vec3,
  distance: 5.2,
  azimuth: 0.35,
  elevation: 0.62,
  throwFrom: null as Vec3 | null,
  throwTo: null as Vec3 | null,
  preview: [] as Vec3[],
  note: '',
  noteUntil: 0,
  trailClock: 0,
  counts: { rock: 0, mars: 0, earth: 0, venus: 0, star: 0 } as Record<Kind, number>,
}

let panelEl: HTMLElement
let wellEl: HTMLElement
let noteEl: HTMLElement
let dayEl: HTMLElement
let clock = 0

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
const sub = (a: Vec3, b: Vec3) => v(a.x - b.x, a.y - b.y, a.z - b.z)
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z)

function startVelocity(spec: BodySpec): Vec3 {
  const a = bodyAt(spec, 0.5)
  const b = bodyAt(spec, -0.5)
  return v(a.x - b.x, a.y - b.y, a.z - b.z)
}

function makeBody(name: string, kind: Kind, pos: Vec3, vel: Vec3, thrown = false): Body {
  const k = KINDS[kind]
  return {
    id: sb.nextId++,
    name,
    model: k.model,
    mass: k.mass,
    pos,
    vel,
    acc: v(0, 0, 0),
    hit: k.hit,
    size: k.size,
    color: k.color,
    trail: [],
    thrown,
  }
}

function resetSystem(): void {
  sb.nextId = 1
  sb.day = 0
  sb.selected = null
  sb.follow = false
  sb.target = v(0, 0, 0)
  sb.counts = { rock: 0, mars: 0, earth: 0, venus: 0, star: 0 }
  const sun = makeBody('Sun', 'star', v(0, 0, 0), v(0, 0, 0))
  sun.mass = 1
  sun.size = 3.4
  sun.hit = 0.05
  const planets: [string, Kind, BodySpec][] = [
    ['Mercury', 'mars', MERCURY],
    ['Venus', 'venus', VENUS],
    ['Earth', 'earth', EARTH],
    ['Mars', 'mars', MARS],
  ]
  sb.bodies = [sun]
  for (const [name, kind, spec] of planets) {
    const body = makeBody(name, kind, bodyAt(spec, 0), startVelocity(spec))
    if (name === 'Mercury') {
      body.model = 'mercury'
      body.mass = 1.66e-7
      body.size = 0.55
    }
    if (name === 'Mars') body.size = 0.75
    sb.bodies.push(body)
  }
  // Keep the whole system's momentum at zero so it does not drift off screen.
  const p = sb.bodies.reduce((acc, b) => v(acc.x + b.vel.x * b.mass, acc.y + b.vel.y * b.mass, acc.z + b.vel.z * b.mass), v(0, 0, 0))
  sun.vel = v(-p.x / sun.mass, -p.y / sun.mass, -p.z / sun.mass)
  accelerate(sb.bodies)
}

function accelerate(bodies: Body[]): void {
  for (const b of bodies) b.acc = v(0, 0, 0)
  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i]
    for (let j = i + 1; j < bodies.length; j += 1) {
      const b = bodies[j]
      const dx = b.pos.x - a.pos.x
      const dy = b.pos.y - a.pos.y
      const dz = b.pos.z - a.pos.z
      const r2 = dx * dx + dy * dy + dz * dz + SOFTEN * SOFTEN
      const inv = 1 / (r2 * Math.sqrt(r2))
      const fa = K * K * b.mass * inv
      const fb = K * K * a.mass * inv
      a.acc.x += dx * fa
      a.acc.y += dy * fa
      a.acc.z += dz * fa
      b.acc.x -= dx * fb
      b.acc.y -= dy * fb
      b.acc.z -= dz * fb
    }
  }
}

/** Kick-drift-kick leapfrog: stable over thousands of orbits, which is what a sandbox needs. */
function leap(bodies: Body[], h: number): void {
  for (const b of bodies) {
    b.vel.x += b.acc.x * h * 0.5
    b.vel.y += b.acc.y * h * 0.5
    b.vel.z += b.acc.z * h * 0.5
    b.pos.x += b.vel.x * h
    b.pos.y += b.vel.y * h
    b.pos.z += b.vel.z * h
  }
  accelerate(bodies)
  for (const b of bodies) {
    b.vel.x += b.acc.x * h * 0.5
    b.vel.y += b.acc.y * h * 0.5
    b.vel.z += b.acc.z * h * 0.5
  }
}

function collide(): void {
  for (let i = 0; i < sb.bodies.length; i += 1) {
    for (let j = i + 1; j < sb.bodies.length; j += 1) {
      const a = sb.bodies[i]
      const b = sb.bodies[j]
      if (len(sub(a.pos, b.pos)) > a.hit + b.hit) continue
      const [big, small] = a.mass >= b.mass ? [a, b] : [b, a]
      const m = big.mass + small.mass
      big.vel = v(
        (big.vel.x * big.mass + small.vel.x * small.mass) / m,
        (big.vel.y * big.mass + small.vel.y * small.mass) / m,
        (big.vel.z * big.mass + small.vel.z * small.mass) / m,
      )
      big.pos = v(
        (big.pos.x * big.mass + small.pos.x * small.mass) / m,
        (big.pos.y * big.mass + small.pos.y * small.mass) / m,
        (big.pos.z * big.mass + small.pos.z * small.mass) / m,
      )
      big.size *= Math.cbrt(m / big.mass)
      big.mass = m
      sb.bodies.splice(sb.bodies.indexOf(small), 1)
      if (sb.selected === small.id) sb.selected = big.id
      say(`${small.name} hit ${big.name} and merged.`)
      playWrong()
      j = sb.bodies.length
      i = -1
      break
    }
  }
}

function say(text: string): void {
  sb.note = text
  sb.noteUntil = clock + 4
}

function heaviestOther(body: Body): Body | null {
  let best: Body | null = null
  for (const b of sb.bodies) if (b !== body && (!best || b.mass > best.mass)) best = b
  return best
}

function orbitOf(body: Body): { dist: number; speed: number; period: number | null; around: string } | null {
  const host = heaviestOther(body)
  if (!host) return null
  const r = sub(body.pos, host.pos)
  const u = sub(body.vel, host.vel)
  const dist = len(r)
  const speed = len(u)
  const mu = K * K * (host.mass + body.mass)
  const inv = 2 / dist - (speed * speed) / mu
  const period = inv > 0 ? 2 * Math.PI * Math.sqrt(Math.pow(1 / inv, 3) / mu) : null
  return { dist, speed, period, around: host.name }
}

/** Where a throw would go: a copy of the system run forward with the new body in it. */
function predict(from: Vec3, vel: Vec3, kind: Kind): Vec3[] {
  const ghost = makeBody('ghost', kind, { ...from }, { ...vel })
  sb.nextId -= 1
  const copy: Body[] = sb.bodies.map((b) => ({ ...b, pos: { ...b.pos }, vel: { ...b.vel }, acc: { ...b.acc }, trail: [] }))
  copy.push(ghost)
  accelerate(copy)
  const out: Vec3[] = [{ ...ghost.pos }]
  for (let i = 0; i < 520; i += 1) {
    leap(copy, 1.5)
    if (i % 2 === 0) out.push({ ...ghost.pos })
    const sun = copy.reduce((a, b) => (b !== ghost && b.mass > a.mass ? b : a), copy[0])
    if (len(sub(ghost.pos, sun.pos)) < sun.hit + ghost.hit) break
  }
  return out
}

function throwVelocity(from: Vec3, to: Vec3): Vec3 {
  // One AU of drag is Earth's orbital speed, along the direction of the drag.
  return v((to.x - from.x) * K, (to.y - from.y) * K, 0)
}

const RATES: [number, string][] = [
  [0, 'Pause'],
  [1, 'Day/s'],
  [30, 'Month/s'],
  [365, 'Year/s'],
]

function panelHTML(): string {
  const kinds = (Object.keys(KINDS) as Kind[])
    .map((k) => `<button type="button" data-kind="${k}" aria-pressed="${sb.armed === k}">${KINDS[k].label}</button>`)
    .join('')
  return `
    <h2 tabindex="-1">Throw something into the Solar System</h2>
    <p class="help">Real gravity between every body. Pick a body, then drag across the plane to throw it; the dashed line is where it will go. Drag empty sky to turn the view, scroll or pinch to zoom, click a body to inspect it.</p>
    <div class="control">
      <div class="control-row"><span>Speed of time</span><span id="sb-day" class="num"></span></div>
      <div class="segmented" role="group" aria-label="Speed of time">${RATES.map(([r, l]) => `<button type="button" data-rate="${r}" aria-pressed="${sb.rate === r}">${l}</button>`).join('')}</div>
    </div>
    <div class="control">
      <div class="control-row"><span>Add a body</span><span>${sb.armed ? 'Drag on the plane' : 'Pick one'}</span></div>
      <div class="kinds">${kinds}</div>
    </div>
    <div id="sb-selected"></div>
    <div class="actions">
      <button type="button" class="secondary" data-sb="flyby">Send a star</button>
      <button type="button" class="secondary" data-sb="reset">Reset</button>
    </div>
  `
}

function selectedHTML(): string {
  const body = sb.bodies.find((b) => b.id === sb.selected)
  if (!body) return `<p class="status">Nothing selected. Click a planet or the Sun to see its orbit.</p>`
  const orbit = orbitOf(body)
  const earthMasses = body.mass / EARTH_MASS
  const mass = earthMasses > 3000 ? `${(body.mass).toFixed(2)} Suns` : earthMasses < 0.001 ? 'a few billion tonnes' : `${earthMasses.toFixed(earthMasses < 1 ? 2 : 1)} Earths`
  const rows: [string, string][] = [['Mass', mass]]
  if (orbit) {
    rows.push([`Distance from ${orbit.around}`, `${orbit.dist.toFixed(2)} AU`])
    rows.push(['Speed', `${(orbit.speed * KM_S).toFixed(1)} km/s`])
    rows.push(['Year', orbit.period ? `${Math.round(orbit.period).toLocaleString()} days` : 'Escaping, no orbit'])
  }
  return `<div class="selected">
    <div class="selected-head"><h3>${body.name}</h3>
      <button type="button" class="secondary" data-sb="follow" aria-pressed="${sb.follow}">${sb.follow ? 'Following' : 'Follow'}</button>
    </div>
    <dl>${rows.map(([k, val]) => `<div><dt>${k}</dt><dd class="num">${val}</dd></div>`).join('')}</dl>
    <div class="control">
      <label class="control-row" for="sb-mass"><span>Mass</span><span class="num">×${(body.mass / baseOf(body)).toFixed(body.mass / baseOf(body) < 10 ? 1 : 0)}</span></label>
      <input id="sb-mass" type="range" min="-1" max="3" step="0.01" value="${Math.log10(body.mass / baseOf(body)).toFixed(2)}" />
    </div>
    <button type="button" class="secondary" data-sb="remove">Remove ${body.name}</button>
  </div>`
}

const baseMass = new Map<number, number>()
/** A body's mass when it was made, so the slider reads as a multiple of it. */
function baseOf(body: Body): number {
  if (!baseMass.has(body.id)) baseMass.set(body.id, body.mass)
  return baseMass.get(body.id)!
}

let selectedSig = ''
function paintSelected(force = false): void {
  const host = panelEl.querySelector<HTMLElement>('#sb-selected')
  if (!host) return
  const body = sb.bodies.find((b) => b.id === sb.selected)
  const o = body ? orbitOf(body) : null
  const sig = body
    ? `${body.id}|${body.mass}|${sb.follow}|${o?.dist.toFixed(2)}|${o ? (o.speed * KM_S).toFixed(1) : ''}|${o?.period ? Math.round(o.period / 5) : 'x'}`
    : 'none'
  if (!force && sig === selectedSig) return
  if (document.activeElement?.id === 'sb-mass' && !force) return
  selectedSig = sig
  host.innerHTML = selectedHTML()
}

function rebuildPanel(): void {
  panelEl.innerHTML = panelHTML()
  selectedSig = ''
  paintSelected(true)
}

export function initSandbox(panel: HTMLElement, well: HTMLElement, note: HTMLElement, day: HTMLElement): void {
  panelEl = panel
  wellEl = well
  noteEl = note
  dayEl = day
  resetSystem()

  panel.addEventListener('click', (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>('button')
    if (!el) return
    if (el.dataset.rate) {
      sb.rate = Number(el.dataset.rate)
      playTick()
      rebuildPanel()
    } else if (el.dataset.kind) {
      const kind = el.dataset.kind as Kind
      sb.armed = sb.armed === kind ? null : kind
      playTick()
      rebuildPanel()
    } else if (el.dataset.sb === 'reset') {
      resetSystem()
      sb.distance = 5.2
      say('Back to the four inner planets.')
      rebuildPanel()
    } else if (el.dataset.sb === 'flyby') {
      const star = makeBody(`Wanderer ${++sb.counts.star}`, 'star', v(-4.2, 2.2, 0.3), v(0.0105, -0.0018, -0.0006), true)
      sb.bodies.push(star)
      accelerate(sb.bodies)
      sb.distance = Math.max(sb.distance, 8.5)
      sb.rate = Math.max(sb.rate, 30)
      say('A half-mass star is coming in from the dark.')
      playSolve()
      rebuildPanel()
    } else if (el.dataset.sb === 'follow') {
      sb.follow = !sb.follow
      paintSelected(true)
    } else if (el.dataset.sb === 'remove') {
      sb.bodies = sb.bodies.filter((b) => b.id !== sb.selected)
      sb.selected = null
      sb.follow = false
      accelerate(sb.bodies)
      paintSelected(true)
    }
  })

  panel.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement
    if (input.id !== 'sb-mass') return
    const body = sb.bodies.find((b) => b.id === sb.selected)
    if (!body) return
    body.mass = baseOf(body) * Math.pow(10, Number(input.value))
    const label = input.previousElementSibling?.querySelector('.num')
    if (label) label.textContent = `×${Math.pow(10, Number(input.value)).toFixed(Number(input.value) < 1 ? 1 : 0)}`
  })

  const pointers = new Map<number, { x: number; y: number }>()
  let pinch = 0
  let downAt = { x: 0, y: 0, moved: false, mode: 'orbit' as 'orbit' | 'throw' }
  const local = (e: PointerEvent | WheelEvent) => {
    const r = well.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }
  }

  well.addEventListener('pointerdown', (e) => {
    const p = local(e)
    pointers.set(e.pointerId, { x: p.x, y: p.y })
    try {
      well.setPointerCapture(e.pointerId)
    } catch {
      // Already released.
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = Math.hypot(a.x - b.x, a.y - b.y)
      sb.throwFrom = null
      return
    }
    downAt = { x: p.x, y: p.y, moved: false, mode: 'orbit' }
    if (sb.armed) {
      const hit = pointerToPlane(p.x, p.y, p.w, p.h)
      if (hit) {
        downAt.mode = 'throw'
        sb.throwFrom = v(hit.x, hit.y, 0)
        sb.throwTo = sb.throwFrom
        sb.preview = []
      }
    }
    well.dataset.drag = downAt.mode
  })

  well.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return
    const p = local(e)
    const prev = pointers.get(e.pointerId)!
    pointers.set(e.pointerId, { x: p.x, y: p.y })
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch > 0) sb.distance = clamp(sb.distance * (pinch / d), 0.4, 60)
      pinch = d
      return
    }
    if (Math.hypot(p.x - downAt.x, p.y - downAt.y) > 5) downAt.moved = true
    if (downAt.mode === 'throw' && sb.throwFrom && sb.armed) {
      const hit = pointerToPlane(p.x, p.y, p.w, p.h)
      if (hit) {
        sb.throwTo = v(hit.x, hit.y, 0)
        sb.preview = predict(sb.throwFrom, throwVelocity(sb.throwFrom, sb.throwTo), sb.armed)
      }
    } else {
      sb.azimuth -= (p.x - prev.x) * 0.006
      sb.elevation = clamp(sb.elevation + (p.y - prev.y) * 0.005, -1.45, 1.5)
    }
  })

  const up = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return
    pointers.delete(e.pointerId)
    if (pointers.size > 0) return
    pinch = 0
    const p = local(e)
    if (downAt.mode === 'throw' && sb.throwFrom && sb.throwTo && sb.armed) {
      const kind = sb.armed
      const vel = throwVelocity(sb.throwFrom, sb.throwTo)
      const body = makeBody(`${KINDS[kind].label} ${++sb.counts[kind]}`, kind, { ...sb.throwFrom }, vel, true)
      sb.bodies.push(body)
      accelerate(sb.bodies)
      sb.selected = body.id
      playTick()
      paintSelected(true)
    } else if (!downAt.moved) {
      let best: Body | null = null
      let bestD = 28
      for (const b of sb.bodies) {
        const s = screenOf(b.pos, p.w, p.h)
        const d = Math.hypot(s.x - p.x, s.y - p.y)
        if (d < bestD) {
          bestD = d
          best = b
        }
      }
      sb.selected = best ? best.id : null
      if (!best) sb.follow = false
      if (best) playTick()
      paintSelected(true)
    }
    sb.throwFrom = null
    sb.throwTo = null
    sb.preview = []
    delete well.dataset.drag
  }
  well.addEventListener('pointerup', up)
  well.addEventListener('pointercancel', up)
  well.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      sb.distance = clamp(sb.distance * Math.exp(e.deltaY * 0.0012), 0.4, 60)
    },
    { passive: false },
  )
}

export function enterSandbox(): void {
  rebuildPanel()
  panelEl.querySelector('h2')?.focus({ preventScroll: true })
}

export function sandboxKey(event: KeyboardEvent): void {
  if (event.key === ' ') {
    event.preventDefault()
    sb.rate = sb.rate === 0 ? 30 : 0
    rebuildPanel()
  }
  if (event.key === 'Escape' && sb.armed) {
    sb.armed = null
    rebuildPanel()
  }
}

export function frameSandbox(now: number, dt: number): void {
  clock = now
  const r = wellEl.getBoundingClientRect()
  const w = Math.round(r.width)
  const h = Math.round(r.height)
  if (w < 2 || h < 2) return

  const days = sb.rate * dt
  const steps = Math.min(4000, Math.ceil(days / STEP))
  for (let i = 0; i < steps; i += 1) {
    leap(sb.bodies, days / steps)
    collide()
  }
  sb.day += days
  sb.trailClock += days
  if (sb.trailClock >= Math.max(0.5, sb.rate / 220)) {
    sb.trailClock = 0
    for (const b of sb.bodies) {
      b.trail.push({ ...b.pos })
      if (b.trail.length > 700) b.trail.shift()
    }
  }

  const selected = sb.bodies.find((b) => b.id === sb.selected)
  const goal = sb.follow && selected ? selected.pos : heaviest()?.pos ?? v(0, 0, 0)
  const ease = 1 - Math.exp(-dt * 6)
  sb.target = v(sb.target.x + (goal.x - sb.target.x) * ease, sb.target.y + (goal.y - sb.target.y) * ease, sb.target.z + (goal.z - sb.target.z) * ease)

  beginFrame()
  const pixelAU = (sb.distance * 0.62) / h
  for (const b of sb.bodies) {
    const drawn = Math.max(b.size * 0.03, b.size * pixelAU * 10) * AU
    placeBody(`sb-${b.id}`, b.model, b.pos, drawn, { spin: now * (b.model === 'sun' ? 0.05 : 0.4) + b.id })
    const isSel = b.id === sb.selected
    labelAt(b.name, b.pos, 'body', { dy: -(drawn / AU / pixelAU) - 8, color: isSel ? GUESS : undefined, alpha: isSel || sb.bodies.length < 14 ? 1 : 0.7 })
    if (b.trail.length > 1) {
      worldLine(`sb-trail-${b.id}`, [...b.trail, b.pos], { color: isSel ? GUESS : b.color, width: isSel ? 2 : 1.3, opacity: isSel ? 0.95 : 0.55 })
    }
  }
  if (sb.throwFrom && sb.throwTo && len(sub(sb.throwTo, sb.throwFrom)) > 0.01) {
    worldLine('sb-arrow', [sb.throwFrom, sb.throwTo], { color: '#f3ecdf', width: 2.5, opacity: 0.95 })
    if (sb.preview.length > 1) worldLine('sb-preview', sb.preview, { color: GUESS, width: 1.6, opacity: 0.9, dashed: true, dash: 0.35 })
    const speed = len(throwVelocity(sb.throwFrom, sb.throwTo)) * KM_S
    labelAt(`${speed.toFixed(1)} km/s`, sb.throwTo, 'body', { dy: -14, color: GUESS })
  }

  const spec: ViewSpec = {
    w,
    h,
    mix: 1,
    observer: v(0, 0, 0),
    pan: 0,
    lookLat: 0,
    pxPerRad: 600,
    lens: false,
    sysRadiusAU: sb.distance,
    sysDistance: sb.distance,
    sysTarget: sb.target,
    azimuth: sb.azimuth,
    elevation: sb.elevation,
  }
  render(spec)

  const years = sb.day / 365.25
  const dayText = years >= 2 ? `Year ${years.toFixed(1)}` : `Day ${Math.round(sb.day).toLocaleString()}`
  if (dayEl.textContent !== dayText) dayEl.textContent = dayText
  const sbDay = document.getElementById('sb-day')
  if (sbDay && sbDay.textContent !== dayText) sbDay.textContent = dayText
  const note = clock < sb.noteUntil ? sb.note : sb.armed ? `Drag on the plane to throw: ${KINDS[sb.armed].label.toLowerCase()}. Esc to stop.` : `${sb.bodies.length} bodies, all pulling on each other.`
  if (noteEl.textContent !== note) noteEl.textContent = note
  wellEl.dataset.armed = sb.armed ? 'true' : 'false'
  paintSelected()
}

/** The view centres on the heaviest body, so a passing star drags the camera only if it wins. */
function heaviest(): Body | null {
  let best: Body | null = null
  for (const b of sb.bodies) if (!best || b.mass > best.mass) best = b
  return best
}

