#include <napi.h>
#include <session_bridge/client_bridge.hpp>
#include <session_bridge/decode_plan.hpp>
#include <session_bridge/gen/napi.hpp>
#include <session_bridge/media_url.hpp>
#include <session_bridge/utf8_path.hpp>

#include <cstdint>
#include <cstring>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <unordered_map>

namespace {

/// One `ClientBridge`, with a thread-safe function standing between Core's loop and V8.
///
/// The addon is the whole of the "platform adapter owns the hop onto the JS thread" half of the
/// shim's contract. Everything below it runs on Core's loop and only enqueues; everything above it
/// is JavaScript. The frame crosses as the struct the shim filled and becomes a V8 object on the
/// JavaScript thread, through the converters generated beside the struct.
class SessionBridge : public Napi::ObjectWrap<SessionBridge> {
  public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function ctor = DefineClass(
                env,
                "SessionBridge",
                {
                        InstanceMethod<&SessionBridge::Call>("call"),
                        InstanceMethod<&SessionBridge::FetchMedia>("fetchMedia"),
                        InstanceMethod<&SessionBridge::FetchThumbhash>("fetchThumbhash"),
                        InstanceMethod<&SessionBridge::FetchThumbnail>("fetchThumbnail"),
                        InstanceMethod<&SessionBridge::FetchRendition>("fetchRendition"),
                        InstanceMethod<&SessionBridge::FetchStagedThumbnail>(
                                "fetchStagedThumbnail"),
                        InstanceMethod<&SessionBridge::DatabasesReplaced>("databasesReplaced"),
                        InstanceMethod<&SessionBridge::Close>("close"),
                });
        exports.Set("SessionBridge", ctor);
        return exports;
    }

    explicit SessionBridge(const Napi::CallbackInfo& info) : Napi::ObjectWrap<SessionBridge>{info} {
        Napi::Env env = info.Env();

        if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction())
            throw Napi::TypeError::New(env, "new SessionBridge(options, onFrame)");

        Napi::Object options = info[0].As<Napi::Object>();
        session_bridge::InitOptions init;

        init.db_path =
                session_bridge::utf8_path(options.Get("dbPath").As<Napi::String>().Utf8Value());
        if (options.Has("cacheDir"))
            init.cache_dir = session_bridge::utf8_path(
                    options.Get("cacheDir").As<Napi::String>().Utf8Value());

        if (options.Has("rawKey") && !options.Get("rawKey").IsUndefined()) {
            Napi::Value raw = options.Get("rawKey");
            if (!raw.IsTypedArray())
                throw Napi::TypeError::New(env, "rawKey must be a Uint8Array of 32 bytes");
            auto bytes = raw.As<Napi::Uint8Array>();
            if (bytes.ElementLength() != 32)
                throw Napi::TypeError::New(env, "rawKey must be exactly 32 bytes");
            std::array<std::byte, 32> key{};
            std::memcpy(key.data(), bytes.Data(), key.size());
            init.raw_key = key;
        } else if (options.Has("password") && !options.Get("password").IsUndefined()) {
            init.password = options.Get("password").As<Napi::String>().Utf8Value();
        }

        if (options.Has("deferAccount"))
            init.defer_account = options.Get("deferAccount").ToBoolean().Value();
        if (options.Has("netid") && !options.Get("netid").IsUndefined())
            init.network.netid = options.Get("netid").As<Napi::String>().Utf8Value();
        if (options.Has("seedNodes") && !options.Get("seedNodes").IsUndefined()) {
            Napi::Value seeds = options.Get("seedNodes");
            if (!seeds.IsArray())
                throw Napi::TypeError::New(env, "seedNodes must be an array");
            auto list = seeds.As<Napi::Array>();
            for (uint32_t i = 0; i < list.Length(); i++) {
                Napi::Value entry = list.Get(i);
                if (!entry.IsObject())
                    throw Napi::TypeError::New(
                            env, "seedNodes[" + std::to_string(i) + "] must be an object");
                auto seed = entry.As<Napi::Object>();
                init.network.seed_nodes.push_back(
                        {seed.Get("ed25519PubkeyHex").As<Napi::String>().Utf8Value(),
                         seed.Get("ip").As<Napi::String>().Utf8Value(),
                         seed.Get("httpsPort").As<Napi::Number>().DoubleValue(),
                         seed.Get("omqPort").As<Napi::Number>().DoubleValue()});
            }
        }
        if (options.Has("fileServer") && !options.Get("fileServer").IsUndefined()) {
            Napi::Value value = options.Get("fileServer");
            if (!value.IsObject())
                throw Napi::TypeError::New(env, "fileServer must be an object");
            auto fs = value.As<Napi::Object>();
            auto scheme = session_bridge::EnumTraits<session_bridge::UrlScheme>::parse(
                    fs.Get("scheme").As<Napi::String>().Utf8Value());
            if (!scheme)
                throw Napi::TypeError::New(env, "fileServer.scheme must be http or https");
            init.network.file_server = session_bridge::FileServerConfig{
                    *scheme,
                    fs.Get("host").As<Napi::String>().Utf8Value(),
                    fs.Get("port").As<Napi::Number>().DoubleValue(),
                    fs.Get("ed25519PubkeyHex").As<Napi::String>().Utf8Value()};
        }
        if (options.Has("router") && !options.Get("router").IsUndefined()) {
            auto kind = session_bridge::EnumTraits<session_bridge::RouterKind>::parse(
                    options.Get("router").As<Napi::String>().Utf8Value());
            if (!kind)
                throw Napi::TypeError::New(
                        env, "router must be onion-requests, session-router or direct");
            init.network.router = *kind;
        }
        if (options.Has("deviceType") && !options.Get("deviceType").IsUndefined())
            init.device_type = options.Get("deviceType").As<Napi::String>().Utf8Value();
        if (options.Has("notificationYou") && !options.Get("notificationYou").IsUndefined())
            init.notification_you = options.Get("notificationYou").As<Napi::String>().Utf8Value();
        if (options.Has("logCategories") && !options.Get("logCategories").IsUndefined()) {
            Napi::Value value = options.Get("logCategories");
            if (!value.IsArray())
                throw Napi::TypeError::New(env, "logCategories must be an array");
            auto list = value.As<Napi::Array>();
            for (uint32_t i = 0; i < list.Length(); i++) {
                Napi::Value entry = list.Get(i);
                if (!entry.IsObject())
                    throw Napi::TypeError::New(
                            env, "logCategories[" + std::to_string(i) + "] must be an object");
                auto each = entry.As<Napi::Object>();
                init.log_categories.push_back(
                        {each.Get("category").As<Napi::String>().Utf8Value(),
                         each.Get("level").As<Napi::String>().Utf8Value()});
            }
        }
        if (options.Has("logLevel") && !options.Get("logLevel").IsUndefined())
            init.log_level = options.Get("logLevel").As<Napi::String>().Utf8Value();
        if (options.Has("thumbnailEdgePx") && !options.Get("thumbnailEdgePx").IsUndefined()) {
            Napi::Value edge = options.Get("thumbnailEdgePx");
            if (!edge.IsNumber())
                throw Napi::TypeError::New(env, "thumbnailEdgePx must be a number");
            init.thumbnail_edge_px = edge.As<Napi::Number>().DoubleValue();
        }

        // Desktop keeps nothing by message id that main could empty (docs/ARCHITECTURE.md,
        // 2026-10-09), so this only counts, for the tests that hold the bridge to calling it.
        init.on_database_replaced = [this] { ++_databases_replaced; };

        // Unlimited queue, so a frame produced on Core's loop is never dropped and BlockingCall
        // never blocks the thread that produced it. The JavaScript side drains the queue on its
        // next tick; bounding this would trade a bounded queue for lost ordering, which is the
        // one thing this stream exists to keep.
        _sink = Napi::ThreadSafeFunction::New(
                env, info[1].As<Napi::Function>(), "sessionBridgeSink", 0, 1);

        try {
            _bridge = std::make_unique<session_bridge::ClientBridge>(
                    std::move(init), [this](session_bridge::Frame frame) {
                        // Moved onto the heap for the queue; the V8 object is built from it on
                        // the JavaScript thread, where alone that is possible.
                        auto* payload = new session_bridge::Frame(std::move(frame));

                        auto status = _sink.BlockingCall(
                                payload,
                                [](Napi::Env cb_env,
                                   Napi::Function cb,
                                   session_bridge::Frame* f) {
                                    // Owned here, so the frame is released even if building the
                                    // object or calling into JavaScript throws.
                                    std::unique_ptr<session_bridge::Frame> owned{f};
                                    cb.Call({session_bridge::node::to_napi(cb_env, *owned)});
                                });

                        // The only way this fails is a sink already released, which means close()
                        // won the race. Dropping the frame is then correct; leaking it is not.
                        if (status != napi_ok)
                            delete payload;
                    });
        } catch (const std::exception& e) {
            _sink.Release();
            throw Napi::Error::New(env, e.what());
        }
    }

    // A collected bridge drops its pending promises rather than rejecting them from a finalizer.
    ~SessionBridge() override { Shutdown(false); }

  private:
    void Call(const Napi::CallbackInfo& info) {
        if (!_bridge)
            return;
        if (info.Length() < 1 || !info[0].IsObject())
            throw Napi::TypeError::New(info.Env(), "call(request) takes a Request object");

        // A request the converter cannot read never reaches the shim, and is reported to the
        // caller synchronously: the TypeScript in front of this turns it into the error Response
        // the request would otherwise have got.
        std::optional<session_bridge::Request> request;
        try {
            request = session_bridge::node::from_napi<session_bridge::Request>(info[0]);
        } catch (const std::exception& e) {
            throw Napi::TypeError::New(info.Env(), e.what());
        }
        _bridge->call(std::move(*request));
    }

    struct Ref {
        double message_id;
        double index;
    };

    /// The `(messageId, index)` pair every attachment fetch takes.
    static auto ref_of(const char* usage) {
        return [usage](const Napi::CallbackInfo& info) {
            if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
                throw Napi::TypeError::New(info.Env(), usage);
            return Ref{info[0].As<Napi::Number>().DoubleValue(),
                       info[1].As<Napi::Number>().DoubleValue()};
        };
    }

    /// A media request not yet settled. Only ever touched on the JavaScript thread.
    struct PendingFetch {
        Napi::Promise::Deferred deferred;
        Napi::ThreadSafeFunction tsfn;
    };
    using PendingFetches = std::unordered_map<uint64_t, PendingFetch>;

    /// A promise settled on the JavaScript thread by whatever `begin` hands its handler.
    ///
    /// Its own thread-safe function per request: these are as rare as a picture coming on
    /// screen, and one shared across them would have to outlive them all to be released safely.
    ///
    /// `parse` reads the arguments, throwing on a wrong one, before anything is allocated for the
    /// request; `begin` gets what it returned.
    template <typename Answer, typename Parse, typename Begin, typename Build>
    Napi::Value Fetch(
            const Napi::CallbackInfo& info,
            Parse parse,
            const char* resource,
            Begin begin,
            Build build) {
        Napi::Env env = info.Env();
        auto deferred = Napi::Promise::Deferred::New(env);

        if (!_bridge) {
            deferred.Reject(Napi::Error::New(env, "the bridge is closed").Value());
            return deferred.Promise();
        }
        auto args = parse(info);

        auto tsfn = Napi::ThreadSafeFunction::New(
                env, Napi::Function::New(env, [](const Napi::CallbackInfo&) {}), resource, 0, 1);
        // A picture that never arrives must not keep the process alive.
        tsfn.Unref(env);

        const uint64_t id = _next_fetch++;
        _fetches->emplace(id, PendingFetch{deferred, tsfn});

        // Holds the map rather than `this`: a queued answer can outlive the wrapper.
        begin(std::move(args), [fetches = _fetches, id, tsfn, build](Answer answer) mutable {
            auto* payload = new Answer(std::move(answer));
            auto status = tsfn.BlockingCall(
                    payload,
                    [fetches, id, build](Napi::Env cb_env, Napi::Function, Answer* a) {
                        std::unique_ptr<Answer> owned{a};
                        auto entry = fetches->extract(id);
                        if (entry.empty())
                            return;  // close() has rejected it already
                        auto& pending = entry.mapped();
                        pending.tsfn.Release();
                        if (owned->error)
                            pending.deferred.Reject(
                                    Napi::Error::New(cb_env, *owned->error).Value());
                        else
                            pending.deferred.Resolve(build(cb_env, *owned));
                    });
            if (status != napi_ok)
                delete payload;
        });

        return deferred.Promise();
    }

    /// `fetchMedia(messageId, index) -> Promise<{ contentType, bytes }>`.
    ///
    /// A promise rather than a frame, because bytes do not belong on the frame stream: its
    /// ordering is what makes a display bindable, and a file on it would stall every state frame
    /// behind a payload no event can contradict. The main process turns this into a response to
    /// a registered scheme, so the renderer receives a URL rather than a payload.
    Napi::Value FetchMedia(const Napi::CallbackInfo& info) {
        return Fetch<session_bridge::Media>(
                info,
                ref_of("fetchMedia(messageId, index)"),
                "sessionBridgeMedia",
                [this](Ref ref, session_bridge::MediaHandler cb) {
                    _bridge->fetch_media(ref.message_id, ref.index, std::move(cb));
                },
                [](Napi::Env env, const session_bridge::Media& media) {
                    // Copied, not wrapped: Electron >= 21 refuses external buffers
                    // (ERR_NAPI_NO_EXTERNAL_BUFFERS_ALLOWED).
                    auto bytes = Napi::Buffer<uint8_t>::Copy(
                            env,
                            reinterpret_cast<const uint8_t*>(media.bytes.data()),
                            media.bytes.size());

                    Napi::Object result = Napi::Object::New(env);
                    result.Set("contentType", media.content_type);
                    result.Set("bytes", bytes);
                    return result;
                });
    }

    /// A decoded ThumbHash, by the same route and for the same reason as `FetchMedia`.
    Napi::Value FetchThumbhash(const Napi::CallbackInfo& info) {
        return Fetch<session_bridge::Thumbhash>(
                info,
                ref_of("fetchThumbhash(messageId, index)"),
                "sessionBridgeThumbhash",
                [this](Ref ref, session_bridge::ThumbhashHandler cb) {
                    _bridge->fetch_thumbhash(ref.message_id, ref.index, std::move(cb));
                },
                [](Napi::Env env, const session_bridge::Thumbhash& thumbhash) {
                    auto rgba = Napi::Uint8Array::New(env, thumbhash.rgba.size());
                    std::memcpy(rgba.Data(), thumbhash.rgba.data(), thumbhash.rgba.size());

                    Napi::Object result = Napi::Object::New(env);
                    result.Set("width", thumbhash.width);
                    result.Set("height", thumbhash.height);
                    result.Set("rgba", rgba);
                    return result;
                });
    }

    /// `fetchThumbnail(messageId, index) -> Promise<Uint8Array>`: the JPEG, by the same route.
    Napi::Value FetchThumbnail(const Napi::CallbackInfo& info) {
        return Fetch<session_bridge::Media>(
                info,
                ref_of("fetchThumbnail(messageId, index)"),
                "sessionBridgeThumbnail",
                [this](Ref ref, session_bridge::MediaHandler cb) {
                    _bridge->fetch_thumbnail(ref.message_id, ref.index, std::move(cb));
                },
                [](Napi::Env env, const session_bridge::Media& media) {
                    auto bytes = Napi::Uint8Array::New(env, media.bytes.size());
                    std::memcpy(bytes.Data(), media.bytes.data(), media.bytes.size());
                    return bytes;
                });
    }

    /// `fetchRendition(messageId, index) -> Promise<{ contentType, bytes }>`, by the same route,
    /// typed by what the bytes are.
    Napi::Value FetchRendition(const Napi::CallbackInfo& info) {
        return Fetch<session_bridge::Media>(
                info,
                ref_of("fetchRendition(messageId, index)"),
                "sessionBridgeRendition",
                [this](Ref ref, session_bridge::MediaHandler cb) {
                    _bridge->fetch_rendition(ref.message_id, ref.index, std::move(cb));
                },
                [](Napi::Env env, const session_bridge::Media& media) {
                    auto bytes = Napi::Uint8Array::New(env, media.bytes.size());
                    std::memcpy(bytes.Data(), media.bytes.data(), media.bytes.size());

                    Napi::Object result = Napi::Object::New(env);
                    result.Set("contentType", media.content_type);
                    result.Set("bytes", bytes);
                    return result;
                });
    }

    /// `fetchStagedThumbnail(path) -> Promise<Uint8Array>`: libsession's thumbnail of a file staged
    /// to send, by the same route.
    Napi::Value FetchStagedThumbnail(const Napi::CallbackInfo& info) {
        return Fetch<session_bridge::Media>(
                info,
                [](const Napi::CallbackInfo& args) {
                    if (args.Length() < 1 || !args[0].IsString())
                        throw Napi::TypeError::New(args.Env(), "fetchStagedThumbnail(path)");
                    return args[0].As<Napi::String>().Utf8Value();
                },
                "sessionBridgeStagedThumbnail",
                [this](std::string path, session_bridge::MediaHandler cb) {
                    _bridge->fetch_staged_thumbnail(std::move(path), std::move(cb));
                },
                [](Napi::Env env, const session_bridge::Media& media) {
                    auto bytes = Napi::Uint8Array::New(env, media.bytes.size());
                    std::memcpy(bytes.Data(), media.bytes.data(), media.bytes.size());
                    return bytes;
                });
    }

    /// `databasesReplaced() -> number`: how many discards have replaced the database, the startup
    /// sweep's included.
    Napi::Value DatabasesReplaced(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), _databases_replaced);
    }

    void Close(const Napi::CallbackInfo&) { Shutdown(true); }

    void Shutdown(bool reject_pending) {
        if (!_bridge)
            return;
        // Destroying the bridge first joins Core's loop and drops the handlers still queued on it,
        // so nothing can call into a thread-safe function once it is released below.
        _bridge.reset();
        for (auto& [id, pending] : *_fetches) {
            if (reject_pending)
                pending.deferred.Reject(
                        Napi::Error::New(pending.deferred.Env(), "the bridge is closed").Value());
            pending.tsfn.Release();
        }
        _fetches->clear();
        _sink.Release();
    }

    std::unique_ptr<session_bridge::ClientBridge> _bridge;
    Napi::ThreadSafeFunction _sink;
    std::shared_ptr<PendingFetches> _fetches = std::make_shared<PendingFetches>();
    uint64_t _next_fetch = 0;
    /// Only touched on the JavaScript thread: the bridge calls back on the thread that called in.
    uint32_t _databases_replaced = 0;
};

/// `parseMediaUrl(url) -> { kind, messageId, index } | { kind: 'staged', path } | null`, the
/// shim's parser.
///
/// Desktop serves the scheme with its own TypeScript parser; this is here so the one both mobile
/// loaders call can be held to the same vectors.
Napi::Value ParseMediaUrl(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString())
        throw Napi::TypeError::New(env, "parseMediaUrl(url)");
    auto parsed = session_bridge::parse_media_url(info[0].As<Napi::String>().Utf8Value());
    if (!parsed)
        return env.Null();
    Napi::Object result = Napi::Object::New(env);
    result.Set("kind", std::string{session_bridge::media_url_kind_name(parsed->kind)});
    if (parsed->kind == session_bridge::MediaUrlKind::staged) {
        result.Set("path", parsed->path);
        return result;
    }
    result.Set("messageId", parsed->message_id);
    result.Set("index", parsed->index);
    return result;
}

/// `servableContentType(declared, bytes) -> string | null`, the shim's check, for the same reason.
Napi::Value ServableContentType(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    // A Uint8Array by element type, not any TypedArray: ElementLength() of a wider one would
    // hand the shim a fraction of the buffer and let a vector pass against the wrong prefix.
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsTypedArray() ||
        info[1].As<Napi::TypedArray>().TypedArrayType() != napi_uint8_array)
        throw Napi::TypeError::New(env, "servableContentType(declared, bytes: Uint8Array)");
    auto bytes = info[1].As<Napi::Uint8Array>();
    auto served = session_bridge::servable_content_type(
            info[0].As<Napi::String>().Utf8Value(),
            {reinterpret_cast<const std::byte*>(bytes.Data()), bytes.ElementLength()});
    if (!served)
        return env.Null();
    return Napi::String::New(env, *served);
}

/// `planDecode(bytes) -> { edgePx, firstFrameOnly, exceedsWholeDecodeCeiling, measured }`, the
/// shim's plan, which desktop main serves an original by. Synchronous: it reads a header and
/// decodes no pixel.
Napi::Value PlanDecode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsTypedArray() ||
        info[0].As<Napi::TypedArray>().TypedArrayType() != napi_uint8_array)
        throw Napi::TypeError::New(env, "planDecode(bytes: Uint8Array)");
    auto bytes = info[0].As<Napi::Uint8Array>();
    const auto plan = session_bridge::decode_plan(std::span<const std::byte>{
            reinterpret_cast<const std::byte*>(bytes.Data()), bytes.ElementLength()});
    Napi::Object result = Napi::Object::New(env);
    result.Set("edgePx", plan.edge_px);
    result.Set("firstFrameOnly", plan.first_frame_only);
    result.Set("exceedsWholeDecodeCeiling", plan.exceeds_whole_decode_ceiling);
    result.Set("measured", plan.measured);
    return result;
}

}  // namespace

static Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    exports.Set("parseMediaUrl", Napi::Function::New<ParseMediaUrl>(env, "parseMediaUrl"));
    exports.Set(
            "servableContentType",
            Napi::Function::New<ServableContentType>(env, "servableContentType"));
    exports.Set("planDecode", Napi::Function::New<PlanDecode>(env, "planDecode"));
    return SessionBridge::Init(env, exports);
}

NODE_API_MODULE(session_bridge_node, InitAll)
