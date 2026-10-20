export type LevelInfo = {
  numeral: string
  title: string
  concept: string
  ask: string
  help: string
  hints: string[]
  success: string
  action: string
}

export const LEVELS: LevelInfo[] = [
  {
    numeral: 'I',
    title: 'The backward planet',
    concept: 'Retrograde motion',
    ask: 'Where will Mars stand at the end of the dial?',
    help: 'The trail is the last few months, and Mars is slowing down. Play time in the system view. Watch the line of sight, then mark that place among the same stars in the telescope.',
    hints: [
      'Earth is on the inside track and is about to pass Mars. During the pass, the line of sight swings backward along the stars.',
      'Take the dial all the way to the end. On the sky band, see which landmarks Mars sits between. Put your brass mark on those same stars in the telescope.',
    ],
    success:
      'Mars never turned around. Earth, on the inside track, caught up and passed it. During that pass Mars seems to slow, stop, and drift back across the stars. That backward drift is retrograde motion. The loop appears because Mars’s orbit is tilted — drawn much steeper here than the real two degrees, so you can see it.',
    action: 'Check the mark',
  },
  {
    numeral: 'II',
    title: 'A speck on the Sun',
    concept: 'Transits',
    ask: 'Set Venus so it crosses the Sun on Day 120.',
    help: 'The observation is locked to one night. Drag Venus along its orbit in the system view, then look through the telescope. A transit is Venus passing between you and the Sun.',
    hints: [
      'Behind the Sun does not count. Venus has to be the middle body: you, then Venus, then the Sun, in a straight line.',
      'On the chart, put Venus on the line that joins Earth to the Sun, on the Sun’s side of Earth. The telescope should show a dark speck on the bright disc.',
    ],
    success:
      'You lined three bodies up, with Venus in front. That silhouette on the Sun is a transit. The real Sun is only about half a degree wide, which is why Venus transits are brief and rare. This Sun is enlarged, and both orbits are drawn in one flat plane, so the crossing is something you can aim at.',
    action: 'Record the night',
  },
  {
    numeral: 'III',
    title: 'Two eyes of the Earth',
    concept: 'Parallax',
    ask: 'Where is Kite, really?',
    help: 'Kite is a fictional nearby rock. It was observed from two places on Earth’s orbit, half a year apart. Each night is a direction. Drag the brass mark to where those directions meet.',
    hints: [
      'Switch nights in the telescope and watch Kite jump against the stars. On the chart, each night becomes a line drawn from that Earth.',
      'The lines cross just past the 3 AU ring, straight out from the Sun between the two Earths. Closer rocks jump more.',
    ],
    success:
      'That jump is parallax. Nearby things shift against a far background when you change your viewpoint — your thumb against a wall, or a rock against the stars. Kite is invented and close on purpose, so the shift is large enough to see. Real stars move by fractions of an arcsecond.',
    action: 'Lock this position',
  },
  {
    numeral: 'IV',
    title: 'A sky with no map',
    concept: 'Fitting a model',
    ask: 'What orbit would draw this path?',
    help: 'Earth and the Sun are known. The strip is a season of telescope nights. Inner planets stay near the Sun in the sky. Outer planets roam, and they hook backward when Earth passes them. Slide the orbit until your ghost path sits on the recording.',
    hints: [
      'If your ghost hugs the Sun’s track, the orbit is too small. This recording wanders the whole strip and doubles back.',
      'Aim a little wider than Earth’s orbit. Kepler’s rule is already on: a wider orbit gets a longer year. Match the hook, not just a single night.',
    ],
    success:
      'A world a little farther out than Earth, with a longer year, draws that hook. An inner planet never could — it would stay near the Sun. You did what astronomers do: keep the nights, and throw out maps that cannot draw them. The year’s length was tied to the orbit by Kepler’s third law.',
    action: 'This is the orbit',
  },
  {
    numeral: 'V',
    title: 'Circles upon circles',
    concept: 'Frames of reference',
    ask: 'Fit the loops. Then change the frame.',
    help: 'From Earth, this path needs a circle riding on a circle. The small circle spins once per Earth year. Match the recorded dots. When the fit is close, the other frame unlocks.',
    hints: [
      'Watch the fit meter while you move one slider at a time. The small circle wants to be about as wide as Earth’s orbit.',
      'Set the small radius near 1, and the big circle’s year a little under 700 days. Then change the frame and see what the little circle really was.',
    ],
    success:
      'The little circle was Earth’s orbit, drawn from the wrong center. Ptolemy could save the loops with circles on circles. Move the Sun to the middle and the little circle becomes Earth; the big one becomes the planet. Copernicus changed the center. Kepler later bent the circles into ellipses — a truer shape, and still a simple frame. These stay circles so you can compare the frames.',
    action: 'Change the frame',
  },
]
