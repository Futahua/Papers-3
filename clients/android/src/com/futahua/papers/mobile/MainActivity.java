package com.futahua.papers.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.ConsoleMessage;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
  private WebView view;
  private final ExecutorService requests = Executors.newFixedThreadPool(3);
  private MobileFiles files;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    files = MobileFiles.get(getApplicationContext());
    view = new WebView(this);
    view.setBackgroundColor(0xff2b302f);
    view.getSettings().setJavaScriptEnabled(true);
    view.getSettings().setAllowFileAccess(false);
    view.getSettings().setAllowContentAccess(false);
    view.getSettings().setBlockNetworkLoads(true);
    view.addJavascriptInterface(new Bridge(), "PapersNative");
    view.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onConsoleMessage(ConsoleMessage message) { android.util.Log.w("PapersWeb", message.message()); return true; }
    });
    view.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) { return true; }
      @Override public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
        String name = request.getUrl().getPath();
        if (!"https".equals(request.getUrl().getScheme()) || !"papers.local".equals(request.getUrl().getHost()) || name == null || name.contains("..") || !name.matches("/[a-zA-Z0-9/_-]+\\.(html|js|css)")) return empty();
        try {
          String type = name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html";
          return new WebResourceResponse(type, "UTF-8", getAssets().open(name.substring(1)));
        } catch (Exception error) { return empty(); }
      }
      private WebResourceResponse empty() { return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0])); }
    });
    setContentView(view);
    view.loadUrl("https://papers.local/index.html");
  }

  public final class Bridge {
    @JavascriptInterface public void request(String id, String text) {
      if (!id.matches("[0-9]{1,12}") || text.length() > 65536) return;
      requests.execute(() -> {
        JSONObject reply = new JSONObject();
        try { reply.put("ok", true); reply.put("result", files.call(new JSONObject(text))); }
        catch (Exception error) { try { reply.put("ok", false); reply.put("message", error.getMessage() == null ? "Operation failed" : error.getMessage()); } catch (Exception ignored) {} }
        String json = reply.toString();
        runOnUiThread(() -> { if (view != null) view.evaluateJavascript("window.papersReply(" + id + "," + json + ")", null); });
      });
    }
  }
  @Override public void onDestroy() {
    requests.shutdownNow();
    if (view != null) { view.removeJavascriptInterface("PapersNative"); view.destroy(); view = null; }
    super.onDestroy();
  }
}
