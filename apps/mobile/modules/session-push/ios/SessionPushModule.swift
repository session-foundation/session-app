import ExpoModulesCore
import UserNotifications

/// APNs registration, the notification settings, and what the notification extension shares with
/// the app, for JavaScript. The same names as the Android module's, where the two do the same.
public class SessionPushModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SessionPush")
    Events("onTokenChange", "onTap", "onAction")

    /// Every iOS build has APNs behind it; whether a token comes is answered by `token`.
    Constant("available") { true }

    /// Asks to show notifications (iOS asks once and answers from then on), registers with APNs,
    /// and answers the token and its service, or null. A token is answered even when notifications
    /// may not be shown: the extension still runs, and they can be allowed later in Settings.
    AsyncFunction("token") { (promise: Promise) in
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) {
        _, error in
        if let error {
          PushToken.log.error(
            "notification authorization failed: \(error.localizedDescription, privacy: .public)")
        }
        PushToken.wait { token in
          promise.resolve(token.map { ["service": PushToken.service, "token": $0] })
        }
        DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
      }
    }

    AsyncFunction("notificationsAllowed") { (promise: Promise) in
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        let status = settings.authorizationStatus
        promise.resolve(status == .authorized || status == .provisional || status == .ephemeral)
      }
    }

    /// Whether Background App Refresh is on for the app, which Periodic, and Instant's backup
    /// checks, depend on. Off when the person turned it off or the phone is in Low Power Mode.
    AsyncFunction("backgroundRefreshOn") { () -> Bool in
      await MainActor.run { UIApplication.shared.backgroundRefreshStatus == .available }
    }

    /// The words the extension builds notifications from, in the app's language.
    Function("setStrings") { (strings: [String: String]) in
      AppGroup.defaults?.set(strings, forKey: AppGroup.wordsKey)
      // The actions' titles are words too.
      NotificationPresenter.registerCategories()
    }

    /// Ends a notification's action that `onAction` handed over: see `NotificationPresenter`.
    Function("finishAction") { (token: String, done: Bool) in
      NotificationPresenter.shared.finishAction(token, done: done)
    }

    Function("setOpenConversation") { (id: String?) in
      NotificationPresenter.shared.openConversation = id
      AppGroup.setOpenConversation(id)
    }

    Function("setSoundWhenOpen") { (on: Bool) in
      NotificationPresenter.shared.soundWhenOpen = on
    }

    /// The sound notifications play, which the extension reads: see `AppGroup.setSound`.
    Function("setSound") { (name: String) in
      AppGroup.setSound(name)
    }

    /// A notification for a message that arrived while the app runs (`IncomingNotification`),
    /// written as the extension writes a push's, so the two look the same and a later removal
    /// finds either by its id.
    Function("post") { (notification: [String: Any]) in
      guard let id = notification["id"] as? String else { return }
      let request = notification["kind"] as? String == "request"
      let content = UNMutableNotificationContent()
      if request {
        content.title = AppGroup.word("appName")
        content.body = AppGroup.word("request")
        content.threadIdentifier = "message-requests"
      } else {
        content.title = notification["sender"] as? String ?? AppGroup.word("appName")
        content.body = notification["body"] as? String ?? Self.placeholder(notification)
        content.threadIdentifier = notification["conversationId"] as? String ?? ""
        content.categoryIdentifier = AppGroup.messageCategory
      }
      content.userInfo = [
        "session_kind": request ? "message_request" : "message",
        AppGroup.notificationIdKey: id,
      ]
      DispatchQueue.main.async {
        content.sound = AppGroup.sound(
          inFront: UIApplication.shared.applicationState == .active)
        UNUserNotificationCenter.current().add(
          UNNotificationRequest(identifier: id, content: content, trigger: nil))
      }
    }

    /// Takes down notifications by id: the app's under their ids, and the extension's under the
    /// names iOS gave them, found by the id in their userInfo.
    Function("remove") { (ids: [String]) in
      let center = UNUserNotificationCenter.current()
      center.removeDeliveredNotifications(withIdentifiers: ids)
      let stale = Set(ids)
      center.getDeliveredNotifications { shown in
        let names = shown.filter {
          guard let id = $0.request.content.userInfo[AppGroup.notificationIdKey] as? String
          else { return false }
          return stale.contains(id)
        }.map { $0.request.identifier }
        if !names.isEmpty { center.removeDeliveredNotifications(withIdentifiers: names) }
      }
    }

    /// The app icon's count.
    AsyncFunction("setBadgeCount") { (count: Int) in
      if #available(iOS 16.0, *) {
        try? await UNUserNotificationCenter.current().setBadgeCount(count)
      } else {
        await MainActor.run { UIApplication.shared.applicationIconBadgeNumber = count }
      }
    }

    /// A sample notification, now, replacing the previous one.
    AsyncFunction("preview") { (title: String, body: String, promise: Promise) in
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = AppGroup.soundInFront()
      let request = UNNotificationRequest(identifier: "preview", content: content, trigger: nil)
      UNUserNotificationCenter.current().add(request) { error in
        if let error {
          promise.reject("ERR_PREVIEW", error.localizedDescription)
        } else {
          promise.resolve(nil)
        }
      }
    }

    OnStartObserving {
      PushToken.onChange = { [weak self] in self?.sendEvent("onTokenChange") }
      NotificationPresenter.shared.onAction = { [weak self] action in
        var event: [String: Any] = [
          "token": action.token, "conversation": action.conversation,
          "action": action.reply == nil ? "markRead" : "reply",
        ]
        if let reply = action.reply { event["reply"] = reply }
        self?.sendEvent("onAction", event)
      }
      NotificationPresenter.shared.onTap = { [weak self] tap in
        switch tap {
        case .conversation(let id): self?.sendEvent("onTap", ["conversation": id])
        case .requests: self?.sendEvent("onTap", ["conversation": NSNull()])
        }
      }
    }

    OnStopObserving {
      PushToken.onChange = nil
      NotificationPresenter.shared.onTap = nil
      NotificationPresenter.shared.onAction = nil
    }
  }

  /// What a message with no text says instead: its first attachment's kind.
  private static func placeholder(_ notification: [String: Any]) -> String {
    if (notification["attachments"] as? Int ?? 0) > 1 { return AppGroup.word("attachments") }
    if let kind = notification["attachment"] as? String { return AppGroup.word(kind) }
    return AppGroup.word("generic")
  }
}
