// sound.js - wood on wood, synthesised. No audio files.
//
//   const sound = new Sound({ enabled: true });
//   sound.play('move' | 'capture' | 'check' | 'end');
//
// The AudioContext is created on the first sound after the user has touched
// the page (browsers refuse earlier). Everything is a few milliseconds of
// filtered noise and a short sine "knock"; nothing here can throw into the
// caller - a browser without WebAudio simply stays silent.

const RECIPES = Object.freeze({
  // [delay s, knock Hz, knock gain, noise Hz, noise gain, length s]
  move: [[0, 190, 0.5, 1900, 0.22, 0.07]],
  capture: [[0, 150, 0.6, 1300, 0.34, 0.09], [0.055, 230, 0.32, 2400, 0.16, 0.05]],
  check: [[0, 190, 0.5, 1900, 0.22, 0.07], [0.09, 880, 0.14, 0, 0, 0.16]],
  end: [[0, 392, 0.16, 0, 0, 0.32], [0.16, 523.25, 0.16, 0, 0, 0.5]],
});

export class Sound {
  #context = null;
  #noise = null;
  #unlocked = false;
  #enabled;

  constructor({ enabled = true } = {}) {
    this.#enabled = Boolean(enabled);
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.#unlocked = true;
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      };
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
    }
  }

  get enabled() {
    return this.#enabled;
  }

  set enabled(value) {
    this.#enabled = Boolean(value);
  }

  /** Plays one of the sounds; silently does nothing if sound is off or not possible. */
  play(name) {
    if (!this.#enabled || !this.#unlocked) return;
    const recipe = RECIPES[name];
    if (recipe === undefined) return;
    try {
      const context = this.#audio();
      if (context === null) return;
      if (context.state === 'suspended') context.resume();
      const now = context.currentTime + 0.005;
      for (const [delay, knockHz, knockGain, noiseHz, noiseGain, length] of recipe) {
        if (knockGain > 0) this.#knock(context, now + delay, knockHz, knockGain, length);
        if (noiseGain > 0) this.#click(context, now + delay, noiseHz, noiseGain, length);
      }
    } catch {
      // sound is a nicety; never let it break a move
    }
  }

  #audio() {
    if (this.#context !== null) return this.#context;
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (Context === undefined) return null;
    this.#context = new Context();
    // half a second of white noise, reused for every click
    const length = Math.floor(this.#context.sampleRate * 0.5);
    this.#noise = this.#context.createBuffer(1, length, this.#context.sampleRate);
    const samples = this.#noise.getChannelData(0);
    for (let i = 0; i < length; i += 1) samples[i] = Math.random() * 2 - 1;
    return this.#context;
  }

  /** A pitched knock: a sine that drops a little and dies quickly. */
  #knock(context, at, hz, gain, length) {
    const tone = context.createOscillator();
    const level = context.createGain();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(hz, at);
    tone.frequency.exponentialRampToValueAtTime(Math.max(40, hz * 0.72), at + length);
    level.gain.setValueAtTime(0.0001, at);
    level.gain.exponentialRampToValueAtTime(gain, at + 0.004);
    level.gain.exponentialRampToValueAtTime(0.0001, at + length);
    tone.connect(level).connect(context.destination);
    tone.start(at);
    tone.stop(at + length + 0.02);
  }

  /** The click of the contact: band-passed noise, a few milliseconds long. */
  #click(context, at, hz, gain, length) {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const level = context.createGain();
    source.buffer = this.#noise;
    filter.type = 'bandpass';
    filter.frequency.value = hz;
    filter.Q.value = 1.1;
    level.gain.setValueAtTime(gain, at);
    level.gain.exponentialRampToValueAtTime(0.0001, at + length * 0.6);
    source.connect(filter).connect(level).connect(context.destination);
    source.start(at, Math.random() * 0.3, length);
  }
}
