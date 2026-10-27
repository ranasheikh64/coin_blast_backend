const fs = require('fs');
const path = require('path');

function createWavHeader(numSamples, sampleRate = 44100) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

function writeWavFile(filePath, samples, sampleRate = 44100) {
  const header = createWavHeader(samples.length, sampleRate);
  const dataBuffer = Buffer.alloc(samples.length * 2);

  for (let i = 0; i < samples.length; i++) {
    // Soft limiter / overdrive
    let s = samples[i];
    s = Math.tanh(s); // Analog saturation warmth
    const intVal = s < 0 ? s * 32767 : s * 32767;
    dataBuffer.writeInt16LE(Math.floor(intVal), i * 2);
  }

  fs.writeFileSync(filePath, Buffer.concat([header, dataBuffer]));
  console.log(` Created sound: ${filePath} (${samples.length} samples)`);
}

const sampleRate = 44100;

// 1. INSPIRATIONAL CRYSTAL CONNECT CHIME (Rich bright harmonics + electric sparkle)
function generateSelectSound() {
  const duration = 0.22;
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Energetic rising pitch blip
    const f0 = 620 + 260 * Math.exp(-t * 28);
    const env = Math.exp(-t * 16);

    // Crystalline multi-harmonic chime: Fundamental + 2nd octave + 5th
    const chime = 
      Math.sin(2 * Math.PI * f0 * t) * 0.6 +
      Math.sin(2 * Math.PI * f0 * 2.01 * t) * 0.35 +
      Math.sin(2 * Math.PI * f0 * 3.02 * t) * 0.18 +
      Math.sin(2 * Math.PI * (f0 * 4.0) * t) * 0.1;

    // Electric zap shimmer on the attack
    const zapFreq = 2200 - 1400 * (t / duration);
    const zap = Math.sin(2 * Math.PI * zapFreq * t) * Math.exp(-t * 45) * 0.25;

    samples[i] = (chime * env + zap) * 1.35;
  }
  return samples;
}

// 2. BOLD ELECTRIC ARC BLAST (Heavy sub-bass impact + FM lightning arc crackle + plasma sweep)
function generateBlastSound() {
  const duration = 0.58; // 580ms
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;

    // Component A: Heavy 808-style Sub-Bass Kick Punch (240Hz -> 44Hz)
    const subFreq = 44 + 200 * Math.exp(-t * 22);
    const subEnv = Math.exp(-t * 8.5);
    const subBass = Math.sin(2 * Math.PI * subFreq * t) * subEnv * 1.4;

    // Component B: Electric Tesla Coil Lightning Arc (FM Synthesis)
    // Carrier 920Hz modulated rapidly by 160Hz with high index
    const modFreq = 160;
    const modIndex = 4.2 * Math.exp(-t * 15);
    const carrierFreq = 950 - 450 * Math.exp(-t * 18);
    const fmPhase = 2 * Math.PI * carrierFreq * t + modIndex * Math.sin(2 * Math.PI * modFreq * t);
    const electricArc = Math.sin(fmPhase) * Math.exp(-t * 14) * 0.75;

    // Component C: High-Voltage Electric Crackle & Sizzle (Chopped Noise)
    const rawNoise = (Math.random() * 2 - 1);
    const chopper = (1 + Math.sin(2 * Math.PI * 110 * t)) * 0.5; // 110Hz arc spark flutter
    const crackle = rawNoise * chopper * Math.exp(-t * 18) * 0.65;

    // Component D: Plasma Laser Energy Sweep (4200Hz -> 600Hz)
    const sweepFreq = 600 + 3600 * Math.exp(-t * 25);
    const sweep = Math.sin(2 * Math.PI * sweepFreq * t) * Math.exp(-t * 20) * 0.45;

    // Combine with analog saturation
    samples[i] = (subBass + electricArc + crackle + sweep) * 1.25;
  }
  return samples;
}

// 3. JUICY BOUNCY CASCADE DROP SOUND (Punchy multi-coin cascade)
function generateFallSound() {
  const duration = 0.42;
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);

  const drops = [
    { delay: 0.00, freq: 560, amp: 0.6 },
    { delay: 0.08, freq: 740, amp: 0.8 },
    { delay: 0.16, freq: 920, amp: 0.95 },
    { delay: 0.24, freq: 1100, amp: 0.7 },
  ];

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sum = 0;

    for (const d of drops) {
      if (t >= d.delay) {
        const dt = t - d.delay;
        const env = Math.exp(-dt * 30);
        // Wood/metal hollow resonant tap
        const wave = 
          Math.sin(2 * Math.PI * d.freq * dt) +
          0.4 * Math.sin(2 * Math.PI * (d.freq * 2.2) * dt) +
          0.2 * Math.sin(2 * Math.PI * (d.freq * 3.8) * dt);
        sum += wave * env * d.amp;
      }
    }
    samples[i] = sum * 0.85;
  }
  return samples;
}

// 4. INSPIRATIONAL HEROIC LEVEL WIN FANFARE (Triumphant brass + shimmering victory arpeggio)
function generateWinSound() {
  const duration = 1.1; // 1.1 seconds
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);

  // Uplifting Major Triad Fanfare + High Octave Triumph
  const notes = [
    { delay: 0.00, freq: 523.25, dur: 0.22 }, // C5
    { delay: 0.15, freq: 659.25, dur: 0.22 }, // E5
    { delay: 0.30, freq: 783.99, dur: 0.24 }, // G5
    { delay: 0.45, freq: 1046.50, dur: 0.65 }, // C6 (Sustained Triumph!)
  ];

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sum = 0;

    for (const note of notes) {
      if (t >= note.delay) {
        const dt = t - note.delay;
        const env = Math.exp(-dt * (note.dur > 0.4 ? 3.5 : 9.0));

        // Warm brassy synth chord
        const wave = 
          Math.sin(2 * Math.PI * note.freq * dt) * 0.65 +
          Math.sin(2 * Math.PI * (note.freq * 2) * dt) * 0.35 +
          Math.sin(2 * Math.PI * (note.freq * 3) * dt) * 0.18 +
          Math.sin(2 * Math.PI * (note.freq * 0.5) * dt) * 0.25; // Sub warmth

        sum += wave * env * 0.55;
      }
    }

    // Sparkle glitter on the triumphant sustained note
    if (t > 0.45) {
      const glitterT = t - 0.45;
      const glitter = Math.sin(2 * Math.PI * (2400 + 400 * Math.sin(glitterT * 35)) * glitterT) * Math.exp(-glitterT * 4.0) * 0.2;
      sum += glitter;
    }

    samples[i] = sum * 1.25;
  }
  return samples;
}

// 5. DRAMATIC CYBER POWER-DOWN (Lose sound)
function generateLoseSound() {
  const duration = 0.75;
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Pitch drops from 680Hz down to 85Hz
    const freq = 85 + 600 * Math.exp(-t * 5.5);
    const env = Math.exp(-t * 4.2);

    // Detuned dual oscillator power drain
    const wave = 
      Math.sin(2 * Math.PI * freq * t) * 0.7 +
      Math.sin(2 * Math.PI * (freq * 1.49) * t) * 0.4;

    samples[i] = wave * env * 0.95;
  }
  return samples;
}

// 6. CYBER ARCADE AMBIENT MENU BGM (4-second seamless atmospheric loop)
function generateAmbientMenuSound() {
  const duration = 4.0;
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);

  // Notes: E3(164.81), G3(196.00), B3(246.94), D4(293.66), E4(329.63), G4(392.00)
  const arpNotes = [164.81, 246.94, 329.63, 392.00, 293.66, 246.94, 196.00, 246.94];
  const noteDuration = 0.25; // 16 steps in 4s

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;

    // A. Sub-bass drone (E1 41.2Hz and E2 82.4Hz)
    const bass = (Math.sin(2 * Math.PI * 82.41 * t) * 0.35 +
                  Math.sin(2 * Math.PI * 41.20 * t) * 0.25);

    // B. Warm cyber pad chords (E minor: E3 + G3 + B3)
    const pad = (Math.sin(2 * Math.PI * 164.81 * t) * 0.18 +
                 Math.sin(2 * Math.PI * 196.00 * t) * 0.15 +
                 Math.sin(2 * Math.PI * 246.94 * t) * 0.18) * 
                 (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.5 * t));

    // C. Crystal Synth Arpeggio
    const stepIdx = Math.floor(t / noteDuration) % arpNotes.length;
    const noteFreq = arpNotes[stepIdx];
    const stepT = (t % noteDuration) / noteDuration;
    const arpEnv = Math.exp(-stepT * 5.5);
    const arp = (Math.sin(2 * Math.PI * noteFreq * t) * 0.35 +
                 Math.sin(2 * Math.PI * (noteFreq * 2) * t) * 0.12) * arpEnv;

    // D. Subtle tape flutter / shimmer
    const shimmer = Math.sin(2 * Math.PI * (noteFreq * 3.01) * t) * 0.04 * arpEnv;

    samples[i] = (bass + pad + arp + shimmer) * 0.85;
  }
  return samples;
}

const targetDir = path.resolve(__dirname, '../client/assets/audio');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

writeWavFile(path.join(targetDir, 'select.wav'), generateSelectSound());
writeWavFile(path.join(targetDir, 'blast.wav'), generateBlastSound());
writeWavFile(path.join(targetDir, 'fall.wav'), generateFallSound());
writeWavFile(path.join(targetDir, 'win.wav'), generateWinSound());
writeWavFile(path.join(targetDir, 'lose.wav'), generateLoseSound());
writeWavFile(path.join(targetDir, 'ambient_menu.wav'), generateAmbientMenuSound());

console.log(' Bold, inspirational arcade audio with Electric Blast & Ambient Menu BGM generated in assets/audio!');

