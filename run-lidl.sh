#!/bin/bash
set -e

# Ensure Bun is in PATH
export PATH="$HOME/.bun/bin:$PATH"

# Run from project directory
cd "$(dirname "$0")"

# Prevent sleep during execution
caffeinate -i bun run main.js
