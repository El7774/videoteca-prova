package com.el7774.videoteca;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebBackForwardList;
import android.webkit.WebChromeClient;
import android.webkit.WebHistoryItem;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Iterator;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Videoteca — app Android minimal.
 * Una WebView serve il sito dalla cartella assets; le API vengono eseguite dal
 * layer nativo (il backend è fail-closed sul CORS e le pagine locali hanno un
 * origine diversa dal sito GitHub Pages), con l'header Origin previsto.
 */
public class MainActivity extends Activity {

  private static final String START_URL = "https://appassets.androidplatform.net/assets/www/index.html";
  private static final String ASSET_HOST = "appassets.androidplatform.net";
  private static final int REQ_EXPORT = 41;
  private static final int REQ_IMPORT = 42;

  private WebView webView;
  private FrameLayout splash;
  private boolean splashVisible = false;
  private String pendingExportContent = null;
  private int lastInsetTop = 0;
  private int lastInsetBottom = 0;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Edge-to-edge: contenuto sotto status bar e gesture bar, colori trasparenti.
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    if (Build.VERSION.SDK_INT >= 28) {
      WindowManager.LayoutParams lp = getWindow().getAttributes();
      lp.layoutInDisplayCutoutMode =
          WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      getWindow().setAttributes(lp);
    }
    getWindow().setStatusBarColor(Color.TRANSPARENT);
    getWindow().setNavigationBarColor(Color.TRANSPARENT);
    getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

    webView = new WebView(this);
    WebSettings s = webView.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setCacheMode(WebSettings.LOAD_DEFAULT);
    CookieManager.getInstance().setAcceptCookie(true);

    final View rootInsetsTarget = webView;

    FrameLayout root = new FrameLayout(this);
    root.addView(webView, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
      @Override
      public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
        int top = insets.getSystemWindowInsetTop();
        int bottom = insets.getSystemWindowInsetBottom();
        if (Build.VERSION.SDK_INT >= 30) {
          bottom = Math.max(bottom, insets.getInsets(WindowInsets.Type.ime()).bottom);
        }
        lastInsetTop = top;
        lastInsetBottom = bottom;
        pushInsetsValues(top, bottom);
        return insets.consumeSystemWindowInsets();
      }
    });
    buildSplash(root);
    setContentView(root);

    webView.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, String url) {
        if (url == null) return false;
        boolean isHttp = url.startsWith("http://") || url.startsWith("https://");
        if (isHttp && !url.contains(ASSET_HOST)) {
          // Link esterni (es. il link di reset password nell'email) -> browser.
          try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
          } catch (Exception ignored) {
          }
          return true;
        }
        return false;
      }

      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
        return interceptAsset(req.getUrl());
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        pushInsetsValues(lastInsetTop, lastInsetBottom);
        scheduleSplashRemoval();
      }
    });
    webView.setWebChromeClient(new WebChromeClient());
    webView.addJavascriptInterface(new NativeBridge(), "VideotecaNative");

    if (savedInstanceState != null) {
      webView.restoreState(savedInstanceState);
    } else {
      webView.loadUrl(START_URL);
    }
  }

  // ---------------- Asset locali (https://appassets.androidplatform.net) ----------------

  private WebResourceResponse interceptAsset(Uri uri) {
    if (!ASSET_HOST.equals(uri.getHost())) return null;
    String path = uri.getPath();
    if (path == null || path.contains("..")) return notFound();
    if (path.startsWith("/api/")) return notFound(); // le API passano dal bridge JS
    String assetPath = "www" + path.replaceFirst("^/assets", "");
    try {
      InputStream in = getAssets().open(assetPath);
      String mime = guessMime(assetPath);
      String enc = (mime.startsWith("text/") || mime.equals("application/javascript")
          || mime.equals("application/json")) ? "utf-8" : null;
      WebResourceResponse resp = new WebResourceResponse(mime, enc, in);
      resp.setResponseHeaders(Collections.singletonMap("Access-Control-Allow-Origin", "*"));
      return resp;
    } catch (Exception e) {
      return notFound();
    }
  }

  private WebResourceResponse notFound() {
    try {
      return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null,
          new ByteArrayInputStream(new byte[0]));
    } catch (Throwable t) {
      return null;
    }
  }

  private static String guessMime(String p) {
    String s = p.toLowerCase();
    if (s.endsWith(".html") || s.endsWith(".htm")) return "text/html";
    if (s.endsWith(".js")) return "application/javascript";
    if (s.endsWith(".css")) return "text/css";
    if (s.endsWith(".json") || s.endsWith(".map") || s.endsWith(".webmanifest")) return "application/json";
    if (s.endsWith(".woff2")) return "font/woff2";
    if (s.endsWith(".woff")) return "font/woff";
    if (s.endsWith(".ttf")) return "font/ttf";
    if (s.endsWith(".svg")) return "image/svg+xml";
    if (s.endsWith(".png")) return "image/png";
    if (s.endsWith(".jpg") || s.endsWith(".jpeg")) return "image/jpeg";
    if (s.endsWith(".webp")) return "image/webp";
    if (s.endsWith(".gif")) return "image/gif";
    if (s.endsWith(".ico")) return "image/x-icon";
    if (s.endsWith(".txt")) return "text/plain";
    return "application/octet-stream";
  }

  // ---------------- Bridge JS -> nativo ----------------

  private class NativeBridge {

    /** Richiesta HTTP verso il backend, eseguita dal layer nativo (no CORS). */
    @JavascriptInterface
    public void request(final String id, final String method, final String url,
                        final String headersJson, final String body) {
      new Thread(new Runnable() {
        @Override
        public void run() {
          performRequest(id, method, url, headersJson, body);
        }
      }).start();
    }

    /** Dialog di conferma in stile app (al posto del confirm() "file:///" della WebView). */
    @JavascriptInterface
    public boolean confirm(final String message) {
      final CountDownLatch latch = new CountDownLatch(1);
      final boolean[] result = {false};
      runOnUiThread(new Runnable() {
        @Override
        public void run() {
          AlertDialog.Builder b = new AlertDialog.Builder(MainActivity.this)
              .setMessage(message == null ? "" : message)
              .setPositiveButton("Conferma", new android.content.DialogInterface.OnClickListener() {
                @Override
                public void onClick(android.content.DialogInterface d, int w) {
                  result[0] = true;
                  latch.countDown();
                }
              })
              .setNegativeButton("Annulla", new android.content.DialogInterface.OnClickListener() {
                @Override
                public void onClick(android.content.DialogInterface d, int w) {
                  latch.countDown();
                }
              })
              .setOnCancelListener(new android.content.DialogInterface.OnCancelListener() {
                @Override
                public void onCancel(android.content.DialogInterface d) {
                  latch.countDown();
                }
              });
          b.show();
        }
      });
      try {
        latch.await(60, TimeUnit.SECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      return result[0];
    }

    @JavascriptInterface
    public void toast(final String message) {
      runOnUiThread(new Runnable() {
        @Override
        public void run() {
          Toast.makeText(MainActivity.this, message == null ? "" : message, Toast.LENGTH_SHORT).show();
        }
      });
    }

    @JavascriptInterface
    public void pageReady() {
      runOnUiThread(new Runnable() {
        @Override
        public void run() {
          removeSplashNow();
        }
      });
    }

    @JavascriptInterface
    public void authRedirect() {
      // Le pagine protette reindirizzano già da sole al login.
    }

    @JavascriptInterface
    public void openExternal(final String url) {
      runOnUiThread(new Runnable() {
        @Override
        public void run() {
          try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
          } catch (Exception ignored) {
          }
        }
      });
    }

    /** Export backup: file picker in scrittura (SAF, nessun permesso richiesto). */
    @JavascriptInterface
    public void exportFile(final String filename, final String content) {
      runOnUiThread(new Runnable() {
        @Override
        public void run() {
          pendingExportContent = content == null ? "" : content;
          Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
          i.addCategory(Intent.CATEGORY_OPENABLE);
          i.setType("application/json");
          i.putExtra(Intent.EXTRA_TITLE, filename == null ? "videoteca-backup.json" : filename);
          try {
            startActivityForResult(i, REQ_EXPORT);
          } catch (Exception e) {
            pendingExportContent = null;
            Toast.makeText(MainActivity.this, "Impossibile aprire il salvataggio.", Toast.LENGTH_SHORT).show();
          }
        }
      });
    }

    /** Import backup: file picker in lettura (SAF). */
    @JavascriptInterface
    public void pickImportFile() {
      runOnUiThread(new Runnable() {
        @Override
        public void run() {
          Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
          i.addCategory(Intent.CATEGORY_OPENABLE);
          i.setType("application/json");
          try {
            startActivityForResult(i, REQ_IMPORT);
          } catch (Exception e) {
            Toast.makeText(MainActivity.this, "Impossibile aprire il selettore file.", Toast.LENGTH_SHORT).show();
          }
        }
      });
    }

    /** Valori safe-area indicativi (poi il nativo aggiorna con gli inset reali). */
    @JavascriptInterface
    public String getSafeArea() {
      return lastInsetTop + "," + lastInsetBottom;
    }
  }

  // ---------------- HTTP del backend (dal nativo, con Origin del sito) ----------------

  private void performRequest(String id, String method, String url, String headersJson, String body) {
    int status = 0;
    String text = "";
    String error = null;
    try {
      HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setRequestMethod(method);
      conn.setConnectTimeout(15000);
      conn.setReadTimeout(30000);
      conn.setInstanceFollowRedirects(true);
      if (headersJson != null && headersJson.length() > 2) {
        JSONObject hs = new JSONObject(headersJson);
        Iterator<String> it = hs.keys();
        while (it.hasNext()) {
          String k = it.next();
          String v = hs.optString(k, "");
          if (v.length() > 0 && !"Origin".equalsIgnoreCase(k)) conn.setRequestProperty(k, v);
        }
      }
      // Il backend è fail-closed sul CORS: presentiamo l'origine del sito ufficiale.
      conn.setRequestProperty("Origin", "https://el7774.github.io");
      boolean hasBody = body != null && body.length() > 0
          && !"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method);
      if (hasBody) {
        conn.setDoOutput(true);
        byte[] out = body.getBytes(StandardCharsets.UTF_8);
        conn.setFixedLengthStreamingMode(out.length);
        OutputStream os = conn.getOutputStream();
        os.write(out);
        os.flush();
        os.close();
      }
      status = conn.getResponseCode();
      InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
      if (in != null) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        in.close();
        text = buf.toString("UTF-8");
      }
      conn.disconnect();
    } catch (Exception e) {
      error = e.getMessage() != null ? e.getMessage() : e.toString();
    }

    final String js = "window.VideotecaBridge && window.VideotecaBridge.onResponse("
        + JSONObject.quote(id) + "," + status + ","
        + JSONObject.quote(text == null ? "" : text) + ","
        + (error == null ? "null" : JSONObject.quote(error)) + ");";
    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        if (webView != null) webView.evaluateJavascript(js, null);
      }
    });
  }

  // ---------------- Export / Import risultati ----------------

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == REQ_EXPORT) {
      if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExportContent != null) {
        try {
          OutputStream os = getContentResolver().openOutputStream(data.getData());
          os.write(pendingExportContent.getBytes(StandardCharsets.UTF_8));
          os.flush();
          os.close();
          Toast.makeText(this, "Backup salvato.", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
          Toast.makeText(this, "Impossibile salvare il backup.", Toast.LENGTH_SHORT).show();
        }
      }
      pendingExportContent = null;
    } else if (requestCode == REQ_IMPORT) {
      if (resultCode == RESULT_OK && data != null && data.getData() != null) {
        try {
          InputStream in = getContentResolver().openInputStream(data.getData());
          ByteArrayOutputStream buf = new ByteArrayOutputStream();
          byte[] chunk = new byte[8192];
          int n;
          while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
          in.close();
          final String content = buf.toString("UTF-8");
          runOnUiThread(new Runnable() {
            @Override
            public void run() {
              webView.evaluateJavascript(
                  "window.VideotecaBridge && window.VideotecaBridge.onFilePicked("
                      + JSONObject.quote(content) + ");", null);
            }
          });
        } catch (Exception e) {
          Toast.makeText(this, "Impossibile leggere il file.", Toast.LENGTH_SHORT).show();
        }
      }
    }
  }

  // ---------------- Safe area ----------------

  private void pushInsetsValues(int top, int bottom) {
    if (webView == null) return;
    final String js = "document.documentElement.style.setProperty('--safe-top','" + top + "px');"
        + "document.documentElement.style.setProperty('--safe-bottom','" + bottom + "px');";
    webView.evaluateJavascript(js, null);
  }

  // ---------------- Splash ----------------

  private void buildSplash(FrameLayout root) {
    splash = new FrameLayout(this);
    splash.setBackgroundColor(0xFF0E1013);
    splash.setClickable(true);
    splash.setFocusable(true);

    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setGravity(Gravity.CENTER);

    ProgressBar bar = new ProgressBar(this);
    bar.getIndeterminateDrawable().setColorFilter(0xFF4C8DFF, PorterDuff.Mode.SRC_IN);
    LinearLayout.LayoutParams barLp = new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    barLp.gravity = Gravity.CENTER_HORIZONTAL;
    box.addView(bar, barLp);

    TextView label = new TextView(this);
    label.setText("VIDEOTECA");
    label.setTextColor(0xFFEAECEF);
    label.setTextSize(15);
    label.setLetterSpacing(0.25f);
    LinearLayout.LayoutParams labelLp = new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    labelLp.gravity = Gravity.CENTER_HORIZONTAL;
    labelLp.topMargin = dp(18);
    box.addView(label, labelLp);

    splash.addView(box, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
    root.addView(splash, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    splashVisible = true;
  }

  private void scheduleSplashRemoval() {
    if (!splashVisible) return;
    webView.postDelayed(new Runnable() {
      @Override
      public void run() {
        removeSplashNow();
      }
    }, 250);
  }

  private void removeSplashNow() {
    if (!splashVisible || splash == null) return;
    splashVisible = false;
    splash.animate().alpha(0f).setDuration(220).withEndAction(new Runnable() {
      @Override
      public void run() {
        if (splash != null && splash.getParent() instanceof ViewGroup) {
          ((ViewGroup) splash.getParent()).removeView(splash);
        }
        splash = null;
      }
    }).start();
  }

  private int dp(int v) {
    return Math.round(v * getResources().getDisplayMetrics().density);
  }

  // ---------------- Tasto back ----------------

  @Override
  public void onBackPressed() {
    if (webView == null) {
      super.onBackPressed();
      return;
    }
    if (webView.canGoBack()) {
      WebBackForwardList list = webView.copyBackForwardList();
      int idx = list.getCurrentIndex();
      String prev = "";
      if (idx > 0 && list.getItemAtIndex(idx - 1) != null) {
        prev = list.getItemAtIndex(idx - 1).getUrl();
      }
      boolean prevIsEntry = prev.endsWith("/index.html") || prev.endsWith("/welcome.html");
      if (prevIsEntry) {
        // Indietro verso login/splash non ha senso: si esce dall'app.
        super.onBackPressed();
        return;
      }
      webView.goBack();
    } else {
      super.onBackPressed();
    }
  }

  @Override
  protected void onSaveInstanceState(Bundle outState) {
    super.onSaveInstanceState(outState);
    if (webView != null) webView.saveState(outState);
  }

  @Override
  protected void onDestroy() {
    if (webView != null) {
      webView.destroy();
      webView = null;
    }
    super.onDestroy();
  }
}
