package org.getsession.push.hms

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.util.Log
import com.huawei.hms.aaid.HmsInstanceId
import com.huawei.hms.api.ConnectionResult
import com.huawei.hms.api.HuaweiApiAvailability
import java.util.concurrent.Executors
import org.getsession.push.PushTokens

/**
 * Hands Huawei's push kit to [PushTokens] at startup, on a device with HMS Core. Without it, no
 * provider is set and Instant shows as not available on this device.
 */
class HmsInit : ContentProvider() {
  override fun onCreate(): Boolean {
    val context = context ?: return false
    val available =
        HuaweiApiAvailability.getInstance().isHuaweiMobileServicesAvailable(context) ==
            ConnectionResult.SUCCESS
    if (!available) return false
    // By name: these sources are compiled into the app, whose resources' package is its own id.
    val id = context.resources.getIdentifier("session_hms_app_id", "string", context.packageName)
    if (id == 0) return false
    val appId = context.getString(id)
    // getToken blocks on HMS Core, so never on the caller's thread.
    val worker = Executors.newSingleThreadExecutor()
    PushTokens.provider =
        object : PushTokens.Provider {
          override val service = "huawei"

          override fun token(callback: (String?) -> Unit) {
            worker.execute {
              val token =
                  try {
                    HmsInstanceId.getInstance(context).getToken(appId, TOKEN_SCOPE)
                  } catch (e: Exception) {
                    Log.w(TAG, "no HMS token: ${e.message}")
                    null
                  }
              // Some EMUI versions answer empty here and deliver the token to HmsService instead,
              // which keeps it and reports a change.
              callback(token?.takeIf { it.isNotEmpty() } ?: HmsService.remembered(context))
            }
          }
        }
    return true
  }

  override fun query(
      uri: Uri,
      projection: Array<out String>?,
      selection: String?,
      selectionArgs: Array<out String>?,
      sortOrder: String?,
  ): Cursor? = null

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0

  override fun update(
      uri: Uri,
      values: ContentValues?,
      selection: String?,
      selectionArgs: Array<out String>?,
  ) = 0

  private companion object {
    const val TAG = "SessionPush"
    const val TOKEN_SCOPE = "HCM"
  }
}
