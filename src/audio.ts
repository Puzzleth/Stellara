let ctx: AudioContext | null = null
let enabled = true

/**
 * “Space” by Luceris (https://pixabay.com/music/ambient-space-590393/), Pixabay Content License.
 * Loops quietly under the game. Hosted on Vercel Blob so the repository never carries the file.
 */
const MUSIC_URL = 'https://fsurqovi1wa5n1pm.public.blob.vercel-storage.com/music/luceris-space-590393-CRJphmVADsCEHASrlDFPINnUcxCZ33.mp3'
const MUSIC_VOLUME = 0.32
let music: HTMLAudioElement | null = null
let fade = 0

function fadeMusic(to: number): void {
  if (!music) return
  const track = music
  cancelAnimationFrame(fade)
  const from = track.volume
  const start = performance.now()
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / 1200)
    track.volume = from + (to - from) * t
    if (t < 1) fade = requestAnimationFrame(tick)
    else if (to === 0) track.pause()
  }
  fade = requestAnimationFrame(tick)
}

/** Browsers only allow sound after a gesture, so the first click or key starts the music. */
export function startMusic(): void {
  if (!enabled) return
  if (!music) {
    music = new Audio(MUSIC_URL)
    music.loop = true
    music.preload = 'auto'
    music.volume = 0
  }
  if (!music.paused) return
  music.play().then(
    () => fadeMusic(MUSIC_VOLUME),
    () => {
      // Blocked until a real gesture; the next one tries again.
    },
  )
}

export function setSound(on: boolean): void {
  enabled = on
  if (on) startMusic()
  else fadeMusic(0)
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
