Pod::Spec.new do |s|
  s.name           = "WindowChrome"
  s.version        = "0.0.0"
  s.summary        = "The window controls and minimum size of a resizable iPad or Mac window"
  s.license        = "GPL-3.0-only"
  s.authors        = "Session"
  s.homepage       = "https://getsession.org"
  s.platforms      = { :ios => "15.1" }
  s.swift_version  = "5.9"
  s.source         = { :path => "." }
  s.static_framework = true

  s.dependency "ExpoModulesCore"

  s.source_files = "*.swift"
  s.pod_target_xcconfig = { "DEFINES_MODULE" => "YES" }
end
