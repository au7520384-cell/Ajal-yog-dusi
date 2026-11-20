package com.royalbilliard8.app;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Proxy;

// Google Play Age Signals API (beta; the US state age laws + Brazil): asks Play for the player's age RANGE, nothing else. check() always resolves {status, ageLower?, ageUpper?, error?}:
//   status "shared"                the player (or the parent) shares the age range: ageLower / ageUpper are set (ageUpper is missing for the top band, e.g. 18+)
//   "not_shared"                   Play does not share an age range (the player did not agree, a parent said no, or no law applies)
//   "verification_required"        the law applies but Play has not verified the age yet (the player has to open the Play Store)
//   "unavailable"                  the library classes are not in the app          "error"  Play / the connection failed (error = the reason)       "busy"  a check is already running
// The library's class names are looked up BY NAME (reflection), so a wrong guess can never break the Gradle build: the workflow (tools/age_pkg.sh) reads the real package out of the library and writes it over the placeholder in the first entry below; the other entries are guesses.
// The calls follow Google's sample: requestAgeSignalsAccess(activity) [Play shows its own prompt only when it is needed] -> if SHARED: checkAgeSignals().
// Play's policy: the answer is only for giving age-appropriate content - never for ads, marketing, profiling or statistics. The installId the API also returns is NOT passed on.
// (No ProGuard / R8 rules needed: the Capacitor template builds with minifyEnabled false.)
@CapacitorPlugin(name = "RbAge")
public class RbAgePlugin extends Plugin {
    private static final String TAG = "RbAge";
    private static final String[] PKGS = {"__AGEPKG__", "com.google.android.play.agesignals", "com.google.android.play.core.agesignals"};
    private static final String TASKS = "com.google.android.gms.tasks.";
    private final Handler main = new Handler(Looper.getMainLooper());
    private PluginCall pending;   // main thread only
    private Runnable dog;

    private interface Cb { void run(Object o) throws Exception; }

    private static Class<?> cls(String simple) throws ClassNotFoundException {
        for (String p : PKGS) { try { return Class.forName(p + "." + simple); } catch (Throwable t) { /* next guess */ } }
        throw new ClassNotFoundException(simple);
    }

    // a public method by name and number of arguments: the objects the library hands back are often instances of hidden implementation classes, so prefer the method of a public class
    private static Method find(Class<?> c, String name, int n) throws NoSuchMethodException {
        Method hit = null;
        for (Method m : c.getMethods()) {
            if (!m.getName().equals(name) || m.getParameterTypes().length != n) continue;
            if (hit == null || (Modifier.isPublic(m.getDeclaringClass().getModifiers()) && !Modifier.isPublic(hit.getDeclaringClass().getModifiers()))) hit = m;
        }
        if (hit == null) throw new NoSuchMethodException(c.getSimpleName() + "." + name);
        try { hit.setAccessible(true); } catch (Throwable t) { /* the method is public anyway */ }
        return hit;
    }

    private static Object call(Object o, String name, Object... a) throws Exception {
        return find(o.getClass(), name, a.length).invoke(o, a);
    }

    private static Object callStatic(Class<?> c, String name, Object... a) throws Exception {
        return find(c, name, a.length).invoke(null, a);
    }

    private static Object constant(String simple, String field) {
        try { return cls(simple).getField(field).get(null); } catch (Throwable t) { return null; }
    }

    // Task.addOnSuccessListener / addOnFailureListener without compiling against Play services: the listeners are dynamic proxies
    private void then(Object task, final Cb ok, final Cb bad) throws Exception {
        Class<?> taskC = Class.forName(TASKS + "Task"), sl = Class.forName(TASKS + "OnSuccessListener"), fl = Class.forName(TASKS + "OnFailureListener");
        ClassLoader loader = taskC.getClassLoader();
        Object s = Proxy.newProxyInstance(loader, new Class<?>[]{sl}, (proxy, m, args) -> {
            if (m.getDeclaringClass() == Object.class) return plain(proxy, m.getName(), args);
            try { ok.run(args == null || args.length == 0 ? null : args[0]); } catch (Throwable t) { fail(t); }
            return null;
        });
        Object f = Proxy.newProxyInstance(loader, new Class<?>[]{fl}, (proxy, m, args) -> {
            if (m.getDeclaringClass() == Object.class) return plain(proxy, m.getName(), args);
            try { bad.run(args == null || args.length == 0 ? null : args[0]); } catch (Throwable t) { fail(t); }
            return null;
        });
        taskC.getMethod("addOnSuccessListener", sl).invoke(task, s);
        taskC.getMethod("addOnFailureListener", fl).invoke(task, f);
    }

    private static Object plain(Object proxy, String name, Object[] args) {
        if (name.equals("hashCode")) return System.identityHashCode(proxy);
        if (name.equals("equals")) return args != null && args.length == 1 && proxy == args[0];
        return "RbAgeListener";
    }

    private static Integer num(Object o) { return o instanceof Number ? Integer.valueOf(((Number) o).intValue()) : null; }

    private static String statusName(Object st) {
        for (String n : new String[]{"SHARED", "NOT_SHARED", "VERIFICATION_REQUIRED"}) {
            Object k = constant("AgeSignalsStatus", n);
            if (st != null && ((k != null && k.equals(st)) || st.toString().equalsIgnoreCase(n))) return n.toLowerCase();
        }
        return "unknown";
    }

    private void finish(String status, Integer lo, Integer hi, String err) {
        PluginCall c = pending; pending = null;
        if (dog != null) { main.removeCallbacks(dog); dog = null; }
        if (c == null) return;
        JSObject o = new JSObject();
        o.put("status", status);
        if (lo != null) o.put("ageLower", lo.intValue());
        if (hi != null) o.put("ageUpper", hi.intValue());
        if (err != null) o.put("error", err);
        Log.i(TAG, "age signals: " + status + (err != null ? " (" + err + ")" : ""));
        c.resolve(o);
    }

    private void fail(Throwable t) {
        while (t instanceof InvocationTargetException && t.getCause() != null) t = t.getCause();
        String msg = t.getClass().getSimpleName() + (t.getMessage() != null ? ": " + t.getMessage() : "");
        finish(t instanceof ClassNotFoundException ? "unavailable" : "error", null, null, msg.length() > 160 ? msg.substring(0, 160) : msg);
    }

    @PluginMethod
    public void check(final PluginCall call) {
        main.post(new Runnable() {
            @Override public void run() { start(call); }
        });
    }

    private void start(final PluginCall call) {
        if (pending != null) {
            JSObject o = new JSObject();
            o.put("status", "busy");
            call.resolve(o);
            return;
        }
        final Activity act = getActivity();
        pending = call;
        dog = new Runnable() {   // Play never answered (no Play Store ...): free the plugin for the next try
            @Override public void run() { dog = null; finish("error", null, null, "timeout"); }
        };
        main.postDelayed(dog, 120000);
        try {
            if (act == null) throw new IllegalStateException("no activity");
            final Object mgr = callStatic(cls("AgeSignalsManagerFactory"), "create", act.getApplicationContext());
            Object ab = callStatic(cls("AgeSignalsAccessRequest"), "builder");
            ab = call(ab, "setActivity", act);
            Object areq = call(ab, "build");
            then(call(mgr, "requestAgeSignalsAccess", areq), new Cb() {
                @Override public void run(Object access) throws Exception {
                    String st = statusName(call(access, "ageSignalsStatus"));
                    if (!st.equals("shared")) { finish(st, null, null, null); return; }   // not_shared / verification_required: no age range to read
                    Object rq = call(callStatic(cls("AgeSignalsRequest"), "builder"), "build");
                    then(call(mgr, "checkAgeSignals", rq), new Cb() {
                        @Override public void run(Object res) throws Exception {
                            finish("shared", num(call(res, "ageLower")), num(call(res, "ageUpper")), null);
                        }
                    }, new Cb() {
                        @Override public void run(Object e) { fail(e instanceof Throwable ? (Throwable) e : new RuntimeException("check failed")); }
                    });
                }
            }, new Cb() {
                @Override public void run(Object e) { fail(e instanceof Throwable ? (Throwable) e : new RuntimeException("access failed")); }
            });
        } catch (Throwable t) {
            fail(t);
        }
    }
}
