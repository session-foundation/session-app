#pragma once

#include <filesystem>

namespace session_bridge {

/// Whether to open the database at `path` with SQLite's header in plaintext.
///
/// iOS kills a process suspended while it holds a lock on a file in a shared container, unless the
/// file's first bytes show it is SQLite; an encrypted header hides that. Every process opening the
/// database has to agree on the mode, or the open fails as "file is not a database", so a file that
/// exists answers for itself, whichever platform made it. `when_new` decides only for a database
/// not yet written. libsession encrypts with AEGIS-256, which needs no salt kept beside the key for
/// this; SQLCipher would.
bool opens_with_plaintext_header(const std::filesystem::path& path, bool when_new);

}  // namespace session_bridge
