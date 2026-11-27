import AVFoundation
import ExpoModulesCore
import Photos
import UserNotifications
import zlib

/// The device logs' native half: compression, and the facts the export header needs that
/// JavaScript cannot read.
///
/// Compression is here because twenty megabytes through a JavaScript gzip takes seven and a half
/// seconds on Hermes with the JS thread frozen; the system zlib, streaming file to file on a
/// background queue, takes a fraction of a second and freezes nothing.
public class SessionLogsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SessionLogs")

    /// Writes `parts` in order through one gzip stream into `outPath`, and returns its size.
    ///
    /// A part is `["text": ...]`, written as UTF-8, or `["file": name]`, a log file in
    /// `directory` streamed off disk. Names are checked to be bare log file names, so a part can
    /// never reach outside the directory.
    ///
    /// On a global queue rather than the serial one every module's async calls share, which would
    /// otherwise wait behind the whole deflate.
    AsyncFunction("gzip") { (parts: [[String: String]], directory: String, outPath: String) throws -> Int in
      let out = URL(fileURLWithPath: outPath)
      do {
        return try Gzip.write(parts: parts, directory: URL(fileURLWithPath: directory), to: out)
      } catch {
        // A half-written export is no use to anybody, and it would sit in the cache.
        try? FileManager.default.removeItem(at: out)
        throw error
      }
    }.runOnQueue(DispatchQueue.global(qos: .utility))

    AsyncFunction("diagnostics") { () async -> [String: Any?] in
      await Diagnostics.snapshot()
    }

    /// How the app was installed, by its name in `BUILD_VARIANTS` in `@session/app`. Synchronous,
    /// since the ports are built at launch, and it only reads the bundle.
    Function("buildVariant") { () -> String in
      Install.current.rawValue
    }
  }
}

/// How the app was installed, as far as the bundle can tell.
///
/// Legacy's checks, except that TestFlight and ad hoc are told apart by the provisioning profile
/// rather than the receipt, which an ad hoc build can name as TestFlight's.
enum Install: String {
  case development
  case adHoc
  case testFlight
  case appStore

  static var current: Install {
    #if DEBUG || targetEnvironment(simulator)
      return .development
    #else
      // The App Store strips the provisioning profile; TestFlight and ad hoc builds keep theirs.
      guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision")
      else { return .appStore }
      if let profile = propertyList(of: url) {
        // A development or ad hoc profile names the devices it may run on, or all of them for an
        // enterprise one. The distribution profile a TestFlight build carries names none.
        let listsDevices =
          profile["ProvisionedDevices"] != nil || profile["ProvisionsAllDevices"] as? Bool == true
        return listsDevices ? .adHoc : .testFlight
      }
      // Unreadable: legacy's check, which an ad hoc build can pass for TestFlight's.
      return Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
        ? .testFlight : .adHoc
    #endif
  }

  /// A provisioning profile's contents: a property list inside a signed envelope, read without
  /// checking the signature, which the system checked when it installed the app.
  private static func propertyList(of profile: URL) -> [String: Any]? {
    guard
      let data = try? Data(contentsOf: profile),
      let start = data.range(of: Data("<?xml".utf8)),
      let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
      let plist = try? PropertyListSerialization.propertyList(
        from: data[start.lowerBound..<end.upperBound], format: nil)
    else { return nil }
    return plist as? [String: Any]
  }
}

enum Gzip {
  struct Failure: Error, CustomStringConvertible {
    let description: String
  }

  /// The writer's `LOG_FILE_NAME` in `@session/logging`, without its groups;
  /// `packages/app/tests/logFileName.contract.test.ts` reads this line and fails when they differ.
  private static let logFile = "^session-\\d{8}T\\d{6}Z-\\d+\\.log$"
  /// The directories beside the logs that a part may name with `extension`: `EXTENSION_LOG_DIRS`
  /// in `@session/logging`, checked by the same contract test. Nothing else, so a part cannot
  /// reach outside the log directory through it.
  private static let extensionDirs: Set<String> = ["notification-service"]
  private static let chunk = 64 * 1024

  static func write(parts: [[String: String]], directory: URL, to out: URL) throws -> Int {
    FileManager.default.createFile(atPath: out.path, contents: nil)
    let output = try FileHandle(forWritingTo: out)
    defer { try? output.close() }

    var stream = z_stream()
    // 15 + 16: the largest window, with a gzip header and trailer rather than a raw zlib one.
    guard deflateInit2_(&stream, 6, Z_DEFLATED, 15 + 16, 8, Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
      throw Failure(description: "deflateInit2 failed")
    }
    defer { deflateEnd(&stream) }

    var buffer = [UInt8](repeating: 0, count: chunk)

    func feed(_ data: Data, finish: Bool) throws {
      var input = [UInt8](data)
      try input.withUnsafeMutableBufferPointer { inputPointer in
        stream.next_in = inputPointer.baseAddress
        stream.avail_in = uInt(inputPointer.count)
        repeat {
          let produced: Int = try buffer.withUnsafeMutableBufferPointer { outputPointer in
            stream.next_out = outputPointer.baseAddress
            stream.avail_out = uInt(outputPointer.count)
            let status = deflate(&stream, finish ? Z_FINISH : Z_NO_FLUSH)
            guard status != Z_STREAM_ERROR else { throw Failure(description: "deflate failed") }
            return outputPointer.count - Int(stream.avail_out)
          }
          // The throwing forms: the older `write(_:)` and `readData(ofLength:)` raise an
          // Objective-C exception on a full disk, which Swift cannot catch - and a full disk is a
          // likely reason to be exporting from the startup-failure screen at all.
          if produced > 0 { try output.write(contentsOf: buffer[0..<produced]) }
        } while stream.avail_out == 0
      }
    }

    for part in parts {
      if let text = part["text"] {
        try feed(Data(text.utf8), finish: false)
      } else if let name = part["file"] {
        guard name.range(of: logFile, options: .regularExpression) != nil else {
          throw Failure(description: "not a log file name: \(name)")
        }
        var folder = directory
        if let ext = part["extension"] {
          guard extensionDirs.contains(ext) else {
            throw Failure(description: "not an extension log directory: \(ext)")
          }
          folder = directory.appendingPathComponent(ext, isDirectory: true)
        }
        // A file rotated away since the list was taken is skipped rather than failing the export.
        guard let input = FileHandle(forReadingAtPath: folder.appendingPathComponent(name).path) else { continue }
        defer { try? input.close() }
        while true {
          guard let data = try input.read(upToCount: chunk), !data.isEmpty else { break }
          try feed(data, finish: false)
        }
      }
    }
    try feed(Data(), finish: true)
    return Int(stream.total_out)
  }
}

enum Diagnostics {
  static func snapshot() async -> [String: Any?] {
    var sizeInfo = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let used: Int? = withUnsafeMutablePointer(to: &sizeInfo) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) == KERN_SUCCESS
      }
    } ? Int(sizeInfo.phys_footprint) : nil
    // Always 0 on the simulator, which has no per-app limit: unknown rather than none.
    let available = os_proc_available_memory()

    let free = try? URL(fileURLWithPath: NSHomeDirectory())
      .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
      .volumeAvailableCapacityForImportantUsage

    return [
      "model": model(),
      "install": install(),
      "usedBytes": used,
      "availableBytes": available > 0 ? available : nil,
      "totalBytes": Int(ProcessInfo.processInfo.physicalMemory),
      "freeBytes": free.map { Int($0) },
      "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
      // An iPad build on a Mac ("Designed for iPad"), where the OS row has to say macOS.
      "iOSAppOnMac": ProcessInfo.processInfo.isiOSAppOnMac,
      "permissions": await permissions(),
    ]
  }

  /// `iPhone17,1`: the hardware identifier, which is what support can look a device up by.
  private static func model() -> String {
    if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
      return "\(simulated) (simulator)"
    }
    var info = utsname()
    uname(&info)
    return withUnsafeBytes(of: &info.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
  }

  /// Where the build came from, in the words the export header uses.
  private static func install() -> String {
    #if targetEnvironment(simulator)
      return "simulator"
    #else
      switch Install.current {
      case .development, .adHoc: return "development or ad hoc"
      case .testFlight: return "testflight"
      case .appStore: return "app store"
      }
    #endif
  }

  private static func permissions() async -> [[String]] {
    let notifications = await UNUserNotificationCenter.current().notificationSettings()
    return [
      ["camera", describe(AVCaptureDevice.authorizationStatus(for: .video))],
      ["microphone", describe(AVCaptureDevice.authorizationStatus(for: .audio))],
      ["photos", describe(PHPhotoLibrary.authorizationStatus(for: .readWrite))],
      ["notifications", describe(notifications.authorizationStatus)],
    ]
  }

  private static func describe(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not asked"
    @unknown default: return "unknown"
    }
  }

  private static func describe(_ status: PHAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "granted"
    case .limited: return "limited"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not asked"
    @unknown default: return "unknown"
    }
  }

  private static func describe(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "granted"
    case .provisional: return "provisional"
    case .ephemeral: return "ephemeral"
    case .denied: return "denied"
    case .notDetermined: return "not asked"
    @unknown default: return "unknown"
    }
  }
}
