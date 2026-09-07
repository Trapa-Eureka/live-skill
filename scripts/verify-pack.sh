#!/usr/bin/env sh
# Tarball install smoke (H2, AUD-017), run by `npm run verify:pack` / prepublishOnly / CI.
# Even when the source-tree tests pass, `npx live-skills` can still die because the published dist is
# missing (files allowlist) or because of an executable bit, shebang, or runtime dependency problem.
# This installs the real tgz into a clean temporary project with --omit=dev and runs the CLI.
# It contacts the registry (runtime dependency install), so it is not part of vitest (CLAUDE.md
# guardrail 3); release gate only.
set -eu
# `npm publish --dry-run` exports npm_config_dry_run=true to prepublishOnly; without this override the
# nested `npm pack` writes no tarball and `npm install` installs nothing, so the smoke would fail for
# the wrong reason.
export npm_config_dry_run=false

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

bin="./node_modules/.bin/live-skills"
[ -x "$bin" ] || { echo "verify-pack: $bin is missing or not executable (bin/shebang/chmod?)" >&2; exit 1; }
[ ! -d node_modules/vitest ] || { echo "verify-pack: a devDependency (vitest) was installed — dependencies/devDependencies are mixed up" >&2; exit 1; }

help=$("$bin" --help)
printf '%s\n' "$help" | grep -q "compile" || { echo "verify-pack: --help output does not mention 'compile'" >&2; printf '%s\n' "$help" >&2; exit 1; }
version=$("$bin" --version)
[ "$version" = "$expected" ] || { echo "verify-pack: --version printed '$version', package.json says '$expected'" >&2; exit 1; }

echo "verify-pack ok: $tgz installs with --omit=dev, live-skills --help works, --version = $version"
