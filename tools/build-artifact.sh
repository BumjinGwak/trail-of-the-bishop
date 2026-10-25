#!/usr/bin/env bash
# index.html 에서 문서 껍데기(doctype/html/head/body, charset/viewport meta)를 떼어
# claude.ai 아티팩트용 조각 HTML 을 dist/index.html 로 만든다.
set -e
cd "$(dirname "$0")/.."
mkdir -p dist
sed -E '/^<!doctype/Id; /^<\/?html/d; /^<\/?head>/d; /^<\/?body>/d; /^<meta charset/d; /^<meta name="viewport"/d' index.html > dist/index.html
echo "dist/index.html: $(wc -l < dist/index.html) lines"
