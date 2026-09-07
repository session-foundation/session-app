#include "BenchCorpus.hpp"

#include <array>
#include <string_view>
#include <utility>

namespace session::bridge::rn::bench {

using margelo::nitro::session::bridge::rn::BenchAutoDownload;
using margelo::nitro::session::bridge::rn::BenchConversation;
using margelo::nitro::session::bridge::rn::BenchConversationKind;
using margelo::nitro::session::bridge::rn::BenchMessage;
using margelo::nitro::session::bridge::rn::BenchSendState;

namespace {

    constexpr std::string_view HEX = "0123456789abcdef";

    // The same list the fixtures use, in the same order, so the same draws pick the same lengths.
    const std::array<std::string_view, 59> WORDS = {
            "the", "a", "of", "and", "to", "in", "is", "it", "you", "that",
            "he", "was", "for", "on", "are", "as", "with", "his", "they", "at",
            "be", "this", "from", "I", "have", "or", "by", "one", "had", "not",
            "but", "what", "all", "were", "we", "when", "your", "can", "said", "there",
            "use", "an", "each", "which", "she", "do", "how", "their", "if", "will",
            "up", "other", "about", "out", "many", "then", "them", "these", "so"};

    std::string account_id(Random& random) {
        std::string id = "05";
        id.reserve(66);
        for (int i = 0; i < 64; i++) id += HEX[static_cast<std::size_t>(random.next() * 16)];
        return id;
    }

    std::string words(Random& random, int count) {
        std::string out;
        for (int i = 0; i < count; i++) {
            if (i > 0) out += ' ';
            out += WORDS[static_cast<std::size_t>(random.next() * static_cast<double>(WORDS.size()))];
        }
        return out;
    }

    constexpr double NOW = 1'760'000'000'000.0;

}  // namespace

std::vector<BenchConversation> conversations(std::size_t count) {
    Random random(1);

    std::vector<std::string> accounts;
    accounts.reserve(count);
    for (std::size_t i = 0; i < count; i++) accounts.push_back(account_id(random));

    std::vector<BenchConversation> out;
    out.reserve(count);
    for (std::size_t i = 0; i < count; i++) {
        BenchConversation c;
        c.id = accounts[i];
        c.kind = BenchConversationKind::DM;
        c.displayName = words(random, 2);
        // nickname and muteUntil are left absent, as the fixtures leave them: an optional that is
        // always populated would measure the wrong thing on a field that is usually empty.
        c.nickname = std::nullopt;
        c.lastActivity = NOW - static_cast<double>(i) * 60'000.0;
        c.priority = 0;
        c.unreadCount = static_cast<double>(i % 7);
        c.markedUnread = false;
        c.snippet = words(random, 8);
        c.muteUntil = std::nullopt;
        c.autoDownload = BenchAutoDownload::NONE;
        c.request = false;
        c.awaitingApproval = false;
        c.noteToSelf = false;
        c.blocked = false;
        out.push_back(std::move(c));
    }
    return out;
}

std::vector<BenchMessage> messages(std::size_t count) {
    Random random(1);

    // Two authors, which is what a DM has - the fixtures' default, and the number the interning
    // question turns on.
    std::vector<std::string> accounts;
    accounts.reserve(2);
    for (int i = 0; i < 2; i++) accounts.push_back(account_id(random));
    const std::string conversation_id = accounts[0];

    std::vector<BenchMessage> out;
    out.reserve(count);
    for (std::size_t i = 0; i < count; i++) {
        BenchMessage m;
        m.id = static_cast<double>(i + 1);
        m.conversationId = conversation_id;
        m.author = accounts[i % 2];
        m.timestamp = NOW - static_cast<double>(count - i) * 30'000.0;
        // Short with a long tail, as real bodies are; a flat length flatters the numbers.
        m.body = words(random, 3 + static_cast<int>(random.next() * 30));
        m.outgoing = i % 2 == 0;
        m.sendState = BenchSendState::SENT;
        out.push_back(std::move(m));
    }
    return out;
}

}  // namespace session::bridge::rn::bench
