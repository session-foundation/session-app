package org.getsession.pathsprites

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.view.Choreographer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import org.json.JSONObject

class PathSpritesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PathSprites")

    View(PathSpritesView::class) {
      // One JSON string rather than records, as on iOS: converting records field by field, every
      // request on every snapshot, costs more than the animation it replaces.
      Prop("spritesJson") { view: PathSpritesView, json: String -> view.show(json) }
    }
  }
}

private fun doubles(o: JSONObject, key: String): DoubleArray {
  val a = o.optJSONArray(key) ?: return DoubleArray(0)
  return DoubleArray(a.length()) { a.optDouble(it) }
}

/** Where `values` is at `t`, in straight runs between `times`, holding the ends. */
private fun linear(times: DoubleArray, values: DoubleArray, t: Double): Double {
  val n = minOf(times.size, values.size)
  if (n == 0) return 0.0
  if (t <= times[0]) return values[0]
  if (t >= times[n - 1]) return values[n - 1]
  var i = 1
  while (times[i] < t) i++
  val span = times[i] - times[i - 1]
  val f = if (span <= 0) 1.0 else (t - times[i - 1]) / span
  return values[i - 1] + (values[i] - values[i - 1]) * f
}

/** The value of the last of `times` reached by `t`: each held until the next. */
private fun stepped(times: DoubleArray, values: DoubleArray, t: Double): Double {
  val n = minOf(times.size, values.size)
  if (n == 0) return 0.0
  var v = values[0]
  for (i in 0 until n) {
    if (times[i] <= t) v = values[i] else break
  }
  return v
}

private val colors = HashMap<String, Int>()

/**
 * A theme colour as the web writes it: `#rgb`, `#rrggbb`, `#rrggbbaa` (alpha last, unlike
 * `Color.parseColor`) or `rgb()`/`rgba()`. Anything else is white.
 */
private fun parseCssColor(value: String): Int? {
  val v = value.trim()
  if (v.startsWith("#")) {
    val hex = v.substring(1)
    val full =
      when (hex.length) {
        3, 4 -> hex.map { "$it$it" }.joinToString("")
        6, 8 -> hex
        else -> return null
      }
    val n = full.toLongOrNull(16) ?: return null
    return if (full.length == 8) {
      Color.argb(
        (n and 0xFF).toInt(),
        (n shr 24 and 0xFF).toInt(),
        (n shr 16 and 0xFF).toInt(),
        (n shr 8 and 0xFF).toInt(),
      )
    } else {
      Color.rgb((n shr 16 and 0xFF).toInt(), (n shr 8 and 0xFF).toInt(), (n and 0xFF).toInt())
    }
  }
  val match = Regex("""rgba?\(([^)]*)\)""").matchEntire(v) ?: return null
  val parts = match.groupValues[1].split(',', '/', ' ').filter { it.isNotBlank() }.map { it.trim() }
  if (parts.size < 3) return null
  val rgb = parts.take(3).map { it.toFloatOrNull()?.toInt()?.coerceIn(0, 255) ?: return null }
  val a = parts.getOrNull(3)?.let { s ->
    if (s.endsWith("%")) s.dropLast(1).toFloatOrNull()?.div(100) else s.toFloatOrNull()
  } ?: 1f
  return Color.argb((a.coerceIn(0f, 1f) * 255).toInt(), rgb[0], rgb[1], rgb[2])
}

private fun colorFrom(value: String?): Int {
  if (value == null) return Color.WHITE
  return colors.getOrPut(value) { parseCssColor(value) ?: Color.WHITE }
}

/** One layer of a request: see `PathSpriteLayer` in `packages/ui/src/pathSprites.ts`. */
private class SpriteLayer(o: JSONObject) {
  val glow = o.optString("shape", "glow") == "glow"
  val r = o.optDouble("r", 1.0).toFloat()
  val times = doubles(o, "times")
  val xs = doubles(o, "xs")
  val ys = doubles(o, "ys")
  val opacityTimes = doubles(o, "opacityTimes")
  val opacityValues = doubles(o, "opacityValues")
  val opacitySteps = o.optBoolean("opacitySteps", true)
  val scaleTimes = doubles(o, "scaleTimes")
  val scaleValues = doubles(o, "scaleValues")
  val paint = Paint(Paint.ANTI_ALIAS_FLAG)

  init {
    val color = colorFrom(if (o.has("color")) o.optString("color") else null)
    if (glow) {
      // The request's colour fading out from a white heart, as the SVG gradient draws it. Drawn
      // around the origin; the canvas is moved to the request.
      paint.shader =
        RadialGradient(
          0f,
          0f,
          r,
          intArrayOf(Color.WHITE, color, color and 0x00FFFFFF),
          floatArrayOf(0f, 0.18f, 1f),
          Shader.TileMode.CLAMP,
        )
    } else {
      val width = o.optDouble("borderWidth", 0.0).toFloat()
      paint.style = Paint.Style.STROKE
      paint.strokeWidth = width
      paint.color = color
    }
  }

  /** The stroke sits inside the circle, as a layer's border does on iOS. */
  val ringR = if (glow) r else r - paint.strokeWidth / 2

  fun opacityAt(t: Double): Double =
    if (opacitySteps) {
      stepped(opacityTimes, opacityValues, t)
    } else {
      linear(opacityTimes, opacityValues, t)
    }

  fun draw(canvas: Canvas, t: Double, spriteOpacity: Float) {
    val alpha = (opacityAt(t) * spriteOpacity * 255).toInt().coerceIn(0, 255)
    if (alpha == 0) return
    val x = linear(times, xs, t).toFloat()
    val y = linear(times, ys, t).toFloat()
    val s = if (scaleTimes.size >= 2) linear(scaleTimes, scaleValues, t).toFloat() else 1f
    paint.alpha = alpha
    canvas.save()
    canvas.translate(x, y)
    if (s != 1f) canvas.scale(s, s)
    canvas.drawCircle(0f, 0f, ringR, paint)
    canvas.restore()
  }
}

/** A request on its trip: see `PathSprite` in `packages/ui/src/pathSprites.ts`. */
private class Sprite(o: JSONObject) {
  val startAtMs = o.optDouble("startAtMs", 0.0)
  val endMs = o.optDouble("endMs", 0.0)
  val opacity = o.optDouble("opacity", 1.0).toFloat()
  val layers: List<SpriteLayer> =
    (o.optJSONArray("layers") ?: JSONArray()).let { a ->
      List(a.length()) { SpriteLayer(a.getJSONObject(it)) }
    }
}

/**
 * Draws every request on one canvas from its whole trip, given once, so React Native moves no view
 * per frame: each frame is one draw of a few circles, and frames stop once every trip is over.
 */
class PathSpritesView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val shown = LinkedHashMap<String, Sprite>()
  private val density = resources.displayMetrics.density
  private var ticking = false
  private val tick =
    Choreographer.FrameCallback {
      ticking = false
      invalidate()
    }

  init {
    setWillNotDraw(false)
  }

  fun show(json: String) {
    val list =
      try {
        JSONArray(json)
      } catch (_: org.json.JSONException) {
        return
      }
    val ids = HashSet<String>()
    for (i in 0 until list.length()) {
      val o = list.optJSONObject(i) ?: continue
      val id = o.optString("id", "")
      if (id.isEmpty()) continue
      ids.add(id)
      if (!shown.containsKey(id)) shown[id] = Sprite(o)
    }
    shown.keys.retainAll(ids)
    invalidate()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    Choreographer.getInstance().removeFrameCallback(tick)
    ticking = false
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val nowMs = System.currentTimeMillis().toDouble()
    var moving = false
    canvas.save()
    canvas.scale(density, density)
    for (sprite in shown.values) {
      val t = nowMs - sprite.startAtMs
      if (t < sprite.endMs) moving = true
      for (layer in sprite.layers) layer.draw(canvas, t, sprite.opacity)
    }
    canvas.restore()
    if (moving && !ticking && isAttachedToWindow) {
      ticking = true
      Choreographer.getInstance().postFrameCallback(tick)
    }
  }
}
