#!/usr/bin/env python3
"""Downloads the curated reference photos listed in data/photo-sources.json from Wikimedia Commons.

Only freely licensed files are accepted (CC BY, CC BY-SA, CC0, public domain); author and licence are
read from Commons metadata and written to ui/public/photos/manifest.json for attribution.
Run:  python3 -I scripts/fetch-photos.py
"""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "photo-sources.json")
OUT = os.path.join(ROOT, "ui", "public", "photos")
UA = {"User-Agent": "EasyOBD-photo-fetch/0.1 (open-source educational app)"}
OK = re.compile(r"CC BY|CC-BY|CC0|Public domain", re.I)

def get(url, tries=6):
    """GET with polite pacing and exponential back-off on HTTP 429 (Wikimedia rate limiting)."""
    for i in range(tries):
        try:
            time.sleep(3)
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or i == tries - 1:
                raise
            wait = 30 * (2 ** i)
            print(f"429 – pause {wait} s", flush=True)
            time.sleep(wait)

def api(params):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({"format": "json", **params})
    return json.loads(get(url))

def main():
    os.makedirs(OUT, exist_ok=True)
    sources = json.load(open(SRC))["photos"]
    mpath = os.path.join(OUT, "manifest.json")
    manifest = {}
    for s in sources:
        d = api({"action": "query", "titles": s["file"], "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": "640"})
        page = next(iter(d["query"]["pages"].values()))
        ii = page["imageinfo"][0]
        md = ii.get("extmetadata", {})
        lic = md.get("LicenseShortName", {}).get("value", "")
        if not OK.search(lic) or re.search(r"\bNC\b|\bND\b", lic):
            print("SKIP (licence)", s["file"], lic)
            continue
        artist = re.sub(r"<[^>]+>", "", md.get("Artist", {}).get("value", "")).strip() or "Wikimedia Commons"
        name = re.sub(r"[^a-z0-9]+", "-", s["file"][5:].lower()).strip("-")
        name = re.sub(r"-(jpg|jpeg|png|tif)$", "", name) + ".jpg"
        dest = os.path.join(OUT, name)
        if not os.path.exists(dest) or os.path.getsize(dest) == 0:
            data = get(ii["thumburl"])  # fetch first: never leave an empty file behind
            with open(dest, "wb") as f:
                f.write(data)
        manifest.setdefault(s["component"], []).append(
            {"file": name, "alt": s["alt"], "credit": artist[:80], "license": lic, "source": ii["descriptionurl"]})
        print("OK", name, lic, f"{os.path.getsize(dest)//1024} Ko", flush=True)
        json.dump(manifest, open(mpath, "w"), ensure_ascii=False, indent=1)  # incremental

if __name__ == "__main__":
    sys.exit(main())
