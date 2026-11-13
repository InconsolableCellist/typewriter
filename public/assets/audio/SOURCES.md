# Recordings used for the acoustic model

Checked on 2026-11-08, each on the file's own page. No account or API key was used. Files were kept in
separate empty directories, decoded with ffmpeg only, and read by Python run with `-I`.

## Used for fitting and comparison

| Id | What | Source page | Author | Licence (as stated on the page) | Used for |
|---|---|---|---|---|---|
| a65525 | Manual typewriter typing, 63 s, 48 kHz 24-bit FLAC, includes one margin bell | https://archive.org/details/aporee_65525_75683 | jpilar20 (radio aporee) | Public Domain Mark 1.0, https://creativecommons.org/publicdomain/mark/1.0/ | Keystroke ensemble (157 strikes), body modes, FIR responses, bell A partials, slide noise |
| bell_b | Margin bell, near mono, about 1.1 s | https://commons.wikimedia.org/wiki/File:406243_stubb_typewriter-ding-near-mono.wav | \_stubb, via freesound.org/s/406243, uploaded to Commons 2022-04-15 | CC0 1.0 | Bell B partials, cross-check of bell A |

Notes on the licences. The Internet Archive item carries a Public Domain Mark applied through the radio aporee
upload. It is the uploader's statement that the work is free of known copyright, not a formal CC0 waiver by a named author.
The model contains measurements from a65525 (modal tables) and two short responses derived from it
(`FIR_STRIKE`, 24 ms, and `FIR_MECH`, 12 ms, in `src/audio/measured_body.js`).

Excerpts for A/B comparison are in `tools/audio/proofs/` (`recording_*.wav`).

## Examined and not used for fitting

| Source | Licence | Why not used |
|---|---|---|
| https://archive.org/details/aporee_18222_21166 to \_21170, OR poiesis | PD Mark 1.0 | Room and street noise over the typing (noise floor about -58 dB), no better than a65525; not fitted |
| https://archive.org/details/JuusonTurhaVideoDiary-MyTypewriter, Paussinappula Foundation | Public domain (CC-PD deed) on the page | Spoken commentary over the typing, ending in music |
| https://archive.org/details/basic_typing_1 (1944 training film) | Public domain | Narration throughout, 10 kHz bandwidth |

## Rejected

- Freesound: the CC0 typewriter recordings there need a login to download the original file, so the site was
  not used, and its CDN previews were not used as a workaround either.
- Wikimedia Commons recordings and videos of typewriters under CC BY or CC BY-SA, including several of mechanical machines:
  licence not public domain or CC0.
- https://commons.wikimedia.org/wiki/File:Paper_Radio_-_Typewriters.opus: page says "License review needed".
- https://commons.wikimedia.org/wiki/File:Typing_fast.ogg (and the other PDSounds typing files): tagged as a computer keyboard.
- A gumroad "typewriter mini library" and a CC0-tagged pack on OpenGameArt: page licence could not be verified
  (the gumroad page showed no licence or terms; the OpenGameArt page returned 403) and the OpenGameArt pack appears to be of computer keyboards.
- Other "royalty-free" sound-effect sites: not public domain.

## Events with no acceptable recording

**A carriage return ratchet and its end-stop thud.** No recording found under these terms has a clear return. The closest is
a 0.65 s noise event at 52.7 to 53.35 s in a65525 (no ratchet ticks, rms 43.7 dB below a median strike peak), which might be the
carriage being slid. Its attribution is unconfirmed. It only sets the spectrum of the rail friction noise. The ratchet clicks
and the end-stop thud in the simulation use the keystroke body and were not fitted to a recording of a return.

## Event samples (`samples/sprite.ogg`, `samples/manifest.json`)

Source: "ASMR Typing on 1950s Typewriter (No Talking) Real Typing", a YouTube recording supplied by the project owner, whose creator has made it free to use.

The recording is a 108-minute stereo MP3 (44.1 kHz, 192 kbps) of typing on a 1950s typewriter, supplied by the user as a
local file. Only its first five minutes were examined. Every cut in the sprite is listed in `samples/manifest.json`,
with `srcT` giving its time in seconds in the source. It was decoded with ffmpeg only, mixed to mono at 48 kHz, lightly
de-noised against a static noise profile, trimmed, peak-normalised and encoded as Ogg Opus at 112 kbps by
`tools/audio/cut_samples.py`. The modal model above is unaffected by this source. It remains the fallback until the sprite
has loaded, and afterwards voices only bar-on-bar clashes and carriage rail noise.

## Electric machine samples (`samples_element/sprite.ogg`, `samples_element/manifest.json`)

Cut by `tools/audio/cut_element_samples.py` from a 2 min 44 s sound-test recording of an electric single-element typewriter, supplied by the project owner; origin and licence not recorded here. Each cut's `srcT` is its time in that recording. The file was decoded with ffmpeg only and mixed to mono at 48 kHz. Print cycles, space, backspace, correction, return and tab are cut as recorded; `el_run` is a seamless loop of the carrier running; the bell is kept only at its three partials (band-passed), because machine noise runs through it. The motor and key clicks remain synthesised (`src/audio/element-synth.js`).

## Word processor samples (`samples_wp/`, `samples_wpkeys/`)

Cut by `tools/audio/cut_wp_samples.py` from two recordings supplied by the project owner, decoded with ffmpeg only, mixed to
mono at 48 kHz, read by Python run with `-I`, and encoded as Ogg Opus at 64 kbps. Each cut's `srcT` is its time in its
recording. Origin and licence beyond what is stated here were not recorded.

| Recording | What it is | Where it came from | Used for |
|---|---|---|---|
| `displaywriter_dc4nl` | 3 min 17 s, 48 kHz stereo: the sound of a video titled "006 - IBM 6580 Displaywriter with HUGE daisy wheel printer 1980 - dc4.nl" | Supplied by the owner as a local file; the video is published by dc4.nl | `samples_wp`: single head steps, head loads, seek bodies and two loops of the running machine (hum and air), all from 93.9 s on, where the machine is heard alone; level ratios (`tools/audio/wp_levels.json`) |
| `beamspring_typing` | 4 min, 48 kHz stereo: typing on an IBM beam spring keyboard of the Displaywriter's kind | Supplied by the owner as a local file | `samples_wpkeys`: presses and releases of the alphanumeric keys, the wide keys and the space bar |

Left out: the Displaywriter recording's first 93.9 s (handling with the machine off, speech, the camera operator's voice
over the running machine), the stretches 98.8-99.4, 128.8-129.3 and 152.9-153.2 s (an electrical click, speech-like
sounds), and the beam spring recording's finger snaps (0.9-3.8 s). The room's noise and the running machine's are taken
out of the cuts by static spectral subtraction against quiet spans (the idle machine at 118.6-125.9 and 184.0-190.4 s; the
beam spring recording before its first snap). No printing is heard in the Displaywriter recording, so the printer's sound
stays synthesised.

## Ambience (`ambience/rain.ogg`, `ambience/thunder.ogg`)

Indoor thunderstorm rain loop and thunder recording supplied by the project owner; origin and licence not recorded here. `rain.ogg` is the owner's crossfaded loop re-encoded as Ogg Opus. `thunder.ogg` is one 22.8 s roll cut from the owner's file, which repeats that roll. Decoded with ffmpeg only.
