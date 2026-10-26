import ExpoModulesCore
import UIKit
internal import React

/// Turns on React Native's W3C pointer events, which is what makes hover work on an iPad with a
/// mouse or trackpad and in the iPad app on a Mac.
///
/// Off, React Native never watches the pointer at all: no `onPointerEnter` or `onPointerLeave`
/// reaches JS, so no `hoverStyle` ever applies. The switch is read once, when each surface's touch
/// handler is created, so it has to be set before the app delegate starts React Native - hence
/// here rather than in a module, which loads after the first surface exists.
///
/// iPad and Mac only. Turned on, every touch is also processed as a pointer event and sent to JS,
/// where the hover handlers drop it as a touch, so on a phone, which has no pointer to hover with,
/// it would be cost for nothing. The Mac's iPad apps report the pad idiom too; the second check
/// keeps that from resting on it.
public final class PointerEventsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func appDelegateWillBeginInitialization() {
    guard UIDevice.current.userInterfaceIdiom == .pad || ProcessInfo.processInfo.isiOSAppOnMac
    else { return }
    RCTSetDispatchW3CPointerEvents(true)
  }
}
