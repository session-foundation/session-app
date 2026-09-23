#pragma once

#include <session/client/attachment.hpp>
#include <session/client/conversation.hpp>
#include <session/client/message.hpp>

#include "session_bridge/gen/types.hpp"

namespace session_bridge {

/// libsession's value types as the protocol's, one direction only: what comes the other way is a
/// command's arguments, which are read at the point they are used because each one validates
/// differently.
///
/// Rvalues only. Everything libsession hands over - a change callback's argument, a query's
/// result - is read for that delivery and is the handler's to consume, so the strings move into
/// the frame rather than being copied a second time.
///
/// Spelled out rather than reached through an enclosing namespace: this namespace is flat, so
/// nothing of libsession's is in scope unless a file says so.
Attachment to_bridge(::session::client::Attachment&& from);
Message to_bridge(::session::client::Message&& from);
/// A batch, in the order libsession gave it -- oldest first, which is already the order a handler
/// applies them in. Only the paged query reverses, because paging runs the other way.
std::vector<Message> to_bridge(std::vector<::session::client::Message>&& from);
Conversation to_bridge(::session::client::AnyConversation&& from);

}  // namespace session_bridge
