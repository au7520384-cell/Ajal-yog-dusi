package com.royalbilliard8.app;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import com.applovin.mediation.MaxAd;
import com.applovin.mediation.MaxError;
import com.applovin.mediation.MaxReward;
import com.applovin.mediation.MaxRewardedAdListener;
import com.applovin.mediation.ads.MaxInterstitialAd;
import com.applovin.mediation.ads.MaxRewardedAd;
import com.applovin.sdk.AppLovinSdk;
import com.applovin.sdk.AppLovinSdkInitializationConfiguration;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// AppLovin MAX for the game's page (there is no maintained Capacitor plugin for it): init({sdkKey, rewardedId, interstitialId, privacyUrl}), ready(), showRewarded(), showInterstitial().
// showRewarded() resolves {shown, rewarded, reason?}: rewarded is true only when the player watched the video to its end (onUserRewarded); showInterstitial() resolves {shown}.
// The ids come from the game server (APPLOVIN_* env vars on Render), so the app needs no new build when the owner has the AppLovin account.
@CapacitorPlugin(name = "RbAds")
public class RbAdsPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean inited = false, started = false, earned = false;
    private MaxRewardedAd rewarded;
    private MaxInterstitialAd inter;
    private int rTry = 0, iTry = 0;
    private PluginCall rCall, iCall;

    private JSObject state() {
        JSObject o = new JSObject();
        o.put("inited", inited);
        o.put("rewarded", rewarded != null && rewarded.isReady());
        o.put("interstitial", inter != null && inter.isReady());
        return o;
    }

    @PluginMethod
    public void init(final PluginCall call) {
        final String key = call.getString("sdkKey", ""), rid = call.getString("rewardedId", ""), iid = call.getString("interstitialId", ""), priv = call.getString("privacyUrl", "");
        if (key.isEmpty() || rid.isEmpty()) { call.reject("ids missing"); return; }
        main.post(new Runnable() {
            @Override public void run() {
                if (inited || started) { call.resolve(state()); return; }
                started = true;
                try {
                    AppLovinSdk sdk = AppLovinSdk.getInstance(getContext());
                    if (!priv.isEmpty()) {   // the consent / terms flow (shown to players in regions that need it, the privacy page is ours)
                        sdk.getSettings().getTermsAndPrivacyPolicyFlowSettings().setEnabled(true);
                        sdk.getSettings().getTermsAndPrivacyPolicyFlowSettings().setPrivacyPolicyUri(Uri.parse(priv));
                    }
                    AppLovinSdkInitializationConfiguration cfg = AppLovinSdkInitializationConfiguration.builder(key).setMediationProvider("max").build();
                    final String r = rid, i = iid;
                    sdk.initialize(cfg, new AppLovinSdk.SdkInitializationListener() {
                        @Override public void onSdkInitialized(com.applovin.sdk.AppLovinSdkConfiguration c) {
                            inited = true;
                            makeAds(r, i);
                            call.resolve(state());
                        }
                    });
                } catch (Throwable t) {
                    started = false;
                    call.reject("init failed: " + t.getMessage());
                }
            }
        });
    }

    @PluginMethod
    public void ready(PluginCall call) { call.resolve(state()); }

    private void makeAds(String rid, String iid) {
        rewarded = MaxRewardedAd.getInstance(rid, getActivity());
        rewarded.setListener(new L(true));
        rewarded.loadAd();
        if (!iid.isEmpty()) {
            inter = new MaxInterstitialAd(iid, getActivity());
            inter.setListener(new L(false));
            inter.loadAd();
        }
    }

    private class L implements MaxRewardedAdListener {
        private final boolean rw;
        L(boolean rw) { this.rw = rw; }
        @Override public void onAdLoaded(MaxAd ad) { if (rw) rTry = 0; else iTry = 0; }
        @Override public void onAdLoadFailed(String id, MaxError e) { retry(rw); }
        @Override public void onAdDisplayed(MaxAd ad) {}
        @Override public void onAdClicked(MaxAd ad) {}
        @Override public void onAdDisplayFailed(MaxAd ad, MaxError e) { finish(rw, false); }
        @Override public void onAdHidden(MaxAd ad) { finish(rw, true); }
        @Override public void onUserRewarded(MaxAd ad, MaxReward r) { earned = true; }
    }

    private void retry(final boolean rw) {   // no ad to show right now: ask again after 2, 4, 8 ... 64 seconds
        int n = rw ? ++rTry : ++iTry;
        long delay = (long) Math.pow(2, Math.min(6, n)) * 1000L;
        main.postDelayed(new Runnable() {
            @Override public void run() {
                if (rw) { if (rewarded != null) rewarded.loadAd(); } else if (inter != null) inter.loadAd();
            }
        }, delay);
    }

    private void finish(boolean rw, boolean shown) {
        PluginCall c = rw ? rCall : iCall;
        if (rw) rCall = null; else iCall = null;
        boolean got = rw && shown && earned;
        if (rw) earned = false;
        if (c != null) {
            JSObject o = new JSObject();
            o.put("shown", shown);
            o.put("rewarded", got);
            if (!shown) o.put("reason", "display");
            c.resolve(o);
        }
        if (rw) { if (rewarded != null) rewarded.loadAd(); } else if (inter != null) inter.loadAd();   // the next one
    }

    private void no(PluginCall call, String why) {
        JSObject o = new JSObject();
        o.put("shown", false);
        o.put("rewarded", false);
        o.put("reason", why);
        call.resolve(o);
    }

    private void show(final PluginCall call, final boolean rw) {
        main.post(new Runnable() {
            @Override public void run() {
                boolean ready = rw ? (rewarded != null && rewarded.isReady()) : (inter != null && inter.isReady());
                if (!inited || getActivity() == null) { no(call, "not_ready"); return; }
                if ((rw ? rCall : iCall) != null) { no(call, "busy"); return; }
                if (!ready) {   // not loaded yet: say so (the page tells the player) and make sure it is loading
                    if (rw) { if (rewarded != null && !rewarded.isLoading()) rewarded.loadAd(); } else if (inter != null && !inter.isLoading()) inter.loadAd();
                    no(call, "not_ready");
                    return;
                }
                if (rw) { rCall = call; earned = false; rewarded.showAd(getActivity()); } else { iCall = call; inter.showAd(getActivity()); }
                main.postDelayed(new Runnable() {   // a show that never ends (the app went away ...) must not block the next ones
                    @Override public void run() { if ((rw ? rCall : iCall) == call) finish(rw, false); }
                }, 180000);
            }
        });
    }

    @PluginMethod
    public void showRewarded(PluginCall call) { show(call, true); }

    @PluginMethod
    public void showInterstitial(PluginCall call) { show(call, false); }
}
