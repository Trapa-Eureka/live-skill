#!/usr/bin/env sh
# npm 배포 tarball에 시크릿 파일·키 문자열이 섞이지 않았는지 확인 (가드레일 7).
# 출처: msg-agent(../msg-agent/scripts/check-tarball.sh) 이식 — docs/PUBLISHING.md §1.
set -eu
list=$(npm pack --dry-run 2>&1)
if printf '%s\n' "$list" | grep -qE '(^|/)(\.env|\.env\..*|config\.json|\.live-skill/)'; then
  echo "publish blocked: secret file in tarball" >&2
  printf '%s\n' "$list" | grep -E '(^|/)(\.env|config\.json|\.live-skill/)' >&2
  exit 1
fi
if grep -rEq 'sk-ant-[A-Za-z0-9_-]{20}|sk-proj-[A-Za-z0-9_-]{20}' dist LICENSE README.md package.json 2>/dev/null; then
  echo "publish blocked: key-like string found in publish set" >&2
  exit 1
fi
echo "tarball check ok: no secret files, no key-like strings"
