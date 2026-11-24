#include "session_bridge/database_header.hpp"

#include <array>
#include <fstream>

namespace session_bridge {

namespace {
    /// The first 16 bytes of every SQLite database, NUL included.
    constexpr std::array<char, 16> SQLITE_HEADER{
            'S', 'Q', 'L', 'i', 't', 'e', ' ', 'f', 'o', 'r', 'm', 'a', 't', ' ', '3', '\0'};
}  // namespace

bool opens_with_plaintext_header(const std::filesystem::path& path, bool when_new) {
    std::ifstream file{path, std::ios::binary};
    std::array<char, 16> head{};
    if (!file.read(head.data(), head.size()))
        return when_new;
    return head == SQLITE_HEADER;
}

}  // namespace session_bridge
