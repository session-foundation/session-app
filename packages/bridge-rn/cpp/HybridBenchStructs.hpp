#pragma once

#include <memory>
#include <vector>

#include "BenchConversation.hpp"
#include "BenchMessage.hpp"
#include "HybridBenchConversationHandle.hpp"
#include "HybridBenchMessageHandle.hpp"
#include "HybridBenchStructsSpec.hpp"

namespace margelo::nitro::session::bridge::rn {

/// The factory. Builds the corpus in C++ and hands it over both ways.
class HybridBenchStructs final : public HybridBenchStructsSpec {
  public:
    HybridBenchStructs() : HybridObject(TAG) {}

    std::vector<BenchConversation> makeConversationStructs(double count) override;
    std::vector<BenchMessage> makeMessageStructs(double count) override;
    std::vector<std::shared_ptr<HybridBenchConversationHandleSpec>> makeConversationHandles(
            double count) override;
    std::vector<std::shared_ptr<HybridBenchMessageHandleSpec>> makeMessageHandles(
            double count) override;
    double generateOnly(double count) override;
    void nothing() override;
};

}  // namespace margelo::nitro::session::bridge::rn
