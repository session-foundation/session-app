import ExpoModulesCore
import UIKit

/// The smallest the window may be made on an iPad or in the iPad app on a Mac: the desktop
/// client's own minimum, so the layouts below it are the same ones on both.
///
/// A preference rather than a rule -- the system may hold a window larger -- and set on every
/// activation, since a scene can connect after launch and the value is cheap to restate.
public final class WindowChromeAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  private static let minimumSize = CGSize(width: 380, height: 380)
  private var observer: NSObjectProtocol?

  public func subscriberDidRegister() {
    observer = NotificationCenter.default.addObserver(
      forName: UIScene.didActivateNotification, object: nil, queue: .main
    ) { notification in
      let scene = notification.object as? UIWindowScene
      MainActor.assumeIsolated {
        scene?.sizeRestrictions?.minimumSize = Self.minimumSize
      }
    }
  }
}
