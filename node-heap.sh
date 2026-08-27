#!/usr/bin/env bash
# How much heap the build's Node processes may use.
#
# The ceiling was a flat `--max-old-space-size=8192` on every machine, and a ceiling above physical
# RAM does not make a build fail fast -- it makes it thrash. V8 only gets aggressive about GC as it
# approaches the limit it was given, so telling it 8 GB on a 7.8 GB runner means it never eases off
# before the kernel starts swapping. Throughput collapses instead of an out-of-memory error, and
# there is nothing in the log to read.
#
# That is the shape of what happened to the x64 Linux build of v1.121.1: it went silent partway
# through `bundle-vscode` -- a phase that takes 43 seconds on the arm64 runner -- and 47 minutes
# later the runner was shut down with "The runner has received a shutdown signal" and no error.
#
# Machine size is not a constant to hard-code, either: GitHub gives private repositories a 2-core
# 7 GB runner and public ones 16 GB, so the same workflow gets very different hardware depending on
# a repository setting. Read the machine.
#
# Sourced, not executed: the point is NODE_OPTIONS.

if [[ -z "${OPENIDE_NODE_HEAP_MB:-}" ]]; then
	_total_mb=""
	if [[ -r /proc/meminfo ]]; then
		# Linux, and Git Bash on Windows, which provides an MSYS /proc.
		_total_mb=$( awk '/^MemTotal:/ { print int($2 / 1024); exit }' /proc/meminfo )
	elif command -v sysctl >/dev/null 2>&1; then
		# macOS reports bytes.
		_total_mb=$( sysctl -n hw.memsize 2>/dev/null | awk '{ print int($1 / 1048576) }' )
	fi

	if [[ "${_total_mb}" =~ ^[0-9]+$ ]] && (( _total_mb > 0 )); then
		# Three quarters. The remaining quarter is not slack: the runner agent, the OS page cache
		# the build reads its own inputs through, and on Linux the gulp process tree all live there.
		OPENIDE_NODE_HEAP_MB=$(( _total_mb * 3 / 4 ))
		# Below 4 GB the build genuinely cannot finish, so a smaller machine should fail saying so
		# rather than thrash. Above 8 GB there is nothing to gain -- that was the ceiling upstream
		# picked, and it is enough.
		if (( OPENIDE_NODE_HEAP_MB < 4096 )); then OPENIDE_NODE_HEAP_MB=4096; fi
		if (( OPENIDE_NODE_HEAP_MB > 8192 )); then OPENIDE_NODE_HEAP_MB=8192; fi
	else
		# Undetectable: keep what the build has always used rather than guess downward.
		OPENIDE_NODE_HEAP_MB=8192
	fi
	unset _total_mb
fi

export OPENIDE_NODE_HEAP_MB
export NODE_OPTIONS="--max-old-space-size=${OPENIDE_NODE_HEAP_MB}"
