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
  private static java.lang.ref.WeakReference<MainActivity> current = new java.lang.ref.WeakReference<>(null);
  static void notifyPhoneProximaChanged() {
    MainActivity activity = current.get();
    if (activity != null) activity.runOnUiThread(() -> { if(activity.view != null) activity.view.evaluateJavascript("window.postMessage({type:'papers:phone:owner-changed'},location.origin)", null); });
  }
  private WebView view;
  private final ExecutorService requests = Executors.newFixedThreadPool(3);
  private MobileFiles files;
  private String importRequest, importEdit;
  private static final int IMPORT_EDIT = 201, PICK_FILES = 202, PICK_DOWNLOAD_FOLDER = 203;
  private String downloadFolderRequest;
  private String pickRequest;
  private android.webkit.ValueCallback<android.net.Uri[]> webFileCallback;
  private static final int WEB_FILES = 204;
  private PhoneUris uris;

  @Override protected void onNewIntent(android.content.Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleFlowPairing(intent);
  }

  /** Flow asks to pair (papers-mobile://pair-flow). The creator approves here, and the token goes
   * only to Flow's own package, never to whichever app claims a link. */
  private void handleFlowPairing(android.content.Intent intent) {
    android.net.Uri data = intent == null ? null : intent.getData();
    if (data == null || !"papers-mobile".equals(data.getScheme()) || !"pair-flow".equals(data.getHost())) return;
    intent.setData(null);
    new android.app.AlertDialog.Builder(this)
      .setTitle("Connect Flow?")
      .setMessage("Flow will be able to open files embedded in your Flow pages and keep the data of interactive embeds in Proxima on this phone. Other apps cannot use this connection.")
      .setNegativeButton("Not now", null)
      .setPositiveButton("Connect", (dialog, which) -> {
        android.net.Uri reply = android.net.Uri.parse("appflowy-flutter://papers-embeds").buildUpon()
          .appendQueryParameter("port", String.valueOf(FlowEmbedServer.PORT))
          .appendQueryParameter("token", FlowEmbedServer.token(this)).build();
        try { startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, reply).setPackage("io.appflowy.appflowy").addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) { android.widget.Toast.makeText(this, "Flow is not installed.", android.widget.Toast.LENGTH_LONG).show(); }
      })
      .show();
  }

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    current = new java.lang.ref.WeakReference<>(this);
    PhonePeerService.start(this);
    files = MobileFiles.get(getApplicationContext());
    uris = new PhoneUris(getApplicationContext());
    handleFlowPairing(getIntent());
    // Personal app: always inspectable (chrome://inspect) and console mirrored to logcat tag PapersWeb.
    WebView.setWebContentsDebuggingEnabled(true);
    view = new WebView(this);
    view.setBackgroundColor(0xff2b302f);
    view.getSettings().setJavaScriptEnabled(true);
    // As you Go and Proxima keep view settings (and the phone its inbox choices) in localStorage.
    view.getSettings().setDomStorageEnabled(true);
    view.getSettings().setAllowFileAccess(false);
    // HTML upload inputs receive only the content URIs explicitly chosen through Android's picker.
    view.getSettings().setAllowContentAccess(true);
    // Network loads stay off except where shouldInterceptRequest lets one through (only the AppFlowy frame);
    // every other outside request is answered empty there.
    view.getSettings().setBlockNetworkLoads(false);
    view.addJavascriptInterface(new Bridge(), "PapersNative");
    view.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onConsoleMessage(ConsoleMessage message) { android.util.Log.i("PapersWeb", message.messageLevel() + " " + message.sourceId() + ":" + message.lineNumber() + " " + message.message()); return true; }
      @Override public boolean onShowFileChooser(WebView webView, android.webkit.ValueCallback<android.net.Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if(webFileCallback!=null||pickRequest!=null||importRequest!=null||downloadFolderRequest!=null){callback.onReceiveValue(null);return true;}
        webFileCallback=callback;
        try {
          android.content.Intent choose=params.createIntent().addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
          startActivityForResult(choose,WEB_FILES);
        } catch(Exception error){webFileCallback=null;callback.onReceiveValue(null);android.widget.Toast.makeText(MainActivity.this,"The file chooser is unavailable.",android.widget.Toast.LENGTH_SHORT).show();}
        return true;
      }
    });
    // AppFlowy keeps its session in its own frame; allow its cookies there (only that origin may load, see appFlowy()).
    android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
    view.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
        if (!request.isForMainFrame() && appFlowy(request.getUrl())) return false;
        String route = request.getUrl().getPath(); return request.isForMainFrame() || !"https".equals(request.getUrl().getScheme()) || !"papers.local".equals(request.getUrl().getHost()) || route == null || !(route.equals("/app/remote-overview.html") || route.startsWith("/ayg/") || route.startsWith("/proxima/"));
      }
      @Override public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
        String name = request.getUrl().getPath();
        // The blob pane's AppFlowy frame is the one outside page allowed: BOP's private (Tailscale) address.
        if (appFlowy(request.getUrl())) return null;
        if (!"https".equals(request.getUrl().getScheme()) || !"papers.local".equals(request.getUrl().getHost()) || name == null || name.contains("..") || !name.matches("/[a-zA-Z0-9/_-]+\\.(html|js|css)")) return empty();
        try {
          String type = name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html";
          return new WebResourceResponse(type, "UTF-8", getAssets().open(name.substring(1)));
        } catch (Exception error) { return empty(); }
      }
      private boolean appFlowy(android.net.Uri url) { return "https".equals(url.getScheme()) && "bop.taild88607.ts.net".equals(url.getHost()) && url.getPort() == 8443; }
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
          if ("clipboard-image".equals(operation)) {
            runOnUiThread(() -> {
              try {
                android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
                android.content.ClipData clip=clipboard.getPrimaryClip();
                if(clip==null||clip.getItemCount()==0||clip.getItemAt(0).getUri()==null){sendReply(id,false,"Copy an image to the clipboard first.");return;}
                android.net.Uri uri=clip.getItemAt(0).getUri();
                requests.execute(()->{try{String image=PhoneClipboard.image(MainActivity.this,uri);runOnUiThread(()->sendReply(id,true,image));}catch(Exception error){runOnUiThread(()->sendReply(id,false,error.getMessage()));}});
              }catch(Exception error){sendReply(id,false,"The clipboard image is unavailable.");}
            });return;
          }
          if ("download-folder-pick".equals(operation)) {
            runOnUiThread(() -> {
              if(downloadFolderRequest!=null||pickRequest!=null||importRequest!=null){sendReply(id,false,"A folder or file choice is already open.");return;}
              downloadFolderRequest=id;
              try{android.content.Intent choose=new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION|android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION|android.content.Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|android.content.Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);startActivityForResult(choose,PICK_DOWNLOAD_FOLDER);}
              catch(Exception error){downloadFolderRequest=null;sendReply(id,false,"Folder picker is unavailable.");}
            });return;
          }
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
    if(requestCode==WEB_FILES){
      android.webkit.ValueCallback<android.net.Uri[]> callback=webFileCallback;webFileCallback=null;
      if(callback!=null){java.util.ArrayList<android.net.Uri> chosen=new java.util.ArrayList<>();if(resultCode==RESULT_OK&&data!=null){if(data.getClipData()!=null){for(int i=0;i<data.getClipData().getItemCount();i++){android.net.Uri uri=data.getClipData().getItemAt(i).getUri();if(uri!=null&&"content".equals(uri.getScheme()))chosen.add(uri);}}else if(data.getData()!=null&&"content".equals(data.getData().getScheme()))chosen.add(data.getData());}callback.onReceiveValue(chosen.isEmpty()?null:chosen.toArray(new android.net.Uri[0]));}
      return;
    }
    if(requestCode==PICK_DOWNLOAD_FOLDER&&downloadFolderRequest!=null){String replyId=downloadFolderRequest;downloadFolderRequest=null;if(resultCode!=RESULT_OK||data==null||data.getData()==null){try{sendReply(replyId,true,PhoneDownloads.get(this).folder());}catch(Exception e){sendReply(replyId,false,"Download folder unavailable.");}return;}android.net.Uri tree=data.getData();int flags=data.getFlags();requests.execute(()->{try{JSONObject folder=PhoneDownloads.get(this).keepFolder(tree,flags);runOnUiThread(()->sendReply(replyId,true,folder));}catch(Exception e){runOnUiThread(()->sendReply(replyId,false,e.getMessage()));}});return;}
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
    if(webFileCallback!=null){webFileCallback.onReceiveValue(null);webFileCallback=null;}
    if(current.get() == this) current.clear();
    requests.shutdownNow();
    if (view != null) { view.removeJavascriptInterface("PapersNative"); view.destroy(); view = null; }
    super.onDestroy();
  }
}
