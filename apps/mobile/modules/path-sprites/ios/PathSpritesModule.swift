import ExpoModulesCore
import QuartzCore
import UIKit

/// The few colours the requests use, converted once each.
private var colors: [String: UIColor] = [:]

private func colorFrom(_ value: String?) -> UIColor {
  guard let value else { return .white }
  if let known = colors[value] { return known }
  let color = (try? UIColor.convert(from: value)) ?? .white
  colors[value] = color
  return color
}

/// One layer of a request: see `PathSpriteLayer` in `packages/ui/src/pathSprites.ts`.
struct SpriteLayerRecord {
  var shape: String
  var color: UIColor
  var r: Double
  var borderWidth: Double
  var times: [Double]
  var xs: [Double]
  var ys: [Double]
  var opacityTimes: [Double]
  var opacityValues: [Double]
  var opacitySteps: Bool
  var scaleTimes: [Double]
  var scaleValues: [Double]

  init(_ d: [String: Any]) {
    shape = d["shape"] as? String ?? "glow"
    color = colorFrom(d["color"] as? String)
    r = d["r"] as? Double ?? 1
    borderWidth = d["borderWidth"] as? Double ?? 0
    times = d["times"] as? [Double] ?? []
    xs = d["xs"] as? [Double] ?? []
    ys = d["ys"] as? [Double] ?? []
    opacityTimes = d["opacityTimes"] as? [Double] ?? []
    opacityValues = d["opacityValues"] as? [Double] ?? []
    opacitySteps = d["opacitySteps"] as? Bool ?? true
    scaleTimes = d["scaleTimes"] as? [Double] ?? []
    scaleValues = d["scaleValues"] as? [Double] ?? []
  }
}

/// A request on its trip: see `PathSprite` in `packages/ui/src/pathSprites.ts`.
struct SpriteRecord {
  var id: String
  var startAtMs: Double
  var opacity: Double
  var layers: [[String: Any]]

  init?(_ d: [String: Any]) {
    guard let id = d["id"] as? String else { return nil }
    self.id = id
    startAtMs = d["startAtMs"] as? Double ?? 0
    opacity = d["opacity"] as? Double ?? 1
    layers = d["layers"] as? [[String: Any]] ?? []
  }
}

public class PathSpritesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PathSprites")

    View(PathSpritesView.self) {
      // One JSON string rather than records: converting records field by field, every sprite on
      // every snapshot, cost more than the animation it replaced.
      Prop("spritesJson") { (view: PathSpritesView, json: String) in
        view.show(json)
      }
    }
  }
}

/// Draws each request as layers and hands their whole trip to Core Animation once, so the render
/// server moves them and the app does nothing per frame. A request joins partway through its
/// trip when it was already under way: its animations begin in the past.
final class PathSpritesView: ExpoView {
  private var shown: [String: CALayer] = [:]

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
  }

  func show(_ json: String) {
    guard let data = json.data(using: .utf8),
      let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return }
    let sprites = list.compactMap(SpriteRecord.init)
    let ids = Set(sprites.map { $0.id })
    for (id, sprite) in shown where !ids.contains(id) {
      sprite.removeFromSuperlayer()
      shown[id] = nil
    }
    let nowMs = Date().timeIntervalSince1970 * 1000
    let now = CACurrentMediaTime()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for sprite in sprites where shown[sprite.id] == nil {
      let container = CALayer()
      container.opacity = Float(sprite.opacity)
      let begin = now - (nowMs - sprite.startAtMs) / 1000
      for record in sprite.layers {
        container.addSublayer(makeLayer(SpriteLayerRecord(record), begin: begin))
      }
      layer.addSublayer(container)
      shown[sprite.id] = container
    }
    CATransaction.commit()
  }

  private func makeLayer(_ record: SpriteLayerRecord, begin: CFTimeInterval) -> CALayer {
    let r = CGFloat(record.r)
    let sprite: CALayer
    if record.shape == "glow" {
      // The request's colour fading out from a white heart, as the SVG gradient draws it.
      let glow = CAGradientLayer()
      glow.type = .radial
      glow.colors = [
        UIColor.white.cgColor, record.color.cgColor, record.color.withAlphaComponent(0).cgColor,
      ]
      glow.locations = [0, 0.18, 1]
      glow.startPoint = CGPoint(x: 0.5, y: 0.5)
      glow.endPoint = CGPoint(x: 1, y: 1)
      sprite = glow
    } else {
      sprite = CALayer()
      sprite.borderWidth = CGFloat(record.borderWidth)
      sprite.borderColor = record.color.cgColor
      sprite.cornerRadius = r
    }
    sprite.bounds = CGRect(x: 0, y: 0, width: r * 2, height: r * 2)
    sprite.contentsScale = UIScreen.main.scale
    sprite.position = CGPoint(x: record.xs.first ?? 0, y: record.ys.first ?? 0)
    sprite.opacity = 0

    if record.times.count >= 2 {
      let points = zip(record.xs, record.ys).map { NSValue(cgPoint: CGPoint(x: $0, y: $1)) }
      sprite.add(
        keyframes("position", times: record.times, values: points, begin: begin), forKey: "position")
    }
    var opacityTimes = record.opacityTimes
    var opacityValues = record.opacityValues
    if record.opacitySteps {
      // Held until the next: each step drawn as a run to just before the next one.
      var times: [Double] = []
      var values: [Double] = []
      for (i, at) in opacityTimes.enumerated() {
        let value = opacityValues[i]
        times.append(at)
        values.append(value)
        if i + 1 < opacityTimes.count {
          times.append(max(at, opacityTimes[i + 1] - 0.01))
          values.append(value)
        }
      }
      opacityTimes = times
      opacityValues = values
    }
    if opacityTimes.count >= 2 {
      sprite.add(
        keyframes(
          "opacity", times: opacityTimes, values: opacityValues.map { NSNumber(value: $0) },
          begin: begin),
        forKey: "opacity")
    } else if let only = opacityValues.first {
      sprite.opacity = Float(only)
    }
    if record.scaleTimes.count >= 2 {
      sprite.add(
        keyframes(
          "transform.scale", times: record.scaleTimes,
          values: record.scaleValues.map { NSNumber(value: $0) }, begin: begin),
        forKey: "scale")
    }
    return sprite
  }

  /// Straight runs between `values` at `times` (milliseconds into the trip), holding the first
  /// before and the last after.
  private func keyframes(
    _ keyPath: String, times: [Double], values: [Any], begin: CFTimeInterval
  ) -> CAKeyframeAnimation {
    let first = times.first ?? 0
    let span = max(0.001, (times.last ?? 0) - first)
    let animation = CAKeyframeAnimation(keyPath: keyPath)
    animation.values = values
    animation.keyTimes = times.map { NSNumber(value: ($0 - first) / span) }
    animation.calculationMode = .linear
    animation.beginTime = begin + first / 1000
    animation.duration = span / 1000
    animation.fillMode = .both
    animation.isRemovedOnCompletion = false
    return animation
  }
}
