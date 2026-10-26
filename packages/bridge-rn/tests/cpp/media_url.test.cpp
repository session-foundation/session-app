// The shim's media URL parser and servable-bytes check, against the table every parser of the
// scheme is held to: `media_vectors.hpp` is written from `mediaVectors.ts` by `run.sh`.

#include <session_bridge/media_url.hpp>

#include "media_vectors.hpp"

#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <span>
#include <string>

namespace {

int failures = 0;

void failed(const char* what, std::string_view subject, const std::string& detail) {
    std::fprintf(
            stderr, "%s: %.*s: %s\n", what, static_cast<int>(subject.size()), subject.data(),
            detail.c_str());
    failures++;
}

std::span<const std::byte> bytes_of(std::string_view text) {
    return {reinterpret_cast<const std::byte*>(text.data()), text.size()};
}

std::string shown(const std::optional<std::string>& type) {
    return type ? *type : "<refused>";
}

void parses_every_url_as_the_table_says() {
    for (const auto& vector : media_vectors::URLS) {
        const auto parsed = session_bridge::parse_media_url(vector.url);
        if (parsed.has_value() != vector.parses) {
            failed("parse_media_url", vector.url, vector.parses ? "refused" : "accepted");
            continue;
        }
        if (!parsed)
            continue;
        if (session_bridge::media_url_kind_name(parsed->kind) != vector.kind
            || parsed->message_id != vector.message_id
            || parsed->index != vector.index)
            failed("parse_media_url", vector.url, "parsed to the wrong ref");
    }
}

void serves_and_refuses_bytes_as_the_table_says() {
    for (const auto& vector : media_vectors::SERVABLE) {
        const auto served =
                session_bridge::servable_content_type(vector.declared, bytes_of(vector.bytes));
        const bool agrees = vector.served ? served == std::string{*vector.served} : !served;
        if (!agrees)
            failed("servable_content_type", vector.declared, "served " + shown(served));
    }
}

/// The image loaders' gate: what the table serves as an image, and nothing the table serves as a
/// video, so an mp4 with a sound `ftyp` box never reaches a picture decoder.
void serves_an_image_type_only_for_the_image_family() {
    for (const auto& vector : media_vectors::SERVABLE) {
        const auto image =
                session_bridge::servable_image_type(vector.declared, bytes_of(vector.bytes));
        const bool expected = vector.served && vector.served->starts_with("image/");
        const bool agrees = expected ? image == std::string{*vector.served} : !image;
        if (!agrees)
            failed("servable_image_type", vector.declared, "served " + shown(image));
    }
    bool saw_video = false;
    for (const auto& vector : media_vectors::SERVABLE)
        if (vector.served && vector.served->starts_with("video/"))
            saw_video = true;
    if (!saw_video)
        failed("servable_image_type", "table", "holds no servable video to refuse");
}

}  // namespace

int main() {
    if (media_vectors::URLS.size() < 40 || media_vectors::SERVABLE.size() < 25) {
        std::fputs("media_vectors.hpp is shorter than the table it was written from\n", stderr);
        return EXIT_FAILURE;
    }
    parses_every_url_as_the_table_says();
    serves_and_refuses_bytes_as_the_table_says();
    serves_an_image_type_only_for_the_image_family();
    if (failures == 0)
        std::puts("media_url: all passed");
    return failures == 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
