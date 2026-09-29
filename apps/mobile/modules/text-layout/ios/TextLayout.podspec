Pod::Spec.new do |s|
  s.name         = "TextLayout"
  s.version      = "0.0.0"
  s.summary      = "Gives React Native's iOS text container the height its frame rounded away"
  s.license      = "GPL-3.0-only"
  s.authors      = "Session"
  s.homepage     = "https://getsession.org"
  s.platforms    = { :ios => "15.1" }
  s.source       = { :path => "." }
  s.source_files = "*.{h,mm}"

  # React Native's own headers and C++ settings, prebuilt core or not, so ParagraphAttributes here
  # is the type the method was compiled with.
  install_modules_dependencies(s)
end
