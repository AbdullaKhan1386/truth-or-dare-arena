class AudioEngine {
  private ctx: AudioContext | null = null;
  private hasInitialized = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const initAudio = () => {
        this.setupContext();
        window.removeEventListener('click', initAudio);
        window.removeEventListener('touchstart', initAudio);
      };
      window.addEventListener('click', initAudio, { passive: true });
      window.addEventListener('touchstart', initAudio, { passive: true });
    }
  }

  private setupContext() {
    if (this.hasInitialized) return;
    try {
      // @ts-ignore
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.hasInitialized = true;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    } catch (e) {
      console.warn('Web Audio not supported', e);
    }
  }

  private init() {
    this.setupContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  // Play a soft wooden tick sound for countdown
  playTick() {
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.08);
    
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.linearRampToValueAtTime(0.01, t + 0.08);
    
    osc.start(t);
    osc.stop(t + 0.08);
  }

  // Play a clean woodblock click sound for UI buttons
  playClick() {
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.05);
    
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.linearRampToValueAtTime(0.01, t + 0.05);
    
    osc.start(t);
    osc.stop(t + 0.05);
  }

  // Spring "boing" sound for draws
  playDraw() {
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.type = 'sine';
    // Frequency sweeps up and down like a cartoon spring
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.linearRampToValueAtTime(350, t + 0.15);
    osc.frequency.linearRampToValueAtTime(200, t + 0.3);
    
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    
    osc.start(t);
    osc.stop(t + 0.35);
  }

  // White-noise rustle for paper fold
  playPaperFold() {
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    
    // Create white noise
    const bufferSize = this.ctx.sampleRate * 0.25; // 0.25s
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + 0.2);
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.linearRampToValueAtTime(0.01, t + 0.25);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    noise.start(t);
    noise.stop(t + 0.25);
  }

  // Low frequency rumble and impact for Rock smash
  playRockImpact() {
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    
    // Low sine thump
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.linearRampToValueAtTime(40, t + 0.15);
    
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
    
    osc.start(t);
    osc.stop(t + 0.25);

    // Crackle noise
    const bufferSize = this.ctx.sampleRate * 0.15;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(300, t);
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
    
    noise.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    
    noise.start(t);
    noise.stop(t + 0.15);
  }

  // High pitch filter sweep for Scissors cut
  playScissorsCut() {
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    
    // Snip frequency sweep
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, t);
    osc.frequency.exponentialRampToValueAtTime(2500, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.15);
    
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.linearRampToValueAtTime(0.01, t + 0.15);
    
    osc.start(t);
    osc.stop(t + 0.15);

    // Quick high-passed noise burst
    const bufferSize = this.ctx.sampleRate * 0.08;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(4000, t);
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.1, t);
    noiseGain.gain.linearRampToValueAtTime(0.01, t + 0.08);
    
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    
    noise.start(t);
    noise.stop(t + 0.08);
  }

  // Playful victory fanfare chord (major triad)
  playVictory() {
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    
    // Play C4, E4, G4, C5 in quick arpeggio and sustain
    const notes = [261.63, 329.63, 392.00, 523.25];
    notes.forEach((freq, idx) => {
      const noteTime = t + idx * 0.07;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);
      
      gain.gain.setValueAtTime(0.001, noteTime);
      gain.gain.linearRampToValueAtTime(0.12, noteTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.6);
      
      osc.start(noteTime);
      osc.stop(noteTime + 0.65);
    });
  }

  // Wholesome crowd cheering white noise swell
  playCheer() {
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    
    const duration = 1.5;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1000, t);
    filter.frequency.linearRampToValueAtTime(800, t + duration);
    filter.Q.setValueAtTime(1.5, t);
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.3);
    gain.gain.linearRampToValueAtTime(0.08, t + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    noise.start(t);
    noise.stop(t + duration);
  }
}

export const audio = new AudioEngine();
export default audio;
