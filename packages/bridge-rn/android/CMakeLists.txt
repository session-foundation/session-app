cmake_minimum_required(VERSION 3.22)
project(SessionBridgeRN)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(SessionBridgeRN SHARED
    ../cpp/HybridSessionBridge.cpp
    ../cpp/BridgeMediaSource.cpp
    ../cpp/JsMediaSource.cpp
    ../cpp/MediaSource.cpp
    PushTarget.cpp
    PushJni.cpp
    OnLoad.cpp
    SessionMediaJni.cpp)

include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/SessionBridgeRN+autolinking.cmake)

# Nitrogen's OnLoad.cpp includes our implementation header by name, so where it lives has to be
# on the include path - the generated file has no way to know we put it in ../cpp.
target_include_directories(SessionBridgeRN PRIVATE ${CMAKE_SOURCE_DIR}/../cpp)

# Android's own sources, for the shared ones to include: PushTarget.hpp.
target_include_directories(SessionBridgeRN PRIVATE ${CMAKE_SOURCE_DIR})

# The shim, built for this ABI against a libsession that was cross-compiled separately.
#
# Separately because libsession's Android build is utils/android.sh, and that is not a
# preference: building it in-place here gives its CMake-based dependencies the NDK compiler
# without the NDK target, so simdutf comes out for the host and the link fails on libstdc++
# symbols that do not exist on Android.
set(SESSION_LIBSESSION_ANDROID "${CMAKE_SOURCE_DIR}/../../../libsession-util/build-android/${ANDROID_ABI}")
set(SESSION_BRIDGE_LIBSESSION_BUNDLE "${SESSION_LIBSESSION_ANDROID}/libsession-util.a"
    CACHE FILEPATH "" FORCE)

if(NOT EXISTS "${SESSION_BRIDGE_LIBSESSION_BUNDLE}")
    message(FATAL_ERROR
        "No libsession for ${ANDROID_ABI}. Build it first:\n"
        "  pnpm --filter @session/bridge-rn build:libsession:android")
endif()

add_subdirectory(${CMAKE_SOURCE_DIR}/../../bridge-core bridge-core)

target_link_libraries(SessionBridgeRN session::bridge-core log)

session_bridge_strict_switches(SessionBridgeRN)
