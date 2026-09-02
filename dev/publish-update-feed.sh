#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 2 ]] || { echo "Uso: $0 <feed-dir> <branch>" >&2; exit 1; }
FEED=$1 BRANCH=$2; test -d "$FEED"
git config user.name openide-bot; git config user.email openide-bot@users.noreply.github.com
git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH" || true
WORK=$(mktemp -d); trap 'git worktree remove --force "$WORK" 2>/dev/null || true' EXIT
if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then git worktree add "$WORK" "refs/remotes/origin/$BRANCH"; else git worktree add --detach "$WORK"; git -C "$WORK" switch --orphan "$BRANCH"; git -C "$WORK" rm -rf . || true; fi
# Versioned manifests and the signature first; latest is copied last, in the same commit.
find "$FEED" -type f ! -name latest.json ! -name latest.json.minisig -exec sh -c 'mkdir -p "$1/$(dirname "$2")"; cp "$2" "$1/$2"' _ "$WORK" {} \;
cp -R "$FEED"/. "$WORK"/
git -C "$WORK" add .; git -C "$WORK" diff --cached --quiet || { git -C "$WORK" commit -m "release: publish signed OpenIDE feed"; git -C "$WORK" push origin "HEAD:$BRANCH"; }
