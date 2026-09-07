#include "HybridBenchStructs.hpp"

#include <utility>

#include "BenchCorpus.hpp"

namespace margelo::nitro::session::bridge::rn {

// Fully qualified for the reason HybridSessionBridge.hpp gives: Nitro puts this code in
// margelo::nitro::session::bridge::rn, so an unqualified `bench::` looks for a `bench` inside
// *that* namespace and never reaches the global one - and says the function does not exist.

/**
 * Note what is deliberately NOT measured here.
 *
 * The corpus is built inside each call, so a result includes generating the rows as well as
 * handing them over. That is why `nothing()` exists and why the struct and handle calls are
 * compared against each other rather than read as absolutes: the generation is common to both,
 * so it cancels out of the difference, which is the quantity in question.
 */

std::vector<BenchConversation> HybridBenchStructs::makeConversationStructs(double count) {
    return ::session::bridge::rn::bench::conversations(static_cast<std::size_t>(count));
}

std::vector<BenchMessage> HybridBenchStructs::makeMessageStructs(double count) {
    return ::session::bridge::rn::bench::messages(static_cast<std::size_t>(count));
}

std::vector<std::shared_ptr<HybridBenchConversationHandleSpec>>
HybridBenchStructs::makeConversationHandles(double count) {
    auto rows = ::session::bridge::rn::bench::conversations(static_cast<std::size_t>(count));
    std::vector<std::shared_ptr<HybridBenchConversationHandleSpec>> out;
    out.reserve(rows.size());
    for (auto& row : rows) {
        out.push_back(std::make_shared<HybridBenchConversationHandle>(std::move(row)));
    }
    return out;
}

std::vector<std::shared_ptr<HybridBenchMessageHandleSpec>>
HybridBenchStructs::makeMessageHandles(double count) {
    auto rows = ::session::bridge::rn::bench::messages(static_cast<std::size_t>(count));
    std::vector<std::shared_ptr<HybridBenchMessageHandleSpec>> out;
    out.reserve(rows.size());
    for (auto& row : rows) {
        out.push_back(std::make_shared<HybridBenchMessageHandle>(std::move(row)));
    }
    return out;
}

double HybridBenchStructs::generateOnly(double count) {
    // Returns the size so the optimiser cannot discard the work: a call whose result is unused is
    // a call clang is entitled to delete, and a benchmark of a deleted call reads as very fast.
    auto rows = ::session::bridge::rn::bench::conversations(static_cast<std::size_t>(count));
    return static_cast<double>(rows.size());
}

void HybridBenchStructs::nothing() {}

}  // namespace margelo::nitro::session::bridge::rn
