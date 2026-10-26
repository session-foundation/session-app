#pragma once

#include <NitroModules/BorrowingReference.hpp>
#include <NitroModules/Dispatcher.hpp>

#include <jsi/jsi.h>

#include <memory>

#include "HybridSessionBridgeSpec.hpp"

// Deliberately fully qualified. Nitro puts us in margelo::nitro::session::bridge::rn, so a name
// starting `session` is looked up inside that namespace first and never reaches the shim - with
// an error that reads as if the header were missing.
namespace session_bridge {
class ClientBridge;
}
namespace session_bridge_rn {
class BridgeMediaSource;
class JsMediaSource;
}

namespace margelo::nitro::session::bridge::rn {

/// The bridge behind JSI. A transport and nothing else: the shim does the work, and this is the
/// mobile half of "the platform adapter owns the hop onto the JavaScript thread".
class HybridSessionBridge : public HybridSessionBridgeSpec {
  public:
    // Both out of line, because the unique_ptr below holds a forward-declared type: a defaulted
    // constructor here would instantiate its deleter, which needs the complete one.
    HybridSessionBridge();
    ~HybridSessionBridge() override;

    void init(const SessionBridgeOptions& options) override;
    void call(::session_bridge::Request request) override;
    std::shared_ptr<Promise<NativeMedia>> fetchMedia(double messageId, double index) override;
    std::shared_ptr<Promise<NativeThumbhash>> fetchThumbhash(double messageId, double index) override;
    std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> fetchThumbnail(
            double messageId, double index) override;
    void close() override;

  protected:
    void loadHybridMethods() override;

  private:
    /// `setSink(onFrame)`, registered by hand as a raw JSI method rather than declared in the
    /// spec. Nitro's typed callback wrapper (`AsyncJSCallback::operator()`) passes its arguments
    /// on as lvalues, which copy-constructs the whole Frame on every call before the hop; holding
    /// the function ourselves lets the frame move all the way to the converter.
    jsi::Value setSink(
            jsi::Runtime& runtime, const jsi::Value& thisArg, const jsi::Value* args, size_t count);

    /// `serveMediaFrom(fetchMedia, fetchThumbhash, fetchThumbnail)`, raw so the functions are called, and the bytes
    /// they answer with read, on the JS thread only.
    jsi::Value serveMediaFrom(
            jsi::Runtime& runtime, const jsi::Value& thisArg, const jsi::Value* args, size_t count);

    /// The sink as JavaScript gave it: the function, the runtime it belongs to, and the dispatcher
    /// that reaches that runtime's thread. Shared with the job that runs on Core's loop, so a
    /// close() racing a frame in flight cannot leave it dangling.
    struct Sink {
        jsi::Runtime* runtime = nullptr;
        BorrowingReference<jsi::Function> function;
        std::weak_ptr<Dispatcher> dispatcher;
    };

    std::shared_ptr<Sink> _sink;
    /// What the image loaders are answered from: the open bridge, or JavaScript. Never both.
    std::shared_ptr<::session_bridge_rn::BridgeMediaSource> _media;
    std::shared_ptr<::session_bridge_rn::JsMediaSource> _served;
    std::unique_ptr<::session_bridge::ClientBridge> _bridge;
    /// Tells a null `_bridge` apart: not yet opened before init(), closed after.
    bool _opened = false;
};

}  // namespace margelo::nitro::session::bridge::rn
