package com.futahua.papers.mobile;

import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** Saves identity before sending and keeps an ambiguous request available after process death. */
final class MobileCommandOutbox {
  interface Dispatch { JSONObject send(JSONObject command) throws Exception; }
  private final File file;
  private JSONArray commands;
  private final ConcurrentHashMap<String,CompletableFuture<JSONObject>> flights=new ConcurrentHashMap<>();
  MobileCommandOutbox(File directory) { file=new File(directory,"outbox.json"); }
  private synchronized void load() throws Exception {
    if(commands!=null)return;
    if(!file.exists()&&!new File(file.getPath()+".bak").exists()){commands=new JSONArray();return;}
    JSONArray loaded;
    try(InputStream input=new AtomicFile(file).openRead()){
      ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] block=new byte[8192];int n;
      while((n=input.read(block))>=0){bytes.write(block,0,n);if(bytes.size()>8*1024*1024)throw new IOException("File request history is too large.");}
      loaded=new JSONObject(bytes.toString("UTF-8")).getJSONArray("commands");
    }
    for(int i=0;i<loaded.length();i++){
      JSONObject record=loaded.getJSONObject(i);
      if(!record.getString("ownerId").matches("[a-f0-9-]{36}")||!record.getString("deviceId").matches("[a-f0-9-]{36}")||!record.getJSONObject("command").getString("commandId").matches("[a-f0-9-]{36}"))throw new IOException("Invalid file request history.");
      if("submitting".equals(record.getString("phase")))record.put("phase","uncertain").put("error","Connection ended before acknowledgement. Retry checks the same request.");
      if(!java.util.Arrays.asList("submitting","uncertain","accepted","completed","failed").contains(record.getString("phase")))throw new IOException("Invalid file request history.");
    }
    commands=loaded;
    save();
  }
  private void save() throws Exception {
    AtomicFile atomic=new AtomicFile(file);FileOutputStream output=atomic.startWrite();
    try{output.write(new JSONObject().put("commands",commands).toString().getBytes(StandardCharsets.UTF_8));atomic.finishWrite(output);}catch(Exception error){atomic.failWrite(output);throw error;}
  }
  private JSONObject find(String owner,String id) throws Exception {
    for(int i=0;i<commands.length();i++){JSONObject record=commands.getJSONObject(i);if(owner.equals(record.getString("ownerId"))&&id.equals(record.getJSONObject("command").getString("commandId")))return record;}return null;
  }
  synchronized JSONArray snapshot() throws Exception {
    load();JSONArray result=new JSONArray();
    for(int i=0;i<commands.length();i++){JSONObject record=commands.getJSONObject(i),command=record.getJSONObject("command");JSONObject job=new JSONObject().put("ownerId",record.getString("ownerId")).put("commandId",command.getString("commandId")).put("operation",command.getString("operation")).put("phase",record.getString("phase"));if(record.has("error"))job.put("error",record.getString("error"));result.put(job);}return result;
  }
  JSONObject send(String owner,String deviceId,JSONObject raw,Dispatch dispatch) throws Exception {
    if(!deviceId.matches("[a-f0-9-]{36}")||!raw.getString("commandId").matches("[a-f0-9-]{36}"))throw new IOException("Pair this device again before changing files.");
    JSONObject command=new JSONObject();for(String field:new String[]{"commandId","operation","resourceId","expectedVersion","newName","destinationId","destinationVersion"})if(raw.has(field))command.put(field,raw.get(field));
    String id=command.getString("commandId"),key=owner+":"+id;
    CompletableFuture<JSONObject> flight=new CompletableFuture<>(),previous=flights.putIfAbsent(key,flight);
    if(previous!=null)return new JSONObject(previous.get().toString());
    JSONObject record=null;boolean admitted=false;
    try{
      synchronized(this){load();record=find(owner,id);if(record!=null&&(!deviceId.equals(record.getString("deviceId"))||!command.toString().equals(record.getJSONObject("command").toString())))throw new IOException("This request belongs to a different pairing or operation.");if(record==null){for(int i=0;i<commands.length();i++){JSONObject prior=commands.getJSONObject(i);if(owner.equals(prior.getString("ownerId"))&&deviceId.equals(prior.getString("deviceId"))&&command.getString("resourceId").equals(prior.getJSONObject("command").getString("resourceId"))&&java.util.Arrays.asList("submitting","uncertain").contains(prior.getString("phase")))throw new IOException("Retry the saved request before starting another change to this item.");}record=new JSONObject().put("ownerId",owner).put("deviceId",deviceId).put("command",command);commands.put(record);}record.put("phase","submitting");record.remove("error");save();}
      admitted=true;
      JSONObject job;
      try{job=dispatch.send(command);if(!id.equals(job.getString("commandId"))||!java.util.Arrays.asList("queued","checking","waiting","verifying","completed","failed","uncertain").contains(job.getString("phase")))throw new IOException("Invalid acknowledgement.");}
      catch(Exception error){synchronized(this){record.put("phase","uncertain").put("error","Response not confirmed. Retry this saved request to check its outcome.");save();}throw error;}
      synchronized(this){String phase=job.getString("phase");record.put("phase","completed".equals(phase)?"completed":"failed".equals(phase)?"failed":"accepted");save();}
      flight.complete(new JSONObject(job.toString()));return job;
    }catch(Exception error){if(admitted&&record!=null)synchronized(this){record.put("phase","uncertain").put("error","Response not confirmed. Retry this saved request to check its outcome.");try{save();}catch(Exception saveError){error.addSuppressed(saveError);}}flight.completeExceptionally(error);throw error;}finally{flights.remove(key,flight);}
  }
  JSONObject retry(String owner,String deviceId,String id,Dispatch dispatch) throws Exception {
    JSONObject command;synchronized(this){load();JSONObject record=find(owner,id);if(record==null)throw new IOException("Saved request is unavailable.");command=new JSONObject(record.getJSONObject("command").toString());}return send(owner,deviceId,command,dispatch);
  }
  synchronized void reconcile(String owner,JSONArray jobs) throws Exception {
    load();boolean changed=false;
    for(int i=0;i<jobs.length();i++){JSONObject job=jobs.getJSONObject(i);String id=job.getString("commandId");JSONObject record=find(owner,id);if(record==null||flights.containsKey(owner+":"+id))continue;String phase=job.getString("phase"),next="completed".equals(phase)?"completed":"failed".equals(phase)?"failed":"accepted";if(!next.equals(record.getString("phase"))||record.has("error")){record.put("phase",next);record.remove("error");changed=true;}}
    if(changed)save();
  }
}
