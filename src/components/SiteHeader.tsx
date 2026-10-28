import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import type { EngineStatus } from "@shared/types";
import { useAuth } from "@/hooks/useAuth";
import { invoke } from "@/lib/bridge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

const NAV = [
  { to: "/studio", label: "Studio" },
  { to: "/library", label: "Library" },
  { to: "/stems", label: "Stems" },
  { to: "/studio/artists", label: "Artists" },
  { to: "/models", label: "Models" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/settings", label: "Settings" },
] as const;

let lastStatus: EngineStatus | null = null;

function EnginePill() {
  const [status, setStatus] = useState<EngineStatus | null>(lastStatus);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      invoke<EngineStatus>("engine:status")
        .then((s) => {
          lastStatus = s;
          if (alive) setStatus(s);
        })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!status) return null;
  const label = status.running
    ? (status.gpu ?? status.device ?? "engine on")
    : status.starting
      ? "engine starting…"
      : status.installed
        ? "engine idle"
        : "no local engine";
  return (
    <Link
      to="/models"
      title="Local model engine"
      className="hidden max-w-[220px] items-center gap-2 truncate rounded-full border border-border px-3 py-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary lg:flex"
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.running ? "bg-primary" : status.installed ? "bg-muted-foreground" : "bg-destructive"}`}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function SiteHeader() {
  const { user, profile } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const closeMenu = () => setIsMobileMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2" onClick={closeMenu}>
          <div className="flex h-7 items-end gap-[2px]">
            {[0.4, 1, 0.6, 0.9, 0.3].map((h, i) => (
              <span
                key={i}
                className="w-[3px] origin-bottom bg-primary pulse-bar"
                style={{ height: `${h * 100}%`, animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
          <span className="font-display text-2xl font-bold tracking-tighter">Vybe Studio</span>
          <span className="rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-widest text-primary">
            desktop · oss
          </span>
        </Link>

        <nav className="hidden items-center gap-6 font-mono text-xs uppercase tracking-widest md:flex">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="hover:text-primary"
              activeOptions={{ exact: n.to === "/studio" }}
              activeProps={{ className: "text-primary" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <EnginePill />
          {user && (
            <Link
              to="/settings"
              className="hidden items-center gap-2 md:flex"
              title="Profile & settings"
            >
              <Avatar className="h-6 w-6 border border-border">
                <AvatarImage src={user.user_metadata?.avatar_url} />
                <AvatarFallback className="bg-card text-[10px] uppercase text-muted-foreground">
                  {profile?.displayName?.charAt(0) || "V"}
                </AvatarFallback>
              </Avatar>
            </Link>
          )}
          <button
            className="p-2 text-foreground md:hidden"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="absolute left-0 top-16 flex w-full flex-col gap-6 border-b border-border bg-background/95 p-6 font-mono text-sm uppercase tracking-widest shadow-lg backdrop-blur-xl md:hidden">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              onClick={closeMenu}
              className="hover:text-primary"
              activeProps={{ className: "text-primary" }}
            >
              {n.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
