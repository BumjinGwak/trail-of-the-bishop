#!/usr/bin/env bash
# 회사 계정과 무관한 정적 호스팅(Netlify Drop, GitHub Pages, itch.io 등)에 올릴 배포 폴더를 만든다.
# deploy/ 에 실행에 필요한 5개 파일만 복사하고, deploy.zip 도 만든다 (itch.io 업로드용).
set -e
cd "$(dirname "$0")/.."
rm -rf deploy
mkdir -p deploy
cp index.html style.css engine.js levels.js game.js deploy/
powershell.exe -NoProfile -Command "Compress-Archive -Path 'deploy\*' -DestinationPath 'deploy.zip' -Force" >/dev/null
echo "deploy/: $(ls deploy | tr '\n' ' ')"
echo "deploy.zip: $(stat -c %s deploy.zip) bytes"
