#!/bin/sh
# Forward root-level Maven commands to the backend project.
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$project_dir/backend"
exec ./mvnw "$@"
