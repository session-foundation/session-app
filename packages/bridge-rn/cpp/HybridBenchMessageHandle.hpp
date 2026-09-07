#pragma once

#include <string>
#include <utility>

#include "BenchMessage.hpp"
#include "HybridBenchMessageHandleSpec.hpp"

namespace margelo::nitro::session::bridge::rn {

/// The same, for a message: seven fields, of which the body is the one that varies.
class HybridBenchMessageHandle final : public HybridBenchMessageHandleSpec {
  public:
    explicit HybridBenchMessageHandle(BenchMessage row)
        : HybridObject(TAG), _row(std::move(row)) {}

    double getId() override { return _row.id; }
    std::string getConversationId() override { return _row.conversationId; }
    std::string getAuthor() override { return _row.author; }
    double getTimestamp() override { return _row.timestamp; }
    std::string getBody() override { return _row.body; }
    bool getOutgoing() override { return _row.outgoing; }
    BenchSendState getSendState() override { return _row.sendState; }

  private:
    BenchMessage _row;
};

}  // namespace margelo::nitro::session::bridge::rn
