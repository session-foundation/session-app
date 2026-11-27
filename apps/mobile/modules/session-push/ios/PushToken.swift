import Foundation
import os

/// The APNs token, which iOS hands to the app delegate and JavaScript asks the module for.
///
/// Every waiter is answered by the next registration result, success or failure: iOS calls the
/// delegate once per `registerForRemoteNotifications`, and a second call while one is pending gets
/// the same answer.
enum PushToken {
  private static let lock = NSLock()
  private static var waiters: [(String?) -> Void] = []
  private static var last: String?
  static let log = Logger(subsystem: "org.getsession", category: "push")

  /// Called when a different token arrives from the one handed out before.
  static var onChange: (() -> Void)?

  static func wait(_ done: @escaping (String?) -> Void) {
    lock.lock()
    waiters.append(done)
    lock.unlock()
  }

  static func resolve(_ token: String?) {
    lock.lock()
    let pending = waiters
    waiters = []
    let changed = token != nil && last != nil && token != last
    if token != nil { last = token }
    lock.unlock()
    pending.forEach { $0(token) }
    if changed { onChange?() }
  }

  /// The push server's name for the APNs environment this build's tokens come from, which is the
  /// signing profile's `aps-environment`, not the build configuration: a Release build signed for
  /// development gets sandbox tokens, which production refuses. A store build carries no embedded
  /// profile, and is production.
  static var service: String {
    guard
      let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let data = try? Data(contentsOf: url),
      // The profile is a signed plist; its XML sits inside the signature as plain text.
      let text = String(data: data, encoding: .isoLatin1),
      let key = text.range(of: "<key>aps-environment</key>"),
      let value = text[key.upperBound...].range(of: "<string>development</string>"),
      text[key.upperBound..<value.lowerBound].trimmingCharacters(in: .whitespacesAndNewlines)
        .isEmpty
    else { return "apns" }
    return "apns-sandbox"
  }
}
