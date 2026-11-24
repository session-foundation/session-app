#include "convert.hpp"

#include <oxenc/hex.h>
#include <session/client/conversation_id.hpp>
#include <session/image/thumbhash.hpp>

#include <algorithm>
#include <chrono>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace session_bridge {

// libsession's own names, which a flat namespace does not bring into scope on its own.
using namespace ::session;

namespace {

    double epoch_ms(sys_ms t) {
        return static_cast<double>(t.time_since_epoch().count());
    }

    template <typename T>
    std::optional<double> number(const std::optional<T>& value) {
        if (!value)
            return std::nullopt;
        return static_cast<double>(*value);
    }

    std::optional<std::string> non_empty(std::string value) {
        if (value.empty())
            return std::nullopt;
        return std::move(value);
    }

    // The enum values are libsession's own, so each of these is a cast in disguise; written out
    // because a value libsession adds should fail to compile here rather than cross the bridge
    // as a name nothing recognises. The fallback after each switch is unreachable, and
    // -Werror=switch is what keeps it that way.
    SendState send_state(client::SendState s) {
        switch (s) {
            case client::SendState::pending: return SendState::pending;
            case client::SendState::sending: return SendState::sending;
            case client::SendState::sent: return SendState::sent;
            case client::SendState::failed: return SendState::failed;
            case client::SendState::interrupted: return SendState::interrupted;
            case client::SendState::uploading: return SendState::uploading;
            case client::SendState::unsendable: return SendState::unsendable;
        }
        return SendState::pending;
    }

    Deletion deletion(client::Deletion d) {
        switch (d) {
            case client::Deletion::here: return Deletion::here;
            case client::Deletion::everywhere: return Deletion::everywhere;
        }
        return Deletion::here;
    }

    AutoDownload auto_download(client::AutoDownload a) {
        switch (a) {
            case client::AutoDownload::none: return AutoDownload::none;
            case client::AutoDownload::image_attachments: return AutoDownload::image_attachments;
            case client::AutoDownload::all: return AutoDownload::all;
        }
        return AutoDownload::none;
    }

    AttachmentAvailability availability(client::AttachmentAvailability a) {
        switch (a) {
            case client::AttachmentAvailability::cached: return AttachmentAvailability::cached;
            case client::AttachmentAvailability::fetching: return AttachmentAvailability::fetching;
            case client::AttachmentAvailability::absent: return AttachmentAvailability::absent;
            case client::AttachmentAvailability::not_found: return AttachmentAvailability::not_found;
            case client::AttachmentAvailability::unreadable:
                return AttachmentAvailability::unreadable;
        }
        return AttachmentAvailability::absent;
    }


}  // namespace

bool thumbhash_decodable(const ::session::client::Attachment& a) {
    if (!a.thumbhash || !image::thumbhash::valid(*a.thumbhash))
        return false;
    // Missing dimensions fall back to square; present but implausible ones are refused.
    return !(a.width && a.height) || (plausible_side(*a.width) && plausible_side(*a.height));
}

namespace {

    // Set exactly when `has_thumbhash` is: the same test decides both.
    std::optional<double> thumbhash_aspect(const ::session::client::Attachment& a) {
        if (!thumbhash_decodable(a))
            return std::nullopt;
        return image::thumbhash::component_aspect_ratio(*a.thumbhash);
    }

}  // namespace

Attachment to_bridge(::session::client::Attachment&& from) {
    return Attachment(
            static_cast<double>(from.index),
            std::move(from.content_type),
            std::move(from.filename),
            number(from.size),
            from.voice_message,
            number(from.width),
            number(from.height),
            thumbhash_decodable(from),
            thumbhash_aspect(from),
            from.has_thumbnail,
            static_cast<double>(from.thumbnail_width),
            static_cast<double>(from.thumbnail_height),
            from.has_rendition,
            from.picture && from.picture->rendition_refused,
            from.original_file,
            from.uploaded,
            availability(from.availability),
            static_cast<double>(from.fetch_done),
            static_cast<double>(from.fetch_total),
            from.saved_at ? std::optional<double>{epoch_ms(*from.saved_at)} : std::nullopt);
}

namespace {

    // Copies: the quoted message is libsession's own, shared with every reply that answers it.
    QuotedMessage quoted(const ::session::client::Message& from) {
        std::vector<Attachment> attachments;
        attachments.reserve(from.attachments.size());
        for (const auto& a : from.attachments)
            attachments.push_back(to_bridge(::session::client::Attachment{a}));
        return QuotedMessage(
                static_cast<double>(from.id),
                from.outgoing,
                from.body,
                std::move(attachments),
                from.deleted ? std::optional{deletion(*from.deleted)} : std::nullopt);
    }

}  // namespace

Message to_bridge(::session::client::Message&& from) {
    std::optional<Reply> reply;
    if (from.reply)
        reply = Reply(
                oxenc::to_hex(from.reply->author),
                epoch_ms(from.reply->timestamp),
                number(from.reply->message_id),
                from.reply->message ? std::optional{quoted(*from.reply->message)} : std::nullopt);

    std::optional<Deletion> deleted;
    if (from.deleted)
        deleted = deletion(*from.deleted);

    std::vector<Attachment> attachments;
    attachments.reserve(from.attachments.size());
    for (auto& a : from.attachments)
        attachments.push_back(to_bridge(std::move(a)));

    return Message(
            static_cast<double>(from.id),
            from.conversation.to_string(),
            oxenc::to_hex(from.sender),
            epoch_ms(from.timestamp),
            std::move(from.body),
            from.outgoing,
            // Incoming messages have no send state; every consumer reads it behind `outgoing`,
            // so an absent value would only move the question.
            from.send_state ? send_state(*from.send_state) : SendState::sent,
            // The sync send is carried across unset rather than defaulted: libsession leaves it
            // unset on an incoming message and on a note to self, and `sent` there would report
            // a delivery to our other devices that was never attempted.
            from.sync_send_state ? std::optional<SendState>{send_state(*from.sync_send_state)}
                                 : std::nullopt,
            std::move(attachments),
            from.gallery_viewable,
            from.gallery,
            std::move(reply),
            deleted);
}

std::vector<Message> to_bridge(std::vector<::session::client::Message>&& from) {
    std::vector<Message> out;
    out.reserve(from.size());
    for (auto& m : from)
        out.push_back(to_bridge(std::move(m)));
    return out;
}

Conversation to_bridge(::session::client::AnyConversation&& from) {
    auto& base = from.base();

    ConversationKind kind = ConversationKind::community;
    std::optional<std::string> nickname;
    bool request = false, awaiting_approval = false, note_to_self = false, blocked = false;
    if (auto* dm = from.dm()) {
        kind = ConversationKind::dm;
        nickname = non_empty(std::move(dm->nickname));
        request = dm->request;
        awaiting_approval = dm->awaiting_approval;
        note_to_self = dm->note_to_self;
        blocked = dm->blocked;
    } else if (from.group()) {
        kind = ConversationKind::group;
    }

    const auto mute_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                                 base.mute_until.time_since_epoch())
                                 .count();

    return Conversation(
            base.id.to_string(),
            kind,
            std::move(base.display_name),
            std::move(nickname),
            epoch_ms(base.last_activity),
            static_cast<double>(base.priority),
            static_cast<double>(std::max(0, base.unread)),
            base.marked_unread,
            // The snippet is a message body. An unset preview and a preview whose body is empty -
            // a message that was attachments alone - both mean no snippet, which is what the row
            // already renders for a conversation nobody has written in. Naming the files instead
            // needs copy, so it belongs to whoever draws the row.
            non_empty(base.last_preview ? std::move(base.last_preview->body) : std::string{}),
            mute_ms > 0 ? std::optional<double>{static_cast<double>(mute_ms)} : std::nullopt,
            base.auto_download ? std::optional<AutoDownload>{auto_download(*base.auto_download)}
                               : std::nullopt,
            request,
            awaiting_approval,
            note_to_self,
            blocked);
}

SendPlan to_bridge(image::SendPlan from) {
    // No default label: -Werror=switch makes a new plan a build failure here.
    switch (from) {
        case image::SendPlan::reencoded: return SendPlan::reencoded;
        case image::SendPlan::as_is: return SendPlan::as_is;
        case image::SendPlan::original_cannot_decode: return SendPlan::original_cannot_decode;
        case image::SendPlan::original_animated_png: return SendPlan::original_animated_png;
        case image::SendPlan::too_large_to_decode: return SendPlan::too_large_to_decode;
        case image::SendPlan::too_large_for_server: return SendPlan::too_large_for_server;
        case image::SendPlan::unreadable: return SendPlan::unreadable;
        case image::SendPlan::missing: return SendPlan::missing;
    }
    return SendPlan::unreadable;
}

NetworkStatus to_bridge(::session::network::ConnectionStatus from) {
    using ::session::network::ConnectionStatus;
    switch (from) {
        case ConnectionStatus::unknown: return NetworkStatus::unknown;
        case ConnectionStatus::connecting: return NetworkStatus::connecting;
        case ConnectionStatus::connected: return NetworkStatus::connected;
        case ConnectionStatus::disconnected: return NetworkStatus::disconnected;
    }
    return NetworkStatus::unknown;
}

ConversationList to_bridge(::session::client::ConversationList from) {
    using ::session::client::ConversationList;
    switch (from) {
        case ConversationList::none: return session_bridge::ConversationList::none;
        case ConversationList::conversations: return session_bridge::ConversationList::conversations;
        case ConversationList::requests: return session_bridge::ConversationList::requests;
    }
    return session_bridge::ConversationList::none;
}

ListPlacement to_bridge(::session::client::ListPlacement&& from) {
    std::optional<std::string> after;
    if (from.after)
        after = from.after->to_string();
    return ListPlacement{to_bridge(from.from), to_bridge(from.to), std::move(after)};
}

IncomingNotification to_bridge(push::NotificationContent&& from) {
    using Kind = push::NotificationContent::Kind;
    std::optional<NotificationAttachment> attachment;
    if (from.attachment) {
        switch (*from.attachment) {
            case push::AttachmentKind::image: attachment = NotificationAttachment::image; break;
            case push::AttachmentKind::animated:
                attachment = NotificationAttachment::animated;
                break;
            case push::AttachmentKind::video: attachment = NotificationAttachment::video; break;
            case push::AttachmentKind::audio: attachment = NotificationAttachment::audio; break;
            case push::AttachmentKind::voice: attachment = NotificationAttachment::voice; break;
            case push::AttachmentKind::file: attachment = NotificationAttachment::file; break;
        }
    }
    bool request = from.kind == Kind::message_request;
    std::optional<std::string> conversation;
    if (from.kind == Kind::message)
        conversation = std::move(from.thread);
    return IncomingNotification{
            std::move(from.id),
            request ? IncomingNotificationKind::request : IncomingNotificationKind::message,
            std::move(conversation),
            std::move(from.sender),
            std::move(from.body),
            attachment,
            static_cast<double>(from.attachments),
            epoch_ms(from.timestamp)};
}

}  // namespace session_bridge
