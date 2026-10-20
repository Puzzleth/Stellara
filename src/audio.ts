let ctx: AudioContext | null = null
let enabled = true

export function setSound(on: boolean): void {
  enabled = on
}

export function soundEnabled(): boolean {
  return enabled
}

function ac(): AudioContext | null {
  if (!enabled) return null
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(freq: number, dur: number, gain: number, type: OscillatorType, delay = 0): void {
  const audio = ac()
  if (!audio) return
  const t0 = audio.currentTime + delay
  const osc = audio.createOscillator()
  const amp = audio.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  amp.gain.setValueAtTime(gain, t0)
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(amp)
  amp.connect(audio.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

export function playTick(): void {
  tone(520, 0.07, 0.03, 'sine')
}

export function playWrong(): void {
  tone(196, 0.16, 0.04, 'triangle')
}

export function playSolve(): void {
  tone(523, 0.18, 0.05, 'sine')
  tone(659, 0.22, 0.045, 'sine', 0.08)
  tone(784, 0.32, 0.04, 'sine', 0.16)
}
