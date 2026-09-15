#include <napi.h>
#include <session_bridge/client_bridge.hpp>
#include <session_bridge/gen/napi.hpp>

#include <cstdint>
#include <cstring>
#include <memory>
#include <optional>
#include <string>

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

        init.db_path = options.Get("dbPath").As<Napi::String>().Utf8Value();
        if (options.Has("cacheDir"))
            init.cache_dir = options.Get("cacheDir").As<Napi::String>().Utf8Value();

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
                    fs.Get("x25519PubkeyHex").As<Napi::String>().Utf8Value()};
        }
        if (options.Has("router") && !options.Get("router").IsUndefined()) {
            auto kind = session_bridge::EnumTraits<session_bridge::RouterKind>::parse(
                    options.Get("router").As<Napi::String>().Utf8Value());
            if (!kind)
                throw Napi::TypeError::New(
                        env, "router must be onion-requests or session-router");
            init.network.router = *kind;
        }
        if (options.Has("deviceType") && !options.Get("deviceType").IsUndefined())
            init.device_type = options.Get("deviceType").As<Napi::String>().Utf8Value();
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

    ~SessionBridge() override { Shutdown(); }

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

    /// `fetchMedia(messageId, index) -> Promise<{ contentType, bytes }>`.
    ///
    /// A promise rather than a frame, because bytes do not belong on the frame stream: its
    /// ordering is what makes a display bindable, and a file on it would stall every state frame
    /// behind a payload no event can contradict. The main process turns this into a response to
    /// a registered scheme, so the renderer receives a URL rather than a payload.
    ///
    /// Its own thread-safe function per request, released when that request settles: these are
    /// as rare as a picture coming on screen, and one shared across them would have to outlive
    /// them all to be released safely.
    Napi::Value FetchMedia(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        auto deferred = Napi::Promise::Deferred::New(env);

        if (!_bridge) {
            deferred.Reject(Napi::Error::New(env, "the bridge is closed").Value());
            return deferred.Promise();
        }
        if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
            throw Napi::TypeError::New(env, "fetchMedia(messageId, index)");

        const double message_id = info[0].As<Napi::Number>().DoubleValue();
        const double index = info[1].As<Napi::Number>().DoubleValue();

        auto* settle = new Napi::Promise::Deferred(deferred);
        auto tsfn = Napi::ThreadSafeFunction::New(
                env, Napi::Function::New(env, [](const Napi::CallbackInfo&) {}),
                "sessionBridgeMedia", 0, 1);

        _bridge->fetch_media(
                message_id, index, [settle, tsfn](session_bridge::Media media) mutable {
                    auto* payload = new session_bridge::Media(std::move(media));
                    auto status = tsfn.BlockingCall(
                            payload,
                            [settle](Napi::Env cb_env,
                                     Napi::Function,
                                     session_bridge::Media* m) {
                                std::unique_ptr<session_bridge::Media> owned{m};
                                std::unique_ptr<Napi::Promise::Deferred> answer{settle};

                                if (owned->error) {
                                    answer->Reject(
                                            Napi::Error::New(cb_env, *owned->error).Value());
                                    return;
                                }

                                // Copied into a Buffer rather than wrapping the vector: the
                                // vector dies with this callback, and a Buffer that outlived its
                                // storage is the one failure mode here that is not a crash.
                                auto bytes = Napi::Buffer<uint8_t>::Copy(
                                        cb_env,
                                        reinterpret_cast<const uint8_t*>(owned->bytes.data()),
                                        owned->bytes.size());

                                Napi::Object result = Napi::Object::New(cb_env);
                                result.Set("contentType", owned->content_type);
                                result.Set("bytes", bytes);
                                answer->Resolve(result);
                            });
                    if (status != napi_ok) {
                        delete payload;
                        delete settle;
                    }
                    tsfn.Release();
                });

        return deferred.Promise();
    }

    void Close(const Napi::CallbackInfo&) { Shutdown(); }

    void Shutdown() {
        if (!_bridge)
            return;
        // Destroying the bridge first joins Core's loop, so no frame can be produced after the
        // sink is released and the release cannot race a call into a dead function.
        _bridge.reset();
        _sink.Release();
    }

    std::unique_ptr<session_bridge::ClientBridge> _bridge;
    Napi::ThreadSafeFunction _sink;
};

}  // namespace

static Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    return SessionBridge::Init(env, exports);
}

NODE_API_MODULE(session_bridge_node, InitAll)
