import ExpoModulesCore
import UIKit

/// The grace iOS gives an app that has left the screen, held while the Client closes its
/// database (`backgroundClose.ts`). One at a time: the caller counts its own holders.
public class BackgroundTaskModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackgroundTask")

    /// Begins it, if none is held. iOS ends a task left running at its expiry; this ends it then
    /// itself, as iOS requires, since a task still held at expiry gets the app killed.
    Function("begin") {
      onMain {
        guard Self.task == .invalid else { return }
        Self.task = UIApplication.shared.beginBackgroundTask(withName: "close-database") {
          Self.end()
        }
      }
    }

    /// Ends it, if one is held. The app is suspended soon after.
    Function("end") {
      onMain { Self.end() }
    }
  }

  /// UIApplication's, so touched on the main thread only.
  private static var task: UIBackgroundTaskIdentifier = .invalid

  private static func end() {
    guard task != .invalid else { return }
    UIApplication.shared.endBackgroundTask(task)
    task = .invalid
  }
}

/// Runs `work` on the main thread, at once if already there.
private func onMain(_ work: @escaping () -> Void) {
  if Thread.isMainThread {
    work()
  } else {
    DispatchQueue.main.async(execute: work)
  }
}
