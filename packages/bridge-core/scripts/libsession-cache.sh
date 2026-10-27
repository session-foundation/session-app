# Builds libsession's static bundle through a per-machine cache. Sourced by the Android and desktop
# build scripts, which call `libsession_bundle` once per target, and by the iOS one once per slice.
#
# Two levels, both under $SESSION_LIBSESSION_CACHE (default ~/.cache/session-app on Linux,
# ~/Library/Caches/session-app on macOS):
#
# - entries/: the finished bundle, keyed by a hash of libsession's whole source tree, the target
#   and the cmake arguments. A clone on a cached libsession builds nothing.
# - trees/: one build tree per set of build rules (libsession's top CMakeLists.txt and cmake/,
#   session-deps included), target and cmake arguments, shared by every clone. A clone whose
#   libsession sources differ reuses the dependencies built there and compiles only libsession.
#
# Everything that decides how a dependency is built is in a tree's key, so a dependency finished in
# a tree is never rebuilt there. That matters: a dependency rebuilt under a finished meson-based one
# makes meson regenerate during the build step, without the environment it was configured with,
# and the build fails (libvips losing glib's pkg-config variables).
#
# A tree is built through a symlink at a fixed path, `<tree>/src`, because every dependency's
# configure line and installed .pc file names absolute paths: through the symlink they are the
# same whichever clone builds. Make compares mtimes, not contents, so libsession's own objects
# and archives are deleted when a different clone takes the tree; ccache makes recompiling them
# cheap. Nothing else is: CMake's per-dependency `-complete` files live beside them, and losing one
# re-touches that dependency's `-done` stamp, which reconfigures everything built on it.

if [ "$(uname -s)" = Darwin ]; then
    _ls_cache_default="$HOME/Library/Caches/session-app"
    _ls_md5() { xargs -0 md5 -r; }
    _ls_md5_stdin() { md5 -q; }
else
    _ls_cache_default="${XDG_CACHE_HOME:-$HOME/.cache}/session-app"
    _ls_md5() { xargs -0 md5sum; }
    _ls_md5_stdin() { md5sum | awk '{print $1}'; }
fi
_ls_cache="${SESSION_LIBSESSION_CACHE:-$_ls_cache_default}"
# Bump whenever what an entry holds, or how a tree is laid out, changes.
_ls_layout=v1
# Where _ls_hashes records what it hashed; named so that pruning sweeps up an abandoned one.
_ls_record="$_ls_cache/entries/.incoming-$$-files"

# Prints, one per line, the libsession paths that can change what is linked: every tracked path
# across every submodule, and every untracked one not ignored, so a new file counts (libsession
# globs its schema migrations); tests, docs and markdown cannot change what is linked.
_ls_files() {
    local files
    # `--others` cannot be combined with `--recurse-submodules`, hence the foreach.
    files=$(cd "$1" && git ls-files --recurse-submodules \
            && git ls-files --others --exclude-standard \
            && git submodule foreach --quiet --recursive \
                'git ls-files --others --exclude-standard | sed "s|^|$displaypath/|"') || files=""
    # An empty list hashes the same for every source state, and every edit would hit the cache.
    if [ -z "$files" ]; then
        echo "cannot list libsession's files with git in $1" >&2
        return 1
    fi
    # A trailing slash is an embedded repository, not a file.
    printf '%s\n' "$files" \
        | grep -vE '(^|/)(tests?|docs?|examples?)/|\.md$|(^|/)(\.DS_Store|\.gitignore)$|/$' \
        | LC_ALL=C sort
}

# _ls_hashes <libsession dir> <record>
#
# Prints "<source hash> <build rules hash>", by working-tree content, so an uncommitted patch
# changes it. Writes the paths it hashed to <record> before reading any of them: an edit the hash
# did not see is then newer than the record, which is what _ls_changed_since looks for.
_ls_hashes() {
    local sums
    mkdir -p "$(dirname "$2")"
    _ls_files "$1" >"$2" || return
    sums=$(tr '\n' '\0' <"$2" | (cd "$1" && _ls_md5))
    printf '%s %s\n' \
        "$(awk '{print $1}' <<<"$sums" | _ls_md5_stdin)" \
        "$(awk '$2 == "CMakeLists.txt" || $2 ~ /^cmake\// {print $1}' <<<"$sums" | _ls_md5_stdin)"
}

# _ls_changed_since <libsession dir> <record>: whether a path was added, removed or written after
# _ls_hashes recorded it. Written and then restored still counts: the build may have read it.
_ls_changed_since() {
    [ "$(_ls_files "$1")" != "$(cat "$2")" ] && return 0
    [ -n "$(cd "$1" && sed 's|^|./|' "$2" | tr '\n' '\0' \
        | xargs -0 sh -c 'record=$1; shift; find "$@" -maxdepth 0 -newer "$record"' _ "$2")" ]
}

# Hard links on Linux and APFS clones on macOS, so a clone's copy costs no space; a plain copy
# where the cache is on another filesystem.
_ls_place() {
    rm -rf "$2"
    mkdir -p "$(dirname "$2")"
    # A link or clone that fails has already created $2, and a copy onto an existing $2 nests in it.
    if [ "$(uname -s)" = Darwin ]; then
        cp -cR "$1" "$2" 2>/dev/null || { rm -rf "$2"; cp -R "$1" "$2"; }
    else
        cp -al "$1" "$2" 2>/dev/null || { rm -rf "$2"; cp -a "$1" "$2"; }
    fi
    if [ ! -f "$2/libsession-util.a" ]; then
        echo "placing $1 left no libsession-util.a in $2" >&2
        return 1
    fi
}

# mkdir is the one atomic lock both Linux and macOS ship; flock(1) is Linux only.
_ls_lock() {
    local waited=0
    until mkdir "$1.lock" 2>/dev/null; do
        local owner
        owner=$(cat "$1.lock/pid" 2>/dev/null || true)
        if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
            rm -rf "$1.lock"
            continue
        fi
        if [ $((waited % 60)) = 0 ]; then
            echo "waiting for another libsession build in ${1##*/} (pid ${owner:-?})"
        fi
        sleep 1
        waited=$((waited + 1))
    done
    echo $$ >"$1.lock/pid"
}

# Keeps the five most recently used, and anything used in the last fortnight.
_ls_prune() {
    local dir="$1" n=0 entry
    [ -d "$dir" ] || return 0
    find "$dir" -maxdepth 1 -name '.incoming-*' -mtime +1 -exec rm -rf {} +
    for entry in $(ls -1td "$dir"/v*-* 2>/dev/null); do
        n=$((n + 1))
        [ "$n" -le 5 ] && continue
        [ -e "$entry.lock" ] && continue
        # Not `[ ... ] && rm`: a false test as the loop's last command fails the caller's set -e.
        if [ -n "$(find "$entry" -maxdepth 0 -mtime +14)" ]; then rm -rf "$entry"; fi
    done
}

# libsession_bundle <libsession dir> <target key> <destination> [cmake args...]
#
# Leaves libsession-util.a and static-deps/include in <destination>, which is what
# bridge-core's SESSION_BRIDGE_LIBSESSION_BUNDLE reads beside the bundle. The target key has to
# name everything about the toolchain that the cmake arguments do not. `@SRC@` in an argument
# stands for the libsession source directory: a clone's own path there would give every clone a
# tree of its own.
libsession_bundle() {
    local libsession dest key hashes record src_hash rules_hash args_hash entry tree status
    libsession="$(cd "$1" && pwd -P)"
    key="$2"
    dest="$3"
    shift 3
    # Tried before every dependency's own URL, so gmp comes from it and not gmplib.org, which drops
    # the download partway often enough to fail cold builds. Hashes are still checked.
    set -- "$@" -DLOCAL_MIRROR="${SESSION_BRIDGE_DEPS_MIRROR:-https://builds.session.codes/deps}"

    # Set by the iOS script, which has already hashed this tree once for BUILT.json.
    hashes=${_LS_HASHES:-}
    record=${_LS_RECORD:-$_ls_record}
    if [ -z "$hashes" ]; then hashes=$(_ls_hashes "$libsession" "$record") || return; fi
    src_hash=${hashes% *}
    rules_hash=${hashes#* }
    args_hash=$(printf '%s\n' "$@" | _ls_md5_stdin | cut -c1-12)
    entry="$_ls_cache/entries/$_ls_layout-$src_hash-$key-$args_hash"
    tree="$_ls_cache/trees/$_ls_layout-$rules_hash-$key-$args_hash"

    if [ ! -d "$entry" ]; then
        mkdir -p "$_ls_cache/entries" "$_ls_cache/trees"
        (
            # Here rather than in the caller: a failed build must never become an entry.
            set -euo pipefail
            _ls_lock "$tree"
            incoming="$_ls_cache/entries/.incoming-$$"
            trap 'rm -rf "$tree.lock" "$incoming"' EXIT
            # Another build may have finished it while this one waited.
            [ -d "$entry" ] && exit 0

            mkdir -p "$tree/build"
            touch "$tree"
            if [ "$(cat "$tree/clone" 2>/dev/null)" != "$libsession" ]; then
                find "$tree/build" -path "$tree/build/static-deps*" -prune -o \
                    -type f \( -name '*.o' -o -name '*.a' \) -exec rm -f {} +
                echo "$libsession" >"$tree/clone"
            fi
            # A dependency an interrupted build left unfinished starts again from its download,
            # rather than from a half-configured build directory. `-done` is touched last, so a step
            # stamp newer than it means a later run got partway through the dependency again.
            for stamps in "$tree"/build/static-deps-sources/src/*-stamp; do
                [ -d "$stamps" ] || continue
                name="${stamps##*/}"
                name="${name%-stamp}"
                if [ -e "$stamps/$name-done" ] && [ -z "$(find "$stamps" -type f \
                    -name "$name-[a-z]*" ! -name '*.txt' ! -name "$name-done" \
                    -newer "$stamps/$name-done")" ]; then
                    continue
                fi
                rm -rf "$stamps" "${stamps%-stamp}" "${stamps%-stamp}-build"
            done
            ln -sfn "$libsession" "$tree/src"
            args=()
            for arg in "$@"; do args+=("${arg//@SRC@/$tree/src}"); done
            # Otherwise a build that fails leaves the previous archive to be cached as this one.
            rm -f "$tree/build/libsession-util.a"
            # CMake keeps the flags of a tree's first configure for good, and no key names them.
            unset CFLAGS CXXFLAGS CPPFLAGS LDFLAGS
            # `cd` through the symlink: static-bundle.sh takes the source directory from $PWD.
            (cd "$tree/src" && ./utils/static-bundle.sh "$tree/build" "" "${args[@]}")

            mkdir -p "$incoming/static-deps"
            cp "$tree/build/libsession-util.a" "$incoming/"
            cp -R "$tree/build/static-deps/include" "$incoming/static-deps/"
            # The build reads the working tree as it goes, so an edit made meanwhile may be in it.
            if _ls_changed_since "$libsession" "$record"; then
                echo "libsession changed during the build: using it, but not caching it"
                _ls_place "$incoming" "$dest"
                exit 0
            fi
            mv "$incoming" "$entry"
        )
        # Not `|| return`: that context switches off the subshell's set -e.
        status=$?
        [ -n "${_LS_HASHES:-}" ] || rm -f "$record"
        [ "$status" = 0 ] || return "$status"
        _ls_prune "$_ls_cache/entries"
        _ls_prune "$_ls_cache/trees"
        # Already placed by the build, which did not cache it.
        [ -d "$entry" ] || return 0
    else
        echo "libsession from cache: $entry"
        [ -n "${_LS_HASHES:-}" ] || rm -f "$record"
    fi
    touch "$entry"
    _ls_place "$entry" "$dest"
}
