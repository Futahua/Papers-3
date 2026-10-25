package com.futahua.papers.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import io.tus.java.client.*;
import java.io.*;
import java.net.*;
import java.util.*;

/** tus-java-client owns upload negotiation and offset recovery. */
final class PhoneTusClient {
  interface Progress { void accepted(long bytes)throws Exception; }
  static boolean supported(String base,String token)throws Exception {
    HttpURLConnection c=(HttpURLConnection)new URL(base+PhoneTusTransfers.ROOT).openConnection();
    try{c.setInstanceFollowRedirects(false);c.setConnectTimeout(5000);c.setReadTimeout(5000);c.setRequestMethod("OPTIONS");c.setRequestProperty("Authorization","Bearer "+token);return c.getResponseCode()<300&&"1.0.0".equals(c.getHeaderField("Tus-Version"));}finally{c.disconnect();}
  }
  static URL upload(Context context,String base,String token,File snapshot,String folder,String name,String digest,Progress progress)throws Exception {
    final URI origin=new URI(base);SharedPreferences preferences=context.getSharedPreferences("tus-upload-urls",0);
    TusClient client=new TusClient(){@Override public void prepareConnection(HttpURLConnection c){
      URI u=URI.create(c.getURL().toString());if(!Objects.equals(u.getScheme(),origin.getScheme())||!Objects.equals(u.getHost(),origin.getHost())||u.getPort()!=origin.getPort()||u.getUserInfo()!=null||u.getQuery()!=null||!u.getPath().startsWith(PhoneTusTransfers.ROOT))throw new IllegalStateException("Upload location differs from paired owner");
      super.prepareConnection(c);c.setInstanceFollowRedirects(false);c.setReadTimeout(60000);
    }};
    client.setUploadCreationURL(new URL(base+PhoneTusTransfers.ROOT));client.setConnectTimeout(15000);client.setHeaders(Collections.singletonMap("Authorization","Bearer "+token));
    client.enableResuming(new TusURLStore(){public void set(String key,URL url){if(!preferences.edit().putString(key,url.toString()).commit())throw new IllegalStateException("Upload identity was not retained");}public URL get(String key){try{String value=preferences.getString(key,null);return value==null?null:new URL(value);}catch(Exception error){throw new IllegalStateException("Retained upload needs recovery",error);}}public void remove(String key){/* Retain until publication is confirmed. */}});
    TusUpload upload=new TusUpload(snapshot);upload.setFingerprint(PhonePeerServer.hash((base+"|"+folder+"|"+name+"|"+digest).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    Map<String,String> metadata=new HashMap<>();metadata.put("folderId",folder);metadata.put("name",name);metadata.put("sha256",digest);upload.setMetadata(metadata);
    TusUploader uploader=client.resumeOrCreateUpload(upload);uploader.setChunkSize(256*1024);uploader.setRequestPayloadSize(4*1024*1024);
    try{while(uploader.uploadChunk()>-1){if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("Upload paused");progress.accepted(uploader.getOffset());}uploader.finish();return uploader.getUploadURL();}finally{upload.getInputStream().close();}
  }
}
