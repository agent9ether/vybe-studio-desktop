import { useState } from "react";
import { EffectConfig, EffectParam, EffectType } from "@/lib/audio-engine";
import { X, Plus, Power, Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TrackEffectsPanelProps {
  channelName: string;
  effects: EffectConfig[];
  onEffectsChange: (newEffects: EffectConfig[]) => void;
  onClose: () => void;
}

const AVAILABLE_EFFECTS: { type: EffectType; name: string }[] = [
  { type: "eq", name: "EQ" },
  { type: "delay", name: "Delay" },
  { type: "reverb", name: "Reverb" },
  { type: "distortion", name: "Distortion" },
  { type: "compressor", name: "Compressor" },
  { type: "chorus", name: "Chorus" },
  { type: "phaser", name: "Phaser" },
  { type: "pitchshift", name: "Pitch Shift (Proto)" },
  { type: "autotune", name: "Auto-Tune (Proto)" },
];

export function TrackEffectsPanel({
  channelName,
  effects,
  onEffectsChange,
  onClose,
}: TrackEffectsPanelProps) {
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);

  const addEffect = (type: EffectType, name: string) => {
    const newEffect: EffectConfig = {
      id: `${type}-${Date.now()}`,
      type,
      name,
      enabled: true,
      params: {}, // Defaults will be handled by the plugin classes
    };
    onEffectsChange([...effects, newEffect]);
    setSelectedEffectId(newEffect.id);
  };

  const removeEffect = (id: string) => {
    onEffectsChange(effects.filter((e) => e.id !== id));
    if (selectedEffectId === id) setSelectedEffectId(null);
  };

  const toggleEffect = (id: string) => {
    onEffectsChange(effects.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)));
  };

  const updateParam = (effectId: string, paramId: string, value: number) => {
    onEffectsChange(
      effects.map((e) =>
        e.id === effectId ? { ...e, params: { ...e.params, [paramId]: value } } : e,
      ),
    );
  };

  const selectedEffect = effects.find((e) => e.id === selectedEffectId);

  // Helper to render sliders based on param definitions
  // In a real app we'd fetch the param definitions directly from the instantiated VybeEffect,
  // but for the UI we can define a static map or recreate them.
  // For simplicity, we'll hardcode the UI controls for now based on type.
  const renderParams = (effect: EffectConfig) => {
    const renderSlider = (
      paramId: string,
      label: string,
      min: number,
      max: number,
      step: number,
      defaultVal: number,
      unit: string = "",
    ) => {
      const value = effect.params[paramId] ?? defaultVal;
      return (
        <div key={paramId} className="flex flex-col gap-1 mb-4">
          <div className="flex justify-between text-xs text-slate-400">
            <span>{label}</span>
            <span>
              {Number(value).toFixed(2)}
              {unit}
            </span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => updateParam(effect.id, paramId, parseFloat(e.target.value))}
            className="w-full accent-emerald-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      );
    };

    switch (effect.type) {
      case "eq":
        return (
          <>
            {renderSlider("low", "Low", -24, 24, 0.1, 0, "dB")}
            {renderSlider("mid", "Mid", -24, 24, 0.1, 0, "dB")}
            {renderSlider("high", "High", -24, 24, 0.1, 0, "dB")}
          </>
        );
      case "delay":
        return (
          <>
            {renderSlider("time", "Time", 0, 1.0, 0.01, 0.25, "s")}
            {renderSlider("feedback", "Feedback", 0, 0.95, 0.01, 0.3)}
            {renderSlider("mix", "Mix", 0, 1, 0.01, 0.3)}
          </>
        );
      case "distortion":
        return (
          <>
            {renderSlider("amount", "Drive", 0, 100, 1, 20)}
            {renderSlider("mix", "Mix", 0, 1, 0.01, 0.5)}
          </>
        );
      case "reverb":
        return <>{renderSlider("mix", "Mix", 0, 1, 0.01, 0.3)}</>;
      case "compressor":
        return (
          <>
            {renderSlider("threshold", "Threshold", -100, 0, 1, -24, "dB")}
            {renderSlider("ratio", "Ratio", 1, 20, 1, 4, ":1")}
            {renderSlider("attack", "Attack", 0, 1, 0.001, 0.003, "s")}
            {renderSlider("release", "Release", 0, 1, 0.01, 0.25, "s")}
          </>
        );
      case "chorus":
        return (
          <>
            {renderSlider("rate", "Rate", 0.1, 10, 0.1, 1.5, "Hz")}
            {renderSlider("depth", "Depth", 0, 0.05, 0.001, 0.003, "s")}
            {renderSlider("delay", "Delay", 0, 0.1, 0.001, 0.03, "s")}
            {renderSlider("mix", "Mix", 0, 1, 0.01, 0.5)}
          </>
        );
      case "phaser":
        return (
          <>
            {renderSlider("rate", "Rate", 0.1, 10, 0.1, 0.5, "Hz")}
            {renderSlider("depth", "Depth", 100, 4000, 10, 1000, "Hz")}
            {renderSlider("baseFreq", "Base Freq", 200, 4000, 10, 1000, "Hz")}
            {renderSlider("mix", "Mix", 0, 1, 0.01, 0.5)}
          </>
        );
      case "pitchshift":
        return <>{renderSlider("semitones", "Semitones", -12, 12, 1, 0, "st")}</>;
      case "autotune":
        return (
          <>
            {renderSlider("speed", "Retune Speed", 0, 100, 1, 10, "ms")}
            {renderSlider("mix", "Mix", 0, 1, 0.01, 1)}
          </>
        );
      default:
        return <div className="text-sm text-slate-500">No parameters available</div>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-[600px]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-semibold text-slate-100">{channelName} FX Chain</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar: Effect List */}
          <div className="w-1/3 border-r border-slate-800 bg-slate-900/50 flex flex-col">
            <div className="p-3 border-b border-slate-800">
              <div className="dropdown relative group">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-xs border-slate-700 bg-slate-800 hover:bg-slate-700"
                >
                  <Plus className="w-3 h-3 mr-2" /> Add Effect
                </Button>
                <div className="absolute top-full left-0 mt-1 w-full bg-slate-800 border border-slate-700 rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                  {AVAILABLE_EFFECTS.map((fx) => (
                    <button
                      key={fx.type}
                      onClick={() => addEffect(fx.type, fx.name)}
                      className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-emerald-500/20 hover:text-emerald-400"
                    >
                      {fx.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {effects.map((effect, index) => (
                <div
                  key={effect.id}
                  className={`flex items-center justify-between p-2 rounded cursor-pointer border ${
                    selectedEffectId === effect.id
                      ? "bg-emerald-900/20 border-emerald-500/30 text-emerald-400"
                      : "bg-slate-800/50 border-slate-700/50 text-slate-300 hover:bg-slate-800"
                  }`}
                  onClick={() => setSelectedEffectId(effect.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-mono w-4">{index + 1}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleEffect(effect.id);
                      }}
                      className={`p-1 rounded ${effect.enabled ? "text-emerald-500" : "text-slate-600"} hover:bg-slate-700`}
                    >
                      <Power className="w-3 h-3" />
                    </button>
                    <span className="text-sm truncate w-24">{effect.name}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeEffect(effect.id);
                    }}
                    className="text-slate-500 hover:text-rose-400 p-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {effects.length === 0 && (
                <div className="text-center p-4 text-xs text-slate-500 italic">
                  No effects in chain
                </div>
              )}
            </div>
          </div>

          {/* Main Area: Effect Parameters */}
          <div className="w-2/3 bg-slate-900 flex flex-col">
            {selectedEffect ? (
              <div className="p-6 h-full flex flex-col">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xl font-bold text-slate-200">{selectedEffect.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 uppercase tracking-widest">
                      {selectedEffect.type}
                    </span>
                    <button
                      onClick={() => toggleEffect(selectedEffect.id)}
                      className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                        selectedEffect.enabled
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {selectedEffect.enabled ? "ON" : "BYPASSED"}
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">{renderParams(selectedEffect)}</div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500">
                <p>Select an effect to view parameters</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
