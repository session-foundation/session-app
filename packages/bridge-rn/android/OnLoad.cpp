#include <jni.h>

#include "SessionBridgeRNOnLoad.hpp"
#include "SessionMediaJni.hpp"

/**
 * Registers the HybridObject when the library is loaded.
 *
 * Nitrogen generates the registration and the `initialize` that performs it, but not the entry
 * point that calls it - that is the library's to write. Without it the .so loads, says so, and
 * the first `createHybridObject('SessionBridge')` fails with "not yet been registered", which
 * reads like a naming mistake rather than a missing eight lines.
 */
extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
    if (session_bridge_rn::register_media_loader(vm) == JNI_ERR)
        return JNI_ERR;
    return margelo::nitro::session::bridge::rn::initialize(vm);
}
