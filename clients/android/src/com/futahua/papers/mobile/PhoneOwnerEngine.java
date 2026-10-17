package com.futahua.papers.mobile;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.*;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/** The existing JS Store owns phone facts, even when no presentation is mounted. */
final class PhoneOwnerEngine {
 private final Context context;private final String host;private WebView view;private final Handler main=new Handler(Looper.getMainLooper());
 private final CompletableFuture<Void> ready=new CompletableFuture<>();private final ConcurrentHashMap<String,CompletableFuture<JSONObject>> pending=new ConcurrentHashMap<>();private final AtomicLong ids=new AtomicLong();
 PhoneOwnerEngine(Context c){this(c,"papers.local");}
 PhoneOwnerEngine(Context c,String host){context=c.getApplicationContext();this.host=host;main.post(this::start);}
 private void start(){try{view=new WebView(context);view.getSettings().setJavaScriptEnabled(true);view.getSettings().setDomStorageEnabled(true);view.getSettings().setAllowFileAccess(false);view.getSettings().setAllowContentAccess(false);view.setWebChromeClient(new WebChromeClient(){@Override public boolean onConsoleMessage(ConsoleMessage m){android.util.Log.i("PapersOwner",m.messageLevel()+" "+m.sourceId()+":"+m.lineNumber()+" "+m.message());return true;}});view.getSettings().setBlockNetworkLoads(true);view.addJavascriptInterface(new Bridge(),"PapersOwner");view.setWebViewClient(new WebViewClient(){@Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){String path=r.getUrl().getPath();if(!"https".equals(r.getUrl().getScheme())||!host.equals(r.getUrl().getHost())||path==null||!path.matches("/proxima/[a-zA-Z0-9_-]+\\.(html|js)"))return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));try{return new WebResourceResponse(path.endsWith(".js")?"text/javascript":"text/html","UTF-8",context.getAssets().open(path.substring(1)));}catch(Exception e){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}}});view.loadUrl("https://"+host+"/proxima/owner.html");}catch(Exception e){ready.completeExceptionally(e);}}
 final class Bridge {
  @JavascriptInterface public void files(String id,String raw){CompletableFuture.runAsync(()->{JSONObject response=new JSONObject();try{JSONObject input=new JSONObject(raw),params=input.optJSONObject("params");String op=input.getString("operation");Object result;
    if(op.equals("workspace-files"))result=WorkspaceFiles.get(context).call(params);
    else if(op.equals("copy"))result=MobileFiles.get(context).call(new JSONObject().put("operation","workspace-transfer").put("paths",params.getJSONArray("paths")).put("destination",params.getString("destination")));
    else if(op.equals("devices"))result=MobileFiles.get(context).call(new JSONObject().put("operation","status"));
    else if(op.equals("workspace-exchange"))result=MobileFiles.get(context).call(new JSONObject().put("operation","workspace-peer-exchange").put("ownerId",params.getString("ownerId")).put("message",params.getJSONObject("message")));
    else throw new IllegalArgumentException("Unsupported workspace owner operation.");response.put("ok",true).put("result",result);
   }catch(Exception error){try{response.put("ok",false).put("message",error.getMessage());}catch(Exception ignored){}}
   String reply=response.toString();main.post(()->{if(view!=null)view.evaluateJavascript("__proximaWorkspaceNativeReply("+JSONObject.quote(id)+","+reply+")",null);});});}
  @JavascriptInterface public void ready(){ready.complete(null);}
  @JavascriptInterface public void failed(String message){ready.completeExceptionally(new IllegalStateException(message));}
  @JavascriptInterface public void reply(String id,String json){CompletableFuture<JSONObject> task=pending.remove(id);if(task==null)return;try{JSONObject response=new JSONObject(json);if(response.optBoolean("ok"))task.complete(response.getJSONObject("result"));else task.completeExceptionally(new IllegalStateException(response.optString("message","Owner refused request.")));}catch(Exception e){task.completeExceptionally(e);}}
 }
 JSONObject request(JSONObject value)throws Exception {ready.get(20,TimeUnit.SECONDS);String id=String.valueOf(ids.incrementAndGet());CompletableFuture<JSONObject> task=new CompletableFuture<>();pending.put(id,task);main.post(()->view.evaluateJavascript("phoneOwnerRequest("+JSONObject.quote(id)+","+value.toString()+")",null));try{return task.get(30,TimeUnit.SECONDS);}finally{pending.remove(id);}}
 void close(){main.post(()->{if(view!=null){view.removeJavascriptInterface("PapersOwner");view.destroy();view=null;}});for(CompletableFuture<JSONObject> task:pending.values())task.completeExceptionally(new IllegalStateException("Owner stopped."));pending.clear();}
}
