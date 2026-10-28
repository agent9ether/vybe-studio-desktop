import { Link } from "@tanstack/react-router";
import { invoke } from "@/lib/bridge";

const REPO = "https://github.com/agent9ether/vybe-studio-desktop";

export function SiteFooter() {
  const open = (url: string) => () => invoke("app:openExternal", { url });
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-[1400px] px-6 py-12">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div>
            <div className="font-display text-3xl font-bold">Vybe Studio</div>
            <p className="mt-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Open-source AI music studio · runs on your machine.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-12 gap-y-2 font-mono text-[10px] uppercase tracking-widest sm:grid-cols-3">
            <Link to="/models" className="text-muted-foreground hover:text-primary">
              Models
            </Link>
            <Link to="/settings" className="text-muted-foreground hover:text-primary">
              Settings
            </Link>
            <button
              onClick={open(REPO)}
              className="text-left text-muted-foreground hover:text-primary"
            >
              GitHub
            </button>
            <button
              onClick={open(`${REPO}/issues`)}
              className="text-left text-muted-foreground hover:text-primary"
            >
              Report a bug
            </button>
            <button
              onClick={open(`${REPO}/blob/main/docs/PROVIDERS.md`)}
              className="text-left text-muted-foreground hover:text-primary"
            >
              Write a provider
            </button>
            <button
              onClick={open(`${REPO}/blob/main/LICENSE`)}
              className="text-left text-muted-foreground hover:text-primary"
            >
              MIT License
            </button>
          </div>
        </div>
        <p className="mt-10 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
          You are responsible for how you use generated music and for following each model's license
          and each provider's terms.
        </p>
      </div>
    </footer>
  );
}
