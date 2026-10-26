import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { MEDIA_URL_VECTORS, SERVABLE_VECTORS } from '#src/mediaVectors'

/**
 * Writes `mediaVectors.ts` as a C++ header, for the host test that holds the shim's
 * `parse_media_url` and `servable_content_type` to the same table as the TypeScript.
 *
 * `pnpm --filter @session/client-contract media-vectors:hpp <path>`, which `bridge-rn`'s
 * `tests/cpp/run.sh` runs before it compiles. A header rather than JSON because the shim has no
 * JSON library and a parser written for the test would be one more thing to hold to a table.
 */

const PRINTABLE = /^[ !#-&(-[\]-~]$/

/**
 * A `string_view` of exactly these bytes. With its length, since a run may hold a NUL; and as one
 * literal per byte, since a `\x` escape would otherwise swallow a hex digit after it.
 */
function literal(bytes: Uint8Array): string {
  const chars = [...bytes].map((byte) => {
    const char = String.fromCharCode(byte)
    return PRINTABLE.test(char) ? `"${char}"` : `"\\x${byte.toString(16).padStart(2, '0')}"`
  })
  return `std::string_view{${chars.length === 0 ? '""' : chars.join('')}, ${String(bytes.length)}}`
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function optional(type: string | null): string {
  return type === null ? 'std::nullopt' : literal(utf8(type))
}

function header(): string {
  const urls = MEDIA_URL_VECTORS.map(({ url, parsed }) =>
    parsed === null
      ? `        {${literal(utf8(url))}, false, "", 0, 0},`
      : `        {${literal(utf8(url))}, true, "${parsed.kind}", ${String(parsed.messageId)}.0, ${String(parsed.index)}.0},`,
  )
  const servable = SERVABLE_VECTORS.map(
    ({ declared, bytes, served }) =>
      `        {${literal(utf8(declared))}, ${literal(bytes)}, ${optional(served)}},`,
  )
  return `// Generated from packages/client-contract/src/mediaVectors.ts by scripts/writeMediaVectors.ts.
#pragma once

#include <optional>
#include <string_view>
#include <vector>

namespace media_vectors {

struct Url {
    std::string_view url;
    bool parses;
    std::string_view kind;
    double message_id;
    double index;
};

struct Servable {
    std::string_view declared;
    std::string_view bytes;
    std::optional<std::string_view> served;
};

inline const std::vector<Url> URLS{
${urls.join('\n')}
};

inline const std::vector<Servable> SERVABLE{
${servable.join('\n')}
};

}  // namespace media_vectors
`
}

const out = process.argv[2]
if (out === undefined) throw new Error('usage: writeMediaVectors.ts <path/to/media_vectors.hpp>')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, header())
