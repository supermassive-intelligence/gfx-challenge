#!/usr/bin/env python3
"""
run_mame.py – Python wrapper for the MAME Lua replay harness.

Usage:
    python run_mame.py --rompath /path/to/berzerk \\
                       --script  /path/to/input.jsonl \\
                       --out     /path/to/output.hashes

Defaults:
    --script  <repo>/scaled_up/traces/scripts/attract-only.jsonl
    --out     /tmp/berzerk-replay.hashes
"""

import argparse
import os
import shutil
import subprocess
import sys


def repo_root() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], text=True
        ).strip()
    except subprocess.CalledProcessError:
        sys.stderr.write("❌ Error: unable to determine repository root.\n")
        sys.exit(1)


def resolve_rom_path(user_path: str) -> str:
    p = os.path.abspath(user_path)
    if not os.path.isdir(p):
        sys.stderr.write(f"❌ Error: ROM path does not exist: {p}\n")
        sys.exit(1)
    # If the user points to the 'berzerk' folder, use its parent.
    if os.path.basename(p).lower() == "berzerk":
        rom_dir = os.path.dirname(p)
    else:
        rom_dir = p
    if not os.path.isdir(os.path.join(rom_dir, "berzerk")):
        sys.stderr.write(f"❌ Error: No 'berzerk' sub-folder found inside {rom_dir}\n")
        sys.exit(1)
    return rom_dir


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the MAME Lua replay harness.")
    parser.add_argument(
        "--rompath",
        required=True,
        help="Path to the Berzerk ROM directory (e.g. …/rom/berzerk).",
    )
    parser.add_argument(
        "--script",
        default=None,
        help="Path to the input script JSONL (default: attract-only.jsonl).",
    )
    parser.add_argument(
        "--out",
        default="/tmp/berzerk-replay.hashes",
        help="Path to write the frame hashes (default: /tmp/berzerk-replay.hashes).",
    )
    args = parser.parse_args()

    rom_dir = resolve_rom_path(args.rompath)

    repo = repo_root()
    lua_script = os.path.join(os.path.dirname(__file__), "replay.lua")
    input_script = args.script or os.path.join(
        repo, "scaled_up", "traces", "scripts", "attract-only.jsonl"
    )
    hash_out = args.out

    if not os.path.isfile(lua_script):
        sys.stderr.write(f"❌ Error: Lua script not found at {lua_script}\n")
        sys.exit(1)
    if not os.path.isfile(input_script):
        sys.stderr.write(f"❌ Error: Input script not found at {input_script}\n")
        sys.exit(1)

    if shutil.which("mame") is None:
        try:
            brew_prefix = subprocess.check_output(
                ["brew", "--prefix", "mame"], text=True
            ).strip()
            mame_bin = os.path.join(brew_prefix, "bin")
            os.environ["PATH"] = f"{os.environ.get('PATH', '')}:{mame_bin}"
        except subprocess.CalledProcessError:
            sys.stderr.write("❌ Error: 'mame' executable not found in PATH.\n")
            sys.exit(1)

    os.environ["MAME_INPUT_SCRIPT"] = input_script
    os.environ["MAME_HASH_OUT"] = hash_out

    mame_cmd = [
        "mame",
        "-window",
        "-sound",
        "none",
        "-nothrottle",
        "-rompath",
        rom_dir,
        "-autoboot_script",
        lua_script,
        "berzerk",
    ]

    print(f"🚀 Launching MAME – Berzerk (replay mode)…")
    print(f"   Using ROM directory: {rom_dir}")
    print(f"   Script: {input_script}")
    print(f"   Output: {hash_out}")

    try:
        subprocess.run(mame_cmd, check=True)
    except subprocess.CalledProcessError as e:
        sys.stderr.write(f"❌ MAME exited with error code {e.returncode}\n")
        sys.exit(1)

    print(f"✅ MAME replay finished – hashes written to {hash_out}")


if __name__ == "__main__":
    main()
