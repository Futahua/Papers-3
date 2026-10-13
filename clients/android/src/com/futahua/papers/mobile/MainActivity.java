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
  private static final int IMPORT_EDIT = 201, PICK_FILES = 202;
  private String pickRequest;
  private PhoneUris uris;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    files = MobileFiles.get(getApplicationContext());
    uris = new PhoneUris(getApplicationContext());
    // Personal app: always inspectable (chrome://inspect) and console mirrored to logcat tag PapersWeb.
    WebView.setWebContentsDebuggingEnabled(true);
    view = new WebView(this);
    view.setBackgroundColor(0xff2b302f);
    view.getSettings().setJavaScriptEnabled(true);
    // As you Go and Proxima keep view settings (and the phone its inbox choices) in localStorage.
    view.getSettings().setDomStorageEnabled(true);
    view.getSettings().setAllowFileAccess(false);
    view.getSettings().setAllowContentAccess(false);
    view.getSettings().setBlockNetworkLoads(true);
    view.addJavascriptInterface(new Bridge(), "PapersNative");
    view.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onConsoleMessage(ConsoleMessage message) { android.util.Log.i("PapersWeb", message.messageLevel() + " " + message.sourceId() + ":" + message.lineNumber() + " " + message.message()); return true; }
    });
    view.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
        String route = request.getUrl().getPath(); return request.isForMainFrame() || !"https".equals(request.getUrl().getScheme()) || !"papers.local".equals(request.getUrl().getHost()) || route == null || !(route.equals("/app/remote-overview.html") || route.startsWith("/ayg/") || route.startsWith("/proxima/"));
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
      if (!id.matches("[0-9]{1,12}") || text.length() > 64 * 1024 * 1024) return;
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
          String operation = request.optString("operation");
          // Files chosen from the phone become items in its As you Go (by content address, not copied).
          if ("pick-files".equals(operation)) {
            runOnUiThread(() -> {
              if (isFinishing() || isDestroyed()) return;
              if (pickRequest != null || importRequest != null) { sendReply(id, false, "A file choice is already open."); return; }
              pickRequest = id;
              try { startActivityForResult(new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT).addCategory(android.content.Intent.CATEGORY_OPENABLE).setType("*/*").putExtra(android.content.Intent.EXTRA_ALLOW_MULTIPLE, true).addFlags(android.content.Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION), PICK_FILES); }
              catch (Exception error) { pickRequest = null; sendReply(id, false, "The file chooser is unavailable."); }
            }); return;
          }
          if ("self".equals(operation)) {
            String name = android.provider.Settings.Global.getString(getContentResolver(), "device_name");
            reply.put("ok", true); reply.put("result", new JSONObject().put("name", name == null || name.isEmpty() ? android.os.Build.MODEL : name));
          }
          else if (PhoneUris.handles(operation)) { reply.put("ok", true); reply.put("result", uris.call(request)); }
          else { reply.put("ok", true); reply.put("result", files.call(request)); }
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
    if(requestCode==PICK_FILES&&pickRequest!=null){
      String replyId=pickRequest;pickRequest=null;
      java.util.List<android.net.Uri> chosen=new java.util.ArrayList<>();
      if(resultCode==RESULT_OK&&data!=null){
        if(data.getClipData()!=null)for(int i=0;i<data.getClipData().getItemCount();i++)chosen.add(data.getClipData().getItemAt(i).getUri());
        else if(data.getData()!=null)chosen.add(data.getData());
      }
      requests.execute(()->{
        try{org.json.JSONArray picked=new org.json.JSONArray();for(android.net.Uri uri:chosen)picked.put(uris.keep(uri));runOnUiThread(()->sendReply(replyId,true,picked));}
        catch(Exception error){runOnUiThread(()->sendReply(replyId,false,"Those files could not be added."));}
      });
      return;
    }
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
  // Back closes an open preview, then leaves a device's As you Go, then leaves the app.
  @Override public void onBackPressed() {
    if (view == null) { super.onBackPressed(); return; }
    view.evaluateJavascript("Boolean(window.papersBack && window.papersBack())", handled -> { if (!"true".equals(handled)) finish(); });
  }
  @Override public void onDestroy() {
    requests.shutdownNow();
    if (view != null) { view.removeJavascriptInterface("PapersNative"); view.destroy(); view = null; }
    super.onDestroy();
  }
}
