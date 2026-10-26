#pragma once

#include <cstddef>
#include <optional>
#include <span>
#include <string>
#include <string_view>

namespace session_bridge {

/// Which of an attachment's images a media URL names: the file, its placeholder, or the thumbnail
/// libsession made of it.
enum class MediaUrlKind { attachment, thumbhash, thumbnail };

/// The kind as the URL spells it.
std::string_view media_url_kind_name(MediaUrlKind kind);

struct MediaUrl {
    MediaUrlKind kind;
    double message_id;
    double index;
};

/// `session-media://<attachment|thumbhash|thumbnail>/<messageId>/<index>` split back up, or
/// nullopt.
///
/// The same rules as `parseMediaUrl` in `@session/app/mediaUrl`, and checked against the same
/// vectors: the canonical form only, two plain decimal ids no larger than 2^53 - 1, a non-zero
/// message id, no port, user, query or fragment. A native image loader is handed whatever URL the
/// app drew, so this is the whole of what one may ask the bridge for.
std::optional<MediaUrl> parse_media_url(std::string_view url);

/// The type to hand an attachment's bytes to a decoder as, or nullopt to refuse them.
///
/// The sender declares the type and a decoder decodes whatever format the bytes really are, so
/// the declaration alone decides nothing: served only when it is a viewable type and the leading
/// bytes are that family, and what is returned is what the bytes are.
std::optional<std::string> servable_content_type(
        std::string_view declared, std::span<const std::byte> bytes);

/// `servable_content_type`, narrowed to what a picture decoder may be handed: nullopt for a
/// servable video as well as for refused bytes. The image loaders' gate, since neither has a
/// player and a video the loader accepts is decrypted and copied only to fail in the decoder.
std::optional<std::string> servable_image_type(
        std::string_view declared, std::span<const std::byte> bytes);

}  // namespace session_bridge
