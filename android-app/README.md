# Videoteca — App Android (APK)

Applicazione Android del sito **Videoteca** con **identiche funzionalità** e
**stile minimal**. È un progetto separato: nessun file del sito originale è
stato modificato.

## APK pronto

`../Videoteca-v1.0.0.apk` (nella root della repository) — sufficiente
scaricarlo e installarlo sul telefono (Android 7.0+). All'installazione
confermare "Installa comunque / Sconosciuto" perché l'APK è firmato con un
certificato personale (non Play Store).

## Cosa contiene

- **WebView** che serve le 9 pagine del sito dalla cartella `assets/`, con
  **font e icone inclusi offline** (nessuna CDN).
- **Bridge nativo per le API**: le chiamate a `videoteca-backend.onrender.com`
  passano dal layer Java, con l'header `Origin` del sito — così il CORS
  fail-closed del backend non blocca l'app.
- **Skin minimal** (`app/assets/www/minimal.css`): superfici piatte, un solo
  accento blu, tipografia Inter, niente glass/neon, bottom navigation,
  safe-area per status bar e gesture bar.
- **Tasto back Android** intelligente, dialog nativi, export/import backup
  tramite selettore file di sistema, splash screen.

## Ricompilare l'APK

```bash
bash android-app/build-apk.sh
```

Requisiti: JDK 17, Android build-tools 34 e platform android-34 (gli script
puntano a `/opt/android-sdk`, sovrascrivibile con `ANDROID_BT` e
`ANDROID_PLATFORM`).

Pipeline senza Gradle: `aapt2 compile/link → javac → d8 → zip → zipalign →
apksigner` (keystore: `android-app/debug.keystore`, password `videoteca`).

## Struttura

```
android-app/
├── app/
│   ├── AndroidManifest.xml
│   ├── java/com/el7774/videoteca/MainActivity.java   (WebView + bridge nativo)
│   ├── res/                                          (manifest, icone, tema)
│   └── assets/www/                                   (copia del sito + integrazioni)
│       ├── minimal.css   skin minimal
│       ├── app.js        bridge HTTP nativo, back, safe-area, bottom nav
│       ├── config.js     copia con API_BASE relativo
│       └── fonts.css, fonts/, vendor/font-awesome/
├── build-apk.sh        pipeline di build
└── tools/gen_icons.py  generatore icone launcher
```
