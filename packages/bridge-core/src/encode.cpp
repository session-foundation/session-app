#include "encode.hpp"

#include <session/client/conversation_id.hpp>

namespace session::bridge {

namespace pb = sessionbridge::v1;

std::string to_hex(std::span<const std::byte> bytes) {
    static constexpr char digits[] = "0123456789abcdef";
    std::string hex;
    hex.reserve(bytes.size() * 2);
    for (auto b : bytes) {
        hex += digits[std::to_integer<unsigned>(b) >> 4];
        hex += digits[std::to_integer<unsigned>(b) & 0xf];
    }
    return hex;
}

namespace {

    int64_t epoch_ms(sys_ms t) {
        return t.time_since_epoch().count();
    }

    pb::SendState send_state(client::SendState s) {
        // The enum values are libsession's own, so this is a cast in disguise; written out because
        // a value libsession adds should fail to compile here rather than cross the bridge as a
        // number nothing recognises.
        switch (s) {
            case client::SendState::pending: return pb::SEND_STATE_PENDING;
            case client::SendState::sending: return pb::SEND_STATE_SENDING;
            case client::SendState::sent: return pb::SEND_STATE_SENT;
            case client::SendState::failed: return pb::SEND_STATE_FAILED;
            case client::SendState::interrupted: return pb::SEND_STATE_INTERRUPTED;
            case client::SendState::uploading: return pb::SEND_STATE_UPLOADING;
            case client::SendState::unsendable: return pb::SEND_STATE_UNSENDABLE;
        }
        return pb::SEND_STATE_PENDING;
    }

    pb::AutoDownload auto_download(client::AutoDownload a) {
        switch (a) {
            case client::AutoDownload::none: return pb::AUTO_DOWNLOAD_NONE;
            case client::AutoDownload::image_attachments: return pb::AUTO_DOWNLOAD_IMAGE_ATTACHMENTS;
            case client::AutoDownload::all: return pb::AUTO_DOWNLOAD_ALL;
        }
        return pb::AUTO_DOWNLOAD_NONE;
    }

}  // namespace

void encode(const client::Attachment& from, pb::Attachment* to) {
    to->set_index(static_cast<uint32_t>(from.index));
    if (from.content_type)
        to->set_content_type(*from.content_type);
    if (from.filename)
        to->set_filename(*from.filename);
    if (from.caption)
        to->set_caption(*from.caption);
    if (from.size)
        to->set_size(*from.size);
    to->set_voice_message(from.voice_message);
    if (from.width)
        to->set_width(*from.width);
    if (from.height)
        to->set_height(*from.height);
    to->set_uploaded(from.uploaded);
}

void encode(const client::Message& from, pb::Message* to) {
    // No conversation id: every container already names the conversation, and repeating a
    // 66-character account id per row was 29% of a page of messages. See types.proto.
    to->set_id(from.id);
    to->set_author(to_hex(from.sender));
    to->set_timestamp(epoch_ms(from.timestamp));
    to->set_body(from.body);
    to->set_outgoing(from.outgoing);

    // Incoming messages have no send state. The field is not optional on the wire because every
    // consumer reads it behind `outgoing`, so an absent value would only move the question.
    to->set_send_state(from.send_state ? send_state(*from.send_state) : pb::SEND_STATE_SENT);

    for (const auto& a : from.attachments)
        encode(a, to->add_attachments());

    if (from.reply) {
        auto* reply = to->mutable_reply_to();
        reply->set_author(to_hex(from.reply->author));
        reply->set_timestamp(epoch_ms(from.reply->timestamp));
        if (from.reply->message_id)
            reply->set_message_id(*from.reply->message_id);
        // One level deep: a message reached through a reply carries what it answered but not the
        // answer itself, so this is null on a nested reply even when message_id is set.
        if (from.reply->message)
            reply->set_body(from.reply->message->body);
    }

    if (from.deleted)
        to->set_deleted(
                *from.deleted == client::Deletion::here ? pb::DELETION_HERE
                                                        : pb::DELETION_EVERYWHERE);
}

void encode(const client::AnyConversation& from, pb::Conversation* to) {
    to->set_id(from.id().to_string());
    to->set_display_name(from.display_name());
    to->set_snippet(from.last_message());
    to->set_last_activity(epoch_ms(from.last_activity()));
    to->set_priority(from.priority());
    to->set_unread_count(static_cast<uint32_t>(std::max(0, from.unread())));
    to->set_marked_unread(from.marked_unread());
    to->set_mute_until(
            std::chrono::duration_cast<std::chrono::milliseconds>(
                    from.mute_until().time_since_epoch())
                    .count());

    // Unset upstream means "inherit the account default" rather than "none"; the two are not
    // distinguished on the wire because no screen offers the distinction.
    to->set_auto_download(
            from.auto_download() ? auto_download(*from.auto_download()) : pb::AUTO_DOWNLOAD_NONE);

    if (const auto* dm = from.dm()) {
        to->set_kind(pb::CONVERSATION_KIND_DM);
        if (!dm->nickname.empty())
            to->set_nickname(dm->nickname);
        to->set_request(dm->request);
        to->set_awaiting_approval(dm->awaiting_approval);
        to->set_note_to_self(dm->note_to_self);
        to->set_blocked(dm->blocked);
    } else if (from.group()) {
        to->set_kind(pb::CONVERSATION_KIND_GROUP);
    } else {
        to->set_kind(pb::CONVERSATION_KIND_COMMUNITY);
    }
}

}  // namespace session::bridge
