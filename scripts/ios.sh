#!/usr/bin/env bash
# Builds and tests the iOS app from the command line (simulator only; no
# signing identity is needed).
#
#   bun run ios:generate   # apps/ios/project.yml -> apps/ios/Bloom.xcodeproj (XcodeGen)
#   bun run ios:build      # generate + build for the simulator
#   bun run ios:test       # generate + unit and UI tests on the simulator
#
# Environment:
#   IOS_DESTINATION   xcodebuild destination (default: iPhone 17 simulator)
#   VERBOSE=1         stream the full xcodebuild output instead of a summary
#
# Full logs land in apps/ios/build/<command>.log.
set -euo pipefail
cd "$(dirname "$0")/.."

IOS_DIR=apps/ios
BUILD_DIR="$IOS_DIR/build"
DESTINATION="${IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 17}"

generate() {
  command -v xcodegen >/dev/null || { echo "xcodegen is not installed (brew install xcodegen)"; exit 1; }
  xcodegen generate --spec "$IOS_DIR/project.yml" --quiet
}

# Runs xcodebuild with the shared flags; prints a summary unless VERBOSE is set.
# -skipPackagePluginValidation lets the OpenAPI generator build plugin run
# without the interactive "Trust & Enable" prompt Xcode shows the first time.
xcb() {
  local action="$1"
  shift
  mkdir -p "$BUILD_DIR"
  local log="$BUILD_DIR/$action.log"
  local cmd=(
    xcodebuild
    -project "$IOS_DIR/Bloom.xcodeproj"
    -scheme Bloom
    -destination "$DESTINATION"
    -derivedDataPath "$BUILD_DIR/DerivedData"
    -clonedSourcePackagesDirPath "$BUILD_DIR/SourcePackages"
    -skipPackagePluginValidation
    -skipMacroValidation
    "$@"
  )
  if [[ -n "${VERBOSE:-}" ]]; then
    "${cmd[@]}" 2>&1 | tee "$log"
    return "${PIPESTATUS[0]}"
  fi
  local status=0
  "${cmd[@]}" >"$log" 2>&1 || status=$?
  # Errors, warnings from our sources, test verdicts and the final banner.
  grep -E "error:|$IOS_DIR/[^ ]*: warning:|^Test Suite .*(passed|failed)|Executed [0-9]+ tests?,|[✔✘] Test run|✘ Test|Failing tests:|\*\* [A-Z ]+ \*\*" "$log" \
    | grep -v "^Test Suite 'Selected tests'" | grep -v "$BUILD_DIR/" | awk '!seen[$0]++' || true
  # The OpenAPI generator reports schemas it had to skip; any of these means a
  # field silently missing from the Swift types.
  grep -E "^warning: .*(not supported|skipping)" "$log" | awk '!seen[$0]++' || true
  if [[ $status -ne 0 ]]; then
    echo "xcodebuild $action failed (status $status); full log: $log"
    tail -30 "$log"
  fi
  return "$status"
}

case "${1:-}" in
  generate) generate ;;
  build)
    generate
    xcb build build
    ;;
  test)
    generate
    xcb test test
    ;;
  *)
    echo "usage: scripts/ios.sh generate|build|test"
    exit 2
    ;;
esac
