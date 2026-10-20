#include "SessionMediaJni.hpp"

#include "MediaSource.hpp"

#include <session_bridge/media_url.hpp>

#include <pthread.h>

#include <climits>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

namespace {

JavaVM* java_vm = nullptr;
jmethodID on_media = nullptr;
jmethodID on_preview = nullptr;
jmethodID on_failure = nullptr;
pthread_key_t detach_on_exit;

/// The calling thread's JNIEnv, attaching it if it is one of Core's: ART aborts the process when
/// an attached native thread exits undetached, hence the key whose destructor detaches it. Null
/// when the VM refuses the attach, which leaves no way to answer Java at all.
JNIEnv* attached_env() {
    JNIEnv* env = nullptr;
    if (java_vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) == JNI_OK)
        return env;
    if (java_vm->AttachCurrentThread(&env, nullptr) != JNI_OK)
        return nullptr;
    pthread_setspecific(detach_on_exit, env);
    return env;
}

/// Left pending on one of Core's threads, an exception would break that thread's next JNI call.
bool clear_pending(JNIEnv* env) {
    if (!env->ExceptionCheck())
        return false;
    env->ExceptionClear();
    return true;
}

void fail(JNIEnv* env, jobject load, const std::string& message) {
    jstring text = env->NewStringUTF(message.c_str());
    if (!text) {
        clear_pending(env);
        return;
    }
    env->CallVoidMethod(load, on_failure, text);
    clear_pending(env);
    env->DeleteLocalRef(text);
}

/// Hands `bytes` to Java as a direct buffer over this memory, which Java frees through `release`
/// once it has copied it into Fresco's pool. Null, with the memory already freed, when the bytes
/// are past a jint - ART aborts the process rather than refuse that - or the VM is out of memory.
jobject lend(JNIEnv* env, std::vector<std::byte>&& bytes, jlong& handle) {
    handle = 0;
    if (bytes.size() > static_cast<size_t>(INT_MAX))
        return nullptr;
    auto* held = new std::vector<std::byte>(std::move(bytes));
    jobject buffer = env->NewDirectByteBuffer(held->data(), static_cast<jlong>(held->size()));
    if (!buffer) {
        clear_pending(env);
        delete held;
        return nullptr;
    }
    handle = reinterpret_cast<jlong>(held);
    return buffer;
}

constexpr const char* UNLENDABLE = "the bytes do not fit a ByteBuffer";
constexpr const char* REFUSED = "the loader's thread did not take the answer";

/// Answers on whichever thread the source answered on - Core's loop, or the JS thread - and only
/// hands on: every method it calls enqueues onto the loader's own thread and returns.
void answer_media(jobject load, ::session_bridge::Media media) {
    JNIEnv* env = attached_env();
    if (!env)
        return;
    if (media.error) {
        fail(env, load, *media.error);
    } else if (::session_bridge::servable_image_type(media.content_type, media.bytes)) {
        // Fresco reads the format from the bytes, which the check has just said are a picture's.
        jlong handle = 0;
        jobject buffer = lend(env, std::move(media.bytes), handle);
        if (!buffer) {
            fail(env, load, UNLENDABLE);
        } else {
            env->CallVoidMethod(load, on_media, buffer, handle);
            // A throw means the loader's thread never took the job, so nothing else releases it.
            if (clear_pending(env)) {
                delete reinterpret_cast<std::vector<std::byte>*>(handle);
                fail(env, load, REFUSED);
            }
            env->DeleteLocalRef(buffer);
        }
    } else {
        fail(env, load, "not a picture the decoder may be handed");
    }
    env->DeleteGlobalRef(load);
}

/// Larger than any ThumbHash decodes to, and small enough that `width * height * 4` fits a jint.
constexpr double MAX_PREVIEW_SIDE = 16384;

void answer_preview(jobject load, ::session_bridge::Preview preview) {
    JNIEnv* env = attached_env();
    if (!env)
        return;
    // Checked as doubles: casting NaN or 1e12 to jint is undefined, so no cast may come first.
    const bool sized = preview.width > 0 && preview.width <= MAX_PREVIEW_SIDE
                    && preview.height > 0 && preview.height <= MAX_PREVIEW_SIDE;
    if (preview.error) {
        fail(env, load, *preview.error);
    } else if (!sized) {
        fail(env, load, "a preview whose size is not a picture's");
    } else {
        const auto width = static_cast<jint>(preview.width);
        const auto height = static_cast<jint>(preview.height);
        if (preview.rgba.size() != static_cast<size_t>(width) * static_cast<size_t>(height) * 4) {
            fail(env, load, "a preview whose pixels do not match its size");
        } else {
            jlong handle = 0;
            jobject buffer = lend(env, std::move(preview.rgba), handle);
            if (!buffer) {
                fail(env, load, UNLENDABLE);
            } else {
                env->CallVoidMethod(load, on_preview, width, height, buffer, handle);
                if (clear_pending(env)) {
                    delete reinterpret_cast<std::vector<std::byte>*>(handle);
                    fail(env, load, REFUSED);
                }
                env->DeleteLocalRef(buffer);
            }
        }
    }
    env->DeleteGlobalRef(load);
}

}  // namespace

namespace session_bridge_rn {

jint register_media_loader(JavaVM* vm) {
    java_vm = vm;
    JNIEnv* env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK)
        return JNI_ERR;
    // Looked up here, on a thread with the app's class loader: Core's loop has only the system one.
    jclass load = env->FindClass("session/bridge/rn/SessionMediaLoad");
    if (!load)
        return JNI_ERR;
    on_media = env->GetMethodID(load, "onMedia", "(Ljava/nio/ByteBuffer;J)V");
    on_preview = env->GetMethodID(load, "onPreview", "(IILjava/nio/ByteBuffer;J)V");
    on_failure = env->GetMethodID(load, "onFailure", "(Ljava/lang/String;)V");
    env->DeleteLocalRef(load);
    if (!on_media || !on_preview || !on_failure)
        return JNI_ERR;
    pthread_key_create(&detach_on_exit, [](void*) { java_vm->DetachCurrentThread(); });
    return JNI_VERSION_1_6;
}

}  // namespace session_bridge_rn

extern "C" JNIEXPORT void JNICALL
Java_session_bridge_rn_SessionMediaNative_fetch(JNIEnv* env, jclass, jstring url, jobject load) {
    const char* chars = env->GetStringUTFChars(url, nullptr);
    if (!chars)
        return;  // OutOfMemoryError is pending and is thrown from fetch().
    const std::string text{chars};
    env->ReleaseStringUTFChars(url, chars);

    const auto parsed = ::session_bridge::parse_media_url(text);
    if (!parsed) {
        fail(env, load, "not a media URL");
        return;
    }
    auto source = ::session_bridge_rn::media_source();
    if (!source) {
        fail(env, load, "nothing is serving media");
        return;
    }

    jobject held = env->NewGlobalRef(load);
    if (parsed->kind == ::session_bridge::MediaUrlKind::preview)
        source->fetch_preview(parsed->message_id, parsed->index, [held](auto preview) {
            answer_preview(held, std::move(preview));
        });
    else
        source->fetch_media(parsed->message_id, parsed->index, [held](auto media) {
            answer_media(held, std::move(media));
        });
}

extern "C" JNIEXPORT void JNICALL
Java_session_bridge_rn_SessionMediaNative_release(JNIEnv*, jclass, jlong handle) {
    delete reinterpret_cast<std::vector<std::byte>*>(handle);
}
