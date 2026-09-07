#!/usr/bin/env sh
# tarball 설치 스모크(H2, AUD-017) — `npm run verify:pack` / prepublishOnly / CI.
# 소스 트리 테스트가 통과해도 배포된 dist가 빠졌거나(파일 화이트리스트), 실행 권한·shebang·런타임 의존성 문제로
# `npx live-skill`이 죽을 수 있다. 실제 tgz를 깨끗한 임시 프로젝트에 --omit=dev로 설치해 CLI를 실행해 본다.
# 레지스트리에 접속하므로(런타임 의존성 설치) vitest에는 넣지 않는다(CLAUDE.md 가드레일 3) — 릴리스 게이트 전용.
set -eu

root=$(pwd)
expected=$(node -p "require('$root/package.json').version")
tmp=$(mktemp -d "${TMPDIR:-/tmp}/live-skill-verify-pack.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

tgz=$(npm pack --pack-destination "$tmp" --json 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync(0,'utf8'))[0].filename")
[ -f "$tmp/$tgz" ] || { echo "verify-pack: npm pack produced no tarball" >&2; exit 1; }

mkdir "$tmp/app"
cd "$tmp/app"
npm init -y >/dev/null 2>&1
npm install --omit=dev --no-audit --no-fund --loglevel=error "$tmp/$tgz" >/dev/null

bin="./node_modules/.bin/live-skill"
[ -x "$bin" ] || { echo "verify-pack: $bin is missing or not executable (bin/shebang/chmod?)" >&2; exit 1; }
[ ! -d node_modules/vitest ] || { echo "verify-pack: a devDependency (vitest) was installed — dependencies/devDependencies are mixed up" >&2; exit 1; }

help=$("$bin" --help)
printf '%s\n' "$help" | grep -q "compile" || { echo "verify-pack: --help output does not mention 'compile'" >&2; printf '%s\n' "$help" >&2; exit 1; }
version=$("$bin" --version)
[ "$version" = "$expected" ] || { echo "verify-pack: --version printed '$version', package.json says '$expected'" >&2; exit 1; }

echo "verify-pack ok: $tgz installs with --omit=dev, live-skill --help works, --version = $version"
