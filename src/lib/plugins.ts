import { VybeEffect, EffectConfig, EffectParam } from "./audio-engine";

// Helper for bypass crossfading (simple version: switch nodes)
// For a robust version, we'd use a dry/wet mix.

export class EQEffect extends VybeEffect {
  private lowNode: BiquadFilterNode;
  private midNode: BiquadFilterNode;
  private highNode: BiquadFilterNode;
  private dryNode: GainNode;
  private wetNode: GainNode;

  constructor(ctx: BaseAudioContext, config: EffectConfig) {
    super(ctx, config);

    this.lowNode = ctx.createBiquadFilter();
    this.lowNode.type = "lowshelf";
    this.lowNode.frequency.value = 320;

    this.midNode = ctx.createBiquadFilter();
    this.midNode.type = "peaking";
    this.midNode.frequency.value = 1000;
    this.midNode.Q.value = 0.5;

    this.highNode = ctx.createBiquadFilter();
    this.highNode.type = "highshelf";
    this.highNode.frequency.value = 3200;

    this.dryNode = ctx.createGain();
    this.wetNode = ctx.createGain();

    // Internal routing
    this.inputNode.disconnect();

    // Split to dry and wet
    this.inputNode.connect(this.dryNode);
    this.inputNode.connect(this.lowNode);

    // Wet chain
    this.lowNode.connect(this.midNode);
    this.midNode.connect(this.highNode);
    this.highNode.connect(this.wetNode);

    // Output mix
    this.dryNode.connect(this.outputNode);
    this.wetNode.connect(this.outputNode);

    this.updateBypass();
    this.applyParams();
  }

  getParamDefinitions(): EffectParam[] {
    return [
      {
        id: "low",
        name: "Low",
        min: -24,
        max: 24,
        step: 0.1,
        value: this.params.low || 0,
        unit: "dB",
      },
      {
        id: "mid",
        name: "Mid",
        min: -24,
        max: 24,
        step: 0.1,
        value: this.params.mid || 0,
        unit: "dB",
      },
      {
        id: "high",
        name: "High",
        min: -24,
        max: 24,
        step: 0.1,
        value: this.params.high || 0,
        unit: "dB",
      },
    ];
  }

  protected onParamChange(paramId: string, value: number): void {
    const time = this.ctx.currentTime;
    if (paramId === "low") this.lowNode.gain.setValueAtTime(value, time);
    if (paramId === "mid") this.midNode.gain.setValueAtTime(value, time);
    if (paramId === "high") this.highNode.gain.setValueAtTime(value, time);
  }

  private applyParams() {
    this.onParamChange("low", this.params.low || 0);
    this.onParamChange("mid", this.params.mid || 0);
    this.onParamChange("high", this.params.high || 0);
  }

  protected updateBypass(): void {
    const time = this.ctx.currentTime;
    if (this.enabled) {
      this.dryNode.gain.setValueAtTime(0, time);
      this.wetNode.gain.setValueAtTime(1, time);
    } else {
      this.dryNode.gain.setValueAtTime(1, time);
      this.wetNode.gain.setValueAtTime(0, time);
    }
  }
}

export class DelayEffect extends VybeEffect {
  private delayNode: DelayNode;
  private feedbackNode: GainNode;
  private dryNode: GainNode;
  private wetNode: GainNode;

  constructor(ctx: BaseAudioContext, config: EffectConfig) {
    super(ctx, config);

    this.delayNode = ctx.createDelay(2.0); // max 2s
    this.feedbackNode = ctx.createGain();
    this.dryNode = ctx.createGain();
    this.wetNode = ctx.createGain();

    this.inputNode.disconnect();

    // Routing
    this.inputNode.connect(this.dryNode);
    this.inputNode.connect(this.delayNode);

    // Feedback loop
    this.delayNode.connect(this.feedbackNode);
    this.feedbackNode.connect(this.delayNode);

    // Wet output
    this.delayNode.connect(this.wetNode);

    // Mix out
    this.dryNode.connect(this.outputNode);
    this.wetNode.connect(this.outputNode);

    this.updateBypass();
    this.applyParams();
  }

  getParamDefinitions(): EffectParam[] {
    return [
      {
        id: "time",
        name: "Time",
        min: 0,
        max: 1.0,
        step: 0.01,
        value: this.params.time || 0.25,
        unit: "s",
      },
      {
        id: "feedback",
        name: "Feedback",
        min: 0,
        max: 0.95,
        step: 0.01,
        value: this.params.feedback || 0.3,
        unit: "",
      },
      {
        id: "mix",
        name: "Mix",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.params.mix || 0.3,
        unit: "",
      },
    ];
  }

  protected onParamChange(paramId: string, value: number): void {
    const time = this.ctx.currentTime;
    if (paramId === "time") this.delayNode.delayTime.setValueAtTime(value, time);
    if (paramId === "feedback") this.feedbackNode.gain.setValueAtTime(value, time);
    if (paramId === "mix") {
      // Crossfade logic can be applied here. For simplicity, just set wet gain.
      if (this.enabled) this.wetNode.gain.setValueAtTime(value, time);
    }
  }

  private applyParams() {
    this.onParamChange("time", this.params.time ?? 0.25);
    this.onParamChange("feedback", this.params.feedback ?? 0.3);
    this.onParamChange("mix", this.params.mix ?? 0.3);
  }

  protected updateBypass(): void {
    const time = this.ctx.currentTime;
    if (this.enabled) {
      this.dryNode.gain.setValueAtTime(1, time); // Always keep dry for send-like delay insert
      this.wetNode.gain.setValueAtTime(this.params.mix ?? 0.3, time);
    } else {
      this.dryNode.gain.setValueAtTime(1, time);
      this.wetNode.gain.setValueAtTime(0, time);
    }
  }
}

// Simple Distortion using WaveShaper
function makeDistortionCurve(amount: number) {
  const k = typeof amount === "number" ? amount : 50,
    n_samples = 44100,
    curve = new Float32Array(n_samples),
    deg = Math.PI / 180;
  let i = 0,
    x;
  for (; i < n_samples; ++i) {
    x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

export class DistortionEffect extends VybeEffect {
  private waveShaper: WaveShaperNode;
  private dryNode: GainNode;
  private wetNode: GainNode;

  constructor(ctx: BaseAudioContext, config: EffectConfig) {
    super(ctx, config);

    this.waveShaper = ctx.createWaveShaper();
    this.waveShaper.oversample = "4x";

    this.dryNode = ctx.createGain();
    this.wetNode = ctx.createGain();

    this.inputNode.disconnect();
    this.inputNode.connect(this.dryNode);
    this.inputNode.connect(this.waveShaper);
    this.waveShaper.connect(this.wetNode);

    this.dryNode.connect(this.outputNode);
    this.wetNode.connect(this.outputNode);

    this.updateBypass();
    this.applyParams();
  }

  getParamDefinitions(): EffectParam[] {
    return [
      {
        id: "amount",
        name: "Amount",
        min: 0,
        max: 100,
        step: 1,
        value: this.params.amount || 20,
        unit: "",
      },
      {
        id: "mix",
        name: "Mix",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.params.mix || 0.5,
        unit: "",
      },
    ];
  }

  protected onParamChange(paramId: string, value: number): void {
    const time = this.ctx.currentTime;
    if (paramId === "amount") {
      this.waveShaper.curve = makeDistortionCurve(value);
    }
    if (paramId === "mix") {
      if (this.enabled) {
        this.dryNode.gain.setValueAtTime(1 - value, time);
        this.wetNode.gain.setValueAtTime(value, time);
      }
    }
  }

  private applyParams() {
    this.onParamChange("amount", this.params.amount ?? 20);
    this.onParamChange("mix", this.params.mix ?? 0.5);
  }

  protected updateBypass(): void {
    const time = this.ctx.currentTime;
    const mix = this.params.mix ?? 0.5;
    if (this.enabled) {
      this.dryNode.gain.setValueAtTime(1 - mix, time);
      this.wetNode.gain.setValueAtTime(mix, time);
    } else {
      this.dryNode.gain.setValueAtTime(1, time);
      this.wetNode.gain.setValueAtTime(0, time);
    }
  }
}

// Simple Reverb using algorithmic or impulse response (for now, just a dummy pass until we load an IR)
export class ReverbEffect extends VybeEffect {
  private convolver: ConvolverNode;
  private dryNode: GainNode;
  private wetNode: GainNode;

  constructor(ctx: BaseAudioContext, config: EffectConfig) {
    super(ctx, config);

    this.convolver = ctx.createConvolver();
    // In a real app, you need to load an impulse response audio buffer into this.convolver.buffer
    // For this example, we generate a simple noise burst IR.
    this.generateNoiseImpulse(2.0, 2.0);

    this.dryNode = ctx.createGain();
    this.wetNode = ctx.createGain();

    this.inputNode.disconnect();
    this.inputNode.connect(this.dryNode);
    this.inputNode.connect(this.convolver);
    this.convolver.connect(this.wetNode);

    this.dryNode.connect(this.outputNode);
    this.wetNode.connect(this.outputNode);

    this.updateBypass();
    this.applyParams();
  }

  private generateNoiseImpulse(seconds: number, decay: number) {
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * seconds;
    const impulse = this.ctx.createBuffer(2, length, sampleRate);
    const impulseL = impulse.getChannelData(0);
    const impulseR = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) {
      impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    this.convolver.buffer = impulse;
  }

  getParamDefinitions(): EffectParam[] {
    return [
      {
        id: "mix",
        name: "Mix",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.params.mix || 0.3,
        unit: "",
      },
    ];
  }

  protected onParamChange(paramId: string, value: number): void {
    const time = this.ctx.currentTime;
    if (paramId === "mix") {
      if (this.enabled) {
        this.dryNode.gain.setValueAtTime(1 - value, time);
        this.wetNode.gain.setValueAtTime(value, time);
      }
    }
  }

  private applyParams() {
    this.onParamChange("mix", this.params.mix ?? 0.3);
  }

  protected updateBypass(): void {
    const time = this.ctx.currentTime;
    const mix = this.params.mix ?? 0.3;
    if (this.enabled) {
      this.dryNode.gain.setValueAtTime(1 - mix, time);
      this.wetNode.gain.setValueAtTime(mix, time);
    } else {
      this.dryNode.gain.setValueAtTime(1, time);
      this.wetNode.gain.setValueAtTime(0, time);
    }
  }
}

export class CompressorEffect extends VybeEffect {
  private compNode: DynamicsCompressorNode;

  constructor(ctx: BaseAudioContext, config: EffectConfig) {
    super(ctx, config);
    this.compNode = ctx.createDynamicsCompressor();

    this.inputNode.disconnect();
    this.inputNode.connect(this.compNode);
    this.compNode.connect(this.outputNode);

    this.updateBypass();
    this.applyParams();
  }

  getParamDefinitions(): EffectParam[] {
    return [
      {
        id: "threshold",
        name: "Threshold",
        min: -100,
        max: 0,
        step: 1,
        value: this.params.threshold ?? -24,
        unit: "dB",
      },
      {
        id: "ratio",
        name: "Ratio",
        min: 1,
        max: 20,
        step: 1,
        value: this.params.ratio ?? 4,
        unit: ":1",
      },
      {
        id: "attack",
        name: "Attack",
        min: 0,
        max: 1,
        step: 0.001,
        value: this.params.attack ?? 0.003,
        unit: "s",
      },
      {
        id: "release",
        name: "Release",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.params.release ?? 0.25,
        unit: "s",
      },
    ];
  }

  protected onParamChange(paramId: string, value: number): void {
    const time = this.ctx.currentTime;
    if (paramId === "threshold") this.compNode.threshold.setValueAtTime(value, time);
    if (paramId === "ratio") this.compNode.ratio.setValueAtTime(value, time);
    if (paramId === "attack") this.compNode.attack.setValueAtTime(value, time);
    if (paramId === "release") this.compNode.release.setValueAtTime(value, time);
  }

  private applyParams() {
    this.onParamChange("threshold", this.params.threshold ?? -24);
    this.onParamChange("ratio", this.params.ratio ?? 4);
    this.onParamChange("attack", this.params.attack ?? 0.003);
    this.onParamChange("release", this.params.release ?? 0.25);
  }

  protected updateBypass(): void {
    // Basic implementation: if bypassed, connect input directly to output, else route through compressor
    this.inputNode.disconnect();
    this.compNode.disconnect();

    if (this.enabled) {
      this.inputNode.connect(this.compNode);
      this.compNode.connect(this.outputNode);
    } else {
      this.inputNode.connect(this.outputNode);
    }
  }
}

export class LimiterEffect extends CompressorEffect {
  constructor(ctx: BaseAudioContext, config: EffectConfig) {
    // A limiter is just a compressor with high ratio and fast attack
    super(ctx, {
      ...config,
      type: "limiter",
      params: { threshold: -1, ratio: 20, attack: 0.001, release: 0.1, ...config.params },
    });
  }
}

export class ChorusEffect extends VybeEffect {
  private delayNode: DelayNode;
  private lfo: OscillatorNode;
  private lfoGain: GainNode;
  private dryNode: GainNode;
  private wetNode: GainNode;

  constructor(ctx: BaseAudioContext, config: EffectConfig) {
    super(ctx, config);

    this.delayNode = ctx.createDelay();
    this.lfo = ctx.createOscillator();
    this.lfoGain = ctx.createGain();

    this.dryNode = ctx.createGain();
    this.wetNode = ctx.createGain();

    // LFO modulates the delay time
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.delayNode.delayTime);
    this.lfo.start(0);

    this.inputNode.disconnect();
    this.inputNode.connect(this.dryNode);
    this.inputNode.connect(this.delayNode);
    this.delayNode.connect(this.wetNode);

    this.dryNode.connect(this.outputNode);
    this.wetNode.connect(this.outputNode);

    this.updateBypass();
    this.applyParams();
  }

  getParamDefinitions(): EffectParam[] {
    return [
      {
        id: "rate",
        name: "Rate",
        min: 0.1,
        max: 10,
        step: 0.1,
        value: this.params.rate || 1.5,
        unit: "Hz",
      },
      {
        id: "depth",
        name: "Depth",
        min: 0,
        max: 0.05,
        step: 0.001,
        value: this.params.depth || 0.003,
        unit: "s",
      },
      {
        id: "delay",
        name: "Delay",
        min: 0,
        max: 0.1,
        step: 0.001,
        value: this.params.delay || 0.03,
        unit: "s",
      },
      {
        id: "mix",
        name: "Mix",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.params.mix || 0.5,
        unit: "",
      },
    ];
  }

  protected onParamChange(paramId: string, value: number): void {
    const time = this.ctx.currentTime;
    if (paramId === "rate") this.lfo.frequency.setValueAtTime(value, time);
    if (paramId === "depth") this.lfoGain.gain.setValueAtTime(value, time);
    // Base delay time is set via the delayNode (but wait, lfo is connected to it, so it adds to the base)
    // Actually delayTime.value sets the base.
    if (paramId === "delay") {
      // Small hack: if we set value, it overrides LFO sometimes. Actually they sum.
      this.delayNode.delayTime.setValueAtTime(value, time);
    }
    if (paramId === "mix") {
      if (this.enabled) {
        this.dryNode.gain.setValueAtTime(1 - value, time);
        this.wetNode.gain.setValueAtTime(value, time);
      }
    }
  }

  private applyParams() {
    this.onParamChange("rate", this.params.rate ?? 1.5);
    this.onParamChange("depth", this.params.depth ?? 0.003);
    this.onParamChange("delay", this.params.delay ?? 0.03);
    this.onParamChange("mix", this.params.mix ?? 0.5);
  }

  protected updateBypass(): void {
    const time = this.ctx.currentTime;
    const mix = this.params.mix ?? 0.5;
    if (this.enabled) {
      this.dryNode.gain.setValueAtTime(1 - mix, time);
      this.wetNode.gain.setValueAtTime(mix, time);
    } else {
      this.dryNode.gain.setValueAtTime(1, time);
      this.wetNode.gain.setValueAtTime(0, time);
    }
  }
}

export class PhaserEffect extends VybeEffect {
  private filters: BiquadFilterNode[] = [];
  private lfo: OscillatorNode;
  private lfoGain: GainNode;
  private dryNode: GainNode;
  private wetNode: GainNode;

  constructor(ctx: BaseAudioContext, config: EffectConfig) {
    super(ctx, config);

    this.lfo = ctx.createOscillator();
    this.lfoGain = ctx.createGain();
    this.lfo.connect(this.lfoGain);
    this.lfo.start(0);

    this.dryNode = ctx.createGain();
    this.wetNode = ctx.createGain();

    this.inputNode.disconnect();
    this.inputNode.connect(this.dryNode);

    // Create 4 allpass filters
    let lastNode: AudioNode = this.inputNode;
    for (let i = 0; i < 4; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = "allpass";
      filter.frequency.value = 1000;
      filter.Q.value = 1;
      this.lfoGain.connect(filter.frequency);
      lastNode.connect(filter);
      lastNode = filter;
      this.filters.push(filter);
    }

    lastNode.connect(this.wetNode);

    this.dryNode.connect(this.outputNode);
    this.wetNode.connect(this.outputNode);

    this.updateBypass();
    this.applyParams();
  }

  getParamDefinitions(): EffectParam[] {
    return [
      {
        id: "rate",
        name: "Rate",
        min: 0.1,
        max: 10,
        step: 0.1,
        value: this.params.rate || 0.5,
        unit: "Hz",
      },
      {
        id: "depth",
        name: "Depth",
        min: 100,
        max: 4000,
        step: 10,
        value: this.params.depth || 1000,
        unit: "Hz",
      },
      {
        id: "baseFreq",
        name: "Base Freq",
        min: 200,
        max: 4000,
        step: 10,
        value: this.params.baseFreq || 1000,
        unit: "Hz",
      },
      {
        id: "mix",
        name: "Mix",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.params.mix || 0.5,
        unit: "",
      },
    ];
  }

  protected onParamChange(paramId: string, value: number): void {
    const time = this.ctx.currentTime;
    if (paramId === "rate") this.lfo.frequency.setValueAtTime(value, time);
    if (paramId === "depth") this.lfoGain.gain.setValueAtTime(value, time);
    if (paramId === "baseFreq") {
      this.filters.forEach((f) => f.frequency.setValueAtTime(value, time));
    }
    if (paramId === "mix") {
      if (this.enabled) {
        this.dryNode.gain.setValueAtTime(1 - value, time);
        this.wetNode.gain.setValueAtTime(value, time);
      }
    }
  }

  private applyParams() {
    this.onParamChange("rate", this.params.rate ?? 0.5);
    this.onParamChange("depth", this.params.depth ?? 1000);
    this.onParamChange("baseFreq", this.params.baseFreq ?? 1000);
    this.onParamChange("mix", this.params.mix ?? 0.5);
  }

  protected updateBypass(): void {
    const time = this.ctx.currentTime;
    const mix = this.params.mix ?? 0.5;
    if (this.enabled) {
      this.dryNode.gain.setValueAtTime(1 - mix, time);
      this.wetNode.gain.setValueAtTime(mix, time);
    } else {
      this.dryNode.gain.setValueAtTime(1, time);
      this.wetNode.gain.setValueAtTime(0, time);
    }
  }
}

// Dummy effect for Pitch Shift
export class PitchShiftEffect extends VybeEffect {
  constructor(ctx: BaseAudioContext, config: EffectConfig) {
    super(ctx, config);
  }
  getParamDefinitions(): EffectParam[] {
    return [
      {
        id: "semitones",
        name: "Semitones",
        min: -12,
        max: 12,
        step: 1,
        value: this.params.semitones || 0,
        unit: "st",
      },
    ];
  }
  protected onParamChange() {}
  protected updateBypass() {}
}

// Dummy effect for Auto-Tune
export class AutoTuneEffect extends VybeEffect {
  constructor(ctx: BaseAudioContext, config: EffectConfig) {
    super(ctx, config);
  }
  getParamDefinitions(): EffectParam[] {
    return [
      {
        id: "speed",
        name: "Retune Speed",
        min: 0,
        max: 100,
        step: 1,
        value: this.params.speed || 10,
        unit: "ms",
      },
      { id: "mix", name: "Mix", min: 0, max: 1, step: 0.01, value: this.params.mix || 1, unit: "" },
    ];
  }
  protected onParamChange() {}
  protected updateBypass() {}
}

// Factory to create effects
export function createEffect(ctx: BaseAudioContext, config: EffectConfig): VybeEffect {
  switch (config.type) {
    case "eq":
      return new EQEffect(ctx, config);
    case "delay":
      return new DelayEffect(ctx, config);
    case "distortion":
      return new DistortionEffect(ctx, config);
    case "reverb":
      return new ReverbEffect(ctx, config);
    case "compressor":
      return new CompressorEffect(ctx, config);
    case "limiter":
      return new LimiterEffect(ctx, config);
    case "chorus":
      return new ChorusEffect(ctx, config);
    case "phaser":
      return new PhaserEffect(ctx, config);
    case "pitchshift":
      return new PitchShiftEffect(ctx, config);
    case "autotune":
      return new AutoTuneEffect(ctx, config);
    default:
      throw new Error(`Unknown effect type: ${config.type}`);
  }
}
