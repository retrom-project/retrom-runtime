#!/usr/bin/env bash
# Go host quality gate. Tool versions and limits match the Retrom backend; scripts/go-quality pins the policy.
set -euo pipefail
cd "$(dirname "$0")/.."

GOFUMPT_VERSION=v0.11.0
GOIMPORTS_VERSION=v0.48.0
GOLANGCI_LINT_VERSION=v2.11.4
GO_VERSION="$(awk '$1 == "go" { print $2; exit }' go.mod)"
TOOLS="${RETROM_RUNTIME_GO_TOOLS:-$PWD/.cache/go-tools/go$GO_VERSION}"
MODULE=github.com/retrom-project/retrom-runtime
PACKAGES=(. ./host/...)

if [[ "$(go env GOVERSION)" != "go$GO_VERSION" ]]; then
  echo "Go $GO_VERSION is required, found $(go env GOVERSION)" >&2
  exit 1
fi
mkdir -p "$TOOLS"
install_tool() {
  local binary="$1" package="$2" version="$3"
  if [[ ! -x "$TOOLS/$binary" ]] || [[ "$("$TOOLS/$binary" "${@:4}" 2>&1)" != *"${version#v}"* ]]; then
    GOBIN="$TOOLS" go install "$package@$version"
  fi
}
install_tool gofumpt mvdan.cc/gofumpt "$GOFUMPT_VERSION" -version
install_tool golangci-lint github.com/golangci/golangci-lint/v2/cmd/golangci-lint "$GOLANGCI_LINT_VERSION" version
if [[ ! -x "$TOOLS/goimports" ]]; then GOBIN="$TOOLS" go install "golang.org/x/tools/cmd/goimports@$GOIMPORTS_VERSION"; fi

mapfile -t files < <(git ls-files --cached --others --exclude-standard -- '*.go' | sort)
status=0
for formatter in "$TOOLS/gofumpt -d" "$TOOLS/goimports -local $MODULE -d"; do
  diff_output="$($formatter "${files[@]}")"
  if [[ -n "$diff_output" ]]; then
    printf '%s\n' "$diff_output" >&2
    status=1
  fi
done
(( status == 0 )) || exit "$status"

go mod tidy -diff
(cd scripts/go-quality && go mod tidy -diff && go test ./...)
node scripts/host-declarations.mjs --check
go build "${PACKAGES[@]}"
"$TOOLS/golangci-lint" run --allow-serial-runners "${PACKAGES[@]}"
(cd scripts/go-quality && "$TOOLS/golangci-lint" run --allow-serial-runners --config ../../.golangci.yml ./...)
go test -p 4 -parallel 4 "${PACKAGES[@]}"
