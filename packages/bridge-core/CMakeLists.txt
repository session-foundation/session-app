cmake_minimum_required(VERSION 3.20)

project(session-bridge-core
    VERSION 0.0.1
    DESCRIPTION "One libsession Client behind one ordered frame stream"
    LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(SESSION_BRIDGE_LIBSESSION "${CMAKE_CURRENT_SOURCE_DIR}/../../libsession-util"
    CACHE PATH "Path to the libsession-util submodule")

# A prebuilt libsession, for platforms where building it inside the consumer's CMake project is
# not how libsession is built. Android is one: its dependencies are cross-compiled by
# utils/android.sh, which is the only path that gets the NDK toolchain as far as the CMake-based
# ones - build it in-place there and simdutf comes out targeting the host, which shows up as
# libstdc++ symbols missing at link time.
set(SESSION_BRIDGE_LIBSESSION_BUNDLE "" CACHE FILEPATH
    "Prebuilt libsession-util.a from utils/static-bundle.sh; built from source when empty")

if(SESSION_BRIDGE_LIBSESSION_BUNDLE)
    add_library(session-libsession-prebuilt STATIC IMPORTED GLOBAL)
    set_target_properties(session-libsession-prebuilt PROPERTIES
        IMPORTED_LOCATION "${SESSION_BRIDGE_LIBSESSION_BUNDLE}")
    # The bundle carries every dependency's code and none of their headers, and libsession's
    # public headers include several of them - oxenc and oxen/quic in client.hpp alone. Building
    # from source gets these through the targets it links; a prebuilt archive has no targets, so
    # the paths are spelled out.
    set(_ls "${SESSION_BRIDGE_LIBSESSION}")
    set(_router "${_ls}/external/session-router")
    # Dependencies the bundle's own build installed - ngtcp2 and friends - which sit beside it.
    get_filename_component(_bundle_dir "${SESSION_BRIDGE_LIBSESSION_BUNDLE}" DIRECTORY)
    target_include_directories(session-libsession-prebuilt INTERFACE
        "${_ls}/include"
        "${_ls}/external/session-sqlite/include"
        "${_ls}/external/session-sqlite/SQLiteCpp/include"
        "${_ls}/external/protobuf/src"
        "${_router}/external/oxen-libquic/include"
        "${_router}/external/oxen-mq/oxen-encoding"
        "${_router}/external/oxen-mq/oxen-logging/fmt/include"
        "${_router}/external/oxen-mq/oxen-logging/include"
        "${_router}/external/oxen-mq/oxen-logging/spdlog/include"
        "${_router}/external/nlohmann/single_include"
        "${_bundle_dir}/static-deps/include")
    add_library(libsession::client ALIAS session-libsession-prebuilt)
    add_library(libsession::protos ALIAS session-libsession-prebuilt)
elseif(NOT TARGET libsession::client)
    # Stand-alone build, for compiling the shim on its own. The addon add_subdirectory's this
    # from a build that has already added libsession.
    add_subdirectory(${SESSION_BRIDGE_LIBSESSION} libsession-util)
endif()

# A switch over one of libsession's enums must fail to build when libsession gains a value,
# rather than falling through to the fallback return after it - which is the whole reason those
# switches are written out instead of being casts. Per target rather than per directory, because
# libsession is built from this same tree and its own switches are its business.
#
# The switch this catches is one with no `default:`, which is how the bridge writes them. The
# stricter -Wswitch-enum, which fires even when a default label hides the omission, cannot be
# used: it also fires on libsession's own switches, since its headers are compiled inside these
# translation units (core/devices.hpp has one), and those are not ours to complete.
#
# Defined here and used by the addon and the Nitro module too: a CMake function outlives the
# directory it was declared in, and both of them add this project as a subdirectory.
function(session_bridge_strict_switches target)
    if(MSVC)
        target_compile_options(${target} PRIVATE /we4062)
    else()
        target_compile_options(${target} PRIVATE -Werror=switch)
    endif()
endfunction()

# The protocol structs under include/session_bridge/gen are generated from @session/bridge-types by
# tooling/bridge-codegen and committed, so this target needs nothing but a compiler.
add_library(session-bridge-core STATIC
    src/client_bridge.cpp
    src/convert.cpp
    src/mark_downloaded.cpp
    src/media_url.cpp)

target_include_directories(session-bridge-core
    PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

target_link_libraries(session-bridge-core PUBLIC libsession::client)

# What `mark_downloaded` sets the quarantine property through. macOS only: iOS has no Gatekeeper.
if(APPLE AND NOT CMAKE_SYSTEM_NAME STREQUAL "iOS")
    target_link_libraries(session-bridge-core PRIVATE "-framework CoreFoundation" "-framework CoreServices")
endif()

set_property(TARGET session-bridge-core PROPERTY POSITION_INDEPENDENT_CODE ON)

session_bridge_strict_switches(session-bridge-core)

option(SESSION_BRIDGE_TESTING
    "Compile the test-only commands, which carry messages between clients with no network" OFF)
if(SESSION_BRIDGE_TESTING)
    target_compile_definitions(session-bridge-core PRIVATE SESSION_BRIDGE_TESTING)
    # Forging a DM means building the same Content the wire carries. libsession links its protos
    # privately, so the headers do not arrive with libsession::client.
    target_link_libraries(session-bridge-core PRIVATE libsession::protos)
endif()

add_library(session::bridge-core ALIAS session-bridge-core)
