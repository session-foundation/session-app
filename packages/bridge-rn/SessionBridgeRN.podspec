require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
repo = File.expand_path("../..", __dir__)

Pod::Spec.new do |s|
  s.name         = "SessionBridgeRN"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.license      = "GPL-3.0-only"
  s.authors      = "Session"
  s.homepage     = "https://getsession.org"
  s.platforms    = { :ios => "15.1" }
  s.source       = { :path => "." }

  # The HybridObject and the image loader. The shim itself is a CMake project on every platform -
  # cmake-js for the addon, the Android Gradle plugin for Android, and the iOS build script here -
  # because CocoaPods compiles only what lives inside the pod directory and drops a glob that
  # reaches out of it without saying so.
  s.source_files = "cpp/**/*.{hpp,cpp}", "ios/*.{h,mm}"

  # libsession, and the shim built against it. Both produced by
  # `pnpm --filter @session/bridge-rn build:libsession:ios`, neither committed.
  #
  # Both are xcframeworks rather than plain archives so the pod can carry a device slice and a
  # simulator one at once: `vendored_libraries` has no per-SDK form, so a directory of archives
  # is a directory for exactly one slice -- and the iOS build running on an Apple silicon Mac is
  # the device slice, so the two have to coexist. The shim's xcframework holds the shim's own
  # archive per slice; see the build script for what goes into it.
  s.vendored_frameworks = "ios/libsession-util.xcframework", "ios/SessionBridgeCore.xcframework"

  # System libraries the vendored archives expect to find. libunistring wants iconv, which the
  # NDK bundles into bionic and Apple ships separately - so this is needed here and nowhere
  # else, and it only surfaces once something reaches the network and pulls gnutls's chain in.
  s.libraries = "iconv", "resolv", "z"

  # client_bridge.hpp is deliberately free of libsession's headers - it is std types and a
  # std::function - so this is the whole of what the HybridObject needs to compile.
  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "HEADER_SEARCH_PATHS" =>
      "\"#{__dir__}/cpp\" \"#{repo}/packages/bridge-core/include\"",
  }

  load File.join(__dir__, "nitrogen/generated/ios/SessionBridgeRN+autolinking.rb")
  add_nitrogen_files(s)

  s.dependency "React-jsi"
  s.dependency "React-callinvoker"
  s.dependency "NitroModules"

  # React's own headers and pods, for the image loader in ios/. Last, because it adds to the
  # xcconfig above rather than setting it.
  install_modules_dependencies(s)
end
