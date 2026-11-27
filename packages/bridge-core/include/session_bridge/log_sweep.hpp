#pragma once

#include <cstddef>
#include <cstdint>
#include <list>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace session_bridge {

/// Log text with what must not be written taken out, for a process that has no JavaScript: the
/// notification extension, and later Android's native push handler.
///
/// **This mirrors `packages/logging` and must not drift from it.** `cap.ts`, `sweep.ts`, `url.ts`,
/// `address.ts`, `pseudonym.ts` and `line.ts` are the source; the shared vectors in
/// `packages/logging/tests/vectors/sweep.json` are run through both, by vitest and by the addon's
/// tests, so a change to one that the other lacks fails a test rather than leaking a key.
class LogSweeper {
  public:
    /// `salt` is the log directory's `.salt`, the same bytes the app's own logger uses, so a
    /// pseudonym in an extension's run matches the one the app wrote for the same id. At least 16
    /// bytes, as `Pseudonyms` requires.
    explicit LogSweeper(std::vector<std::byte> salt);

    /// `~3fa9c1de`: the first eight hex digits of HMAC-SHA256(salt, raw).
    std::string pseudonym(std::string_view raw);

    /// `capForSweep` then `sweep`: one message, before `escape_message`.
    std::string sweep(std::string_view text);

  private:
    std::string render_url(std::string_view text, bool& rendered);
    std::string render_host(std::string_view authority);

    std::vector<std::byte> salt_;
    /// The most recently used last, as `Pseudonyms` keeps them; bounded the same way.
    std::list<std::pair<std::string, std::string>> order_;
    std::unordered_map<std::string, std::list<std::pair<std::string, std::string>>::iterator> seen_;
};

/// `capForSweep`: `text` cut to `max` UTF-16 code units, dropping a run of non-space characters the
/// cut lands inside, with a note of how much went.
std::string cap_for_sweep(std::string_view text, std::size_t max = 4096);

/// `escapeMessage`: backslashes doubled, line breaks written as `\n` and `\r`.
std::string escape_message(std::string_view text);

/// `formatPrefix`, the 79 columns before every message. `level` is libsession's name for it
/// ("info", "warn", ...); an unknown one is written as `warn`, as `parseLevel` falls back.
std::string format_prefix(
        int64_t wall_ms,
        int64_t uptime_ms,
        std::string_view level,
        std::string_view category,
        std::string_view op = {});

/// Whether `name` is one of the app's log file names, `session-<UTC>-<part>.log`.
bool is_log_file_name(std::string_view name);

/// `logFileName`: `session-20261008T032009Z-0.log`.
std::string log_file_name(int64_t launch_ms, int part = 0);

}  // namespace session_bridge
