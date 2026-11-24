Pod::Spec.new do |s|
  s.name           = "NotificationSounds"
  s.version        = "0.0.0"
  s.summary        = "Legacy iOS's notification sounds, played as the Sound screen picks one"
  s.license        = "GPL-3.0-only"
  s.authors        = "Session"
  s.homepage       = "https://getsession.org"
  s.platforms      = { :ios => "15.1" }
  s.swift_version  = "5.9"
  s.source         = { :path => "." }
  s.static_framework = true

  s.dependency "ExpoModulesCore"

  s.source_files = "*.swift"
  # `resources`, not `resource_bundles`: a notification names its sound by file name, which iOS
  # looks up at the top of the app's main bundle, the notification service extension's included.
  s.resources = "sounds/*.aifc"
  s.pod_target_xcconfig = { "DEFINES_MODULE" => "YES" }
end
