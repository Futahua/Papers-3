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
  private String importRequest, importEdit;
  private static final int IMPORT_EDIT = 201;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    files = MobileFiles.get(getApplicationContext());
    // Personal app: always inspectable (chrome://inspect) and console mirrored to logcat tag PapersWeb.
    WebView.setWebContentsDebuggingEnabled(true);
    view = new WebView(this);
    view.setBackgroundColor(0xff2b302f);
    view.getSettings().setJavaScriptEnabled(true);
    view.getSettings().setAllowFileAccess(false);
    view.getSettings().setAllowContentAccess(false);
    view.getSettings().setBlockNetworkLoads(true);
    view.addJavascriptInterface(new Bridge(), "PapersNative");
    view.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onConsoleMessage(ConsoleMessage message) { android.util.Log.i("PapersWeb", message.messageLevel() + " " + message.sourceId() + ":" + message.lineNumber() + " " + message.message()); return true; }
    });
    view.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
        return request.isForMainFrame() || !"https".equals(request.getUrl().getScheme()) || !"papers.local".equals(request.getUrl().getHost()) || !"/app/remote-overview.html".equals(request.getUrl().getPath());
      }
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
        try {
          JSONObject request = new JSONObject(text);
          if ("edit-import".equals(request.optString("operation"))) {
            String editId = request.getString("editId");
            MobileEditCopies copies=new MobileEditCopies(getApplicationContext());copies.working(editId);
            JSONObject copy=copies.read(editId);if(!"editing".equals(copy.getString("phase"))||copy.has("saveId")||copy.has("importedCopyId"))throw new java.io.IOException("Choose the current editable working copy.");
            runOnUiThread(() -> {
              if(isFinishing()||isDestroyed())return;
              if (importRequest != null) { sendReply(id,false,"A file choice is already open."); return; }
              importRequest=id; importEdit=editId;
              try {
                android.content.Intent choose=new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT).addCategory(android.content.Intent.CATEGORY_OPENABLE).setType("*/*");
                choose.putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI,android.provider.DocumentsContract.buildDocumentUri("com.android.externalstorage.documents","primary:Download"));
                startActivityForResult(choose, IMPORT_EDIT);
              }
              catch(Exception error){importRequest=null;importEdit=null;sendReply(id,false,"The file chooser is unavailable.");}
            }); return;
          }
          reply.put("ok", true); reply.put("result", files.call(request));
        }
        catch (Exception error) { try { reply.put("ok", false); reply.put("message", error.getMessage() == null ? "Operation failed" : error.getMessage()); } catch (Exception ignored) {} }
        String json = reply.toString();
        runOnUiThread(() -> { if (view != null) view.evaluateJavascript("window.papersReply(" + id + "," + json + ")", null); });
      });
    }
  }
  private void sendReply(String id,boolean success,Object value) {
    try { JSONObject reply=new JSONObject().put("ok",success).put(success?"result":"message",value);
      if(view!=null)view.evaluateJavascript("window.papersReply("+id+","+reply.toString()+")",null);
    } catch(Exception ignored){}
  }
  @Override protected void onActivityResult(int requestCode,int resultCode,android.content.Intent data) {
    super.onActivityResult(requestCode,resultCode,data);
    if(requestCode!=IMPORT_EDIT||importRequest==null)return;
    String replyId=importRequest,editId=importEdit;importRequest=null;importEdit=null;
    if(resultCode!=RESULT_OK||data==null||data.getData()==null){sendReply(replyId,true,new JSONObject());return;}
    android.net.Uri uri=data.getData();
    requests.execute(()->{
      try(java.io.InputStream input=getContentResolver().openInputStream(uri)){
        if(input==null)throw new java.io.IOException("Chosen file could not be read.");
        JSONObject copy=new MobileEditCopies(getApplicationContext()).importCopy(editId,input);
        runOnUiThread(()->sendReply(replyId,true,copy));
      }catch(Exception error){runOnUiThread(()->sendReply(replyId,false,"Import was not completed. Previous working files were retained."));}
    });
  }
  @Override public void onDestroy() {
    requests.shutdownNow();
    if (view != null) { view.removeJavascriptInterface("PapersNative"); view.destroy(); view = null; }
    super.onDestroy();
  }
}
