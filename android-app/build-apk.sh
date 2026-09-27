#!/usr/bin/env bash
# ============================================================
# Build APK "Videoteca" senza Gradle:
# aapt2 -> javac -> d8 -> package -> zipalign -> apksigner
# Requisiti: JDK 17, Android build-tools 34, platform android-34
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/app"
OUT="$HERE/build"
BT="${ANDROID_BT:-/opt/android-sdk/build-tools/34.0.0}"
PLATFORM="${ANDROID_PLATFORM:-/opt/android-sdk/platforms/android-34/android.jar}"

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex" "$OUT/apk"

echo "==> [1/6] aapt2 compile risorse"
COMPILE_DIR="$OUT/compiled"
mkdir -p "$COMPILE_DIR"
find "$APP/res" -type f | while read -r f; do
  "$BT/aapt2" compile --dir "$APP/res" -o "$COMPILE_DIR" >/dev/null
  break
done
# (compile --dir gestisce l'intera cartella in una passata)
rm -rf "$COMPILE_DIR"
"$BT/aapt2" compile --dir "$APP/res" -o "$OUT/res.zip"

echo "==> [2/6] aapt2 link (base.apk + R.java)"
"$BT/aapt2" link \
  -o "$OUT/apk/base.apk" \
  -I "$PLATFORM" \
  --manifest "$APP/AndroidManifest.xml" \
  --java "$OUT/gen" \
  --auto-add-overlay \
  "$OUT/res.zip" \
  -A "$APP/assets"

echo "==> [3/6] javac"
javac -encoding UTF-8 -source 1.8 -target 1.8 \
  -bootclasspath "$PLATFORM" \
  -classpath "$PLATFORM" \
  -d "$OUT/classes" \
  $(find "$APP/java" "$OUT/gen" -name '*.java')

echo "==> [4/6] d8 (dex)"
"$BT/d8" \
  --release \
  --lib "$PLATFORM" \
  --min-api 24 \
  --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class')

echo "==> [5/6] package + zipalign"
cd "$OUT/apk"
cp "$OUT/dex/classes.dex" .
zip -q -u base.apk classes.dex
# assets e risorse sono già dentro base.apk (link -A e res.zip)
"$BT/zipalign" -f -p 4 base.apk aligned.apk

echo "==> [6/6] firma (debug keystore, se assente viene creato)"
KEYSTORE="$HERE/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass videoteca -keypass videoteca \
    -alias videoteca -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Videoteca, OU=Personal, O=El7774, C=IT" >/dev/null 2>&1
fi
"$BT/apksigner" sign \
  --ks "$KEYSTORE" --ks-pass pass:videoteca --key-pass pass:videoteca \
  --out "$OUT/Videoteca-v1.0.0.apk" \
  aligned.apk

"$BT/apksigner" verify --print-certs "$OUT/Videoteca-v1.0.0.apk" | head -5
echo ""
echo "APK pronto: $OUT/Videoteca-v1.0.0.apk"
ls -lh "$OUT/Videoteca-v1.0.0.apk"
