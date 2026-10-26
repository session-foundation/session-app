package session.bridge.rn;

import android.content.Context;

import com.facebook.imagepipeline.backends.okhttp3.OkHttpImagePipelineConfigFactory;
import com.facebook.imagepipeline.core.DownsampleMode;
import com.facebook.imagepipeline.core.ImagePipelineConfig;
import com.facebook.imagepipeline.listener.RequestListener;
import com.facebook.react.modules.fresco.ReactOkHttpNetworkFetcher;
import com.facebook.react.modules.fresco.SystraceRequestListener;
import com.facebook.react.modules.network.CookieJarContainer;
import com.facebook.react.modules.network.ForwardingCookieHandler;
import com.facebook.react.modules.network.OkHttpClientProvider;

import java.util.Collections;
import java.util.Set;

import okhttp3.JavaNetCookieJar;
import okhttp3.OkHttpClient;

/**
 * React Native's own Fresco configuration, `FrescoModule.getDefaultConfigBuilder`, rebuilt from an
 * Application: handing FrescoModule a configuration replaces that default rather than adding to
 * it, and the original takes a ReactContext, which does not exist yet when MainApplication builds
 * its packages.
 *
 * Java because the fetcher and the listener are Kotlin `internal`, which binds Kotlin callers only.
 * A React Native upgrade that renames either fails this build, which is when to re-read the
 * original.
 */
final class ReactFrescoDefaults {
    private ReactFrescoDefaults() {}

    static ImagePipelineConfig.Builder builder(Context context) {
        OkHttpClient client = OkHttpClientProvider.createClient();
        // Image requests carry the same cookies as fetch() does.
        ((CookieJarContainer) client.cookieJar())
                .setCookieJar(new JavaNetCookieJar(new ForwardingCookieHandler()));
        Set<RequestListener> listeners = Collections.singleton(new SystraceRequestListener());
        ImagePipelineConfig.Builder builder =
                OkHttpImagePipelineConfigFactory.newBuilder(context.getApplicationContext(), client)
                        .setNetworkFetcher(new ReactOkHttpNetworkFetcher(client))
                        .setDownsampleMode(DownsampleMode.AUTO)
                        .setRequestListeners(listeners);
        builder.experiment().setBinaryXmlEnabled(true);
        return builder;
    }
}
