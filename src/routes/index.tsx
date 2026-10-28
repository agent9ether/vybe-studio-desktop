import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

const TICKER = [
  "lo-fi rainy tokyo",
  "doom metal about a microwave",
  "country ballad for my cat",
  "synthwave heist",
  "afrobeat morning coffee",
  "hyperpop breakup",
  "gregorian chant taco truck",
  "dnb sunday drive",
];

function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="relative grain border-b border-border">
          <div className="mx-auto grid max-w-[1400px] grid-cols-12 gap-6 px-6 pb-24 pt-20">
            <div className="col-span-12 lg:col-span-8">
              <p className="mb-8 font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
                ◐ desktop edition — open source, runs on your machine
              </p>
              <h1 className="font-display text-[clamp(3rem,11vw,11rem)] font-black leading-[0.85] tracking-[-0.04em]">
                Type a<br />
                <span className="italic text-primary">sentence.</span>
                <br />
                Get a Song,
                <br />
                <span className="underline decoration-accent decoration-[6px] underline-offset-[12px]">
                  or a Beat !
                </span>
              </h1>
            </div>

            <div className="col-span-12 flex flex-col justify-end gap-6 lg:col-span-4">
              <p className="max-w-sm font-mono text-sm leading-relaxed text-muted-foreground">
                Anyone can be a musician now. Describe the vibe — a memory, a mood, a stupid joke —
                and AI writes the lyrics, picks the genre and generates the whole damn track. Use
                open-source models on your own GPU, or plug in any music API.
              </p>
              <div className="flex flex-col gap-3">
                <Link
                  to="/studio"
                  className="inline-flex items-center justify-between rounded-sm bg-primary px-6 py-5 font-mono text-sm font-bold uppercase tracking-widest text-primary-foreground transition hover:opacity-90"
                >
                  Open the studio
                  <span aria-hidden>→</span>
                </Link>
                <Link
                  to="/models"
                  className="inline-flex items-center justify-between rounded-sm border border-border px-6 py-5 font-mono text-sm font-bold uppercase tracking-widest text-foreground hover:border-primary hover:text-primary"
                >
                  Get open-source models
                  <span aria-hidden>↓</span>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Ticker */}
        <section className="overflow-hidden border-b border-border bg-card py-6">
          <div className="marquee-track flex w-max gap-12 whitespace-nowrap font-display text-4xl italic">
            {[...TICKER, ...TICKER].map((t, i) => (
              <span key={i} className="flex items-center gap-12 text-foreground/60">
                {t}
                <span className="text-primary">✺</span>
              </span>
            ))}
          </div>
        </section>

        {/* Three-up */}
        <section className="border-b border-border">
          <div className="mx-auto grid max-w-[1400px] grid-cols-1 md:grid-cols-3">
            {[
              {
                n: "01",
                t: "Describe",
                b: "Drop a vibe in the box. Three words or thirty. The weirder the better.",
              },
              {
                n: "02",
                t: "Generate",
                b: "We write the lyrics, pick the genre, and shape the structure in seconds.",
              },
              {
                n: "03",
                t: "Listen",
                b: "Stream it back. Save it to your library. Share the link with one tap.",
              },
            ].map((s) => (
              <div key={s.n} className="border-r border-border p-10 last:border-r-0">
                <div className="mb-8 font-mono text-xs uppercase tracking-widest text-primary">
                  {s.n}
                </div>
                <h3 className="mb-4 text-5xl font-bold">{s.t}</h3>
                <p className="font-mono text-sm leading-relaxed text-muted-foreground">{s.b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Stems Lab Promotion */}
        <section className="relative border-b border-border bg-[#030205] overflow-hidden py-24">
          {/* Glow Effects */}
          <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute top-1/2 right-1/4 -translate-y-1/2 w-[400px] h-[400px] bg-accent/5 rounded-full blur-[100px] pointer-events-none" />

          <div className="mx-auto max-w-[1400px] px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-center">
              {/* Promotion Copy */}
              <div className="lg:col-span-5 space-y-8">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary font-mono text-[9px] uppercase tracking-widest font-bold">
                    <Sparkles className="h-3 w-3 animate-pulse" />
                    Now Active in Studio
                  </div>

                  <h2 className="font-display text-5xl md:text-6xl font-black leading-tight tracking-tight text-white">
                    Stems Lab
                    <br />
                    <span className="text-primary italic">AI Isolation.</span>
                  </h2>

                  <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                    Powered by Demucs Neural Stem Separation
                  </p>
                </div>

                <p className="font-mono text-sm leading-relaxed text-muted-foreground">
                  Instantly split any generated song or imported track into high-fidelity isolated
                  components. Perfect for remixing, sampling, isolating pristine vocal tracks, or
                  practicing instruments over isolated rhythm sections.
                </p>

                {/* Specs list */}
                <div className="space-y-3.5 font-mono text-[11px] text-muted-foreground border-l border-white/10 pl-4 py-1">
                  <div className="flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-pink-500 shadow-[0_0_8px_#ec4899]" />
                    <span>Vocals isolation for acapellas</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]" />
                    <span>Punchy acoustic and synth Drums</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
                    <span>Sub Bass and deep frequency isolation</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                    <span>Melodies, synths, and backing keys</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-4">
                  <Link
                    to="/stems"
                    className="flex-1 inline-flex items-center justify-center rounded-sm bg-primary px-6 py-4 font-mono text-xs font-black uppercase tracking-widest text-primary-foreground transition hover:opacity-90 hover:scale-[1.02] shadow-lg shadow-primary/25 cursor-pointer text-center"
                  >
                    Enter Stems Lab
                  </Link>
                  <div className="flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground border border-white/5 bg-white/[0.02] px-4 py-4 rounded-sm">
                    <span>Runs:</span>
                    <span className="text-white font-bold">locally · free</span>
                  </div>
                </div>
              </div>

              {/* Interactive/Mock Studio DAW Mixer Preview Graphic */}
              <div className="lg:col-span-7 relative bg-black/40 border border-white/[0.05] p-6 rounded-md backdrop-blur-md space-y-4 shadow-2xl">
                {/* Decorative Window Topbar */}
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.05]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    STUDIO MIXER PREVIEW — GROOVE FOUNDATION
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-primary font-bold">
                    4 stems active
                  </span>
                </div>

                {/* Mixer lanes list */}
                <div className="space-y-3">
                  {[
                    { name: "vocals", color: "#ec4899", vol: "+1.2", pan: "C" },
                    { name: "drums", color: "#f59e0b", vol: "-2.0", pan: "R 20" },
                    { name: "bass", color: "#3b82f6", vol: "+0.5", pan: "L 10" },
                    { name: "other", color: "#10b981", vol: "-0.5", pan: "C" },
                  ].map((item) => (
                    <div
                      key={item.name}
                      className="bg-white/[0.02] border border-white/[0.03] p-3.5 rounded-sm flex items-center justify-between gap-4 hover:bg-white/[0.03] transition-all"
                    >
                      {/* Channel badge */}
                      <div className="w-24 shrink-0 flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse"
                          style={{
                            backgroundColor: item.color,
                            boxShadow: `0 0 8px ${item.color}`,
                          }}
                        />
                        <span className="font-mono text-[10px] uppercase font-bold tracking-widest text-white">
                          {item.name}
                        </span>
                      </div>

                      {/* Peak bar mock visualizer (beautifully colored wave outline) */}
                      <div className="flex-1 h-8 bg-black/40 border border-white/[0.03] rounded-sm overflow-hidden flex items-center justify-center relative px-2">
                        {/* Generates a custom waveform bars mock using static rounded lines */}
                        <div className="w-full h-full flex items-center gap-1.5">
                          {[
                            0.2, 0.4, 0.7, 0.3, 0.6, 0.8, 0.9, 0.4, 0.2, 0.5, 0.7, 0.3, 0.5, 0.8,
                            0.6, 0.4, 0.1, 0.3, 0.5, 0.7, 0.4, 0.2,
                          ].map((heightVal, idx) => (
                            <span
                              key={idx}
                              className="flex-1 rounded-full transition-all duration-300"
                              style={{
                                height: `${heightVal * 80}%`,
                                backgroundColor: item.color,
                                opacity: idx % 3 === 0 ? 0.85 : 0.6,
                                boxShadow: idx === 6 ? `0 0 6px ${item.color}` : "none",
                              }}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Mock knobs/meters */}
                      <div className="flex items-center gap-4 text-right">
                        <div className="font-mono text-[9px] text-muted-foreground uppercase hidden sm:block">
                          <span>vol </span>
                          <span className="text-white font-bold">{item.vol} dB</span>
                        </div>
                        <div className="font-mono text-[9px] text-muted-foreground uppercase hidden sm:block">
                          <span>pan </span>
                          <span className="text-white font-bold">{item.pan}</span>
                        </div>
                        <div className="flex gap-1.5">
                          <span className="px-2 py-0.5 rounded-sm bg-white/5 font-mono text-[8px] uppercase tracking-wider text-muted-foreground border border-white/5 font-bold hover:text-white transition cursor-pointer">
                            M
                          </span>
                          <span className="px-2 py-0.5 rounded-sm bg-white/5 font-mono text-[8px] uppercase tracking-wider text-muted-foreground border border-white/5 font-bold hover:text-white transition cursor-pointer">
                            S
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Manifesto */}
        <section className="relative border-b border-border bg-primary text-primary-foreground">
          <div className="mx-auto max-w-[1400px] px-6 py-24">
            <p className="max-w-4xl font-display text-3xl italic leading-[1.1] md:text-5xl">
              "Music used to require a band, a studio, a label, ten thousand hours. Now it requires
              a sentence. We think that's beautiful."
            </p>
            <p className="mt-8 font-mono text-xs uppercase tracking-widest">
              — the Vybe Studio team
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <SiteFooter />
    </div>
  );
}
