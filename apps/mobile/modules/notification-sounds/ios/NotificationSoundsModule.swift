import AVFoundation
import ExpoModulesCore

/// Plays a notification sound as the Sound screen picks it, as legacy iOS's picker does: the last
/// pick stops the one before, and it plays with the ringer switch on silent, since it was asked
/// for.
public class NotificationSoundsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NotificationSounds")

    /// `name` is the file's name without its extension. One the bundle lacks plays nothing.
    Function("play") { (name: String) in
      DispatchQueue.main.async { Preview.shared.play(name) }
    }
  }
}

/// Main thread only. It ducks other audio while a sound plays, and gives the audio session back
/// when it ends, or the ducking would outlast the sound.
private final class Preview: NSObject, AVAudioPlayerDelegate {
  static let shared = Preview()

  private var player: AVAudioPlayer?

  func play(_ name: String) {
    player?.stop()
    player = nil
    guard let url = Bundle.main.url(forResource: name, withExtension: "aifc"),
      let next = try? AVAudioPlayer(contentsOf: url)
    else {
      release()
      return
    }
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, options: [.duckOthers])
    try? session.setActive(true)
    next.delegate = self
    player = next
    next.play()
  }

  func audioPlayerDidFinishPlaying(_ finished: AVAudioPlayer, successfully _: Bool) {
    guard finished === player else { return }
    player = nil
    release()
  }

  private func release() {
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }
}
