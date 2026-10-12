package com.futahua.papers.mobile;
import android.app.Instrumentation;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import android.view.ViewGroup;
import org.json.JSONObject;
import java.io.*;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class DeviceCheck extends Instrumentation {
  private Bundle arguments;
  @Override public void onCreate(Bundle args) { arguments=args; start(); }
  @Override public void onStart() {
    Bundle result=new Bundle();
    try {
      MobileFiles files=MobileFiles.get(getTargetContext());
      boolean offlineOnly="true".equals(arguments.getString("offlineOnly", "false"));
      if(!arguments.getString("code", "").isEmpty())files.call(new JSONObject().put("operation","pair").put("address",arguments.getString("address")).put("code",arguments.getString("code")));
      JSONObject snapshot=(JSONObject)files.call(new JSONObject().put("operation","status"));
      String owner=snapshot.getJSONArray("devices").getJSONObject(snapshot.getJSONArray("devices").length()-1).getString("id");
      JSONObject shares=(JSONObject)files.call(new JSONObject().put("operation","browse").put("ownerId",owner));
      String folder=shares.getJSONArray("entries").getJSONObject(0).getString("id");
      JSONObject listing=(JSONObject)files.call(new JSONObject().put("operation","browse").put("ownerId",owner).put("resourceId",folder));
      JSONObject file=listing.getJSONArray("entries").getJSONObject(0);
      if(offlineOnly && listing.getBoolean("online"))throw new IOException("Owner was expected offline");
      if(!offlineOnly){
      JSONObject started=(JSONObject)files.call(new JSONObject().put("operation","download").put("ownerId",owner).put("entry",file));
      boolean completed=false;
      for(int attempt=0;attempt<600;attempt++){
        JSONObject state=(JSONObject)files.call(new JSONObject().put("operation","status"));
        for(int i=0;i<state.getJSONArray("jobs").length();i++){JSONObject job=state.getJSONArray("jobs").getJSONObject(i);if(started.getString("id").equals(job.getString("id"))){if("failed".equals(job.getString("phase")))throw new IOException(job.optString("error"));completed="completed".equals(job.getString("phase"));}}
        if(completed)break;Thread.sleep(100);
      }
      if(!completed)throw new IOException("Download did not finish");
      }
      org.json.JSONArray offline=(org.json.JSONArray)files.call(new JSONObject().put("operation","offline").put("ownerId",owner));
      if(offline.length()!=1||!arguments.getString("sha256").equals(offline.getJSONObject(0).getString("sha256")))throw new IOException("Offline digest mismatch");
      File cached=new File(new File(getTargetContext().getFilesDir(),"remote-files"),offline.getJSONObject(0).getString("key")+".bin");
      MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream input=new FileInputStream(cached)){byte[] block=new byte[65536];int count;while((count=input.read(block))>=0)digest.update(block,0,count);}
      StringBuilder actual=new StringBuilder();for(byte b:digest.digest())actual.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
      if(!arguments.getString("sha256").equals(actual.toString()))throw new IOException("Actual cached bytes do not match fixture");
      Activity activity=startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      Thread.sleep(2000);CountDownLatch ready=new CountDownLatch(1);
      runOnMainSync(()->{WebView view=(WebView)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);view.evaluateJavascript("document.body.innerText",text->{result.putString("uiText",text);ready.countDown();});});
      if(!ready.await(10,TimeUnit.SECONDS)||!result.getString("uiText","").contains("Papers device check"))throw new IOException("Client UI did not display paired owner");
      result.putString("result",offlineOnly?"PASS: disconnected owner, saved listings, complete verified offline bytes, retained pairing after update, shared AYG UI":"PASS: native pairing, direct file listing, verified 1 MiB transfer, offline manifest, shared AYG UI");finish(Activity.RESULT_OK,result);
    }catch(Exception error){result.putString("failure",error.toString());finish(Activity.RESULT_CANCELED,result);}
  }
}
