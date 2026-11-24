import ExpoModulesCore
import UserNotifications

/// APNs registration, the notification settings, and what the notification extension shares with
/// the app, for JavaScript. The same names as the Android module's, where the two do the same.
public class SessionPushModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SessionPush")
    Events("onTokenChange", "onTap")

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
      NotificationPresenter.shared.onTap = { [weak self] conversation in
        self?.sendEvent("onTap", ["conversation": conversation])
      }
    }

    OnStopObserving {
      PushToken.onChange = nil
      NotificationPresenter.shared.onTap = nil
    }
  }
}
