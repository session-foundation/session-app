#include "session_bridge/run_log.hpp"

#include <algorithm>
#include <cstdio>
#include <ctime>
#include <system_error>
#include <vector>

namespace session_bridge {

namespace fs = std::filesystem;

namespace {

    int64_t now_ms() {
        return std::chrono::duration_cast<std::chrono::milliseconds>(
                       std::chrono::system_clock::now().time_since_epoch())
                .count();
    }

    /// `2026-10-09 07:41:02Z`, as `readableUtc` writes a launch.
    std::string readable_utc(int64_t ms) {
        auto secs = static_cast<std::time_t>(ms / 1000);
        std::tm tm{};
        gmtime_r(&secs, &tm);
        char buf[32];
        std::snprintf(
                buf,
                sizeof buf,
                "%04d-%02d-%02d %02d:%02d:%02dZ",
                tm.tm_year + 1900,
                tm.tm_mon + 1,
                tm.tm_mday,
                tm.tm_hour,
                tm.tm_min,
                tm.tm_sec);
        return buf;
    }

    /// The salt as the app writes it: hex, at least 16 bytes.
    std::optional<std::vector<std::byte>> read_salt(const fs::path& path) {
        std::ifstream in{path};
        if (!in)
            return std::nullopt;
        std::string hex;
        in >> hex;
        if (hex.size() < 32 || hex.size() % 2 != 0)
            return std::nullopt;
        std::vector<std::byte> salt;
        salt.reserve(hex.size() / 2);
        auto nibble = [](char c) -> int {
            if (c >= '0' && c <= '9')
                return c - '0';
            if (c >= 'a' && c <= 'f')
                return c - 'a' + 10;
            if (c >= 'A' && c <= 'F')
                return c - 'A' + 10;
            return -1;
        };
        for (std::size_t i = 0; i < hex.size(); i += 2) {
            auto hi = nibble(hex[i]), lo = nibble(hex[i + 1]);
            if (hi < 0 || lo < 0)
                return std::nullopt;
            salt.push_back(static_cast<std::byte>((hi << 4) | lo));
        }
        return salt;
    }

    /// Oldest first by launch then part, as `sortLogFiles` orders them: `-10` after `-9`.
    bool older(const fs::path& a, const fs::path& b) {
        auto key = [](const fs::path& p) {
            auto name = p.filename().string();  // session-<UTC>-<part>.log
            auto stamp = name.substr(8, 16);
            auto part = std::stoll(name.substr(25, name.size() - 25 - 4));
            return std::make_pair(stamp, part);
        };
        return key(a) < key(b);
    }

}  // namespace

std::vector<fs::path> run_log_files(const fs::path& dir) {
    std::vector<fs::path> files;
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(dir, ec)) {
        if (!entry.is_regular_file(ec))
            continue;
        if (is_log_file_name(entry.path().filename().string()))
            files.push_back(entry.path());
    }
    std::sort(files.begin(), files.end(), older);
    return files;
}

void prune_run_logs(const fs::path& dir, std::size_t max_runs, std::uintmax_t max_bytes) {
    auto files = run_log_files(dir);
    std::error_code ec;
    std::uintmax_t total = 0;
    for (const auto& f : files)
        total += fs::file_size(f, ec);
    std::size_t i = 0;
    // Room for the run about to start: one fewer than the count, and its own most within bytes.
    while (i < files.size() &&
           (files.size() - i + 1 > max_runs || total + RUN_LOG_MAX_RUN_BYTES > max_bytes)) {
        auto size = fs::file_size(files[i], ec);
        if (fs::remove(files[i], ec))
            total -= std::min(total, size);
        i++;
    }
}

RunLog::RunLog(fs::path path, std::ofstream out, std::vector<std::byte> salt) :
        path_{std::move(path)},
        out_{std::move(out)},
        sweeper_{std::move(salt)},
        started_{std::chrono::steady_clock::now()} {}

std::unique_ptr<RunLog> RunLog::open(
        const fs::path& dir,
        const fs::path& salt_path,
        std::string_view title,
        std::string_view version) {
    auto salt = read_salt(salt_path);
    if (!salt)
        return nullptr;
    std::error_code ec;
    fs::create_directories(dir, ec);
    if (!fs::is_directory(dir, ec))
        return nullptr;
    prune_run_logs(dir);

    auto launched = now_ms();
    fs::path path;
    for (int part = 0; part < 100; part++) {
        path = dir / log_file_name(launched, part);
        if (!fs::exists(path, ec))
            break;
    }
    std::ofstream out{path, std::ios::app | std::ios::binary};
    if (!out)
        return nullptr;
    std::unique_ptr<RunLog> log{new RunLog{path, std::move(out), std::move(*salt)}};
    std::string first = "── Session ";
    first += title;
    if (!version.empty()) {
        first += ' ';
        first += version;
    }
    first += " launched " + readable_utc(launched) + "\n";
    log->out_ << first;
    log->out_.flush();
    log->written_ = first.size();
    return log;
}

void RunLog::write(std::string_view level, std::string_view category, std::string_view message) {
    if (cut_ || !out_)
        return;
    auto uptime = std::chrono::duration_cast<std::chrono::milliseconds>(
                          std::chrono::steady_clock::now() - started_)
                          .count();
    auto line = format_prefix(now_ms(), uptime, level, category) + " " +
                escape_message(sweeper_.sweep(message)) + "\n";
    if (written_ + line.size() > RUN_LOG_MAX_RUN_BYTES) {
        cut_ = true;
        line = format_prefix(now_ms(), uptime, "warn", "log") + " run log cut at " +
               std::to_string(RUN_LOG_MAX_RUN_BYTES) + " bytes\n";
    }
    out_ << line;
    out_.flush();
    written_ += line.size();
}

}  // namespace session_bridge
