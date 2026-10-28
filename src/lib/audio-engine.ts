export type EffectType =
  | "eq"
  | "reverb"
  | "delay"
  | "distortion"
  | "compressor"
  | "limiter"
  | "autotune"
  | "pitchshift"
  | "chorus"
  | "phaser";

export interface EffectParam {
  id: string;
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
}

export interface EffectConfig {
  id: string;
  type: EffectType;
  name: string;
  enabled: boolean;
  params: Record<string, number>;
}

export abstract class VybeEffect {
  public id: string;
  public type: EffectType;
  public name: string;
  public enabled: boolean;
  public params: Record<string, number>;

  protected inputNode: AudioNode;
  protected outputNode: AudioNode;
  protected ctx: BaseAudioContext; // BaseAudioContext allows for both AudioContext and OfflineAudioContext

  constructor(ctx: BaseAudioContext, config: EffectConfig) {
    this.ctx = ctx;
    this.id = config.id;
    this.type = config.type;
    this.name = config.name;
    this.enabled = config.enabled;
    this.params = { ...config.params };

    // Default passthrough nodes
    this.inputNode = ctx.createGain();
    this.outputNode = ctx.createGain();
    this.inputNode.connect(this.outputNode);
  }

  abstract getParamDefinitions(): EffectParam[];

  public connect(destination: AudioNode | AudioParam) {
    if (destination instanceof AudioNode) {
      this.outputNode.connect(destination);
    } else {
      this.outputNode.connect(destination);
    }
  }

  public disconnect() {
    this.outputNode.disconnect();
  }

  public getInputNode() {
    return this.inputNode;
  }

  public getOutputNode() {
    return this.outputNode;
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.updateBypass();
  }

  public updateParam(paramId: string, value: number) {
    this.params[paramId] = value;
    this.onParamChange(paramId, value);
  }

  protected abstract onParamChange(paramId: string, value: number): void;
  protected abstract updateBypass(): void;
}

// Effect Chain Manager
export class EffectChain {
  private ctx: BaseAudioContext;
  private effects: VybeEffect[] = [];
  public inputNode: GainNode;
  public outputNode: GainNode;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.inputNode = ctx.createGain();
    this.outputNode = ctx.createGain();
    this.inputNode.connect(this.outputNode); // Initial passthrough
  }

  public setEffects(newEffects: VybeEffect[]) {
    // Disconnect old chain
    this.inputNode.disconnect();
    this.effects.forEach((fx) => fx.disconnect());

    this.effects = newEffects;

    if (this.effects.length === 0) {
      this.inputNode.connect(this.outputNode);
      return;
    }

    // Connect new chain
    this.inputNode.connect(this.effects[0].getInputNode());
    for (let i = 0; i < this.effects.length - 1; i++) {
      this.effects[i].connect(this.effects[i + 1].getInputNode());
    }
    this.effects[this.effects.length - 1].connect(this.outputNode);
  }

  // Syncs the chain with a new array of configs (adding, removing, updating, and reordering)
  public updateFromConfig(ctx: BaseAudioContext, configs: EffectConfig[]) {
    // Basic diffing to reuse instances when possible.
    // This avoids glitching audio by not rebuilding the whole graph if only params changed.
    let rebuildGraph = false;

    // Check if the order or effects changed
    if (this.effects.length !== configs.length) {
      rebuildGraph = true;
    } else {
      for (let i = 0; i < configs.length; i++) {
        if (this.effects[i].id !== configs[i].id || this.effects[i].type !== configs[i].type) {
          rebuildGraph = true;
          break;
        }
      }
    }

    if (rebuildGraph) {
      // Re-instantiate everything (import dynamically to avoid circular dependencies if needed,
      // but we'll assume a factory function is passed or we import it here)
      // Since createEffect is in plugins.ts, we should pass it or move the factory out.
      // For now, we will rely on the caller to just use `setEffects` if rebuilding,
      // but let's implement the param updates here anyway.
    } else {
      // Just update params and enabled state
      for (let i = 0; i < configs.length; i++) {
        const effect = this.effects[i];
        const config = configs[i];

        if (effect.enabled !== config.enabled) {
          effect.setEnabled(config.enabled);
        }

        for (const [key, value] of Object.entries(config.params)) {
          if (effect.params[key] !== value) {
            effect.updateParam(key, value);
          }
        }
      }
    }

    return rebuildGraph;
  }

  public getEffects() {
    return this.effects;
  }

  public dispose() {
    this.inputNode.disconnect();
    this.effects.forEach((fx) => fx.disconnect());
    this.outputNode.disconnect();
  }
}
