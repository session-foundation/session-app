import AVFoundation
import ExpoModulesCore

// iOS scans with expo-camera; all this module adds there is whether a camera exists, which
// expo-camera answers only on the web.
public class QrScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("QrScanner")

    /// False in the Simulator and on a Mac running the iPad app without a camera attached.
    Function("hasCamera") { () -> Bool in
      AVCaptureDevice.default(for: .video) != nil
    }
  }
}
