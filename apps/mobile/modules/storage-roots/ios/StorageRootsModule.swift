import ExpoModulesCore

/// The protected roots, to JavaScript. See `ProtectedRoots`.
public class StorageRootsModule: Module {
  private static let pushSubscribedKey = "pushSubscribedThisInstall"

  public func definition() -> ModuleDefinition {
    Name("StorageRoots")

    /// Plain paths rather than URLs: libsession takes paths, and the storage module makes the
    /// `file://` form expo-file-system wants.
    Constant("roots") { () -> [String: String] in
      let paths = ProtectedRoots.paths
      return [
        "data": paths.data.path, "logs": paths.logs.path, "exports": paths.exports.path,
        "staged": paths.staged.path,
      ]
    }

    /// Where the roots are, for the startup block.
    Constant("location") { () -> String in
      ProtectedRoots.paths.inAppGroup ? "app group" : "Application Support (no app group)"
    }

    Function("ensure") { () -> [String] in
      ProtectedRoots.ensure()
    }

    Function("protect") { (path: String) throws -> Bool in
      try ProtectedRoots.protect(URL(fileURLWithPath: path))
    }

    Function("inspect") { (path: String) throws -> [String: Any] in
      try ProtectedRoots.inspect(URL(fileURLWithPath: path))
    }

    /// In the app's own defaults, which an uninstall removes, unlike the app group the roots can
    /// be in. See `PushInstallMarker` in packages/app.
    Function("pushSubscribedThisInstall") { () -> Bool in
      UserDefaults.standard.bool(forKey: Self.pushSubscribedKey)
    }

    Function("markPushSubscribedThisInstall") {
      UserDefaults.standard.set(true, forKey: Self.pushSubscribedKey)
    }
  }
}
