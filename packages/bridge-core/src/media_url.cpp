#include <session_bridge/media_url.hpp>

#include <array>
#include <cstdint>
#include <utility>

namespace session_bridge {

namespace {

    constexpr std::string_view SCHEME = "session-media://";
    constexpr std::uint64_t MAX_SAFE_INTEGER = (std::uint64_t{1} << 53) - 1;

    /// One `/`-free decimal id off the front of `rest`, consuming it; nullopt unless it is `0` or
    /// has no leading zero, and fits a JavaScript number exactly.
    std::optional<std::uint64_t> take_id(std::string_view& rest) {
        std::size_t length = 0;
        while (length < rest.size() && rest[length] >= '0' && rest[length] <= '9')
            length++;
        if (length == 0 || length > 16 || (length > 1 && rest[0] == '0'))
            return std::nullopt;
        std::uint64_t id = 0;
        for (std::size_t i = 0; i < length; i++)
            id = id * 10 + static_cast<std::uint64_t>(rest[i] - '0');
        if (id > MAX_SAFE_INTEGER)
            return std::nullopt;
        rest.remove_prefix(length);
        return id;
    }

    bool take(std::string_view& rest, std::string_view prefix) {
        if (!rest.starts_with(prefix))
            return false;
        rest.remove_prefix(prefix.size());
        return true;
    }

    enum class Family { image, video };

    struct Viewable {
        std::string_view type;
        Family family;
    };

    // `image/jpg` is not a registered type, but senders send it. The list is basic-types' media.ts.
    constexpr std::array<Viewable, 10> VIEWABLE{{
            {"image/bmp", Family::image},
            {"image/gif", Family::image},
            {"image/jpeg", Family::image},
            {"image/jpg", Family::image},
            {"image/png", Family::image},
            {"image/apng", Family::image},
            {"image/webp", Family::image},
            {"video/mp4", Family::video},
            {"video/webm", Family::video},
            {"video/ogg", Family::video},
    }};

    struct Run {
        std::size_t at;
        std::string_view bytes;
    };

    struct Signature {
        std::string_view type;
        Family family;
        std::array<Run, 2> runs;
    };

    using namespace std::string_view_literals;

    // Every run must match; an empty second run matches anything.
    constexpr std::array<Signature, 9> SIGNATURES{{
            {"image/png", Family::image, {{{0, "\x89PNG\r\n\x1a\n"sv}, {}}}},
            {"image/jpeg", Family::image, {{{0, "\xff\xd8\xff"sv}, {}}}},
            {"image/gif", Family::image, {{{0, "GIF87a"sv}, {}}}},
            {"image/gif", Family::image, {{{0, "GIF89a"sv}, {}}}},
            {"image/webp", Family::image, {{{0, "RIFF"sv}, {8, "WEBP"sv}}}},
            {"image/bmp", Family::image, {{{0, "BM"sv}, {}}}},
            {"video/mp4", Family::video, {{{4, "ftyp"sv}, {}}}},
            {"video/webm", Family::video, {{{0, "\x1a\x45\xdf\xa3"sv}, {}}}},
            {"video/ogg", Family::video, {{{0, "OggS"sv}, {}}}},
    }};

    bool matches(const Run& run, std::span<const std::byte> bytes) {
        if (run.at + run.bytes.size() > bytes.size())
            return false;
        for (std::size_t i = 0; i < run.bytes.size(); i++)
            if (bytes[run.at + i] != static_cast<std::byte>(run.bytes[i]))
                return false;
        return true;
    }

    /// `Image/JPEG; charset=binary` -> `image/jpeg`: a declared type is compared by its essence.
    std::string essence(std::string_view type) {
        type = type.substr(0, type.find(';'));
        constexpr std::string_view space = " \t\r\n\f\v";
        const auto first = type.find_first_not_of(space);
        if (first == std::string_view::npos)
            return {};
        type = type.substr(first, type.find_last_not_of(space) - first + 1);
        std::string out{type};
        for (char& c : out)
            if (c >= 'A' && c <= 'Z')
                c = static_cast<char>(c - 'A' + 'a');
        return out;
    }

}  // namespace

std::optional<MediaUrl> parse_media_url(std::string_view url) {
    std::string_view rest = url;
    if (!take(rest, SCHEME))
        return std::nullopt;

    MediaUrlKind kind;
    if (take(rest, "attachment/"))
        kind = MediaUrlKind::attachment;
    else if (take(rest, "preview/"))
        kind = MediaUrlKind::preview;
    else
        return std::nullopt;

    const auto message_id = take_id(rest);
    if (!message_id || *message_id == 0 || !take(rest, "/"))
        return std::nullopt;
    const auto index = take_id(rest);
    if (!index || !rest.empty())
        return std::nullopt;

    return MediaUrl{kind, static_cast<double>(*message_id), static_cast<double>(*index)};
}

std::optional<std::string> servable_content_type(
        std::string_view declared, std::span<const std::byte> bytes) {
    const std::string type = essence(declared);
    const Viewable* viewable = nullptr;
    for (const auto& each : VIEWABLE)
        if (each.type == type)
            viewable = &each;
    if (!viewable)
        return std::nullopt;

    for (const auto& signature : SIGNATURES) {
        if (!matches(signature.runs[0], bytes) || !matches(signature.runs[1], bytes))
            continue;
        if (signature.family != viewable->family)
            return std::nullopt;
        return std::string{signature.type};
    }
    return std::nullopt;
}

}  // namespace session_bridge
