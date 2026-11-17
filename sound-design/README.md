# Sombra Cipher sound identity

Original synthesized UI sounds, created with **SoundCraft 0.20.1** through `dsh-artcraft-plugin-soundcraft` on 17 November 2026. No Overwatch/Blizzard recordings, samples, voice lines or melodies are used. The direction is a fictional cyber-intrusion interface: violet-glitch aesthetic, filtered square/triangle oscillators, tiny packet-like notes and mild bit crushing.

- `cipher-join.scraft` → `ui/app/voice-peer-joined.wav`: ascending F♯4–C♯5–F♯5–F♯6 packet, 0.8 seconds.
- `cipher-leave.scraft` → `ui/app/voice-left.wav`: descending C♯6–F♯5–F♯4–F♯3, darker filter, 0.8 seconds.
- `cipher-ringtone.scraft` → `ui/app/call-ringtone.wav`: repeating F♯/C♯ notification pattern with sparse glitched high notes and silent breathing space, 4-second loop.
- `cipher-base.scraft`: clean starting synth patch.

All exports are stereo PCM16 WAV at 48 kHz, with short ADSR envelopes, unnormalized headroom and peaks below −12 dBFS. Synth: SoundCraft built-in `subtractive_synth`; insert: `lofi`. The editable sessions contain MIDI/instrument settings and do not require external samples. Use SoundCraft Bounce Mix with the explicit 0–38400 sample range for cues, 0–192000 for ringtone.

Incoming ringtone follows the configured output device and output volume, is suppressed while deafened, and stops on answer, decline, expiry and unmount. Browser autoplay may require a user gesture; the hook retries on pointer/key interaction and removes those listeners on cleanup.

SoundCraft official portable release: https://github.com/storytold/soundcraft/releases/tag/v0.20.1 . The downloaded Windows x64 archive was checked against the release SHA-256 `9769223e26f727866b249fc5176caa8b3791a98c7d89e901b78f5f48aff03b82`. No runtime SoundCraft dependency is shipped in Sombra; only original rendered audio is bundled.
