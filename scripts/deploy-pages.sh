#!/usr/bin/env bash
# Build the web preview and publish it to the gh-pages branch (GitHub Pages).
# URL: https://hunmate0704.github.io/fastcal/
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist
npx expo export -p web
touch dist/.nojekyll
cp dist/index.html dist/404.html
SHA=$(git rev-parse --short HEAD)
TMP=$(mktemp -d)
cp -r dist/. "$TMP"
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="fastcal-deploy" -c user.email="deploy@users.noreply.github.com" commit -qm "web preview from $SHA"
git push -f "$(cd - >/dev/null; git config --get remote.origin.url)" gh-pages
