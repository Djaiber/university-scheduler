#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
git -C "$root" config core.hooksPath scripts/git-hooks
chmod +x "$root"/scripts/git-hooks/*
echo "Hooks instalados (core.hooksPath=scripts/git-hooks)"
