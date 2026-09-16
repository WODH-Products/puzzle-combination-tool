#!/usr/bin/env bash
# One-time GitHub setup: create the repository, push, and turn on Pages.
#
#   ./tools/publish.sh                    # private repo named puzzle-combination-tool
#   ./tools/publish.sh my-name public     # choose the name and visibility
#
# Needs the GitHub CLI, signed in:  gh auth login
set -euo pipefail

REPO="${1:-puzzle-combination-tool}"
VISIBILITY="${2:-private}"

command -v gh >/dev/null || { echo "Install the GitHub CLI first: brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Sign in first: gh auth login"; exit 1; }

OWNER="$(gh api user --jq .login)"

if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  echo "Repository $OWNER/$REPO already exists; pushing to it."
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO.git"
  git push -u origin main
else
  gh repo create "$OWNER/$REPO" "--$VISIBILITY" --source=. --remote=origin --push \
    --description "Password-gated browser for 600 puzzle action x payoff combinations"
fi

echo "Turning on GitHub Pages from the main branch…"
gh api -X POST "repos/$OWNER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  || gh api -X PUT "repos/$OWNER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  || echo "Could not enable Pages automatically. Turn it on in Settings > Pages (branch: main, folder: /)."

echo
echo "Repository: https://github.com/$OWNER/$REPO"
echo "Site (takes a minute on the first build): https://$OWNER.github.io/$REPO/"
echo "Password: puzzle600  (change it with: node tools/build-vault.mjs \"new-password\")"
