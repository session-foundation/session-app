#pragma once

#include <jni.h>

namespace session_bridge_rn {

/// Caches what the loader's answers call into Java. From `JNI_OnLoad`, which runs with the app's
/// class loader; returns the JNI version, or `JNI_ERR`.
jint register_media_loader(JavaVM* vm);

}  // namespace session_bridge_rn
