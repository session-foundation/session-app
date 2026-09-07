#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "BenchConversation.hpp"
#include "BenchMessage.hpp"

namespace session::bridge::rn::bench {

/**
 * The fixture corpus, ported.
 *
 * `tests/bench/src/fixtures.ts` is what the 29.67 µs/row parse and 1.33 µs/row convert were
 * measured on, and a JSI number taken against different data would not be comparable with them.
 * So the generator comes across rather than the values: the same mulberry32 seeded the same way,
 * the same word list, the same two words of display name and eight of snippet, the same 66-byte
 * account ids - which are most of what a row weighs and would flatter every result if shortened.
 */
class Random final {
  public:
    explicit Random(std::uint32_t seed) : _a(seed) {}

    // mulberry32, matching the TypeScript bit for bit: the same sequence means the same string
    // lengths, and length is what these measurements are actually sensitive to.
    double next() {
        _a += 0x6d2b79f5u;
        std::uint32_t t = (_a ^ (_a >> 15)) * (1u | _a);
        t = (t + (t ^ (t >> 7)) * (61u | t)) ^ t;
        return static_cast<double>(t ^ (t >> 14)) / 4294967296.0;
    }

  private:
    std::uint32_t _a;
};

std::vector<margelo::nitro::session::bridge::rn::BenchConversation> conversations(std::size_t count);
std::vector<margelo::nitro::session::bridge::rn::BenchMessage> messages(std::size_t count);

}  // namespace session::bridge::rn::bench
