package session.bridge.rn

import android.app.Application
import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.util.Log
import com.facebook.imagepipeline.bitmaps.SimpleBitmapReleaser
import com.facebook.common.memory.PooledByteBuffer
import com.facebook.common.references.CloseableReference
import com.facebook.imagepipeline.core.ImagePipelineFactory
import com.facebook.imagepipeline.core.ProducerFactory
import com.facebook.imagepipeline.core.ProducerSequenceFactory
import com.facebook.imagepipeline.image.CloseableImage
import com.facebook.imagepipeline.image.CloseableStaticBitmap
import com.facebook.imagepipeline.image.EncodedImage
import com.facebook.imagepipeline.image.ImmutableQualityInfo
import com.facebook.imagepipeline.producers.BaseConsumer
import com.facebook.imagepipeline.producers.BaseProducerContextCallbacks
import com.facebook.imagepipeline.producers.Consumer
import com.facebook.imagepipeline.producers.CustomProducerSequenceFactory
import com.facebook.imagepipeline.producers.Producer
import com.facebook.imagepipeline.producers.ProducerContext
import com.facebook.imagepipeline.producers.ThreadHandoffProducerQueue
import com.facebook.imagepipeline.request.ImageRequest
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.shell.MainPackageConfig
import java.nio.ByteBuffer
import java.nio.channels.Channels
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Draws `session-media://` URLs: the image loader behind `MediaPort.urlFor` on Android.
 *
 * The URL is the request. Fresco asks for it, C++ parses it and asks whichever source is serving -
 * the open bridge, or the fake through `serveMediaFrom` - and the bytes come back here without
 * touching JavaScript. The answer's content type has already been checked against its bytes.
 */
object SessionMedia {
  const val SCHEME = "session-media"

  /** React Native's Fresco configuration, plus the sequence that serves the scheme. */
  @JvmStatic
  fun packageConfig(application: Application): MainPackageConfig =
      MainPackageConfig(
          ReactFrescoDefaults.builder(application)
              .setCustomFetchSequenceFactories(setOf(SessionMediaSequenceFactory()))
              .build())

  /**
   * Refuses an app whose Fresco was never handed [packageConfig]: a generated `android/` from
   * before the loader compiles and runs, and every picture then fails to load with nothing in the
   * console. Thrown in a debuggable build; a release logs it and loads fail as they would have.
   * Says nothing until Fresco is initialised, which the caller arranges.
   */
  internal fun checkInstalled(context: Context) {
    if (!ImagePipelineFactory.hasBeenInitialized()) return
    val factories =
        ImagePipelineFactory.getInstance().imagePipeline.config.customProducerSequenceFactories
    if (factories.any { it is SessionMediaSequenceFactory }) return
    val message =
        "Fresco was not handed SessionMedia.packageConfig, so no session-media:// picture can " +
            "load: apps/mobile/android predates the media loader. Regenerate it with " +
            "`expo prebuild --platform android --clean` in apps/mobile, then `pnpm android`."
    val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    if (debuggable) throw IllegalStateException(message)
    Log.e("SessionMedia", message)
  }
}

internal object SessionMediaNative {
  init {
    System.loadLibrary("SessionBridgeRN")
  }

  /** Returns at once; the answer arrives on `load` from whichever thread the source answers on. */
  @JvmStatic external fun fetch(url: String, load: SessionMediaLoad)

  /** Frees the memory a direct buffer handed to `load` points into. */
  @JvmStatic external fun release(handle: Long)
}

/**
 * Fresco's own order for a decoded sequence, minus every disk-cache producer, so decrypted bytes
 * live only in memory. Keyed by URL, which is why a file and its preview have separate ones.
 */
internal class SessionMediaSequenceFactory : CustomProducerSequenceFactory() {
  override fun getCustomDecodedImageSequence(
      imageRequest: ImageRequest,
      producerSequenceFactory: ProducerSequenceFactory,
      producerFactory: ProducerFactory,
      threadHandoffProducerQueue: ThreadHandoffProducerQueue,
      isEncodedMemoryCacheProbingEnabled: Boolean,
      isDiskCacheProbingEnabled: Boolean,
  ): Producer<CloseableReference<CloseableImage>>? {
    val uri = imageRequest.sourceUri
    if (uri.scheme != SessionMedia.SCHEME) return null
    val decoded =
        if (uri.host == "preview") PreviewProducer()
        else
            producerFactory.newDecodeProducer(
                ProducerFactory.newAddImageTransformMetaDataProducer(
                    producerFactory.newEncodedCacheKeyMultiplexProducer(
                        producerFactory.newEncodedMemoryCacheProducer(FetchProducer()))))
    return producerFactory.newBitmapMemoryCacheGetProducer(
        producerFactory.newBackgroundThreadHandoffProducer(
            producerFactory.newBitmapMemoryCacheKeyMultiplexProducer(
                producerFactory.newBitmapMemoryCacheProducer(decoded)),
            threadHandoffProducerQueue))
  }
}

private fun start(context: ProducerContext, load: SessionMediaLoad) {
  context.addCallbacks(
      object : BaseProducerContextCallbacks() {
        override fun onCancellationRequested() {
          load.cancel()
        }
      })
  SessionMediaNative.fetch(context.imageRequest.sourceUri.toString(), load)
}

internal class FetchProducer : Producer<EncodedImage> {
  override fun produceResults(consumer: Consumer<EncodedImage>, context: ProducerContext) {
    val url = context.imageRequest.sourceUri.toString()
    start(context, SessionMediaLoad.encoded(consumer, context, url))
  }
}

/** A preview arrives as pixels, so it skips the decoder and is handed over as a bitmap. */
internal class PreviewProducer : Producer<CloseableReference<CloseableImage>> {
  override fun produceResults(
      consumer: Consumer<CloseableReference<CloseableImage>>,
      context: ProducerContext,
  ) {
    start(context, SessionMediaLoad.decoded(consumer, context.imageRequest.sourceUri.toString()))
  }
}

/**
 * One load in flight: what the C++ answers call, on Core's loop or the JS thread.
 *
 * Every method only hands off to [DRAIN], the one thread that copies bytes and calls Fresco, so a
 * source's thread is never held. Settles exactly once, whether by an answer or by cancellation;
 * native memory is released however it settles.
 */
@DoNotStrip
internal class SessionMediaLoad
private constructor(
    private val encoded: Consumer<EncodedImage>?,
    private val decoded: Consumer<CloseableReference<CloseableImage>>?,
    private val context: ProducerContext?,
    private val url: String,
) {
  private val settled = AtomicBoolean(false)

  private fun settle(): Boolean = settled.compareAndSet(false, true)

  fun cancel() {
    if (settle()) (encoded ?: decoded)?.onCancellation()
  }

  private fun failWith(error: Throwable) {
    // Fresco reports a failure to the view and nowhere else, so this is the only trace of why.
    Log.w(TAG, "$url did not load: ${error.message}")
    encoded?.onFailure(error)
    decoded?.onFailure(error)
  }

  @DoNotStrip
  fun onMedia(bytes: ByteBuffer, handle: Long) {
    DRAIN.execute {
      try {
        val consumer = encoded
        if (!settle() || consumer == null || context == null) return@execute
        val factory = context.imagePipelineConfig.poolFactory.pooledByteBufferFactory
        val out = factory.newOutputStream(bytes.remaining())
        val pooled =
            try {
              Channels.newChannel(out).write(bytes)
              CloseableReference.of<PooledByteBuffer>(out.toByteBuffer())
            } finally {
              out.close()
            }
        val image = EncodedImage(pooled)
        try {
          consumer.onNewResult(image, BaseConsumer.IS_LAST)
        } finally {
          EncodedImage.closeSafely(image)
          CloseableReference.closeSafely(pooled)
        }
      } catch (error: Throwable) {
        failWith(error)
      } finally {
        SessionMediaNative.release(handle)
      }
    }
  }

  @DoNotStrip
  fun onPreview(width: Int, height: Int, rgba: ByteBuffer, handle: Long) {
    DRAIN.execute {
      try {
        val consumer = decoded
        if (!settle() || consumer == null) return@execute
        // Colour ints are not premultiplied, which is what the shim's RGBA is; createBitmap
        // premultiplies them itself.
        val colours = IntArray(width * height)
        for (at in colours.indices) {
          val r = rgba.get(at * 4).toInt() and 0xff
          val g = rgba.get(at * 4 + 1).toInt() and 0xff
          val b = rgba.get(at * 4 + 2).toInt() and 0xff
          val a = rgba.get(at * 4 + 3).toInt() and 0xff
          colours[at] = (a shl 24) or (r shl 16) or (g shl 8) or b
        }
        val bitmap = Bitmap.createBitmap(colours, width, height, Bitmap.Config.ARGB_8888)
        val image: CloseableReference<CloseableImage> =
            CloseableReference.of(
                CloseableStaticBitmap.of(
                    bitmap,
                    SimpleBitmapReleaser.getInstance(),
                    ImmutableQualityInfo.FULL_QUALITY,
                    0))
        try {
          consumer.onNewResult(image, BaseConsumer.IS_LAST)
        } finally {
          CloseableReference.closeSafely(image)
        }
      } catch (error: Throwable) {
        failWith(error)
      } finally {
        SessionMediaNative.release(handle)
      }
    }
  }

  @DoNotStrip
  fun onFailure(message: String) {
    DRAIN.execute { if (settle()) failWith(RuntimeException(message)) }
  }

  companion object {
    private const val TAG = "SessionMedia"
    private val DRAIN = Executors.newSingleThreadExecutor { Thread(it, "session-media") }

    fun encoded(consumer: Consumer<EncodedImage>, context: ProducerContext, url: String) =
        SessionMediaLoad(consumer, null, context, url)

    fun decoded(consumer: Consumer<CloseableReference<CloseableImage>>, url: String) =
        SessionMediaLoad(null, consumer, null, url)
  }
}
