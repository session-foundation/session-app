import ExpoModulesCore
import UserNotifications

/// The app delegate's part: the APNs registration result, the lease while the app is in front, and
/// how notifications are presented while it is.
public final class SessionPushAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  private var leaseTimer: Timer?

  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = NotificationPresenter.shared
    return true
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    AppGroup.renewLease()
    leaseTimer?.invalidate()
    leaseTimer = Timer.scheduledTimer(withTimeInterval: AppGroup.leaseRenewal, repeats: true) { _ in
      AppGroup.renewLease()
    }
  }

  public func applicationDidEnterBackground(_ application: UIApplication) {
    leaseTimer?.invalidate()
    leaseTimer = nil
    AppGroup.clearLease()
  }

  public func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    PushToken.log.info("APNs token received (\(hex.count / 2) bytes)")
    PushToken.resolve(hex)
  }

  public func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    PushToken.log.error(
      "APNs registration failed: \(error.localizedDescription, privacy: .public)")
    PushToken.resolve(nil)
  }
}

/// Decides how a notification shows while the app is in front, and hands a tap to JavaScript.
final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate {
  static let shared = NotificationPresenter()

  /// The conversation on screen, which gets no banner; see `AppGroup`.
  var openConversation: String?
  var soundWhenOpen = true

  /// Where a tap leads: a message's conversation, or the message requests.
  enum Tap {
    case conversation(String)
    case requests
  }

  /// A tap that arrived before JavaScript was listening, as a cold launch from a notification
  /// does: handed over when it asks.
  private(set) var pendingTap: Tap?
  var onTap: ((Tap) -> Void)? {
    didSet {
      if let onTap, let pending = pendingTap {
        pendingTap = nil
        onTap(pending)
      }
    }
  }

  /// At most this many sounds in `soundWindow` while the app is in front, as legacy iOS plays: a
  /// burst of messages makes one or two sounds, not one each.
  private static let soundsPerWindow = 2
  private static let soundWindow: TimeInterval = 5
  /// When the recent sounds played. Main thread only, where the delegate is called.
  private var recentSounds: [Date] = []

  private func mayPlaySound() -> Bool {
    let now = Date()
    recentSounds.removeAll { now.timeIntervalSince($0) >= Self.soundWindow }
    guard recentSounds.count < Self.soundsPerWindow else { return false }
    recentSounds.append(now)
    return true
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler:
      @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    let thread = notification.request.content.threadIdentifier
    if let open = openConversation, !thread.isEmpty, thread == open {
      completionHandler([])
      return
    }
    completionHandler(soundWhenOpen && mayPlaySound() ? [.banner, .list, .sound] : [.banner, .list])
  }

  /// The thread a message notification belongs to is its conversation (see `decide`); a request's
  /// opens the requests, and a generic notification only the app.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    defer { completionHandler() }
    let content = response.notification.request.content
    let tap: Tap
    switch content.userInfo["session_kind"] as? String {
    case "message":
      let thread = content.threadIdentifier
      guard !thread.isEmpty else { return }
      tap = .conversation(thread)
    case "message_request":
      tap = .requests
    default:
      return
    }
    if let onTap { onTap(tap) } else { pendingTap = tap }
  }
}
