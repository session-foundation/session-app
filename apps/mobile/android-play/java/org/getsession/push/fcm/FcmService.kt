package org.getsession.push.fcm

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.getsession.push.PushMessages
import org.getsession.push.PushTokens

/** FCM's deliveries, passed on without Google's types to the code every build shares. */
class FcmService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    PushTokens.changed()
  }

  override fun onMessageReceived(message: RemoteMessage) {
    PushMessages.received(applicationContext, message.data)
  }
}
