#pragma once

#include <optional>
#include <string>
#include <utility>

#include "BenchConversation.hpp"
#include "HybridBenchConversationHandleSpec.hpp"

namespace margelo::nitro::session::bridge::rn {

/**
 * A conversation that lives in C++ until something reads it.
 *
 * One JSI hop per property, which is the number this object exists to price: the parse that
 * direct structs would delete costs 29.67 µs per row under Hermes, and what replaces it is paid
 * per field instead. Fifteen of them here, a 66-byte account id and two enums the app wants as
 * strings among them.
 *
 * Its own header, and not folded in beside the factory, because nitrogen's autolinking includes
 * one file per registered HybridObject named exactly after the implementation class.
 */
class HybridBenchConversationHandle final : public HybridBenchConversationHandleSpec {
  public:
    explicit HybridBenchConversationHandle(BenchConversation row)
        : HybridObject(TAG), _row(std::move(row)) {}

    std::string getId() override { return _row.id; }
    BenchConversationKind getKind() override { return _row.kind; }
    std::string getDisplayName() override { return _row.displayName; }
    std::optional<std::string> getNickname() override { return _row.nickname; }
    double getLastActivity() override { return _row.lastActivity; }
    double getPriority() override { return _row.priority; }
    double getUnreadCount() override { return _row.unreadCount; }
    bool getMarkedUnread() override { return _row.markedUnread; }
    std::optional<std::string> getSnippet() override { return _row.snippet; }
    std::optional<double> getMuteUntil() override { return _row.muteUntil; }
    BenchAutoDownload getAutoDownload() override { return _row.autoDownload; }
    bool getRequest() override { return _row.request; }
    bool getAwaitingApproval() override { return _row.awaitingApproval; }
    bool getNoteToSelf() override { return _row.noteToSelf; }
    bool getBlocked() override { return _row.blocked; }

  private:
    BenchConversation _row;
};

}  // namespace margelo::nitro::session::bridge::rn
