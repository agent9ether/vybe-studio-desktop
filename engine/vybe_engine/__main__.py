import argparse
import faulthandler
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Vybe Studio local engine")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--models-dir", default=str(Path.home() / ".vybe" / "models"))
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu", "mps"])
    args = parser.parse_args()
    faulthandler.enable()  # print a traceback if a native library crashes

    models = Path(args.models_dir)
    # Keep every download inside the user-chosen models folder.
    os.environ.setdefault("HF_HOME", str(models / "_hf"))
    os.environ.setdefault("TORCH_HOME", str(models / "_torch"))
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

    import uvicorn

    from .server import create_app

    print(f"[vybe-engine] models dir: {models}", flush=True)
    uvicorn.run(create_app(str(models), args.device), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
