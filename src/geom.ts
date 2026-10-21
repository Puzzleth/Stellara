import { signedDelta, wrap } from './sim.ts'

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n))
}

export function midAngle(a: number, b: number): number {
  return wrap(a + signedDelta(a, b) / 2)
}

export function ease(m: number): number {
  const t = clamp(m, 0, 1)
  return t * t * (3 - 2 * t)
}

/** Radius of the eyepiece circle inside a w × h well. */
export function lensRadius(w: number, h: number): number {
  return Math.min(w, h) * 0.455
}

/** The sky band shown above the chart in the first observation. */
export function bandRect(w: number, h: number): { x: number; y: number; w: number; h: number } {
  const inset = w < 560 ? 10 : 16
  const bw = w - inset * 2
  const bh = Math.round(Math.max(96, Math.min(180, h * 0.26, bw * 0.3)))
  return { x: inset, y: inset, w: bw, h: bh }
}
