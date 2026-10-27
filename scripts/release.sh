#!/usr/bin/env bash
# Builds the Docker image and packages it with the deploy compose file into
# release/consent-cookie-<version>/, ready to copy to the deploy server.
# Usage: bash scripts/release.sh   (version comes from the root package.json)
set -euo pipefail

cd "$(dirname "$0")/.."

version=$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' package.json)
[ -n "$version" ] || { echo "could not read version from package.json" >&2; exit 1; }

image="consent-cookie:$version"
name="consent-cookie-$version"
out="release/$name"

echo "==> Building $image (typecheck + tests run inside the build)"
docker build --platform linux/amd64 -t "$image" -t consent-cookie:latest .

echo "==> Packaging into $out"
rm -rf "$out"
mkdir -p "$out"
docker save "$image" | gzip > "$out/$name.tar.gz"
sed "s/\${IMAGE_TAG:-[^}]*}/\${IMAGE_TAG:-$version}/" deploy/docker-compose.yml > "$out/docker-compose.yml"
cp deploy/DEPLOY.md .env.example "$out/"
(cd "$out" && sha256sum "$name.tar.gz" > SHA256SUMS)

echo "==> Done"
ls -lh "$out"
cat "$out/SHA256SUMS"
