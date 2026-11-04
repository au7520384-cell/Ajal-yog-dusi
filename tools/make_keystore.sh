#!/usr/bin/env bash
# Makes the Android upload key (once):  bash tools/make_keystore.sh      (run it in a GitHub Codespace terminal; keytool comes with Java)
# It asks for a password (typed hidden), writes upload.jks (NOT committed: .gitignore) and prints the 4 values for the GitHub secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v keytool >/dev/null || { echo "keytool (Java) not found"; exit 1; }
[ -e upload.jks ] && { echo "upload.jks already exists - keep it, do not make a second one"; exit 1; }
read -r -s -p "Choose a password (6+ characters, write it down): " PASS; echo
read -r -s -p "Same password again: " PASS2; echo
[ "$PASS" = "$PASS2" ] && [ ${#PASS} -ge 6 ] || { echo "Passwords differ or too short"; exit 1; }
keytool -genkeypair -noprompt -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=Azizjon Sultonov, O=Royal Billiard 8, C=UZ"
base64 -w0 upload.jks > upload.jks.b64
echo
echo "Done. Now open GitHub -> repository -> Settings -> Secrets and variables -> Actions -> New repository secret, and add:"
echo "  ANDROID_KEYSTORE_PASSWORD = the password you typed"
echo "  ANDROID_KEY_PASSWORD      = the same password"
echo "  ANDROID_KEY_ALIAS         = upload"
echo "  ANDROID_KEYSTORE_BASE64   = the content of the file upload.jks.b64  (open it in the editor, select all, copy)"
echo "Keep upload.jks and the password: download upload.jks from the Codespace file list and store it safely (Google Drive). Never share it."
