import { STARS } from './stars.ts'
import {
  EARTH,
  FRAME,
  MARS,
  MERCURY,
  SUN_DISC,
  TAU,
  VENUS,
  bodyAt,
  epicyclePosition,
  frameEarth,
  framePlanet,
  level1Window,
  marsLook,
  signedDelta,
} from './sim.ts'
import {
  type Layout,
  type Rect,
  bandRect,
  lensRadius,
  orreryLayout,
  projectSky,
  projectStrip,
  stripRect,
  worldToScreen,
  bandHeight,
} from './geom.ts'

export type LonLat = { lon: number; lat: number }

export type Trail = {
  pts: LonLat[]
  color: string
  width: number
  alpha: number
  dashed?: boolean
}

export type SkyDot = {
  lon: number
  lat: number
  color: string
  r: number
  label?: string
  kind: 'body' | 'mark' | 'ghost' | 'sun'
}

export type OrbitDraw = { pts: { x: number; y: number }[]; color: string; dashed?: boolean; width: number }
export type BodyDraw = { name: string; color: string; x: number; y: number; r: number }
export type RayDraw = { x: number; y: number; ang: number; color: string; dashed?: boolean }

export type Scene = {
  mix: number
  mode: 'sky' | 'transit' | 'strip' | 'frames'
  fov: number
  pan: number
  trails: Trail[]
  dots: SkyDot[]
  showBand: boolean
  bandTrails: Trail[]
  bandDots: SkyDot[]
  orbits: OrbitDraw[]
  bodies: BodyDraw[]
  rays: RayDraw[]
  auRings: number[]
  maxAU: number
  transitSep: number
  transitBearing: number
  inFront: boolean
  epiR: number
  defPeriod: number
  frameT: number
  frameMix: number
  reveal: boolean
  clock: number
}

const PAPER = '#f3ecdf'
const BRASS = '#e0c089'
const INK = '#090a0e'

function fade(ctx: CanvasRenderingContext2D, alpha: number, draw: () => void): void {
  ctx.save()
  ctx.globalAlpha *= alpha
  draw()
  ctx.restore()
}

function roundPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

function halo(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = 'center',
  baseline: CanvasTextBaseline = 'bottom',
): void {
  ctx.font = font
  ctx.textAlign = align
  ctx.textBaseline = baseline
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(8, 9, 13, 0.82)'
  ctx.strokeText(text, x, y)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4.2)
  g.addColorStop(0, color)
  g.addColorStop(0.35, color)
  g.addColorStop(1, 'transparent')
  fade(ctx, 0.85, () => {
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r * 4.2, 0, TAU)
    ctx.fill()
  })
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#fff8ee'
  ctx.beginPath()
  ctx.arc(x, y, r * 0.42, 0, TAU)
  ctx.fill()
}

function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, clock: number): void {
  const pulse = r * (1 + 0.035 * Math.sin(clock * 1.3))
  const g = ctx.createRadialGradient(x, y, pulse * 0.2, x, y, pulse * 6)
  g.addColorStop(0, 'rgba(255, 220, 140, 0.95)')
  g.addColorStop(0.18, 'rgba(255, 168, 48, 0.55)')
  g.addColorStop(1, 'transparent')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, pulse * 6, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#ffe3ad'
  ctx.beginPath()
  ctx.arc(x, y, pulse, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#fffaf0'
  ctx.beginPath()
  ctx.arc(x, y, pulse * 0.45, 0, TAU)
  ctx.fill()
}

function strokeLonLat(
  ctx: CanvasRenderingContext2D,
  trail: Trail,
  project: (p: LonLat) => { x: number; y: number },
): void {
  if (trail.pts.length < 2) return
  fade(ctx, trail.alpha, () => {
    ctx.strokeStyle = trail.color
    ctx.lineWidth = trail.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash(trail.dashed ? [5, 6] : [])
    ctx.beginPath()
    let open = false
    for (let i = 0; i < trail.pts.length; i += 1) {
      const p = project(trail.pts[i])
      if (!open) {
        ctx.moveTo(p.x, p.y)
        open = true
        continue
      }
      if (Math.abs(signedDelta(trail.pts[i - 1].lon, trail.pts[i].lon)) > 1.3) {
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
      } else {
        ctx.lineTo(p.x, p.y)
      }
    }
    ctx.stroke()
    ctx.setLineDash([])
  })
}

function drawSkyDot(
  ctx: CanvasRenderingContext2D,
  dot: SkyDot,
  p: { x: number; y: number },
): void {
  if (dot.kind === 'mark') {
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(Math.PI / 4)
    ctx.fillStyle = PAPER
    ctx.fillRect(-6, -6, 12, 12)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#8a6840'
    ctx.strokeRect(-6, -6, 12, 12)
    ctx.restore()
    if (dot.label) halo(ctx, dot.label, p.x, p.y - 14, '600 12px "Outfit Variable", sans-serif', BRASS)
    return
  }
  if (dot.kind === 'ghost') {
    ctx.save()
    ctx.strokeStyle = dot.color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(p.x, p.y, dot.r + 4, 0, TAU)
    ctx.stroke()
    ctx.restore()
  }
  if (dot.kind === 'sun') drawSun(ctx, p.x, p.y, dot.r, 0)
  else glow(ctx, p.x, p.y, dot.r, dot.color)
  if (dot.label) {
    halo(ctx, dot.label, p.x, p.y - dot.r - 8, 'italic 15px "Fraunces Variable", serif', PAPER)
  }
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  project: (lon: number, lat: number) => { x: number; y: number },
  named: boolean,
): void {
  for (const star of STARS) {
    if (named !== Boolean(star.name)) continue
    const p = project(star.lon, star.lat)
    if (star.name) {
      glow(ctx, p.x, p.y, 2.3, '#f7f1e4')
      halo(ctx, star.name, p.x, p.y - 8, 'italic 13px "Fraunces Variable", serif', BRASS)
    } else {
      const radius = 0.6 + (1 - star.mag) * 1.15
      fade(ctx, 0.35 + (1 - star.mag) * 0.55, () => {
        ctx.fillStyle = star.mag < 0.25 ? '#f4efe4' : '#c9d4ea'
        ctx.beginPath()
        ctx.arc(p.x, p.y, radius, 0, TAU)
        ctx.fill()
      })
    }
  }
}

function drawEcliptic(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  pan: number,
  fov: number,
): void {
  const a = projectSky(rect, pan, pan - fov, 0, fov)
  const b = projectSky(rect, pan, pan + fov, 0, fov)
  ctx.strokeStyle = 'rgba(224, 192, 137, 0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

function nightFill(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 20, w * 0.5, h * 0.5, Math.max(w, h) * 0.72)
  g.addColorStop(0, '#2a3c62')
  g.addColorStop(0.42, '#141b2e')
  g.addColorStop(1, '#07080e')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

function chartFill(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 30, w * 0.5, h * 0.55, Math.max(w, h) * 0.75)
  g.addColorStop(0, '#2a2418')
  g.addColorStop(0.5, '#15130f')
  g.addColorStop(1, '#0c0b09')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

function drawTelescope(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  const rect = { x: (w - Math.min(w, h) * 0.84) / 2, y: (h - Math.min(w, h) * 0.84) / 2, w: Math.min(w, h) * 0.84, h: Math.min(w, h) * 0.84 }
  const r = lensRadius(w, h)
  ctx.save()
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, r, 0, TAU)
  ctx.clip()
  nightFill(ctx, w, h)
  drawStars(ctx, (lon, lat) => projectSky(rect, scene.pan, lon, lat, scene.fov), false)
  drawEcliptic(ctx, rect, scene.pan, scene.fov)
  for (const trail of scene.trails) {
    strokeLonLat(ctx, trail, (p) => projectSky(rect, scene.pan, p.lon, p.lat, scene.fov))
  }
  drawStars(ctx, (lon, lat) => projectSky(rect, scene.pan, lon, lat, scene.fov), true)
  for (const dot of scene.dots) {
    drawSkyDot(ctx, dot, projectSky(rect, scene.pan, dot.lon, dot.lat, scene.fov))
  }
  const vig = ctx.createRadialGradient(w / 2, h / 2, r * 0.55, w / 2, h / 2, r)
  vig.addColorStop(0, 'transparent')
  vig.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

function drawStrip(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  const plate = frameGeom(w, h, 1)
  ctx.save()
  roundPath(ctx, plate.x, plate.y, plate.w, plate.h, plate.r)
  ctx.clip()
  nightFill(ctx, w, h)
  const rect = stripRect(w, h)
  ctx.fillStyle = 'rgba(255, 248, 236, 0.03)'
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  ctx.strokeStyle = 'rgba(224, 192, 137, 0.28)'
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
  const project = (p: LonLat) => projectStrip(rect, p.lon, p.lat)
  drawStars(ctx, (lon, lat) => projectStrip(rect, lon, lat), false)
  const eclipticY = projectStrip(rect, 0, 0).y
  ctx.strokeStyle = 'rgba(224, 192, 137, 0.3)'
  ctx.beginPath()
  ctx.moveTo(rect.x, eclipticY)
  ctx.lineTo(rect.x + rect.w, eclipticY)
  ctx.stroke()
  for (const trail of scene.trails) strokeLonLat(ctx, trail, project)
  drawStars(ctx, (lon, lat) => projectStrip(rect, lon, lat), true)
  for (const dot of scene.dots) drawSkyDot(ctx, dot, project(dot))
  halo(ctx, 'all recorded nights, along the ecliptic', w / 2, plate.y + 28, '500 12px "Outfit Variable", sans-serif', BRASS)
  ctx.restore()
}

function drawTransit(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  const r = lensRadius(w, h)
  ctx.save()
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, r, 0, TAU)
  ctx.clip()
  nightFill(ctx, w, h)
  const sunR = r * 0.33
  drawSun(ctx, w / 2, h / 2, sunR * 0.72, scene.clock)
  ctx.fillStyle = 'rgba(255, 214, 120, 0.16)'
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, sunR, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 236, 200, 0.85)'
  ctx.lineWidth = 2
  ctx.stroke()
  const scale = sunR / SUN_DISC
  const vx = w / 2 + Math.cos(scene.transitBearing) * scene.transitSep * scale
  const vy = h / 2 - Math.sin(scene.transitBearing) * scene.transitSep * scale
  const dx = vx - w / 2
  const dy = vy - h / 2
  const dist = Math.hypot(dx, dy)
  const edge = r * 0.78
  if (dist > edge) {
    const ux = dx / dist
    const uy = dy / dist
    ctx.strokeStyle = BRASS
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(w / 2 + ux * (sunR + 16), h / 2 + uy * (sunR + 16))
    ctx.lineTo(w / 2 + ux * edge, h / 2 + uy * edge)
    ctx.stroke()
    halo(ctx, 'Venus is off the glass', w / 2, h / 2 + r * 0.62, '500 13px "Outfit Variable", sans-serif', PAPER)
  } else {
    const onDisc = scene.inFront && scene.transitSep < SUN_DISC
    if (scene.inFront) {
      ctx.fillStyle = onDisc ? '#1a120c' : VENUS.color
      ctx.beginPath()
      ctx.arc(vx, vy, onDisc ? 7 : 6, 0, TAU)
      ctx.fill()
      if (!onDisc) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.stroke()
      }
    } else {
      fade(ctx, 0.45, () => glow(ctx, vx, vy, 5, VENUS.color))
    }
    halo(ctx, 'Venus', vx, vy - 14, 'italic 14px "Fraunces Variable", serif', PAPER)
  }
  halo(ctx, 'Sun', w / 2, h / 2 - sunR - 10, 'italic 14px "Fraunces Variable", serif', '#ffe3ad')
  ctx.restore()
}

function drawBand(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  const rect = bandRect(w, h)
  ctx.save()
  roundPath(ctx, rect.x, rect.y, rect.w, rect.h, 12)
  ctx.fillStyle = 'rgba(10, 14, 26, 0.78)'
  ctx.fill()
  ctx.clip()
  drawStars(ctx, (lon, lat) => projectSky(rect, scene.pan, lon, lat, scene.fov), false)
  drawEcliptic(ctx, rect, scene.pan, scene.fov)
  const project = (p: LonLat) => projectSky(rect, scene.pan, p.lon, p.lat, scene.fov)
  for (const trail of scene.bandTrails) strokeLonLat(ctx, trail, project)
  drawStars(ctx, (lon, lat) => projectSky(rect, scene.pan, lon, lat, scene.fov), true)
  for (const dot of scene.bandDots) drawSkyDot(ctx, dot, project(dot))
  halo(ctx, 'sky now', rect.x + 10, rect.y + rect.h - 8, '500 11px "Outfit Variable", sans-serif', BRASS, 'left', 'bottom')
  ctx.restore()
}

function drawOrrery(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  const reserve = scene.showBand ? bandHeight(h) : 28
  const layout = orreryLayout(w, h, scene.maxAU, reserve)
  const sun = worldToScreen(0, 0, layout)
  for (const au of scene.auRings) {
    ctx.beginPath()
    ctx.arc(sun.x, sun.y, au * layout.scale, 0, TAU)
    ctx.strokeStyle = 'rgba(224, 192, 137, 0.16)'
    ctx.lineWidth = 1
    ctx.stroke()
    halo(
      ctx,
      `${au} AU`,
      sun.x + 6,
      sun.y - au * layout.scale - 4,
      '500 11px "Outfit Variable", sans-serif',
      'rgba(224, 192, 137, 0.55)',
      'left',
    )
  }
  for (const orbit of scene.orbits) {
    if (orbit.pts.length < 2) continue
    ctx.save()
    ctx.strokeStyle = orbit.color
    ctx.lineWidth = orbit.width
    ctx.setLineDash(orbit.dashed ? [4, 5] : [])
    ctx.beginPath()
    orbit.pts.forEach((p, i) => {
      const s = worldToScreen(p.x, p.y, layout)
      if (i === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    })
    ctx.stroke()
    ctx.restore()
  }
  for (const ray of scene.rays) {
    const from = worldToScreen(ray.x, ray.y, layout)
    const len = Math.max(w, h)
    ctx.save()
    ctx.strokeStyle = ray.color
    ctx.lineWidth = ray.dashed ? 1.25 : 1.6
    ctx.setLineDash(ray.dashed ? [3, 6] : [])
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(from.x + Math.cos(ray.ang) * len, from.y - Math.sin(ray.ang) * len)
    ctx.stroke()
    ctx.restore()
  }
  drawSun(ctx, sun.x, sun.y, 11, scene.clock)
  for (const body of scene.bodies) {
    const s = worldToScreen(body.x, body.y, layout)
    glow(ctx, s.x, s.y, body.r, body.color)
    halo(
      ctx,
      body.name,
      s.x,
      s.y - body.r - 8,
      '600 13px "Outfit Variable", sans-serif',
      PAPER,
      'center',
      'bottom',
    )
  }
}

function drawSystem(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  const plate = frameGeom(w, h, 1)
  ctx.save()
  roundPath(ctx, plate.x, plate.y, plate.w, plate.h, plate.r)
  ctx.clip()
  chartFill(ctx, w, h)
  drawOrrery(ctx, w, h, scene)
  if (scene.showBand) drawBand(ctx, w, h, scene)
  ctx.restore()
}

function strokeWorldCircle(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  x: number,
  y: number,
  r: number,
  color: string,
  width: number,
  dashed = false,
): void {
  const s = worldToScreen(x, y, layout)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash(dashed ? [4, 5] : [])
  ctx.beginPath()
  ctx.arc(s.x, s.y, Math.abs(r) * layout.scale, 0, TAU)
  ctx.stroke()
  ctx.restore()
}

function drawFrames(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  const plate = frameGeom(w, h, 1)
  ctx.save()
  roundPath(ctx, plate.x, plate.y, plate.w, plate.h, plate.r)
  ctx.clip()
  chartFill(ctx, w, h)
  const layout = orreryLayout(w, h, 2.75, 36)

  fade(ctx, 1 - scene.frameMix, () => {
    strokeWorldCircle(ctx, layout, 0, 0, FRAME.defR, 'rgba(224, 192, 137, 0.7)', 1.25)
    const defA = FRAME.defPhase + (TAU * scene.frameT) / scene.defPeriod
    const cx = FRAME.defR * Math.cos(defA)
    const cy = FRAME.defR * Math.sin(defA)
    strokeWorldCircle(ctx, layout, cx, cy, scene.epiR, 'rgba(226, 120, 91, 0.85)', 1.25)
    ctx.save()
    ctx.strokeStyle = BRASS
    ctx.lineWidth = 1.6
    ctx.beginPath()
    for (let i = 0; i <= 180; i += 1) {
      const p = epicyclePosition((i / 180) * 740, scene.epiR, scene.defPeriod)
      const s = worldToScreen(p.x, p.y, layout)
      if (i === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    }
    ctx.stroke()
    ctx.restore()
    for (let i = 0; i <= 64; i += 1) {
      const p = epicyclePosition((i / 64) * 740, FRAME.epiR, FRAME.defPeriod)
      const s = worldToScreen(p.x, p.y, layout)
      ctx.fillStyle = 'rgba(243, 236, 223, 0.85)'
      ctx.beginPath()
      ctx.arc(s.x, s.y, 2.1, 0, TAU)
      ctx.fill()
    }
    const planet = epicyclePosition(scene.frameT, scene.epiR, scene.defPeriod)
    const ps = worldToScreen(planet.x, planet.y, layout)
    const origin = worldToScreen(0, 0, layout)
    glow(ctx, origin.x, origin.y, 7, EARTH.color)
    glow(ctx, ps.x, ps.y, 6, MARS.color)
    halo(ctx, 'Earth', origin.x, origin.y + 18, '600 13px "Outfit Variable", sans-serif', PAPER)
    halo(ctx, 'From Earth', w / 2, plate.y + 32, 'italic 18px "Fraunces Variable", serif', PAPER)
  })

  fade(ctx, scene.frameMix, () => {
    strokeWorldCircle(ctx, layout, 0, 0, 1, 'rgba(142, 200, 240, 0.75)', 1.25)
    strokeWorldCircle(ctx, layout, 0, 0, FRAME.defR, 'rgba(226, 120, 91, 0.8)', 1.25)
    const earth = frameEarth(scene.frameT)
    const planet = framePlanet(scene.frameT)
    const es = worldToScreen(earth.x, earth.y, layout)
    const ps = worldToScreen(planet.x, planet.y, layout)
    const sun = worldToScreen(0, 0, layout)
    ctx.strokeStyle = 'rgba(243, 236, 223, 0.45)'
    ctx.setLineDash([3, 5])
    ctx.beginPath()
    ctx.moveTo(es.x, es.y)
    ctx.lineTo(ps.x, ps.y)
    ctx.stroke()
    ctx.setLineDash([])
    drawSun(ctx, sun.x, sun.y, 12, scene.clock)
    glow(ctx, es.x, es.y, 7, EARTH.color)
    glow(ctx, ps.x, ps.y, 6, MARS.color)
    halo(ctx, 'Earth', es.x + 12, es.y, '600 13px "Outfit Variable", sans-serif', PAPER, 'left', 'middle')
    halo(ctx, 'Planet', ps.x + 12, ps.y, '600 13px "Outfit Variable", sans-serif', PAPER, 'left', 'middle')
    halo(ctx, 'From the Sun', w / 2, plate.y + 32, 'italic 18px "Fraunces Variable", serif', '#ffe3ad')
  })
  ctx.restore()
}

function frameGeom(w: number, h: number, mix: number): { x: number; y: number; w: number; h: number; r: number } {
  const r0 = lensRadius(w, h)
  const x0 = w / 2 - r0
  const y0 = h / 2 - r0
  const s0 = r0 * 2
  const inset = 14
  return {
    x: x0 + (inset - x0) * mix,
    y: y0 + (inset - y0) * mix,
    w: s0 + (w - inset * 2 - s0) * mix,
    h: s0 + (h - inset * 2 - s0) * mix,
    r: r0 + (22 - r0) * mix,
  }
}

function drawChrome(ctx: CanvasRenderingContext2D, w: number, h: number, mix: number): void {
  const g = frameGeom(w, h, mix)
  roundPath(ctx, g.x, g.y, g.w, g.h, g.r)
  ctx.strokeStyle = 'rgba(224, 192, 137, 0.72)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.save()
  ctx.clip()
  ctx.strokeStyle = 'rgba(224, 192, 137, 0.2)'
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.restore()
}

export function drawPlay(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, w, h)
  if (scene.mode === 'frames') {
    drawFrames(ctx, w, h, scene)
    drawChrome(ctx, w, h, 1)
    return
  }
  if (scene.mix < 0.995) {
    fade(ctx, 1 - scene.mix, () => {
      if (scene.mode === 'transit') drawTransit(ctx, w, h, scene)
      else if (scene.mode === 'strip') drawStrip(ctx, w, h, scene)
      else drawTelescope(ctx, w, h, scene)
    })
  }
  if (scene.mix > 0.005) {
    fade(ctx, scene.mix, () => drawSystem(ctx, w, h, scene))
  }
  drawChrome(ctx, w, h, scene.mode === 'strip' ? 1 : scene.mix)
}

let titleLoop: LonLat[] | null = null

function titleLoopPoints(): LonLat[] {
  if (titleLoop) return titleLoop
  const { t0, t1 } = level1Window()
  const pts: LonLat[] = []
  for (let t = t0 - 36; t <= t1 + 18; t += 1) {
    const look = marsLook(t)
    pts.push({ lon: look.lon, lat: look.lat })
  }
  titleLoop = pts
  return pts
}

function drawTitleLoop(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, bead: number): void {
  const pts = titleLoopPoints()
  const origin = pts[0].lon
  const local = pts.map((p) => ({ x: signedDelta(origin, p.lon), y: p.lat }))
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of local) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const span = Math.max(maxX - minX, maxY - minY, 0.05)
  const scale = (radius * 1.25) / span
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const at = (i: number) => ({
    x: cx + (local[i].x - midX) * scale,
    y: cy - (local[i].y - midY) * scale,
  })
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, TAU)
  ctx.clip()
  const g = ctx.createRadialGradient(cx, cy, 8, cx, cy, radius)
  g.addColorStop(0, '#243656')
  g.addColorStop(1, '#07080e')
  ctx.fillStyle = g
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
  ctx.strokeStyle = BRASS
  ctx.lineWidth = 1.6
  ctx.beginPath()
  local.forEach((_, i) => {
    const p = at(i)
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  })
  ctx.stroke()
  const beadIndex = Math.min(local.length - 1, Math.floor(bead * (local.length - 1)))
  const b = at(beadIndex)
  glow(ctx, b.x, b.y, 4, MARS.color)
  ctx.restore()
  ctx.strokeStyle = 'rgba(224, 192, 137, 0.8)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, TAU)
  ctx.stroke()
}

export function drawTitle(ctx: CanvasRenderingContext2D, w: number, h: number, day: number, clock: number): void {
  ctx.clearRect(0, 0, w, h)
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#12151e')
  g.addColorStop(1, '#08090d')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  const rand = (n: number) => {
    const x = Math.sin(n * 127.1) * 43758.5453
    return x - Math.floor(x)
  }
  for (let i = 0; i < 80; i += 1) {
    fade(ctx, 0.25 + rand(i + 3) * 0.6, () => {
      ctx.fillStyle = '#f4efe4'
      ctx.beginPath()
      ctx.arc(rand(i) * w, rand(i + 9) * h, rand(i + 4) < 0.2 ? 1.4 : 0.7, 0, TAU)
      ctx.fill()
    })
  }

  const narrow = w < 860
  const cx = narrow ? w * 0.72 : w * 0.74
  const cy = narrow ? h * 0.28 : h * 0.48
  const layout = { cx, cy, scale: Math.min(w, h) * (narrow ? 0.16 : 0.22) }
  const sun = worldToScreen(0, 0, layout)
  for (const spec of [MERCURY, VENUS, EARTH, MARS]) {
    ctx.strokeStyle = 'rgba(224, 192, 137, 0.28)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i <= 80; i += 1) {
      const p = bodyAt(spec, (i / 80) * spec.period)
      const s = worldToScreen(p.x, p.y, layout)
      if (i === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    }
    ctx.stroke()
  }
  const earth = bodyAt(EARTH, day)
  const mars = bodyAt(MARS, day)
  const es = worldToScreen(earth.x, earth.y, layout)
  const ms = worldToScreen(mars.x, mars.y, layout)
  ctx.strokeStyle = 'rgba(226, 120, 91, 0.7)'
  ctx.setLineDash([3, 5])
  ctx.beginPath()
  ctx.moveTo(es.x, es.y)
  ctx.lineTo(es.x + (ms.x - es.x) * 2.4, es.y + (ms.y - es.y) * 2.4)
  ctx.stroke()
  ctx.setLineDash([])
  drawSun(ctx, sun.x, sun.y, narrow ? 7 : 10, clock)
  glow(ctx, es.x, es.y, 5, EARTH.color)
  glow(ctx, ms.x, ms.y, 4.5, MARS.color)
  glow(ctx, worldToScreen(bodyAt(VENUS, day).x, bodyAt(VENUS, day).y, layout).x, worldToScreen(bodyAt(VENUS, day).x, bodyAt(VENUS, day).y, layout).y, 3.5, VENUS.color)

  const loopR = Math.min(w, h) * (narrow ? 0.11 : 0.14)
  const lx = narrow ? w * 0.22 : w * 0.78
  const ly = narrow ? h * 0.16 : h * 0.78
  const { t0, t1 } = level1Window()
  const span = t1 - t0 + 54
  const along = ((day - (t0 - 36)) % span + span) % span
  drawTitleLoop(ctx, lx, ly, loopR, along / span)
}
