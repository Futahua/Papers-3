package com.futahua.papers.mobile;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.io.File;
import java.util.Map;
import android.database.Cursor;

/** Read-only real peer HTTP folder benchmark; never exposes pairing tokens or file names. */
public final class PhoneFolderLatencyCheck extends Instrumentation {
  private JSONObject get(String route, String token) throws Exception {
    HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:48240"+route).openConnection();
    c.setRequestProperty("Authorization","Bearer "+token);
    c.setConnectTimeout(5000);c.setReadTimeout(20000);
    try {
      int code=c.getResponseCode();
      if(code!=200)throw new Exception("Phone owner returned HTTP "+code+" for "+route.replaceAll("[a-f0-9-]{36}","<id>"));
      try(InputStream input=c.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
        byte[] b=new byte[8192];for(int n;(n=input.read(b))!=-1;)bytes.write(b,0,n);
        return new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
      }
    } finally {c.disconnect();}
  }
  @Override public void onCreate(Bundle args){start();}
  @Override public void onStart(){
    Bundle output=new Bundle();
    try {
      if(!PhonePeerServer.hex(new byte[]{0,15,16,(byte)255}).equals("000f10ff"))throw new Exception("Lowercase hex compatibility changed");
      if(!PhonePeerServer.hash("abc".getBytes(StandardCharsets.UTF_8)).equals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"))throw new Exception("SHA-256 version compatibility changed");
      PhonePeerServer peer=new PhonePeerServer(getTargetContext());
      // Instrumentation stops the target app's service process; start an isolated read-only owner listener.
      peer.start();
      JSONArray grants=MobileFiles.get(getTargetContext()).peerInvitations(peer.owner);
      if(grants.length()==0)throw new Exception("No paired PC permission for read-only peer benchmark");
      String token=grants.getJSONObject(0).getString("token");
      long a=System.nanoTime();
      JSONObject roots=get("/v1/files/shares",token);
      long sharesMs=(System.nanoTime()-a)/1000000;
      JSONArray result=new JSONArray();
      for(int i=0;i<roots.getJSONArray("entries").length();i++){
        JSONObject root=roots.getJSONArray("entries").getJSONObject(i);
        if(!"folder".equals(root.getString("kind")))continue;
        String id=root.getString("id");
        File folder=PhoneStorage.roots().get(i);long rawStart=System.nanoTime();File[] rawFiles=folder.listFiles();long rawMs=(System.nanoTime()-rawStart)/1000000;
        Map<String,PhoneIndex.ListedMetadata> index=PhoneIndex.get(getTargetContext()).listedMetadata(folder);
        int hits=0;for(File file:rawFiles)if(index.containsKey(file.getPath()))hits++;
        java.lang.reflect.Method metadata=PhonePeerServer.class.getDeclaredMethod("metadata",File.class,JSONObject.class,boolean.class,long.class,long.class);metadata.setAccessible(true);
        long metaStart=System.nanoTime();for(File child:rawFiles){PhoneIndex.ListedMetadata row=index.get(child.getPath());if(row!=null)metadata.invoke(peer,child,grants.getJSONObject(0),row.directory,row.directory?0:row.size,row.modified);}long metaMs=(System.nanoTime()-metaStart)/1000000;
        result.put(new JSONObject().put("rootIndex",i).put("rawReadMs",rawMs).put("metadataMs",metaMs).put("rawCount",rawFiles.length).put("indexed",index.size()).put("hits",hits));
        for(int run=0;run<2;run++){
          long start=System.nanoTime();int total=0,pages=0,folders=0;int offset=0;
          do {
            JSONObject page=get("/v1/files/"+id+"/list?offset="+offset+"&limit=500",token);
            pages++;
            JSONArray rows=page.getJSONArray("entries");total+=rows.length();
            for(int x=0;x<rows.length();x++)if("folder".equals(rows.getJSONObject(x).getString("kind")))folders++;
            offset=page.isNull("nextOffset")?-1:page.getInt("nextOffset");
            if(pages>50)throw new Exception("Unbounded phone listing");
          }while(offset>=0);
          long elapsed=(System.nanoTime()-start)/1000000;
          result.put(new JSONObject().put("rootIndex",i).put("pass",run).put("items",total).put("folders",folders).put("pages",pages).put("durationMs",elapsed));
        }
      }
      JSONArray large=new JSONArray();
      java.lang.reflect.Method register=PhonePeerServer.class.getDeclaredMethod("entry",File.class,JSONObject.class);register.setAccessible(true);
      try(Cursor candidates=PhoneIndex.get(getTargetContext()).targetDatabase().rawQuery("SELECT parent,count(*) FROM files GROUP BY parent HAVING count(*)>=450 ORDER BY count(*) DESC LIMIT 5",null)){
        while(candidates.moveToNext()){
          File folder=new File(candidates.getString(0));if(!folder.isDirectory())continue;
          JSONObject registered;try{registered=(JSONObject)register.invoke(peer,folder,grants.getJSONObject(0));}catch(Exception inaccessible){continue;}
          String id=registered.getString("id");long beginning=System.nanoTime();int offset=0,items=0,pages=0;
          do{JSONObject page=get("/v1/files/"+id+"/list?offset="+offset+"&limit=500",token);items+=page.getJSONArray("entries").length();pages++;offset=page.isNull("nextOffset")?-1:page.getInt("nextOffset");if(pages>20)throw new Exception("Unbounded large folder");}while(offset>=0);
          large.put(new JSONObject().put("indexedItems",candidates.getInt(1)).put("actualItems",items).put("pages",pages).put("durationMs",(System.nanoTime()-beginning)/1000000));
        }
      }
      output.putString("result",new JSONObject().put("sharesMs",sharesMs).put("listing",result).put("largeFolders",large).toString());
      finish(Activity.RESULT_OK,output);
    }catch(Exception error){output.putString("error",error.getClass().getSimpleName()+": "+error.getMessage());finish(Activity.RESULT_CANCELED,output);}
  }
}