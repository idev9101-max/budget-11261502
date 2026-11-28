#!/usr/bin/env python3
import os, subprocess, time, socket, shutil, argparse
from pathlib import Path

CHROME = "/opt/.devin/chrome/chrome/linux-156.0.8078.47/chrome-linux64/chrome"
ROOT = Path("/home/ubuntu/experiment/budgetrepo")
APP = ROOT / "app"

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

def wait_http(url, timeout=15):
    import urllib.request
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=1).read(); return
        except Exception:
            time.sleep(0.2)
    raise RuntimeError(f"server not ready: {url}")

SHOTS = [
    ("1-cover-dashboard.jpg", "/#/", "1280,720"),
    ("2-transactions-desktop.jpg", "/#/transactions", "1280,720"),
    ("3-reports-desktop.jpg", "/#/reports", "1280,720"),
    ("4-mobile-overview.jpg", "/#/", "390,844"),
]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(ROOT / 'dev' / 'shots'))
    ap.add_argument('--port', type=int, default=0)
    args = ap.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    port = args.port or free_port()
    srv = subprocess.Popen(['python3','-m','http.server',str(port),'--bind','127.0.0.1'],
                           cwd=str(APP), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_http(f'http://127.0.0.1:{port}/')
        for name, hashp, size in SHOTS:
            dest = out / name
            if dest.exists(): dest.unlink()
            profile = ROOT / 'dev' / f'.chrome-{name.replace(".jpg","")}'
            if profile.exists(): shutil.rmtree(profile, ignore_errors=True)
            cmd = [CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
                   '--run-all-compositor-stages-before-draw', '--virtual-time-budget=7000',
                   f'--window-size={size}', f'--user-data-dir={profile}',
                   f'--screenshot={dest}', f'http://127.0.0.1:{port}/{hashp}']
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
            size_kb = dest.stat().st_size/1024 if dest.exists() else 0
            print(f"{name}: rc={r.returncode} {size_kb:.0f}KB")
            shutil.rmtree(profile, ignore_errors=True)
    finally:
        srv.terminate()
        try: srv.wait(timeout=3)
        except: srv.kill()

if __name__ == '__main__':
    main()
