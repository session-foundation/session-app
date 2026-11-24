#include "session_bridge/log_sweep.hpp"

#include <sodium/crypto_auth_hmacsha256.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <optional>
#include <regex>
#include <stdexcept>
#include <unordered_set>

namespace session_bridge {

namespace {

    constexpr std::size_t PSEUDONYM_DIGITS = 8;
    constexpr std::size_t PSEUDONYM_CACHE_LIMIT = 4096;

    using std::regex;
    constexpr auto ECMA = std::regex::ECMAScript;
    constexpr auto ICASE = std::regex::ECMAScript | std::regex::icase;

    /// Every replacement in `sweep.ts` is a JavaScript `replace` with a callback over a global
    /// regex: left to right, without overlap, each match handed to the callback.
    template <typename F>
    std::string replace_each(const std::string& in, const regex& re, F&& f) {
        std::string out;
        out.reserve(in.size());
        auto last = in.cbegin();
        for (auto it = std::sregex_iterator(in.cbegin(), in.cend(), re); it != std::sregex_iterator();
             ++it) {
            const auto& m = *it;
            out.append(last, m[0].first);
            out += f(m);
            last = m[0].second;
        }
        out.append(last, in.cend());
        return out;
    }

    std::string lower(std::string_view s) {
        std::string out{s};
        for (auto& c : out)
            if (c >= 'A' && c <= 'Z')
                c = static_cast<char>(c - 'A' + 'a');
        return out;
    }

    bool full_match(std::string_view s, const regex& re) {
        return std::regex_match(s.begin(), s.end(), re);
    }

    // --- address.ts ---------------------------------------------------------------------------

    std::optional<std::array<int, 4>> octets(std::string_view text) {
        static const regex part{"^\\d{1,3}$", ECMA};
        std::array<int, 4> values{};
        std::size_t start = 0;
        for (int i = 0; i < 4; i++) {
            auto dot = text.find('.', start);
            if ((i < 3) != (dot != std::string_view::npos))
                return std::nullopt;
            auto piece = text.substr(start, i < 3 ? dot - start : std::string_view::npos);
            if (!full_match(piece, part))
                return std::nullopt;
            values[i] = std::stoi(std::string{piece});
            if (values[i] > 255)
                return std::nullopt;
            start = dot + 1;
        }
        return values;
    }

    std::string v4_class(const std::array<int, 4>& o) {
        auto [a, b, c, d] = o;
        if (a == 0 && b == 0 && c == 0 && d == 0)
            return "unspecified";
        if (a == 127)
            return "loopback";
        if (a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168))
            return "private";
        if (a == 169 && b == 254)
            return "private";
        if (a == 100 && b >= 64 && b <= 127)
            return "cgnat";
        return "public";
    }

    struct AddressShape {
        std::string family;
        std::string klass;
    };

    std::optional<AddressShape> address_shape(std::string_view host) {
        std::string bare{host};
        if (!bare.empty() && bare.front() == '[')
            bare.erase(0, 1);
        if (!bare.empty() && bare.back() == ']')
            bare.pop_back();
        if (auto pct = bare.find('%'); pct != std::string::npos)
            bare.erase(pct);
        if (auto v4 = octets(bare))
            return AddressShape{"v4", v4_class(*v4)};
        static const regex v6_chars{"^[0-9a-f:.]+$", ICASE};
        if (bare.find(':') == std::string::npos || !full_match(bare, v6_chars))
            return std::nullopt;

        auto lo = lower(bare);
        static const regex mapped{"^(?:0*:)*:?ffff:(\\d+\\.\\d+\\.\\d+\\.\\d+)$", ECMA};
        std::smatch m;
        if (std::regex_match(lo, m, mapped))
            if (auto inner = octets(m[1].str()))
                return AddressShape{"v6-mapped", v4_class(*inner)};

        static const regex loopback{"^(?:0*:)*:?0*1$", ECMA};
        static const regex unspecified{"^[0:]+$", ECMA};
        static const regex priv1{"^f[cd]", ECMA};
        static const regex priv2{"^fe[89ab]", ECMA};
        if (full_match(lo, loopback) && lo != "1")
            return AddressShape{"v6", "loopback"};
        if (full_match(lo, unspecified))
            return AddressShape{"v6", "unspecified"};
        if (std::regex_search(lo, priv1) || std::regex_search(lo, priv2))
            return AddressShape{"v6", "private"};
        return AddressShape{"v6", "public"};
    }

    std::string render_address(std::string_view host, std::string_view port = {}) {
        auto shape = address_shape(host);
        std::string head = shape ? shape->family + " " + shape->klass : "host?";
        return port.empty() ? head : head + ":" + std::string{port};
    }

    // --- values.ts ----------------------------------------------------------------------------

    std::optional<std::string> shorten_visible(std::string_view raw) {
        static const regex key_prefix{"^(05|03|15|25)[0-9a-f]{64}$", ICASE};
        if (!full_match(raw, key_prefix))
            return std::nullopt;
        auto lo = lower(raw);
        return lo.substr(0, 6) + "..." + lo.substr(lo.size() - 4);
    }

    // --- url.ts -------------------------------------------------------------------------------

    const std::unordered_set<std::string>& public_hosts() {
        static const std::unordered_set<std::string> hosts{
                "getsession.org",
                "docs.getsession.org",
                "token.getsession.org",
                "seed1.getsession.org",
                "seed2.getsession.org",
                "seed3.getsession.org",
                "filev2.getsession.org",
                "push.getsession.org",
                "superduperfiles.oxen.io",
        };
        return hosts;
    }

    const std::unordered_set<std::string>& path_words() {
        static const std::unordered_set<std::string> words{
                "room",         "rooms",       "file",      "files",    "message",  "messages",
                "since",        "before",      "recent",    "capabilities", "batch", "sequence",
                "pin",          "unpin",       "reactions", "reaction", "reactors", "inbox",
                "outbox",       "poll",        "info",      "user",     "oxen",     "session_version",
                "lsrpc",        "json_rpc",    "storage_rpc", "v1",     "v2",       "v3",
                "v4",           "onion_req",
        };
        return words;
    }

    bool looks_like_id(std::string_view segment) {
        static const regex hex{"^[0-9a-f]{16,}$", ICASE};
        static const regex b64{"^[A-Za-z0-9+/_=-]{20,}$", ECMA};
        static const regex digits{"^\\d{6,}$", ECMA};
        return full_match(segment, hex) || full_match(segment, b64) || full_match(segment, digits);
    }

    // --- Unicode, for the recovery-phrase backstop --------------------------------------------

    struct CodePoint {
        char32_t cp;
        std::size_t byte;
    };

    /// Malformed UTF-8 decodes byte by byte as U+FFFD, which is neither a letter nor a gap.
    std::vector<CodePoint> decode(std::string_view s) {
        std::vector<CodePoint> out;
        out.reserve(s.size());
        std::size_t i = 0;
        while (i < s.size()) {
            auto b = static_cast<unsigned char>(s[i]);
            int len = b < 0x80 ? 1 : (b >> 5) == 0x6 ? 2 : (b >> 4) == 0xe ? 3 : (b >> 3) == 0x1e ? 4 : 0;
            char32_t cp = 0xfffd;
            if (len == 1)
                cp = b;
            else if (len > 1 && i + len <= s.size()) {
                cp = b & (0x7f >> len);
                bool ok = true;
                for (int k = 1; k < len; k++) {
                    auto c = static_cast<unsigned char>(s[i + k]);
                    if ((c >> 6) != 0x2) {
                        ok = false;
                        break;
                    }
                    cp = (cp << 6) | (c & 0x3f);
                }
                if (!ok) {
                    cp = 0xfffd;
                    len = 1;
                }
            } else
                len = 1;
            out.push_back({cp, i});
            i += static_cast<std::size_t>(len);
        }
        return out;
    }

    /// `PHRASE_WORD`'s class: Latin and Cyrillic letters and the apostrophe.
    bool phrase_letter(char32_t c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= 0xc0 && c <= 0x24f) ||
               (c >= 0x400 && c <= 0x4ff) || c == '\'';
    }

    /// JavaScript's `\s`.
    bool js_space(char32_t c) {
        return c == '\t' || c == '\n' || c == '\v' || c == '\f' || c == '\r' || c == ' ' ||
               c == 0xa0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200a) || c == 0x2028 ||
               c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff;
    }

    /// `PHRASE_GAP`'s single characters.
    bool gap_char(char32_t c) {
        return js_space(c) || c == ',' || c == ';' || c == '"' || c == '[' || c == ']';
    }

    /// The length of a `PHRASE_GAP` starting at `i`: gap characters and literal `\n`, greedily.
    std::size_t gap_len(const std::vector<CodePoint>& t, std::size_t i) {
        std::size_t j = i;
        while (j < t.size()) {
            if (gap_char(t[j].cp))
                j++;
            else if (t[j].cp == '\\' && j + 1 < t.size() && t[j + 1].cp == 'n')
                j += 2;
            else
                break;
        }
        return j - i;
    }

    std::size_t letter_run(const std::vector<CodePoint>& t, std::size_t i) {
        std::size_t j = i;
        while (j < t.size() && phrase_letter(t[j].cp))
            j++;
        return j - i;
    }

    /// `WORD_RUN` as JavaScript would match it at `s`:
    /// `(?:WORD GAP){12,}WORD` with WORD = 3 to 16 letters, greedy, backtracking. Returns the end
    /// (in code points) and the number of words, or nothing.
    std::optional<std::pair<std::size_t, std::size_t>> word_run_at(
            const std::vector<CodePoint>& t, std::size_t s) {
        // Each repetition is a word of 3-16 letters ending exactly where a gap starts: a word cut
        // short would be followed by a letter, never a gap, so there is nothing to backtrack into.
        std::vector<std::size_t> word_ends;
        std::size_t pos = s;
        while (true) {
            auto len = letter_run(t, pos);
            if (len < 3 || len > 16)
                break;
            auto gap = gap_len(t, pos + len);
            if (gap == 0)
                break;
            word_ends.push_back(pos + len);
            pos = pos + len + gap;
        }
        auto k = word_ends.size();
        if (k >= 12) {
            // The greediest: every repetition taken, then a final WORD after the last gap, which
            // may be the start of a longer run, since nothing has to follow it.
            if (auto len = letter_run(t, pos); len >= 3)
                return std::make_pair(pos + std::min<std::size_t>(len, 16), k + 1);
        }
        if (k >= 13)
            // One repetition fewer, its word standing as the final WORD.
            return std::make_pair(word_ends[k - 1], k);
        return std::nullopt;
    }

    std::string sweep_word_runs(const std::string& in) {
        auto t = decode(in);
        std::string out;
        std::size_t copied = 0;  // bytes of `in` already handled
        std::size_t i = 0;
        while (i < t.size()) {
            if (!phrase_letter(t[i].cp)) {
                i++;
                continue;
            }
            auto run = word_run_at(t, i);
            if (!run) {
                i++;
                continue;
            }
            auto [end, words] = *run;
            auto from = t[i].byte;
            auto to = end < t.size() ? t[end].byte : in.size();
            out.append(in, copied, from - copied);
            out += "<" + std::to_string(words) + " words>";
            copied = to;
            i = end;
        }
        out.append(in, copied, std::string::npos);
        return out;
    }

    /// UTF-16 code units in a code point, which is what JavaScript's lengths count.
    std::size_t utf16_units(char32_t c) {
        return c >= 0x10000 ? 2 : 1;
    }

}  // namespace

LogSweeper::LogSweeper(std::vector<std::byte> salt) : salt_{std::move(salt)} {
    if (salt_.size() < 16)
        throw std::invalid_argument{"a pseudonym salt needs at least 16 bytes"};
}

std::string LogSweeper::pseudonym(std::string_view raw) {
    std::string key{raw};
    if (auto hit = seen_.find(key); hit != seen_.end()) {
        order_.splice(order_.end(), order_, hit->second);
        return hit->second->second;
    }
    if (seen_.size() >= PSEUDONYM_CACHE_LIMIT) {
        seen_.erase(order_.front().first);
        order_.pop_front();
    }
    crypto_auth_hmacsha256_state st;
    crypto_auth_hmacsha256_init(
            &st, reinterpret_cast<const unsigned char*>(salt_.data()), salt_.size());
    crypto_auth_hmacsha256_update(
            &st, reinterpret_cast<const unsigned char*>(raw.data()), raw.size());
    std::array<unsigned char, crypto_auth_hmacsha256_BYTES> mac{};
    crypto_auth_hmacsha256_final(&st, mac.data());
    static constexpr char HEX[] = "0123456789abcdef";
    std::string rendered = "~";
    for (std::size_t i = 0; i < PSEUDONYM_DIGITS / 2; i++) {
        rendered += HEX[mac[i] >> 4];
        rendered += HEX[mac[i] & 0xf];
    }
    order_.emplace_back(key, rendered);
    seen_[key] = std::prev(order_.end());
    return rendered;
}

std::string LogSweeper::render_host(std::string_view authority) {
    std::string host_port{authority};
    if (auto at = host_port.find('@'); at != std::string::npos)
        host_port.erase(0, at + 1);
    std::string host, port;
    bool has_port = false;
    static const regex bracketed{"^(\\[[^\\]]+\\])(?::(\\d+))?$", ECMA};
    std::smatch m;
    if (std::regex_match(host_port, m, bracketed)) {
        host = m[1].str();
        has_port = m[2].matched;
        port = m[2].str();
    } else if (auto colon = host_port.rfind(':'); colon != std::string::npos) {
        host = host_port.substr(0, colon);
        port = host_port.substr(colon + 1);
        has_port = true;
    } else
        host = host_port;
    if (address_shape(host))
        return "<" + render_address(host, has_port ? std::string_view{port} : std::string_view{}) +
               ">";
    auto lo = lower(host);
    auto name = public_hosts().contains(lo) ? lo : pseudonym(lo);
    return has_port ? name + ":" + port : name;
}

std::string LogSweeper::render_url(std::string_view text, bool& rendered) {
    static const regex url{"^([a-z][a-z0-9+.-]*):\\/\\/([^/?#\\s]*)([^?#\\s]*)(\\?[^#\\s]*)?(#\\S*)?$", ICASE};
    std::match_results<std::string_view::const_iterator> m;
    rendered = std::regex_match(text.begin(), text.end(), m, url);
    if (!rendered)
        return std::string{text};
    auto scheme = m[1].str();
    auto host = render_host(m[2].str());
    auto path = m[3].str();
    static const regex port_suffix{":\\d+$", ECMA};
    bool is_public = public_hosts().contains(std::regex_replace(host, port_suffix, ""));

    std::string out_path;
    std::size_t start = 0;
    while (true) {
        auto slash = path.find('/', start);
        auto segment = path.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
        if (!segment.empty()) {
            if (is_public)
                out_path += looks_like_id(segment) ? pseudonym(segment) : segment;
            else
                out_path += path_words().contains(lower(segment)) ? segment : pseudonym(segment);
        }
        if (slash == std::string::npos)
            break;
        out_path += '/';
        start = slash + 1;
    }

    std::string query_shape;
    if (m[4].matched) {
        auto query = m[4].str().substr(1);
        std::size_t params = 0, s = 0;
        while (s <= query.size()) {
            auto amp = query.find('&', s);
            auto part = query.substr(s, amp == std::string::npos ? std::string::npos : amp - s);
            if (!part.empty())
                params++;
            if (amp == std::string::npos)
                break;
            s = amp + 1;
        }
        query_shape = "?<" + std::to_string(params) + ">";
    }
    return lower(scheme) + "://" + host + out_path + query_shape;
}

std::string LogSweeper::sweep(std::string_view raw) {
    static const regex url_in_text{"\\b[a-z][a-z0-9+.-]*:\\/\\/[^\\s\"'<>]+", ICASE};
    static const regex uuid{
            "\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b", ICASE};
    static const regex hex{"(^|[^0-9a-z])([0-9a-f]{32,})(?![0-9a-z])", ICASE};
    static const regex base64{
            "(^|[^A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{40,}={0,2})(?![A-Za-z0-9+/_=-])", ECMA};
    static const regex base32{"\\b([a-z0-9]{50,})(\\.(?:sesh|snode|loki))?\\b", ECMA};
    static const regex ipv4{"\\b(\\d{1,3}(?:\\.\\d{1,3}){3})(?::(\\d{1,5}))?\\b", ECMA};
    static const regex ipv6_bracketed{"\\[([0-9a-f:.]+)\\](?::(\\d{1,5}))?", ICASE};
    // The dotted quad is tried before a hex group, and a match may not stop in front of `.digit`:
    // otherwise `::ffff:10.0.0.1` matches as `::ffff:10` and leaves the rest of the IPv4 address.
    static const regex ipv6_bare{
            "(^|[^\\w:.])((?:[0-9a-f]{0,4}:){2,7}(?:\\d+\\.\\d+\\.\\d+\\.\\d+|[0-9a-f]{1,4})?)(?![\\w:]|\\.\\d)",
            ICASE};
    static const regex has_b64_mark{"[0-9+/=_-]", ECMA};
    static const regex has_upper{"[A-Z]", ECMA};
    static const regex has_lower{"[a-z]", ECMA};
    static const regex has_hex_letter{"[a-f]", ICASE};

    std::string out = cap_for_sweep(raw);
    out = replace_each(out, url_in_text, [&](const std::smatch& m) {
        bool rendered = false;
        auto r = render_url(m[0].str(), rendered);
        return rendered ? r : m[0].str();
    });
    out = replace_each(out, uuid, [&](const std::smatch& m) { return pseudonym(lower(m[0].str())); });
    out = replace_each(out, hex, [&](const std::smatch& m) {
        auto value = m[2].str();
        auto shown = shorten_visible(value);
        return m[1].str() + (shown ? *shown : pseudonym(lower(value)));
    });
    out = replace_each(out, base64, [&](const std::smatch& m) {
        auto value = m[2].str();
        if (!std::regex_search(value, has_b64_mark) || !std::regex_search(value, has_upper) ||
            !std::regex_search(value, has_lower))
            return m[0].str();
        return m[1].str() + pseudonym(value);
    });
    out = replace_each(out, base32, [&](const std::smatch& m) {
        return pseudonym(m[1].str()) + (m[2].matched ? m[2].str() : std::string{});
    });
    out = replace_each(out, ipv6_bracketed, [&](const std::smatch& m) {
        if (!address_shape(m[1].str()))
            return m[0].str();
        return "<" + render_address(m[1].str(), m[2].matched ? m[2].str() : std::string{}) + ">";
    });
    out = replace_each(out, ipv6_bare, [&](const std::smatch& m) {
        auto host = m[2].str();
        if (!std::regex_search(host, has_hex_letter) && host.find("::") == std::string::npos)
            return m[0].str();
        if (!address_shape(host))
            return m[0].str();
        return m[1].str() + "<" + render_address(host) + ">";
    });
    out = replace_each(out, ipv4, [&](const std::smatch& m) {
        if (!address_shape(m[1].str()))
            return m[0].str();
        return "<" + render_address(m[1].str(), m[2].matched ? m[2].str() : std::string{}) + ">";
    });
    return sweep_word_runs(out);
}

std::string cap_for_sweep(std::string_view text, std::size_t max) {
    auto t = decode(text);
    std::size_t units = 0;
    for (const auto& c : t)
        units += utf16_units(c.cp);
    if (units <= max)
        return std::string{text};

    // The code point holding unit `max`, as JavaScript's `slice(0, max)` and `charAt(max)` see it.
    std::size_t kept_cps = 0, seen = 0;
    while (kept_cps < t.size() && seen + utf16_units(t[kept_cps].cp) <= max)
        seen += utf16_units(t[kept_cps++].cp);
    bool next_is_space = kept_cps < t.size() && js_space(t[kept_cps].cp);
    std::size_t end = kept_cps;
    if (!next_is_space)
        while (end > 0 && !js_space(t[end - 1].cp))
            end--;
    while (end > 0 && js_space(t[end - 1].cp))
        end--;
    std::size_t kept_units = 0;
    for (std::size_t i = 0; i < end; i++)
        kept_units += utf16_units(t[i].cp);
    auto kept = std::string{text.substr(0, end < t.size() ? t[end].byte : text.size())};
    auto note = "[cut " + std::to_string(units - kept_units) + " chars]";
    return kept.empty() ? note : kept + " " + note;
}

std::string escape_message(std::string_view text) {
    std::string out;
    out.reserve(text.size());
    for (std::size_t i = 0; i < text.size(); i++) {
        char c = text[i];
        if (c == '\\')
            out += "\\\\";
        else if (c == '\r' && i + 1 < text.size() && text[i + 1] == '\n') {
            out += "\\n";
            i++;
        } else if (c == '\n')
            out += "\\n";
        else if (c == '\r')
            out += "\\r";
        else
            out += c;
    }
    return out;
}

namespace {

    /// `prefixToken`: at most 32 characters, anything but `[\w.#-]` written as `_`.
    std::string prefix_token(std::string_view value) {
        auto t = decode(value);
        std::string out;
        std::size_t units = 0;
        for (const auto& c : t) {
            if (units + utf16_units(c.cp) > 32)
                break;
            units += utf16_units(c.cp);
            bool keep = (c.cp >= 'A' && c.cp <= 'Z') || (c.cp >= 'a' && c.cp <= 'z') ||
                        (c.cp >= '0' && c.cp <= '9') || c.cp == '_' || c.cp == '.' || c.cp == '#' ||
                        c.cp == '-';
            out += keep ? static_cast<char>(c.cp) : '_';
            // A surrogate pair is two code units, each replaced in JavaScript.
            if (!keep && utf16_units(c.cp) == 2)
                out += '_';
        }
        return out;
    }

    std::string pad_end(std::string s, std::size_t width, std::size_t units) {
        if (units < width)
            s.append(width - units, ' ');
        return s;
    }

    std::string level_word(std::string_view level) {
        if (level == "trace")
            return "TRACE";
        if (level == "debug")
            return "DEBUG";
        if (level == "info")
            return "INFO ";
        if (level == "error")
            return "ERROR";
        if (level == "critical")
            return "CRIT ";
        return "WARN ";
    }

    std::string iso_utc(int64_t ms) {
        auto secs = static_cast<std::time_t>(ms >= 0 ? ms / 1000 : (ms - 999) / 1000);
        auto millis = static_cast<int>(ms - static_cast<int64_t>(secs) * 1000);
        std::tm tm{};
        gmtime_r(&secs, &tm);
        char buf[32];
        std::snprintf(
                buf,
                sizeof buf,
                "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
                tm.tm_year + 1900,
                tm.tm_mon + 1,
                tm.tm_mday,
                tm.tm_hour,
                tm.tm_min,
                tm.tm_sec,
                millis);
        return buf;
    }

}  // namespace

std::string format_prefix(
        int64_t wall_ms,
        int64_t uptime_ms,
        std::string_view level,
        std::string_view category,
        std::string_view op) {
    constexpr std::size_t UPTIME_WIDTH = 11, CATEGORY_MAX = 16, CATEGORY_WIDTH = 18, OP_WIDTH = 16;

    char up[32];
    std::snprintf(
            up,
            sizeof up,
            "+%lld.%03lld",
            static_cast<long long>(uptime_ms / 1000),
            static_cast<long long>(uptime_ms % 1000));
    std::string uptime{up};
    if (uptime.size() < UPTIME_WIDTH)
        uptime.insert(0, UPTIME_WIDTH - uptime.size(), ' ');

    auto token = prefix_token(category);
    std::size_t token_units = token.size();  // ASCII after prefix_token
    std::string bracketed;
    std::size_t bracketed_units;
    if (token_units <= CATEGORY_MAX) {
        bracketed = "[" + token + "]";
        bracketed_units = token_units + 2;
    } else {
        bracketed = "[" + token.substr(0, CATEGORY_MAX - 1) + "…]";
        bracketed_units = CATEGORY_MAX + 2;
    }
    bracketed = pad_end(bracketed, CATEGORY_WIDTH, bracketed_units);

    std::string operation = op.empty() ? std::string{} : "[" + prefix_token(op) + "]";
    operation = pad_end(operation, OP_WIDTH, operation.size());

    return iso_utc(wall_ms) + " " + uptime + " " + level_word(level) + " " + bracketed + " " +
           operation;
}

bool is_log_file_name(std::string_view name) {
    static const regex pattern{"^session-(\\d{8}T\\d{6}Z)-(\\d+)\\.log$", ECMA};
    return full_match(name, pattern);
}

std::string log_file_name(int64_t launch_ms, int part) {
    auto iso = iso_utc(launch_ms);  // 2026-10-08T03:20:09.123Z
    std::string basic;
    for (auto c : iso.substr(0, 19))
        if (c != '-' && c != ':')
            basic += c;
    return "session-" + basic + "Z-" + std::to_string(part) + ".log";
}

}  // namespace session_bridge
