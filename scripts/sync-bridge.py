"""웹앱 빌드 결과를 Spine 연결 프로그램(../spine-bridge/studio)에 복사하고 dist/spine-bridge-mac.zip을 다시 만든다.

사용 (layer-studio 폴더에서, npm run build 뒤):
    python3 scripts/sync-bridge.py
"""
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
BRIDGE = ROOT.parent / "spine-bridge"
FILES = ["index.html", "app.js", "local-engine-worker.js", "style.css", "rig-demo.json", "redraw-demo-17.json",
         "sample-character.png", "sample-half-body.png", "sample-bust.png"]
FOLDER = "Layer Studio Spine 연결"


def main():
    if not BRIDGE.is_dir():
        raise SystemExit(f"연결 프로그램 폴더가 없습니다: {BRIDGE}")
    studio = BRIDGE / "studio"
    studio.mkdir(exist_ok=True)
    for name in FILES:
        shutil.copy2(DIST / name, studio / name)
    items = ["bridge.py", "Spine 연결 시작.command", "사용법.txt"] + [f"studio/{n}" for n in FILES]
    out = DIST / "spine-bridge-mac.zip"
    tmp = out.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in items:
            info = zipfile.ZipInfo(f"{FOLDER}/{rel}")
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if rel.endswith(".command") else 0o644) << 16
            info.flag_bits |= 0x800  # UTF-8 파일 이름
            z.writestr(info, (BRIDGE / rel).read_bytes())
    tmp.replace(out)
    print(f"연결 프로그램 작업실 {len(FILES)}개 파일 갱신, {out.name} {out.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
