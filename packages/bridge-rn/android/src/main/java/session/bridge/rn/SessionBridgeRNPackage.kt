package session.bridge.rn

import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.session.bridge.rn.SessionBridgeRNOnLoad

/**
 * Empty of modules on purpose: everything here is a Nitro HybridObject, registered from C++ when
 * the library loads. What this class is for is autolinking, which looks for a ReactPackage to
 * decide a package is linkable - a pure-C++ module without one is skipped in silence, and shows
 * up much later as "SessionBridge does not exist".
 */
class SessionBridgeRNPackage : ReactPackage {
  init {
    SessionBridgeRNOnLoad.initializeNative()
  }

  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> {
    checkMediaInstalledOnce(context)
    return emptyList()
  }

  /**
   * Runs [SessionMedia.checkInstalled] once Fresco is up. Modules are initialised eagerly on the
   * native-modules queue before the instance is announced as initialised, so a job posted to that
   * queue from the announcement runs after FrescoModule's initialize, and sees the configuration
   * the app was really given.
   */
  private fun checkMediaInstalledOnce(context: ReactApplicationContext) {
    val host = (context.applicationContext as? ReactApplication)?.reactHost ?: return
    host.addReactInstanceEventListener(
        object : ReactInstanceEventListener {
          override fun onReactContextInitialized(context: ReactContext) {
            host.removeReactInstanceEventListener(this)
            context.runOnNativeModulesQueueThread { SessionMedia.checkInstalled(context) }
          }
        })
  }

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
