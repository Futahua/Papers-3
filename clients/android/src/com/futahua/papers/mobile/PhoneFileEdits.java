package com.futahua.papers.mobile;

import android.content.Context;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Phone file owner: explicit assignments and checked publication, not directory sync.
 * Byte receiving delegates to the same maintained tus engine as ordinary transfers. */
final class PhoneFileEdits {
 interface Catalog { File resolve(String id)throws Exception; JSONObject entry(File file)throws Exception; }
 private final Context context;private final Object writes;private final File root;private final AtomicFile journal;private final PhoneTusTransfers transfers;
 private JSONObject state;
 PhoneFileEdits(Context context,Object writes)throws Exception {
  this(context,writes,new File(context.getFilesDir(),"file-edits"));
 }
 PhoneFileEdits(Context context,Object writes,File directory)throws Exception {
  this.context=context;this.writes=writes;root=directory;root.mkdirs();journal=new AtomicFile(new File(root,"state.json"));transfers=new PhoneTusTransfers(new File(root,"uploads"));
  try{state=new JSONObject(new String(journal.readFully(),StandardCharsets.UTF_8));}catch(FileNotFoundException empty){state=new JSONObject().put("sessions",new JSONObject()).put("assignments",new JSONObject()).put("uploads",new JSONObject());}
  JSONObject sessions=state.getJSONObject("sessions");Iterator<String> ids=sessions.keys();while(ids.hasNext()){JSONObject s=sessions.getJSONObject(ids.next());if(s.optString("phase").equals("saving"))s.put("phase","uncertain");}persist();
 }
 private void persist()throws Exception {FileOutputStream stream=journal.startWrite();try{stream.write(state.toString().getBytes(StandardCharsets.UTF_8));journal.finishWrite(stream);}catch(Exception e){journal.failWrite(stream);throw e;}}
 private static String sha(File file)throws Exception{return MobileEditCopies.digest(file);}
 private JSONObject assignmentFor(File file)throws Exception {
  JSONObject all=state.getJSONObject("assignments");Iterator<String> keys=all.keys();while(keys.hasNext()){JSONObject a=all.getJSONObject(keys.next());if(!a.optBoolean("active"))continue;File target=assignmentFile(a);if(target!=null&&target.getCanonicalFile().equals(file.getCanonicalFile()))return a;}return null;
 }
 private File assignmentFile(JSONObject assignment)throws Exception{if(!assignment.has("targetId"))return new File(assignment.getString("path"));JSONObject target=PhoneTargets.get(context).resolve(assignment.getString("targetId"));return target.optString("status").equals("present")?PhoneStorage.file(android.net.Uri.parse(target.getString("uri"))):null;}
 private void active(JSONObject session,String device)throws Exception {if(session.has("assignmentId")){JSONObject a=state.getJSONObject("assignments").optJSONObject(session.getString("assignmentId"));if(a==null||!a.optBoolean("active")||!device.equals(a.getString("editorDeviceId")))throw new IOException("Editing assignment stopped. Working copy retained.");}}
 private JSONObject publicSession(JSONObject s)throws Exception {JSONObject r=new JSONObject(s.toString());File source=new File(s.getString("path"));r.put("originalPath",source.getCanonicalPath());for(File root:PhoneStorage.roots()){String base=root.getCanonicalPath(),actual=source.getCanonicalPath();if(actual.startsWith(base+"/")){JSONArray parts=new JSONArray().put(PhoneStorage.name(root));for(String part:actual.substring(base.length()+1).split("/"))parts.put(part);r.put("originalParts",parts);break;}}for(String key:Arrays.asList("path","targetId","nativeIdentity"))r.remove(key);return r;}
 JSONObject assignments(String device,Catalog catalog,JSONArray editors)throws Exception {
  synchronized(writes){JSONArray result=new JSONArray();JSONObject all=state.getJSONObject("assignments");Iterator<String> keys=all.keys();while(keys.hasNext()){JSONObject a=all.getJSONObject(keys.next());try{JSONObject visible=new JSONObject(a.toString());visible.remove("path");visible.put("entry",catalog.entry(assignmentFile(a))).put("mine",device.equals(a.getString("editorDeviceId")));result.put(visible);}catch(Exception inaccessible){}}return new JSONObject().put("ok",true).put("assignments",result).put("editors",editors);}
 }
 JSONObject assignment(String device,JSONObject request,Catalog catalog,JSONArray editors)throws Exception {
  synchronized(writes){JSONObject all=state.getJSONObject("assignments");if(request.optString("action").equals("stop")){JSONObject a=all.getJSONObject(request.getString("id"));catalog.entry(new File(a.getString("path")));a.put("active",false);try{persist();}catch(Exception error){a.put("active",true);throw error;}return new JSONObject().put("id",a.getString("id")).put("active",false);}
   String editor=request.getString("editorDeviceId");boolean allowed=false;for(int i=0;i<editors.length();i++)if(editor.equals(editors.getJSONObject(i).getString("id")))allowed=true;if(!allowed)throw new IOException("Choose an authorized editing device");
   File source=catalog.resolve(request.getString("resourceId"));JSONObject entry=catalog.entry(source);if(!entry.getString("kind").equals("file")||!entry.getString("version").equals(request.getString("sourceVersion")))throw new IOException("Source changed");
   JSONObject previous=assignmentFor(source);if(previous!=null)previous.put("active",false);String id=UUID.randomUUID().toString();JSONObject a=new JSONObject().put("id",id).put("path",source.getCanonicalPath()).put("name",source.getName()).put("targetId",PhoneTargets.get(context).track(source).getString("targetId")).put("editorDeviceId",editor).put("active",true);all.put(id,a);try{persist();}catch(Exception error){all.remove(id);if(previous!=null)previous.put("active",true);throw error;}JSONObject result=new JSONObject(a.toString());result.remove("path");return result;
  }
 }
 JSONObject begin(String device,JSONObject request,Catalog catalog)throws Exception {
  synchronized(writes){File file=catalog.resolve(request.getString("resourceId"));JSONObject entry=catalog.entry(file);if(!entry.getString("kind").equals("file")||!entry.getString("version").equals(request.getString("sourceVersion")))throw new IOException("Source changed");JSONObject assignment=assignmentFor(file);if(assignment!=null&&!device.equals(assignment.getString("editorDeviceId")))throw new IOException("Editing is assigned to another device");
   String hash=sha(file);if(!catalog.entry(file).getString("version").equals(entry.getString("version")))throw new IOException("Source changed while preparing");JSONObject target=PhoneTargets.get(context).track(file);
   String id=UUID.randomUUID().toString();JSONObject s=new JSONObject().put("id",id).put("deviceId",device).put("resourceId",entry.getString("id")).put("sourceVersion",entry.getString("version")).put("sourceSha256",hash).put("path",file.getCanonicalPath()).put("targetId",target.getString("targetId")).put("phase","editing");if(assignment!=null)s.put("assignmentId",assignment.getString("id"));state.getJSONObject("sessions").put(id,s);persist();return publicSession(s);
  }
 }
 private JSONObject session(String device,String id)throws Exception {JSONObject s=state.getJSONObject("sessions").getJSONObject(id);if(!device.equals(s.getString("deviceId")))throw new IOException("Edit session unavailable");return s;}
 private JSONObject upload(String device,String id)throws Exception {JSONObject u=state.getJSONObject("uploads").getJSONObject(id);if(!device.equals(u.getString("deviceId")))throw new IOException("Edit upload unavailable");return u;}
 JSONObject beginUpload(String device,String sessionId,JSONObject request)throws Exception {
  synchronized(writes){JSONObject s=session(device,sessionId);active(s,device);if(!s.getString("phase").equals("editing"))throw new IOException("Resolve previous save first");long size=request.getLong("bytes");String hash=request.getString("sha256");if(size<0||size>512L*1024*1024*1024||!hash.matches("[a-f0-9]{64}"))throw new IOException("Invalid upload");String id=transfers.createEditUpload(device,size,hash);state.getJSONObject("uploads").put(id,new JSONObject().put("id",id).put("deviceId",device).put("sessionId",sessionId).put("bytes",size).put("sha256",hash).put("complete",false));persist();return new JSONObject().put("ok",true).put("uploadId",id);}
 }
 JSONObject uploadStatus(String device,String id)throws Exception {
  synchronized(writes){JSONObject u=upload(device,id);long received=transfers.editInfo(device,id).getOffset();java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");try(InputStream input=transfers.editBytes(device,id)){byte[] b=new byte[65536];for(int n;(n=input.read(b))!=-1;)digest.update(b,0,n);}return new JSONObject(u.toString()).put("receivedBytes",received).put("prefixSha256",PhonePeerServer.hex(digest.digest()));}
 }
 JSONObject append(String device,String id,long offset,long length,InputStream input)throws Exception {
  synchronized(writes){JSONObject u=upload(device,id);active(session(device,u.getString("sessionId")),device);if(u.optBoolean("complete")||length<0||length>4L*1024*1024)throw new IOException("Invalid edit chunk");transfers.appendEdit(device,id,offset,length,input);return new JSONObject().put("ok",true).put("receivedBytes",transfers.editInfo(device,id).getOffset());}
 }
 void seal(String device,String id)throws Exception {synchronized(writes){JSONObject u=upload(device,id),status=uploadStatus(device,id);if(status.getLong("receivedBytes")!=u.getLong("bytes")||!status.getString("prefixSha256").equals(u.getString("sha256")))throw new IOException("Upload verification failed");u.put("complete",true);persist();}}
 JSONObject save(String device,String id,JSONObject request,Catalog catalog)throws Exception {
  synchronized(writes){JSONObject s=session(device,id);String saveId=request.getString("saveId"),uploadId=request.getString("uploadId"),hash=request.getString("sha256");if(!saveId.matches("[a-f0-9-]{36}")||!hash.matches("[a-f0-9]{64}"))throw new IOException("Invalid save identity");
   if(s.has("saveId")){if(!saveId.equals(s.getString("saveId"))||!uploadId.equals(s.getString("uploadId"))||!hash.equals(s.getString("editedSha256")))throw new IOException("Save receipt differs");return publicSession(s);}active(s,device);JSONObject u=upload(device,uploadId);if(!u.optBoolean("complete")||!id.equals(u.getString("sessionId"))||!hash.equals(u.getString("sha256")))throw new IOException("Sealed upload required");
   s.put("saveId",saveId).put("uploadId",uploadId).put("editedSha256",hash).put("phase","saving");persist();File temporary=null;
   try{JSONObject target=PhoneTargets.get(context).resolve(s.getString("targetId"));if(!target.optString("status").equals("present"))throw new IOException("SOURCE_CHANGED");File original=PhoneStorage.file(android.net.Uri.parse(target.getString("uri")));catalog.entry(original);if(!sha(original).equals(s.getString("sourceSha256")))throw new IOException("SOURCE_CHANGED");
    File backup=new File(root,id+"-"+saveId+".before");MobileEditCopies.copy(original,backup);
    temporary=File.createTempFile(".papers-edit-",".part",original.getParentFile());try(InputStream input=transfers.editBytes(device,uploadId);FileOutputStream output=new FileOutputStream(temporary)){byte[] b=new byte[65536];for(int n;(n=input.read(b))!=-1;)output.write(b,0,n);output.getFD().sync();}
    if(!sha(temporary).equals(hash))throw new IOException("Upload changed");active(s,device);JSONObject current=PhoneTargets.get(context).resolve(s.getString("targetId"));if(!current.optString("status").equals("present")||!PhoneStorage.file(android.net.Uri.parse(current.getString("uri"))).equals(original)||!sha(original).equals(s.getString("sourceSha256")))throw new IOException("SOURCE_CHANGED");
    android.system.Os.rename(temporary.getPath(),original.getPath());PhoneTargets.get(context).relocate(original,original);if(!sha(original).equals(hash))throw new IOException("Publication unconfirmed");s.put("phase","saved").put("savedVersion",catalog.entry(original).getString("version")).put("resourceId",catalog.entry(original).getString("id"));
   }catch(Exception error){s.put("phase",error.getMessage()!=null&&error.getMessage().equals("SOURCE_CHANGED")?"conflict":"uncertain").put("message","Both versions retained; inspect the owner before overwriting.");}finally{if(temporary!=null)temporary.delete();}persist();return publicSession(s);
  }
 }
 boolean handle(String method,String route,Map<String,String> query,long length,InputStream input,OutputStream output,String device,Catalog catalog,JSONArray editors)throws Exception {
  if(!route.equals("/v1/files/edits")&&!route.startsWith("/v1/files/edits/"))return false;JSONObject result;
  if(route.equals("/v1/files/edits/assignments")){result=method.equals("GET")?assignments(device,catalog,editors):new JSONObject().put("ok",true).put("assignment",assignment(device,body(input,length),catalog,editors));}
  else if(route.equals("/v1/files/edits")&&method.equals("POST"))result=new JSONObject().put("ok",true).put("session",begin(device,body(input,length),catalog));
  else if(route.equals("/v1/files/edits")&&method.equals("GET")){JSONArray list=new JSONArray();synchronized(writes){Iterator<String> ids=state.getJSONObject("sessions").keys();while(ids.hasNext()){JSONObject s=state.getJSONObject("sessions").getJSONObject(ids.next());if(device.equals(s.getString("deviceId")))list.put(publicSession(s));}}result=new JSONObject().put("ok",true).put("sessions",list);}
  else {String[] p=route.substring("/v1/files/edits/".length()).split("/");if(p.length<2)throw new IOException("Invalid edit route");if(p[0].equals("uploads")){String id=p[1];if(p.length==3&&p[2].equals("seal")&&method.equals("POST")){body(input,length);seal(device,id);result=new JSONObject().put("ok",true);}else if(p.length==2&&method.equals("GET"))result=new JSONObject().put("ok",true).put("upload",uploadStatus(device,id));else if(p.length==2&&method.equals("PUT"))result=append(device,id,Long.parseLong(query.get("offset")),length,input);else throw new IOException("Invalid upload route");}else if(p.length==2&&method.equals("POST")){JSONObject request=body(input,length);if(p[1].equals("uploads"))result=beginUpload(device,p[0],request);else if(p[1].equals("save"))result=new JSONObject().put("ok",true).put("session",save(device,p[0],request,catalog));else throw new IOException("Invalid session route");}else throw new IOException("Invalid edit method");}
  byte[] bytes=result.toString().getBytes(StandardCharsets.UTF_8);output.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: "+bytes.length+"\r\n\r\n").getBytes(StandardCharsets.UTF_8));output.write(bytes);output.flush();return true;
 }
 private static JSONObject body(InputStream input,long size)throws Exception {if(size<0||size>4096)throw new IOException("Edit request too large");byte[] b=new byte[(int)size];new DataInputStream(input).readFully(b);return size==0?new JSONObject():new JSONObject(new String(b,StandardCharsets.UTF_8));}
}
