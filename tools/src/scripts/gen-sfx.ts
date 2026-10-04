/**
 * Synthesizes placeholder sound effects so every theme has audio before real assets exist.
 * Usage: tsx tools/src/scripts/gen-sfx.ts <outDir> <timbre: chime|marimba>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RATE = 22050;
type Timbre = "chime" | "marimba";
type Note = { freq: number; start: number; dur: number; gain?: number; slideTo?: number };

function voice(timbre: Timbre, phase: number): number {
  if (timbre === "marimba") return Math.sin(phase) + 0.35 * Math.sin(phase * 4) + 0.1 * Math.sin(phase * 10);
  return Math.sin(phase) + 0.25 * Math.sin(phase * 2) + 0.12 * Math.sin(phase * 3);
}

function render(notes: Note[], timbre: Timbre, noise = 0): Float32Array {
  const length = Math.max(...notes.map((n) => n.start + n.dur)) + 0.05;
  const out = new Float32Array(Math.ceil(length * RATE));
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (const note of notes) {
    const begin = Math.floor(note.start * RATE);
    const count = Math.floor(note.dur * RATE);
    const decay = timbre === "marimba" ? 9 / note.dur : 5 / note.dur;
    let phase = 0;
    for (let i = 0; i < count; i++) {
      const t = i / RATE;
      const freq = note.slideTo ? note.freq + (note.slideTo - note.freq) * (i / count) : note.freq;
      phase += (2 * Math.PI * freq) / RATE;
      const attack = Math.min(1, t / 0.004);
      const env = attack * Math.exp(-decay * t);
      out[begin + i]! += (voice(timbre, phase) * 0.6 + rand() * noise) * env * (note.gain ?? 0.5);
    }
  }
  return out;
}

function wav(samples: Float32Array): Buffer {
  const peak = Math.max(1e-6, ...samples.map(Math.abs));
  const scale = Math.min(1, 0.85 / peak);
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s * scale)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const N = (name: string) => {
  const table: Record<string, number> = { C4: 261.63, E4: 329.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5 };
  return table[name]!;
};

export function soundBank(timbre: Timbre): Record<string, Float32Array> {
  const shift = timbre === "marimba" ? 1.5 : 1;
  const n = (name: string) => N(name) * shift;
  return {
    tap: render([{ freq: 1400, start: 0, dur: 0.04, gain: 0.3 }], timbre),
    select: render([{ freq: n("A5"), start: 0, dur: 0.08, gain: 0.35 }], timbre),
    place: render([{ freq: n("E5"), start: 0, dur: 0.07 }, { freq: n("A5"), start: 0.05, dur: 0.1 }], timbre),
    mismatch: render([{ freq: 200, start: 0, dur: 0.22, slideTo: 140, gain: 0.5 }], timbre, 0.08),
    draw: render([{ freq: 900, start: 0, dur: 0.1, slideTo: 1600, gain: 0.15 }], timbre, 0.35),
    flip: render([{ freq: 1500, start: 0, dur: 0.035, gain: 0.25 }], timbre, 0.2),
    complete: render([{ freq: n("C5"), start: 0, dur: 0.12 }, { freq: n("E5"), start: 0.08, dur: 0.12 }, { freq: n("G5"), start: 0.16, dur: 0.2 }], timbre),
    win: render(
      [
        { freq: n("C5"), start: 0, dur: 0.15 }, { freq: n("E5"), start: 0.12, dur: 0.15 }, { freq: n("G5"), start: 0.24, dur: 0.15 },
        { freq: n("C6"), start: 0.36, dur: 0.5 }, { freq: n("E5"), start: 0.36, dur: 0.5, gain: 0.3 }, { freq: n("G5"), start: 0.36, dur: 0.5, gain: 0.3 },
      ],
      timbre,
    ),
    lose: render([{ freq: n("G4"), start: 0, dur: 0.18 }, { freq: n("E4"), start: 0.16, dur: 0.18 }, { freq: n("C4"), start: 0.32, dur: 0.35 }], timbre),
    coin: render([{ freq: n("B5"), start: 0, dur: 0.07, gain: 0.4 }, { freq: n("E6"), start: 0.06, dur: 0.16, gain: 0.4 }], timbre),
    button: render([{ freq: 700, start: 0, dur: 0.05, gain: 0.3 }], timbre),
    popup: render([{ freq: 400, start: 0, dur: 0.13, slideTo: 820, gain: 0.3 }], timbre),
  };
}

if (process.argv[1]?.endsWith("gen-sfx.ts")) {
  const [outDir, timbre] = process.argv.slice(2) as [string, Timbre];
  if (!outDir || (timbre !== "chime" && timbre !== "marimba")) {
    console.error("usage: gen-sfx.ts <outDir> <chime|marimba>");
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  for (const [name, samples] of Object.entries(soundBank(timbre))) {
    writeFileSync(join(outDir, `${name}.wav`), wav(samples));
  }
  console.log(`wrote ${Object.keys(soundBank(timbre)).length} sounds to ${outDir}`);
}

export { wav };
