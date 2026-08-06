#!/usr/bin/env python3
"""
medal_download.py - Download a public Medal.tv clip + all metadata.

Usage:
    python medal_download.py <medal_url_or_id> [output_dir]

Examples:
    python medal_download.py https://medal.tv/games/valorant/clips/jTBFnLKdLy15K
    python medal_download.py jTBFnLKdLy15K ./downloads

Outputs (per clip):
    <id>.mp4        - the video
    <id>.json       - full metadata blob returned by Medal's content API
    <id>.thumb.jpg  - thumbnail (if present)

How it works (no auth required for public clips):
    1. Parse the clip slug from the URL (everything after /clips/).
    2. GET https://medal.tv/api/content/<slug>   -> JSON metadata, including
       contentUrl (direct mp4) and contentUrlHls (m3u8).
    3. Download contentUrl with a streaming request.
    4. If contentUrl is missing/auth-gated, fall back to
       https://medal.tv/api/content/<slug>/socialVideoUrl which redirects
       to a public mp4.

This is the same endpoint and field set yt-dlp's MedalTV extractor uses, so
behavior should track yt-dlp's.
"""

import json
import os
import re
import sys
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"


def slug_from(arg: str) -> str:
    """Accept a full medal URL or a bare slug, return the slug."""
    if "/" not in arg:
        return arg.strip()
    # Handles both /games/<game>/clips/<slug> and /clip/<num>/<slug>
    m = re.search(r"/clips?/(?:\d+/)?([^/?#]+)", arg)
    if not m:
        raise SystemExit(f"Could not find a clip id in: {arg}")
    return m.group(1)


def http_get(url: str, headers=None) -> urllib.request.addinfourl:
    h = {"User-Agent": UA, "Accept": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    return urllib.request.urlopen(req, timeout=60)


def fetch_metadata(slug: str) -> dict:
    url = f"https://medal.tv/api/content/{urllib.parse.quote(slug)}"
    with http_get(url) as r:
        return json.loads(r.read().decode("utf-8"))


def fallback_video_url(slug: str) -> str:
    """If contentUrl is missing, follow the social redirect."""
    url = f"https://medal.tv/api/content/{urllib.parse.quote(slug)}/socialVideoUrl"
    with http_get(url) as r:
        return r.url


def stream_download(url: str, dest: str) -> None:
    with http_get(url, headers={"Accept": "*/*"}) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 20)  # 1 MiB
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total:
                pct = 100 * done / total
                print(
                    f"\r  {dest}  {done/1e6:6.1f} / {total/1e6:6.1f} MB  ({pct:5.1f}%)",
                    end="",
                    flush=True,
                )
    print()


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    target = argv[1]
    out_dir = argv[2] if len(argv) > 2 else "."
    os.makedirs(out_dir, exist_ok=True)

    slug = slug_from(target)
    print(f"[*] Clip id: {slug}")

    meta = fetch_metadata(slug)

    meta_path = os.path.join(out_dir, f"{slug}.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f"[+] Wrote metadata -> {meta_path}")

    # Print a quick summary of useful fields
    summary = {
        "title": meta.get("contentTitle"),
        "description": meta.get("contentDescription"),
        "uploader": (meta.get("poster") or {}).get("displayName"),
        "uploader_id": (meta.get("poster") or {}).get("userId"),
        "created_ms": meta.get("created"),
        "duration_s": meta.get("videoLengthSeconds"),
        "views": meta.get("views"),
        "likes": meta.get("likes"),
        "comments": meta.get("comments"),
        "tags": meta.get("tags"),
        "categoryId": meta.get("categoryId"),
        "contentUrl": meta.get("contentUrl"),
        "contentUrlHls": meta.get("contentUrlHls"),
        "thumbnailUrl": meta.get("thumbnailUrl"),
    }
    print("[*] Summary:")
    for k, v in summary.items():
        print(f"    {k}: {v}")

    # Thumbnail
    thumb = meta.get("thumbnailUrl")
    if thumb:
        ext = os.path.splitext(urllib.parse.urlparse(thumb).path)[1] or ".jpg"
        thumb_path = os.path.join(out_dir, f"{slug}.thumb{ext}")
        try:
            stream_download(thumb, thumb_path)
            print(f"[+] Thumbnail -> {thumb_path}")
        except Exception as e:
            print(f"[!] Thumbnail download failed: {e}")

    # Video
    video_url = meta.get("contentUrl")
    if not video_url or "video/privacy-protected-guest" in video_url:
        print(
            "[*] contentUrl missing or guest-protected; falling back to socialVideoUrl"
        )
        video_url = fallback_video_url(slug)

    if not video_url:
        print("[!] No downloadable video URL found.", file=sys.stderr)
        return 1

    video_path = os.path.join(out_dir, f"{slug}.mp4")
    print(f"[*] Downloading video from {video_url}")
    stream_download(video_url, video_path)
    print(f"[+] Video -> {video_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
