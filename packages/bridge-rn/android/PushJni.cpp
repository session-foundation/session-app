// The native half of `org.getsession.push.PushNative` (apps/mobile/modules/session-push), which
// loads this library for it: the push service hands each push here, and posts what comes back.
//
// Found by its exported name rather than registered in JNI_OnLoad, because the class is in another
// Gradle module, which this one cannot see.

#include <android/log.h>
#include <jni.h>
#include <oxenc/hex.h>

#include <array>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

#include "PushTarget.hpp"

namespace push = session::push;

namespace {

void log_line(std::string_view line) {
    __android_log_print(
            ANDROID_LOG_INFO,
            "SessionPush",
            "%.*s",
            static_cast<int>(line.size()),
            line.data());
}

std::string text(JNIEnv* env, jstring s) {
    if (!s)
        return {};
    const char* chars = env->GetStringUTFChars(s, nullptr);
    std::string out{chars};
    env->ReleaseStringUTFChars(s, chars);
    return out;
}

jstring java(JNIEnv* env, const std::optional<std::string>& s) {
    return s ? env->NewStringUTF(s->c_str()) : nullptr;
}

const char* kind_name(push::NotificationContent::Kind kind) {
    switch (kind) {
        case push::NotificationContent::Kind::message: return "message";
        case push::NotificationContent::Kind::message_request: return "message_request";
        case push::NotificationContent::Kind::generic: return "generic";
    }
    return "generic";
}

const char* attachment_name(push::AttachmentKind kind) {
    switch (kind) {
        case push::AttachmentKind::image: return "image";
        case push::AttachmentKind::animated: return "animated";
        case push::AttachmentKind::video: return "video";
        case push::AttachmentKind::audio: return "audio";
        case push::AttachmentKind::voice: return "voice";
        case push::AttachmentKind::file: return "file";
    }
    return "file";
}

/// `org.getsession.push.PushOutcome`, built from what the handler decided.
jobject outcome(JNIEnv* env, const session_bridge::PushResult& r) {
    jclass type = env->FindClass("org/getsession/push/PushOutcome");
    if (!type)
        return nullptr;
    jmethodID make = env->GetMethodID(
            type,
            "<init>",
            "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;"
            "Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;IJJJ[Ljava/lang/String;)V");
    if (!make)
        return nullptr;

    jclass string_type = env->FindClass("java/lang/String");
    jobjectArray stale =
            env->NewObjectArray(static_cast<jsize>(r.stale.size()), string_type, nullptr);
    for (size_t i = 0; i < r.stale.size(); ++i) {
        jstring id = env->NewStringUTF(r.stale[i].c_str());
        env->SetObjectArrayElement(stale, static_cast<jsize>(i), id);
        env->DeleteLocalRef(id);
    }

    const auto* c = r.show ? &*r.show : nullptr;
    return env->NewObject(
            type,
            make,
            env->NewStringUTF(r.why.c_str()),
            c ? env->NewStringUTF(kind_name(c->kind)) : nullptr,
            c ? env->NewStringUTF(c->id.c_str()) : nullptr,
            c ? env->NewStringUTF(c->thread.c_str()) : nullptr,
            c ? java(env, c->sender) : nullptr,
            c ? java(env, c->body) : nullptr,
            c && c->attachment ? env->NewStringUTF(attachment_name(*c->attachment)) : nullptr,
            static_cast<jint>(c ? c->attachments : 0),
            static_cast<jlong>(c ? c->timestamp.time_since_epoch().count() : 0),
            static_cast<jlong>(c ? r.message_id.value_or(-1) : -1),
            static_cast<jlong>(r.badge.value_or(-1)),
            stale);
}

}  // namespace

/// Handles one push: on the app's own Client when the app is running with its database open, and
/// otherwise on a Client opened for it from `dbPath` with `keyHex`. `openConversation` is the one
/// on screen, which gets no notification. Blocks until done.
extern "C" JNIEXPORT jobject JNICALL Java_org_getsession_push_PushNative_handle(
        JNIEnv* env,
        jclass,
        jstring enc_payload,
        jstring db_path,
        jstring key_hex,
        jstring netid,
        jstring you,
        jstring open_conversation) {
    const auto enc = text(env, enc_payload);
    const auto me = text(env, you);
    std::optional<std::string> open;
    if (open_conversation)
        open = text(env, open_conversation);
    std::optional<session_bridge::PushResult> result;
    try {
        result = session_bridge_rn::handle_push_on_app_bridge(
                enc,
                me,
                open ? std::optional<std::string_view>{*open} : std::nullopt,
                session_bridge::PUSH_DEADLINE,
                log_line);
        if (result) {
            log_line("handled on the app's Client");
        } else {
            const auto hex = text(env, key_hex);
            if (hex.size() != 64 || !oxenc::is_hex(hex)) {
                result = session_bridge::PushResult{
                        session_bridge::generic_notification(),
                        {},
                        std::nullopt,
                        "no database key"};
            } else {
                session_bridge::ColdPush where;
                where.db_path = text(env, db_path);
                oxenc::from_hex(hex.begin(), hex.end(), where.key.begin());
                where.netid = text(env, netid);
                result = session_bridge::handle_cold_push(
                        where, enc, me, session_bridge::PUSH_DEADLINE, log_line);
            }
        }
    } catch (const std::exception& e) {
        result = session_bridge::PushResult{
                session_bridge::generic_notification(),
                {},
                std::nullopt,
                std::string{"threw: "} + e.what()};
    }
    log_line("push: " + result->why);
    return outcome(env, *result);
}

/// `org.getsession.push.ActionOutcome`: whether it is done, and what to take down.
jobject action_outcome(JNIEnv* env, const session_bridge::ActionResult& r) {
    jclass type = env->FindClass("org/getsession/push/ActionOutcome");
    if (!type)
        return nullptr;
    jmethodID make = env->GetMethodID(type, "<init>", "(Z[Ljava/lang/String;)V");
    if (!make)
        return nullptr;
    jclass string_type = env->FindClass("java/lang/String");
    jobjectArray stale =
            env->NewObjectArray(static_cast<jsize>(r.stale.size()), string_type, nullptr);
    for (size_t i = 0; i < r.stale.size(); ++i) {
        jstring id = env->NewStringUTF(r.stale[i].c_str());
        env->SetObjectArrayElement(stale, static_cast<jsize>(i), id);
        env->DeleteLocalRef(id);
    }
    return env->NewObject(type, make, r.done ? JNI_TRUE : JNI_FALSE, stale);
}

/// Carries out a notification's action: marks `conversation` read, and sends `reply` there when it
/// is not null. On the app's own Client when it is open, otherwise on one opened from `dbPath` with
/// `keyHex`, as a push is. Blocks until done or the deadline.
extern "C" JNIEXPORT jobject JNICALL Java_org_getsession_push_PushNative_act(
        JNIEnv* env,
        jclass,
        jstring conversation,
        jstring reply,
        jboolean mark_read,
        jstring db_path,
        jstring key_hex,
        jstring netid) {
    session_bridge::NotificationAction action;
    action.conversation = text(env, conversation);
    if (reply)
        action.reply = text(env, reply);
    action.mark_read = mark_read == JNI_TRUE;
    std::optional<session_bridge::ActionResult> result;
    try {
        result = session_bridge_rn::act_on_app_bridge(
                action, session_bridge::ACTION_DEADLINE, log_line);
        if (!result) {
            const auto hex = text(env, key_hex);
            if (hex.size() != 64 || !oxenc::is_hex(hex)) {
                result = session_bridge::ActionResult{false, "no database key", {}};
            } else {
                session_bridge::ColdPush where;
                where.db_path = text(env, db_path);
                oxenc::from_hex(hex.begin(), hex.end(), where.key.begin());
                where.netid = text(env, netid);
                result = session_bridge::handle_cold_action(
                        where, action, session_bridge::ACTION_DEADLINE, log_line);
            }
        }
    } catch (const std::exception& e) {
        result = session_bridge::ActionResult{false, std::string{"threw: "} + e.what(), {}};
    }
    log_line("action: " + result->why);
    return action_outcome(env, *result);
}
