import * as THREE from "../pc-shim/index.ts";
import type { Weapon } from "../types.ts";

export type SoundKind =
  | "gun" | "cannon" | "bofors" | "impact"
  | "reload-mg" | "reload-cannon" | "reload-bofors" | "air-warning";

export class AudioManager {
  private audioContext?: AudioContext;
  private noiseBuffer?: AudioBuffer;
  private explosionReverbBuffer?: AudioBuffer;

  initialize() {
    const AudioContextCtor = globalThis.AudioContext;
    if (!AudioContextCtor) return;
    if (!this.audioContext) {
      this.audioContext = new AudioContextCtor();
      this.noiseBuffer = this.audioContext.createBuffer(
        1,
        this.audioContext.sampleRate,
        this.audioContext.sampleRate,
      );
      const samples = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

      const reverbDuration = 1.6;
      this.explosionReverbBuffer = this.audioContext.createBuffer(
        2,
        this.audioContext.sampleRate * reverbDuration,
        this.audioContext.sampleRate,
      );
      for (
        let channel = 0;
        channel < this.explosionReverbBuffer.numberOfChannels;
        channel++
      ) {
        const impulse = this.explosionReverbBuffer.getChannelData(channel);
        for (let i = 0; i < impulse.length; i++) {
          const decay = Math.pow(1 - i / impulse.length, 2.4);
          impulse[i] = (Math.random() * 2 - 1) * decay;
        }
      }
    }
    void this.audioContext.resume();
  }
  reloadSoundForWeapon(w: Weapon) {
    return w === "MG" ? "reload-mg" : w === "CANNON" ? "reload-cannon" : "reload-bofors";
  }
  sound(
    kind:
      | "gun"
      | "cannon"
      | "bofors"
      | "impact"
      | "reload-mg"
      | "reload-cannon"
      | "reload-bofors"
      | "air-warning",
    pan = 0,
  ) {
    if (!this.audioContext || !this.noiseBuffer) return;
    const ctx = this.audioContext;
    const clampedPan = Math.max(-1, Math.min(1, pan));
    const now = ctx.currentTime;

    if (kind === "air-warning") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clampedPan;
      for (let pulse = 0; pulse < 2; pulse++) {
        const start = now + pulse * 0.35;
        const osc = ctx.createOscillator(),
          gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(500, start);
        osc.frequency.exponentialRampToValueAtTime(1100, start + 0.3);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.07, start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
        osc.connect(gain).connect(panner).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.32);
        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
          if (pulse === 1) panner.disconnect();
        };
      }
      return;
    }

    if (kind === "reload-mg") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clampedPan;
      const noise = ctx.createBufferSource(),
        noiseFilter = ctx.createBiquadFilter(),
        noiseGain = ctx.createGain();
      noise.buffer = this.noiseBuffer;
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.value = 2800;
      noiseFilter.Q.value = 1.2;
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.08, now + 0.004);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      noise.connect(noiseFilter).connect(noiseGain).connect(panner).connect(ctx.destination);
      noise.start(now);
      noise.stop(now + 0.06);
      for (let i = 0; i < 2; i++) {
        const tick = ctx.createOscillator(),
          tickGain = ctx.createGain();
        tick.type = "square";
        tick.frequency.setValueAtTime(1800 - i * 200, now + i * 0.035);
        tickGain.gain.setValueAtTime(0.0001, now + i * 0.035);
        tickGain.gain.exponentialRampToValueAtTime(0.06, now + i * 0.035 + 0.003);
        tickGain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.035 + 0.025);
        tick.connect(tickGain).connect(panner).connect(ctx.destination);
        tick.start(now + i * 0.035);
        tick.stop(now + i * 0.035 + 0.03);
        tick.onended = () => {
          tick.disconnect();
          tickGain.disconnect();
        };
      }
      noise.onended = () => {
        noise.disconnect();
        noiseFilter.disconnect();
        noiseGain.disconnect();
        panner.disconnect();
      };
      return;
    }

    if (kind === "reload-cannon") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clampedPan;
      const thump = ctx.createBufferSource(),
        thumpFilter = ctx.createBiquadFilter(),
        thumpGain = ctx.createGain(),
        clunk = ctx.createOscillator(),
        clunkGain = ctx.createGain();
      thump.buffer = this.noiseBuffer;
      thumpFilter.type = "lowpass";
      thumpFilter.frequency.value = 420;
      thumpGain.gain.setValueAtTime(0.0001, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      clunk.type = "sine";
      clunk.frequency.setValueAtTime(95, now);
      clunk.frequency.exponentialRampToValueAtTime(48, now + 0.18);
      clunkGain.gain.setValueAtTime(0.0001, now);
      clunkGain.gain.exponentialRampToValueAtTime(0.2, now + 0.012);
      clunkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      thump.connect(thumpFilter).connect(thumpGain).connect(panner).connect(ctx.destination);
      clunk.connect(clunkGain).connect(panner).connect(ctx.destination);
      thump.start(now);
      thump.stop(now + 0.28);
      clunk.start(now);
      clunk.stop(now + 0.25);
      thump.onended = () => {
        thump.disconnect();
        thumpFilter.disconnect();
        thumpGain.disconnect();
        clunk.disconnect();
        clunkGain.disconnect();
        panner.disconnect();
      };
      return;
    }

    if (kind === "reload-bofors") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clampedPan;
      const slide = ctx.createBufferSource(),
        slideFilter = ctx.createBiquadFilter(),
        slideGain = ctx.createGain(),
        latch = ctx.createOscillator(),
        latchGain = ctx.createGain();
      slide.buffer = this.noiseBuffer;
      slideFilter.type = "bandpass";
      slideFilter.frequency.setValueAtTime(1800, now);
      slideFilter.frequency.exponentialRampToValueAtTime(3200, now + 0.18);
      slideFilter.Q.value = 0.8;
      slideGain.gain.setValueAtTime(0.0001, now);
      slideGain.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
      slideGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      latch.type = "triangle";
      latch.frequency.setValueAtTime(1250, now + 0.2);
      latchGain.gain.setValueAtTime(0.0001, now + 0.2);
      latchGain.gain.exponentialRampToValueAtTime(0.09, now + 0.21);
      latchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      slide.connect(slideFilter).connect(slideGain).connect(panner).connect(ctx.destination);
      latch.connect(latchGain).connect(panner).connect(ctx.destination);
      slide.start(now);
      slide.stop(now + 0.24);
      latch.start(now + 0.2);
      latch.stop(now + 0.32);
      latch.onended = () => {
        slide.disconnect();
        slideFilter.disconnect();
        slideGain.disconnect();
        latch.disconnect();
        latchGain.disconnect();
        panner.disconnect();
      };
      return;
    }

    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain(),
      panner = ctx.createStereoPanner();
    source.buffer = this.noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.value =
      kind === "gun" ? 2600 : kind === "cannon" ? 520 : kind === "bofors" ? 1600 : 650;
    const duration = kind === "gun" ? 0.085 : kind === "cannon" ? 0.5 : kind === "bofors" ? 0.18 : 0.45;
    gain.gain.setValueAtTime(
      kind === "gun" ? 0.14 : kind === "cannon" ? 0.26 : 0.22,
      now,
    );
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    panner.pan.value = clampedPan;
    source.connect(filter).connect(gain).connect(panner).connect(ctx.destination);
    source.start(now);
    source.stop(now + duration);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      panner.disconnect();
    };

    if (kind === "gun") {
      const thump = ctx.createOscillator(),
        thumpGain = ctx.createGain(),
        thumpPanner = ctx.createStereoPanner();
      thumpPanner.pan.value = clampedPan;
      thump.type = "triangle";
      thump.frequency.setValueAtTime(150, now);
      thump.frequency.exponentialRampToValueAtTime(70, now + 0.05);
      thumpGain.gain.setValueAtTime(0.0001, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.12, now + 0.004);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      thump.connect(thumpGain).connect(thumpPanner).connect(ctx.destination);
      thump.start(now);
      thump.stop(now + 0.08);
      thump.onended = () => {
        thump.disconnect();
        thumpGain.disconnect();
        thumpPanner.disconnect();
      };
    }

    if (kind === "cannon") {
      const crack = ctx.createOscillator(),
        crackGain = ctx.createGain(),
        crackPanner = ctx.createStereoPanner();
      crackPanner.pan.value = clampedPan;
      crack.type = "triangle";
      crack.frequency.setValueAtTime(140, now);
      crack.frequency.exponentialRampToValueAtTime(55, now + 0.08);
      crackGain.gain.setValueAtTime(0.0001, now);
      crackGain.gain.exponentialRampToValueAtTime(0.18, now + 0.006);
      crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      crack.connect(crackGain).connect(crackPanner).connect(ctx.destination);
      crack.start(now);
      crack.stop(now + 0.12);
      crack.onended = () => {
        crack.disconnect();
        crackGain.disconnect();
        crackPanner.disconnect();
      };
    }
  }
  // Soft hit-marker "thup": a muted, dry tap like hitting folded cloth - no
  // metallic ring or sharp click, just a brief muffled noise body plus a
  // low, quick thump for a bit of weight.
  hitMarkerSound(kill: boolean, pan = 0) {
    if (!this.audioContext || !this.noiseBuffer) return;
    const ctx = this.audioContext;
    const clampedPan = Math.max(-1, Math.min(1, pan));
    const thup = (
      startTime: number,
      duration: number,
      noiseVolume: number,
      thumpVolume: number,
      lowFreq: number,
    ) => {
      const noise = ctx.createBufferSource(),
        noiseFilter = ctx.createBiquadFilter(),
        noiseGain = ctx.createGain(),
        thump = ctx.createOscillator(),
        thumpGain = ctx.createGain(),
        panner = ctx.createStereoPanner();
      panner.pan.value = clampedPan;
      // Muffled noise body - heavily lowpassed so it sounds dry/padded, not crisp
      noise.buffer = this.noiseBuffer;
      noiseFilter.type = "lowpass";
      noiseFilter.frequency.value = 420;
      noiseFilter.Q.value = 0.2;
      noiseGain.gain.setValueAtTime(0.0001, startTime);
      noiseGain.gain.exponentialRampToValueAtTime(noiseVolume, startTime + 0.008);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      // Soft low thump for a touch of bassy weight, no overtones/ringing
      thump.type = "sine";
      thump.frequency.setValueAtTime(lowFreq, startTime);
      thump.frequency.exponentialRampToValueAtTime(lowFreq * 0.65, startTime + duration);
      thumpGain.gain.setValueAtTime(0.0001, startTime);
      thumpGain.gain.exponentialRampToValueAtTime(thumpVolume, startTime + 0.01);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      noise
        .connect(noiseFilter)
        .connect(noiseGain)
        .connect(panner)
        .connect(ctx.destination);
      thump.connect(thumpGain).connect(panner).connect(ctx.destination);
      noise.start(startTime);
      noise.stop(startTime + duration + 0.02);
      thump.start(startTime);
      thump.stop(startTime + duration + 0.02);
      noise.onended = () => {
        noise.disconnect();
        noiseFilter.disconnect();
        noiseGain.disconnect();
      };
      thump.onended = () => {
        thump.disconnect();
        thumpGain.disconnect();
        panner.disconnect();
      };
    };
    const now = ctx.currentTime;
    if (kill) thup(now, 0.1, 0.32, 0.26, 160);
    else thup(now, 0.07, 0.24, 0.18, 200);
  }
  // Vehicle armor hit: dry metallic impact dominated by noise and a brief plate clang.
  vehicleHitSound(kill: boolean, pan = 0) {
    if (!this.audioContext || !this.noiseBuffer) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const clangDuration = kill ? 0.055 : 0.042;
    const clampedPan = Math.max(-1, Math.min(1, pan));
    const panner = ctx.createStereoPanner();
    panner.pan.value = clampedPan;
    panner.connect(ctx.destination);

    const strike = ctx.createBufferSource(),
      strikeFilter = ctx.createBiquadFilter(),
      strikeGain = ctx.createGain();
    strike.buffer = this.noiseBuffer;
    strikeFilter.type = "bandpass";
    strikeFilter.frequency.value = kill ? 2800 : 3400;
    strikeFilter.Q.value = 1.8;
    strikeGain.gain.setValueAtTime(0.0001, now);
    strikeGain.gain.exponentialRampToValueAtTime(kill ? 0.3 : 0.24, now + 0.002);
    strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
    strike.connect(strikeFilter).connect(strikeGain).connect(panner);
    strike.start(now);
    strike.stop(now + 0.035);

    const scrape = ctx.createBufferSource(),
      scrapeFilter = ctx.createBiquadFilter(),
      scrapeGain = ctx.createGain();
    scrape.buffer = this.noiseBuffer;
    scrapeFilter.type = "bandpass";
    scrapeFilter.frequency.value = kill ? 720 : 880;
    scrapeFilter.Q.value = 2.2;
    scrapeGain.gain.setValueAtTime(0.0001, now);
    scrapeGain.gain.exponentialRampToValueAtTime(kill ? 0.2 : 0.15, now + 0.003);
    scrapeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    scrape.connect(scrapeFilter).connect(scrapeGain).connect(panner);
    scrape.start(now);
    scrape.stop(now + 0.05);

    const clangA = ctx.createOscillator(),
      clangB = ctx.createOscillator(),
      clangGain = ctx.createGain();
    clangA.type = "sawtooth";
    clangB.type = "square";
    clangA.frequency.value = kill ? 260 : 310;
    clangB.frequency.value = kill ? 278 : 325;
    clangGain.gain.setValueAtTime(0.0001, now);
    clangGain.gain.exponentialRampToValueAtTime(kill ? 0.1 : 0.07, now + 0.002);
    clangGain.gain.exponentialRampToValueAtTime(0.0001, now + clangDuration);
    clangA.connect(clangGain);
    clangB.connect(clangGain);
    clangGain.connect(panner);
    clangA.start(now);
    clangB.start(now);
    clangA.stop(now + clangDuration + 0.01);
    clangB.stop(now + clangDuration + 0.01);

    const thunk = ctx.createBufferSource(),
      thunkFilter = ctx.createBiquadFilter(),
      thunkGain = ctx.createGain();
    thunk.buffer = this.noiseBuffer;
    thunkFilter.type = "lowpass";
    thunkFilter.frequency.value = kill ? 420 : 340;
    thunkGain.gain.setValueAtTime(0.0001, now);
    thunkGain.gain.exponentialRampToValueAtTime(kill ? 0.18 : 0.13, now + 0.004);
    thunkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    thunk.connect(thunkFilter).connect(thunkGain).connect(panner);
    thunk.start(now);
    thunk.stop(now + 0.08);

    strike.onended = () => {
      strike.disconnect();
      strikeFilter.disconnect();
      strikeGain.disconnect();
      scrape.disconnect();
      scrapeFilter.disconnect();
      scrapeGain.disconnect();
      clangA.disconnect();
      clangB.disconnect();
      clangGain.disconnect();
      thunk.disconnect();
      thunkFilter.disconnect();
      thunkGain.disconnect();
      panner.disconnect();
    };
  }
  // Explosion: a sharp crack, a descending rumbling body, and a deep sub-bass
  // boom with a short outdoor reflection tail for weight and space.
  explosionSound(pan = 0, size = 1, volume = 1) {
    if (!this.audioContext || !this.noiseBuffer || !this.explosionReverbBuffer || volume <= 0)
      return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const clampedPan = Math.max(-1, Math.min(1, pan));
    const scale = THREE.MathUtils.clamp(size / 2.5, 0.55, 1.6);
    const panner = ctx.createStereoPanner(),
      dryGain = ctx.createGain(),
      reverbPreDelay = ctx.createDelay(),
      reverb = ctx.createConvolver(),
      reverbGain = ctx.createGain(),
      outputGain = ctx.createGain();
    panner.pan.value = clampedPan;
    dryGain.gain.value = 0.86;
    reverbPreDelay.delayTime.value = 0.035;
    reverb.buffer = this.explosionReverbBuffer;
    reverbGain.gain.value = 0.38 + Math.min(0.16, size * 0.025);
    outputGain.gain.value = Math.min(1, volume);
    panner.connect(dryGain).connect(outputGain);
    panner
      .connect(reverbPreDelay)
      .connect(reverb)
      .connect(reverbGain)
      .connect(outputGain);
    outputGain.connect(ctx.destination);

    // Sharp initial crack - brief bright noise burst
    const crack = ctx.createBufferSource(),
      crackFilter = ctx.createBiquadFilter(),
      crackGain = ctx.createGain();
    crack.buffer = this.noiseBuffer;
    crackFilter.type = "highpass";
    crackFilter.frequency.value = 1500;
    crackGain.gain.setValueAtTime(0.001, now);
    crackGain.gain.exponentialRampToValueAtTime(0.32 * scale, now + 0.004);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    crack.connect(crackFilter).connect(crackGain).connect(panner);
    crack.start(now);
    crack.stop(now + 0.06);
    crack.onended = () => {
      crack.disconnect();
      crackFilter.disconnect();
      crackGain.disconnect();
    };

    // Rumbling body - noise sweeping from a bright crack down into a dull roar
    const bodyDuration = 0.55 * scale;
    const body = ctx.createBufferSource(),
      bodyFilter = ctx.createBiquadFilter(),
      bodyGain = ctx.createGain();
    body.buffer = this.noiseBuffer;
    bodyFilter.type = "lowpass";
    bodyFilter.Q.value = 0.4;
    bodyFilter.frequency.setValueAtTime(2600, now);
    bodyFilter.frequency.exponentialRampToValueAtTime(180, now + bodyDuration);
    bodyGain.gain.setValueAtTime(0.001, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.4 * scale, now + 0.02);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + bodyDuration);
    body.connect(bodyFilter).connect(bodyGain).connect(panner);
    body.start(now);
    body.stop(now + bodyDuration + 0.02);
    body.onended = () => {
      body.disconnect();
      bodyFilter.disconnect();
      bodyGain.disconnect();
    };

    // Sub-bass boom - gives the blast physical weight
    const boomDuration = 0.4 * scale;
    const boom = ctx.createOscillator(),
      boomGain = ctx.createGain();
    boom.type = "sine";
    boom.frequency.setValueAtTime(105, now);
    boom.frequency.exponentialRampToValueAtTime(32, now + boomDuration);
    boomGain.gain.setValueAtTime(0.001, now);
    boomGain.gain.exponentialRampToValueAtTime(0.5 * scale, now + 0.015);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + boomDuration);
    boom.connect(boomGain).connect(panner);
    boom.start(now);
    boom.stop(now + boomDuration + 0.02);
    boom.onended = () => {
      boom.disconnect();
      boomGain.disconnect();
    };
    window.setTimeout(
      () => {
        panner.disconnect();
        dryGain.disconnect();
        reverbPreDelay.disconnect();
        reverb.disconnect();
        reverbGain.disconnect();
        outputGain.disconnect();
      },
      (bodyDuration + this.explosionReverbBuffer.duration + 0.15) * 1000,
    );
  }
  // Sand impact: a soft, dry, grainy "puff" of a bullet kicking up sand/dirt -
  // no tonal ring or whistle, just noise-based texture and a bit of scatter.
  ricochetSound(pan = 0, volume = 1) {
    if (!this.audioContext || !this.noiseBuffer || volume <= 0) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const panner = ctx.createStereoPanner(),
      outputGain = ctx.createGain();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    outputGain.gain.value = Math.min(1, volume);
    panner.connect(outputGain).connect(ctx.destination);
    const layers: { node: AudioScheduledSourceNode; extras: AudioNode[] }[] = [];

    // Soft puff body - band-limited noise, dry and grainy rather than sharp
    const puff = ctx.createBufferSource(),
      puffFilter = ctx.createBiquadFilter(),
      puffGain = ctx.createGain();
    puff.buffer = this.noiseBuffer;
    puffFilter.type = "bandpass";
    puffFilter.frequency.value = 1200;
    puffFilter.Q.value = 0.5;
    puffGain.gain.setValueAtTime(0.001, now);
    puffGain.gain.exponentialRampToValueAtTime(0.17, now + 0.008);
    puffGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    puff.connect(puffFilter).connect(puffGain).connect(panner);
    layers.push({ node: puff, extras: [puffFilter, puffGain] });

    // Dull low body for a bit of weight - lowpassed noise, not a tone
    const thump = ctx.createBufferSource(),
      thumpFilter = ctx.createBiquadFilter(),
      thumpGain = ctx.createGain();
    thump.buffer = this.noiseBuffer;
    thumpFilter.type = "lowpass";
    thumpFilter.frequency.value = 260;
    thumpGain.gain.setValueAtTime(0.001, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.11, now + 0.01);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    thump.connect(thumpFilter).connect(thumpGain).connect(panner);
    layers.push({ node: thump, extras: [thumpFilter, thumpGain] });

    // A few tiny staggered grains of scattering sand/grit
    for (let i = 0; i < 4; i++) {
      const startTime = now + 0.008 + Math.random() * 0.045;
      const grain = ctx.createBufferSource(),
        grainFilter = ctx.createBiquadFilter(),
        grainGain = ctx.createGain();
      grain.buffer = this.noiseBuffer;
      grainFilter.type = "highpass";
      grainFilter.frequency.value = 2800 + Math.random() * 2200;
      grainGain.gain.setValueAtTime(0.001, startTime);
      grainGain.gain.exponentialRampToValueAtTime(
        0.015 + Math.random() * 0.018,
        startTime + 0.002,
      );
      grainGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.02);
      grain.connect(grainFilter).connect(grainGain).connect(panner);
      grain.start(startTime);
      grain.stop(startTime + 0.03);
      layers.push({ node: grain, extras: [grainFilter, grainGain] });
    }

    puff.start(now);
    puff.stop(now + 0.08);
    thump.start(now);
    thump.stop(now + 0.11);
    let remaining = layers.length;
    for (const { node, extras } of layers) {
      node.onended = () => {
        node.disconnect();
        for (const extra of extras) extra.disconnect();
        remaining--;
        if (remaining === 0) {
          panner.disconnect();
          outputGain.disconnect();
        }
      };
    }
  }
  // Headshot: bullet strike on a steel helmet - sharp snap, brief metallic
  // "dink", and a damped thud from the head behind the shell.
  splatSound(pan = 0) {
    if (!this.audioContext || !this.noiseBuffer) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(ctx.destination);

    const strike = ctx.createBufferSource(),
      strikeFilter = ctx.createBiquadFilter(),
      strikeGain = ctx.createGain();
    strike.buffer = this.noiseBuffer;
    strikeFilter.type = "bandpass";
    strikeFilter.frequency.value = 3400;
    strikeFilter.Q.value = 1.6;
    strikeGain.gain.setValueAtTime(0.0001, now);
    strikeGain.gain.exponentialRampToValueAtTime(0.24, now + 0.002);
    strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
    strike.connect(strikeFilter).connect(strikeGain).connect(panner);
    strike.start(now);
    strike.stop(now + 0.025);

    const ringA = ctx.createOscillator(),
      ringB = ctx.createOscillator(),
      ringGain = ctx.createGain();
    ringA.type = "sine";
    ringB.type = "triangle";
    const base = 920 + Math.random() * 140;
    ringA.frequency.setValueAtTime(base, now);
    ringB.frequency.setValueAtTime(base * 1.13, now);
    ringGain.gain.setValueAtTime(0.0001, now);
    ringGain.gain.exponentialRampToValueAtTime(0.18, now + 0.003);
    ringGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    ringA.connect(ringGain);
    ringB.connect(ringGain);
    ringGain.connect(panner);
    ringA.start(now);
    ringB.start(now);
    ringA.stop(now + 0.07);
    ringB.stop(now + 0.07);

    const shell = ctx.createOscillator(),
      shellGain = ctx.createGain();
    shell.type = "square";
    shell.frequency.setValueAtTime(480 + Math.random() * 60, now);
    shellGain.gain.setValueAtTime(0.0001, now);
    shellGain.gain.exponentialRampToValueAtTime(0.1, now + 0.004);
    shellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    shell.connect(shellGain).connect(panner);
    shell.start(now);
    shell.stop(now + 0.05);

    const thud = ctx.createBufferSource(),
      thudFilter = ctx.createBiquadFilter(),
      thudGain = ctx.createGain();
    thud.buffer = this.noiseBuffer;
    thudFilter.type = "lowpass";
    thudFilter.frequency.value = 280;
    thudGain.gain.setValueAtTime(0.0001, now + 0.008);
    thudGain.gain.exponentialRampToValueAtTime(0.14, now + 0.012);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    thud.connect(thudFilter).connect(thudGain).connect(panner);
    thud.start(now + 0.008);
    thud.stop(now + 0.09);

    thud.onended = () => {
      strike.disconnect();
      strikeFilter.disconnect();
      strikeGain.disconnect();
      ringA.disconnect();
      ringB.disconnect();
      ringGain.disconnect();
      shell.disconnect();
      shellGain.disconnect();
      thud.disconnect();
      thudFilter.disconnect();
      thudGain.disconnect();
      panner.disconnect();
    };
  }
}
