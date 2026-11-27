#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "session_bridge/log_sweep.hpp"

namespace session_bridge {

/// How many runs an extension's log directory keeps. A push is a run, and pushes are small and
/// frequent, so a count alone would let a few long runs fill the phone and bytes alone would keep
/// too few short ones: both are budgets, and the oldest whole run goes when either is passed.
inline constexpr std::size_t RUN_LOG_MAX_RUNS = 200;
/// The directory's byte budget, beside the app's own 20 MB.
inline constexpr std::uintmax_t RUN_LOG_MAX_BYTES = 2 * 1024 * 1024;
/// The most one run writes: past it the run notes that it was cut and writes nothing more, so a
/// run stuck in a loop cannot push every other run out of the budget.
inline constexpr std::uintmax_t RUN_LOG_MAX_RUN_BYTES = 256 * 1024;

/// One process run's log file, in a directory of its own beside the app's logs, written the way
/// the app writes its own: the same line prefix, swept with the same rules and salt, so an export
/// can put the two side by side and a pseudonym means the same id in both.
///
/// Nothing unswept reaches the disk: without the app's salt there is no file at all (the caller
/// still has the system log).
class RunLog {
  public:
    /// Opens a new run file in `dir`, creating `dir` if needed, after dropping old runs to keep
    /// within the budgets. `salt_path` is the app's `.salt`. `title` names the process in the
    /// run's first line: `── Session notification service 1.0.0 (123) launched ...`. Nothing when
    /// there is no salt yet or the file cannot be opened.
    static std::unique_ptr<RunLog> open(
            const std::filesystem::path& dir,
            const std::filesystem::path& salt_path,
            std::string_view title,
            std::string_view version);

    /// One line, at libsession's `level` name, under `category`.
    void write(std::string_view level, std::string_view category, std::string_view message);

    const std::filesystem::path& path() const { return path_; }

  private:
    RunLog(std::filesystem::path path, std::ofstream out, std::vector<std::byte> salt);

    std::filesystem::path path_;
    std::ofstream out_;
    LogSweeper sweeper_;
    std::chrono::steady_clock::time_point started_;
    std::uintmax_t written_ = 0;
    bool cut_ = false;
};

/// The runs a directory holds, oldest first, as the export lists them: names matching
/// `is_log_file_name` only.
std::vector<std::filesystem::path> run_log_files(const std::filesystem::path& dir);

/// Drops the oldest runs until adding one more keeps within both budgets.
void prune_run_logs(
        const std::filesystem::path& dir,
        std::size_t max_runs = RUN_LOG_MAX_RUNS,
        std::uintmax_t max_bytes = RUN_LOG_MAX_BYTES);

}  // namespace session_bridge
