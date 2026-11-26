#!/bin/sh
set -eu

# Fail rather than silently repackaging an unreviewed PostgreSQL major/version.
test "$PG_MAJOR" = 18
test "$PG_VERSION" = 18.6
test -f /usr/local/lib/postgresql/llvmjit.so
rm /usr/local/lib/postgresql/llvmjit.so /usr/local/lib/postgresql/llvmjit_types.bc
rm -r /usr/local/lib/postgresql/bitcode

# Mirror the upstream dependency scan, after removing only the optional provider.
# APK removes LLVM only when nothing retained requires it. No downloads needed.
run_deps="$(
    scanelf --needed --nobanner --format '%n#p' --recursive /usr/local \
        | tr ',' '\n' \
        | sort -u \
        | awk 'system("[ -e /usr/local/lib/" $1 " ]") == 0 { next } { print "so:" $1 }' \
        | grep -v -e perl -e python -e tcl
)"
# Upstream also omits these optional procedural-language runtimes by default.
# Intentional word splitting: these are APK dependency names from scanelf.
# shellcheck disable=SC2086
apk add --no-network --virtual .pixb-postgresql-rundeps \
    $run_deps bash tzdata zstd icu-data-full nss_wrapper
apk del --no-network .postgresql-rundeps
if find /usr/lib -name '*LLVM*' | grep -q .; then
    echo 'Unexpected retained LLVM dependency; review the upstream image.' >&2
    exit 1
fi
postgres --version
pg_dump --version
pg_restore --version
