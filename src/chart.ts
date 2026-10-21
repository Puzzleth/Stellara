import { STARS } from './stars.ts'
import { TAU, wrap } from './sim.ts'

export type LonLat = { lon: number; lat: number }

export type ChartTrail = { pts: LonLat[]; color: string; width: number; opacity: number; dashed?: boolean }
export type ChartDot = LonLat & { color: string; label: string; ring?: boolean }

/**
 * Every recorded night unrolled along the ecliptic. Longitude runs right to left,
 * as it does through the eyepiece when you face the ecliptic with north up.
 */
export function drawStrip(svg: SVGSVGElement, w: number, h: number, trails: ChartTrail[], dots: ChartDot[]): void {
  const pad = Math.max(16, Math.min(32, w * 0.04))
  const top = 56
  const plotH = Math.max(120, h - top - 72)
  const plotW = Math.max(40, w - pad * 2)
  const x = (lon: number) => pad + (1 - wrap(lon) / TAU) * plotW
  const y = (lat: number) => top + plotH / 2 - (lat / 0.32) * (plotH / 2)

  const parts: string[] = []
  parts.push(`<rect x="${pad}" y="${top}" width="${plotW}" height="${plotH}" fill="#0a0e1a"/>`)
  parts.push(
    `<line x1="${pad}" x2="${pad + plotW}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(224, 192, 137, 0.3)" stroke-dasharray="3 5"/>`,
  )
  for (const star of STARS) {
    if (star.name) continue
    const r = 0.5 + (1 - star.mag) * 1.1
    parts.push(`<circle cx="${x(star.lon).toFixed(1)}" cy="${y(star.lat).toFixed(1)}" r="${r.toFixed(2)}" fill="#c9d4ea" opacity="${(0.3 + (1 - star.mag) * 0.5).toFixed(2)}"/>`)
  }
  for (const trail of trails) {
    let d = ''
    trail.pts.forEach((p, i) => {
      // Break the path where it runs off one edge of the strip and back in at the other.
      const jump = i > 0 && Math.abs(x(trail.pts[i - 1].lon) - x(p.lon)) > plotW / 2
      d += `${i === 0 || jump ? 'M' : 'L'}${x(p.lon).toFixed(1)} ${y(p.lat).toFixed(1)}`
    })
    parts.push(
      `<path d="${d}" fill="none" stroke="${trail.color}" stroke-width="${trail.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${trail.opacity}"${trail.dashed ? ' stroke-dasharray="6 6"' : ''}/>`,
    )
  }
  for (const star of STARS) {
    if (!star.name) continue
    const sx = x(star.lon)
    const sy = y(star.lat)
    parts.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.6" fill="#f7f1e4"/>`)
    parts.push(`<text x="${sx.toFixed(1)}" y="${(top + plotH + 20).toFixed(1)}" class="strip-star">${star.name}</text>`)
  }
  for (const dot of dots) {
    const sx = x(dot.lon)
    const sy = y(dot.lat)
    if (dot.ring) parts.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="8" fill="none" stroke="${dot.color}" stroke-width="2"/>`)
    else parts.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5" fill="${dot.color}"/>`)
    parts.push(`<text x="${sx.toFixed(1)}" y="${(sy - 14).toFixed(1)}" class="strip-dot">${dot.label}</text>`)
  }
  parts.push(`<text x="${pad}" y="32" class="strip-title">Every recorded night, along the ecliptic</text>`)
  parts.push(`<text x="${pad + plotW}" y="32" class="strip-axis">East to the left, as in the eyepiece</text>`)
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.innerHTML = parts.join('')
}
