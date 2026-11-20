#!/usr/bin/env bash
# Used by .github/workflows/android.yml:  bash tools/age_pkg.sh <age-signals .aar (or its classes.jar)> <RbAgePlugin.java in the Android project>
# Finds the Java package the Play Age Signals library really uses (the docs show only short class names), writes it over "__AGEPKG__" in the plugin and prints what is inside the library (public classes and their members), so the build log shows the real API.
# It NEVER fails the build: when anything goes wrong the plugin keeps its built-in guesses and finds the classes by name at run time (see android/native/RbAgePlugin.java).  Tested by: bash tools/test_age_plugin.sh
set +e
SRC="$1"; PLUGIN="$2"
D=$(mktemp -d)
case "$SRC" in *.aar) unzip -p "$SRC" classes.jar > "$D/c.jar" 2>/dev/null ;; *) cp "$SRC" "$D/c.jar" 2>/dev/null ;; esac
if [ ! -s "$D/c.jar" ]; then echo "age-signals: could not open '$SRC' - the plugin keeps its guesses"; exit 0; fi
CLASSES=$(unzip -Z1 "$D/c.jar" 2>/dev/null | grep '\.class$' | grep -v '\$')
echo "age-signals: classes in the library:"; echo "$CLASSES" | head -60
PKG=$(echo "$CLASSES" | grep '/AgeSignalsManagerFactory\.class$' | head -1 | sed 's#/AgeSignalsManagerFactory\.class$##; s#/#.#g')
if [ -n "$PKG" ]; then
  sed -i "s#__AGEPKG__#$PKG#" "$PLUGIN"
  echo "age-signals: package '$PKG' written into the plugin ($(grep -c "\"$PKG\"" "$PLUGIN") place)"
else
  echo "age-signals: AgeSignalsManagerFactory NOT found in the library - the plugin keeps its guesses"
fi
# the public API (the library's own classes incl. nested ones like Builder; the obfuscated internals zz.. are left out)
PUB=$(unzip -Z1 "$D/c.jar" 2>/dev/null | grep '\.class$' | grep -v '/internal/' | grep -v -E '/z[a-z]{1,3}(\$[^/]*)?\.class$' | sed 's#\.class$##; s#/#.#g' | head -60)
for c in $PUB; do javap -public -cp "$D/c.jar" "$c" 2>/dev/null; done | head -400
rm -rf "$D"
exit 0
