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
# A tree builds from its own copy of libsession at a fixed path, `<tree>/src`, because every
# dependency's configure line and installed .pc file names absolute paths. The copy is synced from
# the clone under the tree's lock, by content: a changed file arrives with a fresh mtime and an
# unchanged one keeps its old one, whichever clone it now comes from, so make recompiles exactly
# what changed although it compares mtimes and every clone's differ. An entry is keyed by the hash
# of that copy, so it holds what its key says even when the clone is edited during the build.

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
_ls_layout=v2
# _ls_hashes's working files; named so that pruning sweeps up an abandoned one.
_ls_scratch="$_ls_cache/entries/.incoming-$$-files"

# Prints, one per line, every tracked path across every submodule and every untracked one not
# ignored, so a new file counts (libsession globs its schema migrations). Nothing is left out: the
# build reads files no filter would keep, down to a README listed as a source.
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
        | grep -vE '/$|(^|/)\.DS_Store$' \
        | LC_ALL=C sort
}

# _ls_sums <dir> <list>: "<md5> <path>" for each path in <list> that exists under <dir>, sorted
# by path. A symlink is summed by its target, since some point at directories; a tracked file
# deleted from the working tree is left out, as the build cannot read it.
_ls_sums() {
    (
        cd "$1" || exit
        : >"$2.files"
        while IFS= read -r path; do
            if [ -L "$path" ]; then
                printf '%s %s\n' "$(readlink "$path" | _ls_md5_stdin)" "$path"
            elif [ -e "$path" ]; then
                printf '%s\0' "$path" >>"$2.files"
            fi
        done <"$2"
        if [ -s "$2.files" ]; then
            _ls_md5 <"$2.files" | awk '{ h = $1; sub(/^[^ ]+ +/, ""); print h, $0 }' || exit
        fi
        rm -f "$2.files"
    ) | LC_ALL=C sort -t' ' -k2
}

# _ls_keys <sums>: "<source hash> <build rules hash>". Paths are hashed with their content, so a
# rename changes the key.
_ls_keys() {
    printf '%s %s\n' \
        "$(_ls_md5_stdin <"$1")" \
        "$(awk '$2 == "CMakeLists.txt" || $2 ~ /^cmake\// {print}' "$1" | _ls_md5_stdin)"
}

# _ls_hashes <libsession dir>: _ls_keys of the working tree as it stands.
_ls_hashes() {
    mkdir -p "$(dirname "$_ls_scratch")"
    _ls_files "$1" >"$_ls_scratch" || return
    _ls_sums "$1" "$_ls_scratch" >"$_ls_scratch.sums" || return
    _ls_keys "$_ls_scratch.sums"
    rm -f "$_ls_scratch" "$_ls_scratch.sums"
}

# _ls_sync <libsession dir> <snapshot dir>: makes the snapshot hold exactly libsession's files,
# and leaves their sums in <snapshot>.sums, taken from the snapshot itself: an edit to the clone
# during the sync is then either wholly in them or not at all.
_ls_sync() {
    local snap="$2"
    _ls_files "$1" >"$snap.list" || return
    _ls_sums "$1" "$snap.list" >"$snap.want" || return
    touch "$snap.sums"
    LC_ALL=C comm -13 <(LC_ALL=C sort "$snap.sums") <(LC_ALL=C sort "$snap.want") \
        | cut -d' ' -f2- >"$snap.changed"
    LC_ALL=C comm -23 <(cut -d' ' -f2- "$snap.sums" | LC_ALL=C sort) \
        <(cut -d' ' -f2- "$snap.want" | LC_ALL=C sort) \
        | tr '\n' '\0' | (cd "$snap" && xargs -0 rm -f) || return
    if [ -s "$snap.changed" ]; then
        echo "libsession: copying $(wc -l <"$snap.changed" | tr -d ' ') changed files" \
            "to the build tree"
        # -m: extracted files take the current time, not the clone's, so make sees them as new.
        (cd "$1" && tar -cf - -T "$snap.changed") | (cd "$snap" && tar -xmf -) || return
    fi
    cut -d' ' -f2- "$snap.want" >"$snap.list"
    _ls_sums "$snap" "$snap.list" >"$snap.sums" || return
    rm -f "$snap.list" "$snap.want" "$snap.changed"
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

# _ls_prune <dir> <keep> [<days>]: keeps the <keep> most recently used, and with <days>, anything
# used within that many days.
_ls_prune() {
    local dir="$1" keep="$2" days="${3:-}" n=0 entry
    [ -d "$dir" ] || return 0
    find "$dir" -maxdepth 1 -name '.incoming-*' -mtime +1 -exec rm -rf {} +
    for entry in $(ls -1td "$dir"/v*-* 2>/dev/null); do
        case "$entry" in *.lock) continue ;; esac
        n=$((n + 1))
        [ "$n" -le "$keep" ] && continue
        [ -e "$entry.lock" ] && continue
        # Not `[ ... ] && continue`: a false test as the loop's last command fails set -e.
        if [ -n "$days" ] && [ -n "$(find "$entry" -maxdepth 0 -mtime -"$days")" ]; then
            continue
        fi
        rm -rf "$entry"
    done
}

# _ls_fit: with SESSION_LIBSESSION_CACHE_MAX_GB set, removes the least recently used entries,
# then trees, until the cache fits, but nothing used in the last day: a run builds each slice or
# ABI in a tree of its own, and removing an earlier one's would make every run a cold build. Sizes
# are du's, so an entry still hard-linked from a destination counts in full.
_ls_fit() {
    local max_gb="${SESSION_LIBSESSION_CACHE_MAX_GB:-}" max_kb used_kb used_gb candidate
    [ -n "$max_gb" ] || return 0
    if ! max_kb=$(awk -v gb="$max_gb" \
        'BEGIN { if (gb !~ /^[0-9]+(\.[0-9]+)?$/) exit 1; print int(gb * 1048576) }'); then
        echo "SESSION_LIBSESSION_CACHE_MAX_GB is not a number of gigabytes; not capping" >&2
        return 0
    fi
    # Oldest first, every entry before any tree.
    for candidate in $(ls -1trd "$_ls_cache"/entries/v*-* "$_ls_cache"/trees/v*-* 2>/dev/null \
        | awk '/\/entries\// { print; next } { t = t $0 "\n" } END { printf "%s", t }'); do
        [ "$(du -sk "$_ls_cache" | cut -f1)" -gt "$max_kb" ] || return 0
        case "$candidate" in *.lock) continue ;; esac
        [ -e "$candidate.lock" ] && continue
        if [ -n "$(find "$candidate" -maxdepth 0 -mtime -1)" ]; then continue; fi
        rm -rf "$candidate"
    done
    used_kb=$(du -sk "$_ls_cache" | cut -f1)
    if [ "$used_kb" -gt "$max_kb" ]; then
        used_gb=$(awk -v kb="$used_kb" 'BEGIN { printf "%.1f", kb / 1048576 }')
        echo "the libsession cache is $used_gb GB, all used in the last day," \
            "over SESSION_LIBSESSION_CACHE_MAX_GB=$max_gb" >&2
    fi
}

# libsession_bundle <libsession dir> <target key> <destination> [cmake args...]
#
# Leaves libsession-util.a and static-deps/include in <destination>, which is what
# bridge-core's SESSION_BRIDGE_LIBSESSION_BUNDLE reads beside the bundle. The target key has to
# name everything about the toolchain that the cmake arguments do not. `@SRC@` in an argument
# stands for the libsession source directory: a clone's own path there would give every clone a
# tree of its own.
libsession_bundle() {
    local libsession dest key hashes rules_hash args_hash entry tree status
    libsession="$(cd "$1" && pwd -P)"
    key="$2"
    dest="$3"
    shift 3
    # Tried before every dependency's own URL, so gmp comes from it and not gmplib.org, which drops
    # the download partway often enough to fail cold builds. Hashes are still checked. The snapshot
    # has no .git for the submodule check to read, and its hash covers what that check guards.
    set -- "$@" -DLOCAL_MIRROR="${SESSION_BRIDGE_DEPS_MIRROR:-https://builds.session.codes/deps}" \
        -DSUBMODULE_CHECK=OFF

    # Set by the iOS script, which hashes the tree once for every slice.
    hashes=${_LS_HASHES:-}
    if [ -z "$hashes" ]; then hashes=$(_ls_hashes "$libsession") || return; fi
    rules_hash=${hashes#* }
    args_hash=$(printf '%s\n' "$@" | _ls_md5_stdin | cut -c1-12)
    entry="$_ls_cache/entries/$_ls_layout-${hashes% *}-$key-$args_hash"
    tree="$_ls_cache/trees/$_ls_layout-$rules_hash-$key-$args_hash"

    if [ -d "$entry" ]; then
        echo "libsession from cache: $entry"
        touch "$entry"
        _ls_place "$entry" "$dest"
        return
    fi

    mkdir -p "$_ls_cache/entries" "$_ls_cache/trees"
    (
        # Here rather than in the caller: a failed build must never become an entry.
        set -euo pipefail
        _ls_lock "$tree"
        incoming="$_ls_cache/entries/.incoming-$$"
        # Expanded now: bash 3.2 runs a subshell's EXIT trap after the function's locals are gone.
        trap "rm -rf $(printf '%q %q' "$tree.lock" "$incoming")" EXIT

        mkdir -p "$tree/build" "$tree/src"
        touch "$tree"
        _ls_sync "$libsession" "$tree/src"
        # The snapshot, not the clone hashed above, is what this tree builds.
        hashes=$(_ls_keys "$tree/src.sums")
        if [ "${hashes#* }" != "$rules_hash" ]; then
            echo "libsession's build rules changed after they were hashed; build again" >&2
            exit 1
        fi
        entry="$_ls_cache/entries/$_ls_layout-${hashes% *}-$key-$args_hash"

        # Another build may have finished it while this one waited.
        if [ ! -d "$entry" ]; then
            # A dependency an interrupted build left unfinished starts again from its download,
            # rather than from a half-configured build directory. `-done` is touched last, so a
            # step stamp newer than it means a later run got partway through the dependency again.
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
            args=()
            for arg in "$@"; do args+=("${arg//@SRC@/$tree/src}"); done
            # Otherwise a build that fails leaves the previous archive to be cached as this one.
            rm -f "$tree/build/libsession-util.a"
            # CMake keeps the flags of a tree's first configure for good, and no key names them.
            unset CFLAGS CXXFLAGS CPPFLAGS LDFLAGS
            # static-bundle.sh takes the source directory from $PWD.
            (cd "$tree/src" && ./utils/static-bundle.sh "$tree/build" "" "${args[@]}")

            mkdir -p "$incoming/static-deps"
            cp "$tree/build/libsession-util.a" "$incoming/"
            cp -R "$tree/build/static-deps/include" "$incoming/static-deps/"
            # What BUILT.json records: the clone may have moved on from it since it was hashed.
            echo "${hashes% *}" >"$incoming/source-hash"
            mv "$incoming" "$entry"
        fi
        touch "$entry"
        _ls_place "$entry" "$dest"
    )
    # Not `|| return`: that context switches off the subshell's set -e.
    status=$?
    [ "$status" = 0 ] || return "$status"
    # An entry is one incremental build from a warm tree; a tree is a cold build.
    _ls_prune "$_ls_cache/entries" 10
    _ls_prune "$_ls_cache/trees" 5 14
    _ls_fit
}
