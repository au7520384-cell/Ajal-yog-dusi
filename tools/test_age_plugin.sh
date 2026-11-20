#!/usr/bin/env bash
# Tests the Android plugin for the Play Age Signals API (android/native/RbAgePlugin.java) WITHOUT an Android SDK:  bash tools/test_age_plugin.sh
# The REAL plugin file is compiled with javac against tiny stand-ins for Capacitor / Android / Play services Task, and run against a FAKE Age Signals library that follows Google's documented API
# (hidden implementation classes, int status constants, Integer ageLower / ageUpper, Task callbacks). It proves the reflection logic, the "package written by the workflow" step (tools/age_pkg.sh) and the failure paths.
# It does NOT prove the real library's class names (the docs show only short names): the GitHub build prints them (age_pkg.sh) - see android/README.md.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
S="$W/src"; mkdir -p "$S/android/app" "$S/android/content" "$S/android/os" "$S/android/util" "$S/com/getcapacitor/annotation" "$S/com/google/android/gms/tasks" "$S/fake/agesignals" "$S/com/royalbilliard8/app"

# ---- stand-ins for Android / Capacitor / Play services Task
cat > "$S/android/content/Context.java" <<'J'
package android.content; public class Context { public Context getApplicationContext() { return this; } }
J
cat > "$S/android/app/Activity.java" <<'J'
package android.app; public class Activity extends android.content.Context { }
J
cat > "$S/android/os/Looper.java" <<'J'
package android.os; public class Looper { public static Looper getMainLooper() { return new Looper(); } }
J
cat > "$S/android/os/Handler.java" <<'J'
package android.os;
public class Handler {
  public static final java.util.List<Runnable> delayed = new java.util.ArrayList<>();
  public Handler(Looper l) {}
  public boolean post(Runnable r) { r.run(); return true; }
  public boolean postDelayed(Runnable r, long ms) { delayed.add(r); return true; }
  public void removeCallbacks(Runnable r) { delayed.remove(r); }
}
J
cat > "$S/android/util/Log.java" <<'J'
package android.util; public class Log { public static int i(String t, String m) { System.out.println("  [log] " + m); return 0; } }
J
cat > "$S/com/getcapacitor/annotation/CapacitorPlugin.java" <<'J'
package com.getcapacitor.annotation; import java.lang.annotation.*; @Retention(RetentionPolicy.RUNTIME) public @interface CapacitorPlugin { String name() default ""; }
J
cat > "$S/com/getcapacitor/PluginMethod.java" <<'J'
package com.getcapacitor; import java.lang.annotation.*; @Retention(RetentionPolicy.RUNTIME) public @interface PluginMethod { }
J
cat > "$S/com/getcapacitor/JSObject.java" <<'J'
package com.getcapacitor;
public class JSObject extends java.util.LinkedHashMap<String, Object> {
  public JSObject put(String k, String v) { super.put(k, v); return this; }
  public JSObject put(String k, int v) { super.put(k, v); return this; }
}
J
cat > "$S/com/getcapacitor/PluginCall.java" <<'J'
package com.getcapacitor; public class PluginCall { public JSObject result; public int resolved = 0; public void resolve(JSObject o) { result = o; resolved++; } }
J
cat > "$S/com/getcapacitor/Plugin.java" <<'J'
package com.getcapacitor;
public abstract class Plugin { public android.app.Activity activity = new android.app.Activity(); public android.app.Activity getActivity() { return activity; } public android.content.Context getContext() { return activity; } }
J
cat > "$S/com/google/android/gms/tasks/OnSuccessListener.java" <<'J'
package com.google.android.gms.tasks; public interface OnSuccessListener<T> { void onSuccess(T t); }
J
cat > "$S/com/google/android/gms/tasks/OnFailureListener.java" <<'J'
package com.google.android.gms.tasks; public interface OnFailureListener { void onFailure(Exception e); }
J
cat > "$S/com/google/android/gms/tasks/Task.java" <<'J'
package com.google.android.gms.tasks;
public abstract class Task<T> {
  public abstract Task<T> addOnSuccessListener(OnSuccessListener<? super T> l);
  public abstract Task<T> addOnFailureListener(OnFailureListener l);
  public static <T> Task<T> done(T v) { return new Impl<T>(v, null, false); }
  public static <T> Task<T> failed(Exception e) { return new Impl<T>(null, e, false); }
  public static <T> Task<T> never() { return new Impl<T>(null, null, true); }
}
class Impl<T> extends Task<T> {   // hidden (package-private) implementation, like the real one
  final T v; final Exception e; final boolean never;
  Impl(T v, Exception e, boolean never) { this.v = v; this.e = e; this.never = never; }
  @Override public Task<T> addOnSuccessListener(OnSuccessListener<? super T> l) { if (!never && e == null) l.onSuccess(v); return this; }
  @Override public Task<T> addOnFailureListener(OnFailureListener l) { if (!never && e != null) l.onFailure(e); return this; }
}
J

# ---- a FAKE Age Signals library: the shapes in Google's documented sample (the real package is found by tools/age_pkg.sh; here it is fake.agesignals)
cat > "$S/fake/agesignals/AgeSignalsStatus.java" <<'J'
package fake.agesignals; public final class AgeSignalsStatus { public static final int SHARED = 1, NOT_SHARED = 2, VERIFICATION_REQUIRED = 3; }
J
cat > "$S/fake/agesignals/Scenario.java" <<'J'
package fake.agesignals; public final class Scenario { public static String mode = "shared13"; public static int calls = 0; public static int checks = 0; public static Object seenActivity; }
J
cat > "$S/fake/agesignals/AgeSignalsManager.java" <<'J'
package fake.agesignals; import com.google.android.gms.tasks.Task;
public interface AgeSignalsManager { Task<AgeSignalsAccessResult> requestAgeSignalsAccess(AgeSignalsAccessRequest r); Task<AgeSignalsResult> checkAgeSignals(AgeSignalsRequest r); }
J
cat > "$S/fake/agesignals/AgeSignalsManagerFactory.java" <<'J'
package fake.agesignals; import android.content.Context; import com.google.android.gms.tasks.Task;
public final class AgeSignalsManagerFactory {
  public static AgeSignalsManager create(Context c) { return new M(); }
  private static final class M implements AgeSignalsManager {   // hidden implementation
    @Override public Task<AgeSignalsAccessResult> requestAgeSignalsAccess(AgeSignalsAccessRequest r) {
      Scenario.calls++;
      String m = Scenario.mode;
      if (m.equals("throw")) throw new IllegalStateException("boom");
      if (m.equals("never")) return Task.never();
      if (m.equals("accessfail")) return Task.failed(new RuntimeException("PLAY_STORE_NOT_FOUND"));
      int st = m.equals("notshared") ? AgeSignalsStatus.NOT_SHARED : m.equals("verif") ? AgeSignalsStatus.VERIFICATION_REQUIRED : AgeSignalsStatus.SHARED;
      return Task.done(AgeSignalsAccessResult.of(st));
    }
    @Override public Task<AgeSignalsResult> checkAgeSignals(AgeSignalsRequest r) {
      Scenario.checks++;
      String m = Scenario.mode;
      if (m.equals("checkfail")) return Task.failed(new RuntimeException("NETWORK_ERROR"));
      if (m.equals("adult")) return Task.done(AgeSignalsResult.of("id-1", 18, null));
      return Task.done(AgeSignalsResult.of("id-1", 13, 15));
    }
  }
}
J
cat > "$S/fake/agesignals/AgeSignalsAccessRequest.java" <<'J'
package fake.agesignals; import android.app.Activity;
public abstract class AgeSignalsAccessRequest {
  public static Builder builder() { return new Impl.B(); }
  public abstract Activity activity();
  public abstract static class Builder { public abstract Builder setActivity(Activity a); public abstract AgeSignalsAccessRequest build(); }
  private static final class Impl extends AgeSignalsAccessRequest {   // hidden, like AutoValue_...
    final Activity a; Impl(Activity a) { this.a = a; } @Override public Activity activity() { return a; }
    static final class B extends Builder { Activity a; @Override public Builder setActivity(Activity x) { a = x; Scenario.seenActivity = x; return this; } @Override public AgeSignalsAccessRequest build() { return new Impl(a); } }
  }
}
J
cat > "$S/fake/agesignals/AgeSignalsAccessResult.java" <<'J'
package fake.agesignals;
public abstract class AgeSignalsAccessResult {
  public abstract Integer ageSignalsStatus();
  static AgeSignalsAccessResult of(final int s) { return new AgeSignalsAccessResult() { @Override public Integer ageSignalsStatus() { return s; } }; }
}
J
cat > "$S/fake/agesignals/AgeSignalsRequest.java" <<'J'
package fake.agesignals;
public abstract class AgeSignalsRequest {
  public static Builder builder() { return new B(); }
  public abstract static class Builder { public abstract AgeSignalsRequest build(); }
  private static final class B extends Builder { @Override public AgeSignalsRequest build() { return new AgeSignalsRequest() {}; } }
}
J
cat > "$S/fake/agesignals/AgeSignalsResult.java" <<'J'
package fake.agesignals;
public abstract class AgeSignalsResult {
  public abstract String installId(); public abstract Integer ageLower(); public abstract Integer ageUpper();
  static AgeSignalsResult of(final String id, final Integer lo, final Integer hi) {
    return new AgeSignalsResult() { @Override public String installId() { return id; } @Override public Integer ageLower() { return lo; } @Override public Integer ageUpper() { return hi; } };
  }
}
J

# ---- the REAL plugin, with the first line the workflow writes (the app's package) and the library package written the way the workflow does it (tools/age_pkg.sh, run on the fake library's jar)
mkdir -p "$W/lib" "$W/out"
cp "$ROOT/android/native/RbAgePlugin.java" "$S/com/royalbilliard8/app/RbAgePlugin.java"
sed -i '1s/.*/package com.royalbilliard8.app;/' "$S/com/royalbilliard8/app/RbAgePlugin.java"
find "$S/android" "$S/com/getcapacitor" "$S/com/google" "$S/fake" -name '*.java' > "$W/libsrc.txt"
javac -nowarn -d "$W/lib" @"$W/libsrc.txt" 2>&1 | grep -v "^Picked up" || true
(cd "$W/lib" && jar cf "$W/fakelib.jar" fake)
echo "== tools/age_pkg.sh on the fake library:"
bash "$ROOT/tools/age_pkg.sh" "$W/fakelib.jar" "$S/com/royalbilliard8/app/RbAgePlugin.java" | grep "age-signals:"
grep -q '"fake.agesignals"' "$S/com/royalbilliard8/app/RbAgePlugin.java" || { echo "FAIL: the package was not written into the plugin"; exit 1; }
echo "== a garbage file must not break anything:"
echo "not a jar" > "$W/junk.jar"; cp "$ROOT/android/native/RbAgePlugin.java" "$W/Copy.java"
bash "$ROOT/tools/age_pkg.sh" "$W/junk.jar" "$W/Copy.java" | grep "age-signals:"; grep -q "__AGEPKG__" "$W/Copy.java" || { echo "FAIL: a bad library changed the plugin"; exit 1; }

cat > "$S/Main.java" <<'J'
import com.getcapacitor.*;
import com.royalbilliard8.app.RbAgePlugin;
import fake.agesignals.Scenario;
import java.lang.reflect.*;
public class Main {
  static int pass = 0, fail = 0;
  static void ok(boolean c, String m, Object x) { if (c) pass++; else { fail++; System.out.println("FAIL: " + m + " -> " + x); } }
  static JSObject run(RbAgePlugin p, String mode) throws Exception {
    Scenario.mode = mode; PluginCall c = new PluginCall();
    p.check(c);
    return c.result;
  }
  public static void main(String[] a) throws Exception {
    RbAgePlugin p = new RbAgePlugin();
    JSObject r = run(p, "shared13");
    ok("shared".equals(r.get("status")) && Integer.valueOf(13).equals(r.get("ageLower")) && Integer.valueOf(15).equals(r.get("ageUpper")) && !r.containsKey("installId"), "shared 13-15, installId not passed on", r);
    ok(Scenario.seenActivity == p.getActivity(), "the activity was handed to the access request", Scenario.seenActivity);
    r = run(p, "adult");
    ok("shared".equals(r.get("status")) && Integer.valueOf(18).equals(r.get("ageLower")) && !r.containsKey("ageUpper"), "top band 18+: ageUpper missing", r);
    int checks = Scenario.checks;
    r = run(p, "notshared");
    ok("not_shared".equals(r.get("status")) && !r.containsKey("ageLower") && Scenario.checks == checks, "not shared: no age and checkAgeSignals is not called", r);
    r = run(p, "verif");
    ok("verification_required".equals(r.get("status")) && Scenario.checks == checks, "verification required", r);
    r = run(p, "accessfail");
    ok("error".equals(r.get("status")) && String.valueOf(r.get("error")).contains("PLAY_STORE_NOT_FOUND"), "Play failure -> error with the reason", r);
    r = run(p, "checkfail");
    ok("error".equals(r.get("status")) && String.valueOf(r.get("error")).contains("NETWORK_ERROR"), "failure of the second call -> error", r);
    r = run(p, "throw");
    ok("error".equals(r.get("status")) && String.valueOf(r.get("error")).contains("boom"), "an exception inside the library is caught", r);
    // a check that never answers: a second call says busy, the watchdog frees the plugin
    Scenario.mode = "never"; PluginCall c1 = new PluginCall(); p.check(c1);
    ok(c1.resolved == 0, "a pending check has not answered yet", c1.result);
    PluginCall c2 = new PluginCall(); p.check(c2);
    ok(c2.result != null && "busy".equals(c2.result.get("status")), "a second call while one runs -> busy", c2.result);
    ok(android.os.Handler.delayed.size() == 1, "one watchdog is waiting", android.os.Handler.delayed.size());
    Runnable w = android.os.Handler.delayed.remove(0); w.run();   // (a real Handler drops a task once it ran)
    ok(c1.result != null && "error".equals(c1.result.get("status")) && "timeout".equals(c1.result.get("error")) && c1.resolved == 1, "the watchdog answers 'timeout' once", c1.result);
    r = run(p, "shared13");
    ok("shared".equals(r.get("status")) && android.os.Handler.delayed.isEmpty(), "the plugin works again after a timeout and the watchdog is cleared", r);
    // no activity
    p.activity = null; r = run(p, "shared13"); p.activity = new android.app.Activity();
    ok("error".equals(r.get("status")), "no activity -> error, not a crash", r);
    // the library is not in the app: every package guess fails
    Field f = RbAgePlugin.class.getDeclaredField("PKGS"); f.setAccessible(true); String[] pk = (String[]) f.get(null); String keep = pk[0]; pk[0] = "no.such.pkg";
    r = run(p, "shared13");
    ok("unavailable".equals(r.get("status")), "library classes missing -> unavailable", r);
    pk[0] = keep;
    System.out.println(fail == 0 ? "OK " + pass + " checks passed" : "FAILED " + fail + " of " + (pass + fail));
    System.exit(fail == 0 ? 0 : 1);
  }
}
J
echo "== compile the REAL plugin + run the scenarios:"
find "$S/com/royalbilliard8" "$S/Main.java" -name '*.java' > "$W/appsrc.txt"
javac -nowarn -cp "$W/lib" -d "$W/out" @"$W/appsrc.txt" 2>&1 | grep -v "^Picked up" || true
test -f "$W/out/com/royalbilliard8/app/RbAgePlugin.class" || { echo "FAIL: RbAgePlugin did not compile"; exit 1; }
java -cp "$W/out:$W/lib" Main 2>&1 | grep -v "^Picked up"
