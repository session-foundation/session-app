import Foundation
import UserNotifications

/// What the app shares with its notification extension through the app group's defaults: the
/// words a notification is made of, the sound it plays, and while the app is in front, the
/// conversation on screen.
///
/// **The conversation on screen is trusted only under a lease**, an expiry the app renews while it
/// is in front and clears as it leaves. The extension passes the conversation to libsession, which
/// gives it no notification; a flag instead of a lease, left set by a crash, would silence that
/// conversation until the app was next opened.
///
/// Key names are the extension's too (notification-service/NotificationService.mm): change both.
enum AppGroup {
  static let wordsKey = "session.push.words"
  static let inFrontUntilKey = "session.push.inFrontUntil"
  static let openConversationKey = "session.push.openConversation"
  static let soundKey = "session.push.sound"
  /// The userInfo key a notification's id goes under, by which it is taken down; the extension's
  /// too.
  static let notificationIdKey = "session_id"

  /// How long the lease lasts without being renewed, and how often the app renews it. Long enough
  /// that a renewal is never missed in practice; short enough that a crash, which cannot clear it,
  /// silences pushes for a minute and a half at most.
  static let leaseValidity: TimeInterval = 90
  static let leaseRenewal: TimeInterval = 30

  static var defaults: UserDefaults? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "SessionAppGroup") as? String
    else { return nil }
    return UserDefaults(suiteName: group)
  }

  static func renewLease() {
    defaults?.set(
      Date().addingTimeInterval(leaseValidity).timeIntervalSince1970, forKey: inFrontUntilKey)
  }

  static func clearLease() {
    defaults?.removeObject(forKey: inFrontUntilKey)
  }

  /// The chosen sound's name: a file in the app's bundle (modules/notification-sounds), or "none".
  static func setSound(_ name: String) {
    defaults?.set(name, forKey: soundKey)
  }

  /// The chosen sound as the extension plays it, for a notification posted while the app is in
  /// front: the quiet version, as legacy iOS plays then, and nothing for None.
  static func soundInFront() -> UNNotificationSound? {
    sound(inFront: true)
  }

  /// The chosen sound, its quiet version while the app is in front; nothing for None.
  static func sound(inFront: Bool) -> UNNotificationSound? {
    let name = defaults?.string(forKey: soundKey) ?? "note"
    if name == "none" { return nil }
    let file = inFront ? "\(name)-quiet.aifc" : "\(name).aifc"
    return UNNotificationSound(named: UNNotificationSoundName(file))
  }

  /// A word a notification is made of, as `setStrings` last handed them over; English before then.
  static func word(_ key: String) -> String {
    let english = [
      "appName": "Session", "generic": "You've got a new message.",
      "request": "You have a new message request", "image": "Image", "animated": "GIF",
      "video": "Video", "audio": "Audio", "voice": "Voice Message", "file": "Document",
      "attachments": "Attachments",
    ]
    let words = defaults?.dictionary(forKey: wordsKey) as? [String: String]
    return words?[key] ?? english[key] ?? ""
  }

  static func setOpenConversation(_ id: String?) {
    if let id { defaults?.set(id, forKey: openConversationKey) } else {
      defaults?.removeObject(forKey: openConversationKey)
    }
  }
}
