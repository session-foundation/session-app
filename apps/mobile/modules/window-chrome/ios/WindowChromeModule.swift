import ExpoModulesCore
import UIKit

public class WindowChromeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WindowChrome")

    /// How much further in from each side a top bar's content has to start to clear the window's
    /// close, minimise and zoom controls, beyond the safe area the app already keeps to.
    ///
    /// iPadOS 26 draws those controls in a top corner of a resizable window and leaves them out of
    /// the safe area, so content laid out to it sits under them. Zero where there are none: a full
    /// screen window, a phone, an iPad before 26.
    ///
    /// Physical sides rather than leading and trailing: UIKit's leading follows the system's
    /// language, while the app lays its panes out by the language picked inside it, and the two
    /// can disagree. The JS side decides which pane touches which corner.
    AsyncFunction("controlsInsets") { () -> [String: Double] in
      MainActor.assumeIsolated { Self.controlsInsets() }
    }.runOnQueue(.main)
  }

  @MainActor
  private static func controlsInsets() -> [String: Double] {
    let none = ["left": 0.0, "right": 0.0]
    guard #available(iOS 26.0, *) else { return none }
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first { $0.isKeyWindow }
    guard let view = window?.rootViewController?.view else { return none }
    let adapted = view.edgeInsets(for: .safeArea(cornerAdaptation: .horizontal))
    let plain = view.edgeInsets(for: .safeArea())
    return [
      "left": Double(max(0, adapted.left - plain.left)),
      "right": Double(max(0, adapted.right - plain.right)),
    ]
  }
}
