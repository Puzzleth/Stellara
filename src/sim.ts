/** Circular orbits, on purpose. The puzzle is the frame, not the ellipse. */

export const TAU = Math.PI * 2
export const DEG = Math.PI / 180

export type Vec3 = { x: number; y: number; z: number }
export type Look = { lon: number; lat: number; dist: number }

export type BodySpec = {
  name: string
  color: string
  radius: number
  period: number
  phase: number
  inc: number
  node: number
}

export const EARTH: BodySpec = {
  name: 'Earth',
  color: '#8ec8f0',
  radius: 1,
  period: 365.25,
  phase: 0.35,
  inc: 0,
  node: 0,
}

/** Inclination is enlarged (real Mars is about 1.85°) so the retrograde loop reads on screen. */
export const MARS: BodySpec = {
  name: 'Mars',
  color: '#e2785b',
  radius: 1.5237,
  period: 686.98,
  phase: 1.2,
  inc: 9 * DEG,
  node: 0.7,
}

export const VENUS: BodySpec = {
  name: 'Venus',
  color: '#f3d7a4',
  radius: 0.723,
  period: 224.7,
  phase: 0,
  inc: 0,
  node: 0,
}

export const MERCURY: BodySpec = {
  name: 'Mercury',
  color: '#c9c3b6',
  radius: 0.387,
  period: 87.97,
  phase: 2.1,
  inc: 5 * DEG,
  node: 0.4,
}

/** Observation night for the transit puzzle. */
export const TRANSIT_DAY = 120

/** Angular radius of the enlarged teaching Sun. The real Sun is about 0.25°. */
export const SUN_DISC = 0.095

export const KITE: Vec3 = { x: 0, y: 3.2, z: 0 }

/** Planar epicycle that decomposes exactly into Earth + a Mars-like orbit. */
export const FRAME = {
  defR: 1.5237,
  epiR: 1,
  defPeriod: 686.98,
  epiPeriod: 365.25,
  defPhase: 0.9,
}

export function wrap(a: number): number {
  const t = a % TAU
  return t < 0 ? t + TAU : t
}

/** Shortest signed angle from `from` to `to`, in (-π, π]. */
export function signedDelta(from: number, to: number): number {
  let d = wrap(to) - wrap(from)
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}

export function separation(a: number, b: number): number {
  return Math.abs(signedDelta(a, b))
}

export function keplerPeriod(radiusAU: number): number {
  return 365.25 * Math.pow(Math.max(0.05, radiusAU), 1.5)
}

export function bodyAt(spec: BodySpec, t: number, phase = spec.phase): Vec3 {
  const th = phase + (TAU * t) / spec.period
  const x0 = spec.radius * Math.cos(th)
  const y0 = spec.radius * Math.sin(th)
  const y1 = y0 * Math.cos(spec.inc)
  const z1 = y0 * Math.sin(spec.inc)
  const cn = Math.cos(spec.node)
  const sn = Math.sin(spec.node)
  return {
    x: x0 * cn - y1 * sn,
    y: x0 * sn + y1 * cn,
    z: z1,
  }
}

export function observe(target: Vec3, from: Vec3): Look {
  const x = target.x - from.x
  const y = target.y - from.y
  const z = target.z - from.z
  const dist = Math.hypot(x, y, z)
  return {
    lon: Math.atan2(y, x),
    lat: Math.atan2(z, Math.hypot(x, y)),
    dist,
  }
}

export function lookBetween(a: Look, b: Look): number {
  const ax = Math.cos(a.lat) * Math.cos(a.lon)
  const ay = Math.cos(a.lat) * Math.sin(a.lon)
  const az = Math.sin(a.lat)
  const bx = Math.cos(b.lat) * Math.cos(b.lon)
  const by = Math.cos(b.lat) * Math.sin(b.lon)
  const bz = Math.sin(b.lat)
  const dot = Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz))
  return Math.acos(dot)
}

export function marsLook(t: number): Look {
  return observe(bodyAt(MARS, t), bodyAt(EARTH, t))
}

export function sunLook(t: number): Look {
  return observe({ x: 0, y: 0, z: 0 }, bodyAt(EARTH, t))
}

let retroTurn: number | null = null

/**
 * First day of sustained retrograde: apparent longitude decreasing
 * for more than two weeks. A one-day wobble does not count.
 */
export function findRetrogradeTurn(): number {
  if (retroTurn !== null) return retroTurn
  let prevLon = marsLook(0).lon
  let run = 0
  let start = 160
  for (let t = 1; t <= 1000; t += 1) {
    const lon = marsLook(t).lon
    const v = signedDelta(prevLon, lon)
    if (v < -0.0008) {
      if (run === 0) start = t
      run += 1
      if (run >= 18) {
        retroTurn = start
        return start
      }
    } else {
      run = 0
    }
    prevLon = lon
  }
  retroTurn = start
  return start
}

export function level1Window(): { t0: number; t1: number; turn: number } {
  const turn = findRetrogradeTurn()
  return { t0: turn - 14, t1: turn + 46, turn }
}

export function transitPhase(day = TRANSIT_DAY): number {
  const earth = bodyAt(EARTH, day)
  const earthAng = Math.atan2(earth.y, earth.x)
  return earthAng - (TAU * day) / VENUS.period
}

export function venusLook(phase: number, day = TRANSIT_DAY): Look {
  const venus = bodyAt(VENUS, day, phase)
  return observe(venus, bodyAt(EARTH, day))
}

export function venusOnSun(phase: number, day = TRANSIT_DAY): boolean {
  const sun = sunLook(day)
  const venus = venusLook(phase, day)
  const venusPos = bodyAt(VENUS, day, phase)
  const earth = bodyAt(EARTH, day)
  const closer = Math.hypot(venusPos.x - earth.x, venusPos.y - earth.y) < Math.hypot(earth.x, earth.y)
  return closer && lookBetween(sun, venus) < SUN_DISC
}

export function parallaxTimes(): { tA: number; tB: number } {
  const tA = (-EARTH.phase * EARTH.period) / TAU
  return { tA, tB: tA + EARTH.period / 2 }
}

export function kiteLook(from: Vec3, kite: Vec3 = KITE): Look {
  return observe(kite, from)
}

export function jumpAngle(kite: Vec3): number {
  const { tA, tB } = parallaxTimes()
  return lookBetween(kiteLook(bodyAt(EARTH, tA), kite), kiteLook(bodyAt(EARTH, tB), kite))
}

/** Right-triangle check for this particular layout: D = 1 / tan(jump / 2). */
export function parallaxDistance(jump: number): number {
  return 1 / Math.tan(jump / 2)
}

export type Sample = { t: number; lon: number; lat: number }

export function apparentTrail(
  radius: number,
  phase: number,
  inc: number,
  node: number,
  t0: number,
  t1: number,
  step: number,
): Sample[] {
  const spec: BodySpec = {
    name: 'body',
    color: '#fff',
    radius,
    period: keplerPeriod(radius),
    phase,
    inc,
    node,
  }
  const out: Sample[] = []
  for (let t = t0; t <= t1; t += step) {
    const look = observe(bodyAt(spec, t), bodyAt(EARTH, t))
    out.push({ t, lon: look.lon, lat: look.lat })
  }
  return out
}

export function fitPathError(radius: number): number {
  let err = 0
  let n = 0
  for (let t = 40; t <= 620; t += 8) {
    const a = observe(bodyAt(MARS, t), bodyAt(EARTH, t))
    const spec: BodySpec = {
      name: 'guess',
      color: '#fff',
      radius,
      period: keplerPeriod(radius),
      phase: MARS.phase,
      inc: MARS.inc,
      node: MARS.node,
    }
    const b = observe(bodyAt(spec, t), bodyAt(EARTH, t))
    err += lookBetween(a, b)
    n += 1
  }
  return err / n
}

export function epicyclePosition(t: number, epiR: number, defPeriod: number): { x: number; y: number } {
  const defA = FRAME.defPhase + (TAU * t) / defPeriod
  const epiA = Math.PI + (TAU * t) / FRAME.epiPeriod
  return {
    x: FRAME.defR * Math.cos(defA) + epiR * Math.cos(epiA),
    y: FRAME.defR * Math.sin(defA) + epiR * Math.sin(epiA),
  }
}

export function frameError(epiR: number, defPeriod: number): number {
  let err = 0
  let n = 0
  for (let t = 0; t <= 720; t += 8) {
    const a = epicyclePosition(t, FRAME.epiR, FRAME.defPeriod)
    const b = epicyclePosition(t, epiR, defPeriod)
    err += Math.hypot(a.x - b.x, a.y - b.y)
    n += 1
  }
  return err / n
}

export function frameEarth(t: number): { x: number; y: number } {
  const a = (TAU * t) / FRAME.epiPeriod
  return { x: Math.cos(a), y: Math.sin(a) }
}

export function framePlanet(t: number): { x: number; y: number } {
  const a = FRAME.defPhase + (TAU * t) / FRAME.defPeriod
  return { x: FRAME.defR * Math.cos(a), y: FRAME.defR * Math.sin(a) }
}

export function agreementFromError(error: number, scale: number): number {
  return Math.max(0, Math.min(1, 1 - error / scale))
}
