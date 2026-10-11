"""Fetch public HLTV HTML with browser-compatible TLS; no relay or paid API."""
import sys
from urllib.parse import urlparse

from curl_cffi import requests


def fetch(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "www.hltv.org" or parsed.username:
        raise ValueError("Only https://www.hltv.org URLs are supported")
    errors = []
    for profile in ("chrome", "firefox"):
        try:
            response = requests.get(
                url, impersonate=profile, timeout=20,
                headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
            )
            body = response.text
            challenge = any(marker in body for marker in (
                "Just a moment", "cf-chl-", "Attention Required",
                "Enable JavaScript and cookies",
            ))
            if response.status_code == 200 and body and not challenge:
                return body
            errors.append(f"{profile}: HTTP {response.status_code}" + (" Cloudflare challenge" if challenge else ""))
            if response.status_code == 429:
                break  # Do not hammer a rate-limited server with another profile.
        except requests.RequestsError as error:
            errors.append(f"{profile}: {type(error).__name__}")
    raise RuntimeError("; ".join(errors))


if __name__ == "__main__":
    try:
        sys.stdout.buffer.write(fetch(sys.argv[1]).encode("utf-8"))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
