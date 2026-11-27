# Built and called by name from native code (packages/bridge-rn/android/PushJni.cpp).
-keep class org.getsession.push.PushOutcome { <init>(...); }
-keepclasseswithmembernames class org.getsession.push.PushNative { native <methods>; }
