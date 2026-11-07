#!/usr/bin/env bash
# Fetches the official FreeMarker jar (if missing) and compiles the sidecar.
# Run automatically by `npm start` / `npm run render` when engine/build is missing.
set -euo pipefail
cd "$(dirname "$0")"

FM_VERSION="${FREEMARKER_VERSION:-2.3.34}"
JAR="lib/freemarker-${FM_VERSION}.jar"
URL="https://repo1.maven.org/maven2/org/freemarker/freemarker/${FM_VERSION}/freemarker-${FM_VERSION}.jar"

mkdir -p lib build

if [ ! -s "$JAR" ]; then
  echo "Downloading FreeMarker ${FM_VERSION}..."
  for attempt in 1 2 3 4; do
    if curl -fsSL -o "$JAR" "$URL"; then break; fi
    echo "  download attempt $attempt failed, retrying..."
    sleep $((attempt * 2))
  done
  [ -s "$JAR" ] || { echo "Could not download $URL" >&2; exit 1; }
fi

if ! command -v javac >/dev/null 2>&1; then
  echo "javac not found. Install a JDK (17+), e.g. 'brew install openjdk' or 'apt install default-jdk'." >&2
  exit 1
fi

echo "Compiling FtlServer.java..."
javac -Xlint:-options --release 17 -cp "$JAR" -d build FtlServer.java
echo "Engine ready (FreeMarker ${FM_VERSION})."
