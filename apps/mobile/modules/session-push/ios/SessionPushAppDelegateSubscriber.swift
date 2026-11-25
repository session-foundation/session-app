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
    NotificationPresenter.registerCategories()
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

  /// Where a tap leads: a message's conversation, open on the message where it names one, or the
  /// message requests.
  enum Tap {
    case conversation(String, Int64?)
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

  static let markReadAction = "session-mark-read"
  static let replyAction = "session-reply"

  /// Mark read and Reply on a message's notification, as legacy iOS has them, in the app's words.
  static func registerCategories() {
    let markRead = UNNotificationAction(
      identifier: markReadAction, title: AppGroup.word("markRead"), options: [])
    let reply = UNTextInputNotificationAction(
      identifier: replyAction, title: AppGroup.word("reply"), options: [],
      textInputButtonTitle: AppGroup.word("send"), textInputPlaceholder: "")
    UNUserNotificationCenter.current().setNotificationCategories([
      UNNotificationCategory(
        identifier: AppGroup.messageCategory, actions: [markRead, reply], intentIdentifiers: [])
    ])
  }

  /// A notification's action, for JavaScript to carry out with the app's own Client: iOS wakes
  /// the app for it, in the background, and waits for `finishAction`.
  struct Action {
    let token: String
    let conversation: String
    /// The reply typed, or nil for Mark read.
    let reply: String?
    let notification: String
  }

  /// Actions JavaScript has not yet finished, by token, with what to call and end once it has.
  private typealias Running = (action: Action, done: () -> Void, task: UIBackgroundTaskIdentifier)
  private var running: [String: Running] = [:]
  /// Actions that arrived before JavaScript was listening, as a background launch for one does.
  private var pendingActions: [Action] = []
  var onAction: ((Action) -> Void)? {
    didSet {
      guard let onAction else { return }
      let pending = pendingActions
      pendingActions = []
      pending.forEach(onAction)
    }
  }

  /// Takes the notification down once its action is done; a reply that did not go says so, and
  /// iOS is told the action is over either way.
  func finishAction(_ token: String, done: Bool) {
    DispatchQueue.main.async {
      guard let entry = self.running.removeValue(forKey: token) else { return }
      let center = UNUserNotificationCenter.current()
      if done {
        center.removeDeliveredNotifications(withIdentifiers: [entry.action.notification])
      } else if entry.action.reply != nil {
        let content = UNMutableNotificationContent()
        content.title = AppGroup.word("appName")
        content.body = AppGroup.word("replyFailed")
        content.threadIdentifier = entry.action.conversation
        center.add(
          UNNotificationRequest(
            identifier: entry.action.notification, content: content, trigger: nil))
      }
      entry.done()
      if entry.task != .invalid { UIApplication.shared.endBackgroundTask(entry.task) }
    }
  }

  /// The thread a message notification belongs to is its conversation (see `decide`); a request's
  /// opens the requests, and a generic notification only the app.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if response.actionIdentifier == Self.markReadAction
      || response.actionIdentifier == Self.replyAction
    {
      startAction(response, completionHandler: completionHandler)
      return
    }
    defer { completionHandler() }
    let content = response.notification.request.content
    let tap: Tap
    switch content.userInfo["session_kind"] as? String {
    case "message":
      let thread = content.threadIdentifier
      guard !thread.isEmpty else { return }
      tap = .conversation(
        thread, (content.userInfo[AppGroup.messageIdKey] as? NSNumber)?.int64Value)
    case "message_request":
      tap = .requests
    default:
      return
    }
    if let onTap { onTap(tap) } else { pendingTap = tap }
  }

  private func startAction(
    _ response: UNNotificationResponse, completionHandler: @escaping () -> Void
  ) {
    let conversation = response.notification.request.content.threadIdentifier
    let reply = (response as? UNTextInputNotificationResponse)?.userText
    guard !conversation.isEmpty,
      response.actionIdentifier == Self.markReadAction || !(reply ?? "").isEmpty
    else {
      completionHandler()
      return
    }
    let action = Action(
      token: UUID().uuidString, conversation: conversation, reply: reply,
      notification: response.notification.request.identifier)
    // Time to send in, should iOS have woken the app for this alone; finishing ends it.
    var task = UIBackgroundTaskIdentifier.invalid
    task = UIApplication.shared.beginBackgroundTask(withName: "notification-action") {
      [weak self] in self?.finishAction(action.token, done: false)
    }
    running[action.token] = (action, completionHandler, task)
    if let onAction { onAction(action) } else { pendingActions.append(action) }
  }
}
