import { signedDelta, TAU, wrap } from './sim.ts'

export type Rect = { x: number; y: number; w: number; h: number }
export type Layout = { cx: number; cy: number; scale: number }

export const SKY_FOV = 0.98
export const SKY_LAT = 0.4

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n))
}

export function lensRadius(w: number, h: number): number {
  return Math.min(w, h) * 0.455
}

export function lensRect(w: number, h: number): Rect {
  const d = Math.min(w, h) * 0.84
  return { x: (w - d) / 2, y: (h - d) / 2, w: d, h: d }
}

export function insideLens(w: number, h: number, x: number, y: number): boolean {
  const r = lensRadius(w, h)
  const dx = x - w / 2
  const dy = y - h / 2
  return dx * dx + dy * dy <= r * r
}

export function bandHeight(h: number): number {
  return Math.max(112, Math.min(156, h * 0.24))
}

export function bandRect(w: number, h: number): Rect {
  const bh = bandHeight(h)
  return { x: 26, y: 18, w: Math.max(20, w - 52), h: bh - 30 }
}

export function orreryLayout(w: number, h: number, maxAU: number, reserveTop: number): Layout {
  const usableH = Math.max(80, h - reserveTop)
  const cx = w / 2
  const cy = reserveTop + usableH * 0.54
  const radiusPx = Math.max(48, Math.min(w * 0.36, usableH * 0.38))
  return { cx, cy, scale: radiusPx / Math.max(0.35, maxAU) }
}

export function worldToScreen(x: number, y: number, layout: Layout): { x: number; y: number } {
  return { x: layout.cx + x * layout.scale, y: layout.cy - y * layout.scale }
}

export function screenToWorld(x: number, y: number, layout: Layout): { x: number; y: number } {
  return { x: (x - layout.cx) / layout.scale, y: (layout.cy - y) / layout.scale }
}

export function projectSky(
  rect: Rect,
  pan: number,
  lon: number,
  lat: number,
  fov = SKY_FOV,
  latSpan = SKY_LAT,
): { x: number; y: number } {
  const d = signedDelta(pan, lon)
  return {
    x: rect.x + rect.w / 2 + (d / fov) * rect.w,
    y: rect.y + rect.h / 2 - (lat / latSpan) * (rect.h * 0.4),
  }
}

export function unprojectSky(
  rect: Rect,
  pan: number,
  x: number,
  y: number,
  fov = SKY_FOV,
  latSpan = SKY_LAT,
): { lon: number; lat: number } {
  const d = ((x - rect.x - rect.w / 2) / rect.w) * fov
  const lat = -((y - rect.y - rect.h / 2) / (rect.h * 0.4)) * latSpan
  return { lon: wrap(pan + d), lat }
}

export function stripRect(w: number, h: number): Rect {
  return { x: 32, y: h * 0.18, w: Math.max(40, w - 64), h: h * 0.58 }
}

export function projectStrip(rect: Rect, lon: number, lat: number): { x: number; y: number } {
  return {
    x: rect.x + (wrap(lon) / TAU) * rect.w,
    y: rect.y + rect.h * 0.58 - lat * rect.h * 1.25,
  }
}

export function midAngle(a: number, b: number): number {
  return wrap(a + signedDelta(a, b) / 2)
}
