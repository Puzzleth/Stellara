import { TAU } from './sim.ts'

export type Star = { lon: number; lat: number; mag: number; name?: string }

/** Fictional landmarks, so the chart never pretends to be a real atlas. */
const NAMED: Star[] = [
  ['Ember', 0],
  ['Quill', 30],
  ['Lantern', 60],
  ['Crown', 90],
  ['Bridge', 120],
  ['Keel', 150],
  ['Hearth', 180],
  ['Anchor', 210],
  ['Spire', 240],
  ['Willow', 270],
  ['Cinder', 300],
  ['Harbor', 330],
].map(([name, deg], i) => ({
  name: String(name),
  lon: (Number(deg) * Math.PI) / 180,
  lat: (i % 2 === 0 ? 0.045 : -0.04),
  mag: 0,
}))

function mulberry(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry(11)
const faint: Star[] = []
for (let i = 0; i < 96; i += 1) {
  faint.push({
    lon: rand() * TAU,
    lat: (rand() - 0.5) * 0.46,
    mag: rand() * 0.85 + 0.15,
  })
}

export const STARS: Star[] = [...NAMED, ...faint]
