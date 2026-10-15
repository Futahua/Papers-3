package com.futahua.papers.mobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.database.Cursor;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.util.UUID;
import java.util.concurrent.*;

/** Public copies go to an explicitly granted phone folder, after existing transfer verification. */
final class PhoneDownloads {
 private static PhoneDownloads instance;
 static synchronized PhoneDownloads get(Context c){if(instance==null)instance=new PhoneDownloads(c.getApplicationContext());return instance;}
 private final Context context;private final ExecutorService worker=Executors.newSingleThreadExecutor();private JSONObject batch;private volatile boolean paused;private String activeJob;
 private PhoneDownloads(Context c){context=c;try{File f=new File(c.getFilesDir(),"phone-download-batch.json");if(f.exists()){batch=new JSONObject(new String(java.nio.file.Files.readAllBytes(f.toPath()),java.nio.charset.StandardCharsets.UTF_8));if(!"completed".equals(batch.optString("phase")))batch.put("phase","paused");}}catch(Exception ignored){}}
 JSONObject folder() throws Exception {
  String value=context.getSharedPreferences("downloads",0).getString("tree","");JSONObject result=new JSONObject().put("uri",value).put("valid",false).put("name","Choose a phone folder");if(value.isEmpty())return result;
  try{Uri tree=Uri.parse(value),root=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));try(Cursor q=context.getContentResolver().query(root,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_FLAGS},null,null,null)){if(q!=null&&q.moveToFirst())result.put("name",q.getString(0)).put("valid",(q.getLong(1)&DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE)!=0);}}catch(Exception ignored){}return result;
 }
 JSONObject keepFolder(Uri tree,int flags) throws Exception {context.getContentResolver().takePersistableUriPermission(tree,flags&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));String previous=context.getSharedPreferences("downloads",0).getString("tree","");context.getSharedPreferences("downloads",0).edit().putString("tree",tree.toString()).commit();JSONObject chosen=folder();if(!chosen.getBoolean("valid")){context.getSharedPreferences("downloads",0).edit().putString("tree",previous).commit();throw new IOException("That folder is not writable. Previous download folder kept.");}return chosen;}
 synchronized JSONObject call(JSONObject request) throws Exception {
  String op=request.getString("operation");if(op.equals("download-folder"))return folder();
  if(op.equals("public-download-status"))return summary();
  if(op.equals("public-download-pause")){paused=true;if(batch!=null&&!"completed".equals(batch.optString("phase"))){batch.put("phase","paused");persist();}return batch==null?new JSONObject():new JSONObject(batch.toString());}
  if(op.equals("public-download-start")){
   if(batch!=null&&("transferring".equals(batch.optString("phase"))||"verifying".equals(batch.optString("phase"))||"saving".equals(batch.optString("phase"))||"paused".equals(batch.optString("phase"))))throw new IOException("Finish or resume the existing download first.");
   JSONObject destination=folder();if(!destination.getBoolean("valid"))throw new IOException("Choose a writable Download folder in the device menu first.");
   JSONArray items=request.getJSONArray("items");if(items.length()==0)throw new IOException("Select files or a folder first.");long total=0;for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);clean(item.getString("relative"));total+=item.getJSONObject("entry").getLong("size");}
   batch=new JSONObject().put("id",UUID.randomUUID().toString()).put("items",items).put("destination",destination).put("phase","transferring").put("total",total).put("bytes",0).put("index",0).put("count",items.length()).put("file","");
  }else if(op.equals("public-download-resume")){if(batch==null)throw new IOException("No download to resume.");if(!"paused".equals(batch.optString("phase"))&&!"failed".equals(batch.optString("phase")))return new JSONObject(batch.toString());JSONObject destination=folder();if(!destination.getBoolean("valid")||!destination.getString("uri").equals(batch.getJSONObject("destination").getString("uri")))throw new IOException("The original download folder is unavailable. Restore it in the device menu.");batch.remove("error");batch.put("phase","transferring");}else throw new IOException("Unknown download action.");
  paused=false;persist();final String id=batch.getString("id");worker.submit(()->run(id));return summary();
 }
 private void run(String id){try{
  for(;;){JSONObject item;int index; synchronized(this){if(paused||batch==null||!id.equals(batch.optString("id")))return;index=batch.getInt("index");JSONArray items=batch.getJSONArray("items");if(index>=items.length()){batch.put("phase","completed").put("bytes",batch.getLong("total"));persist();return;}item=items.getJSONObject(index);batch.put("file",item.getString("relative"));batch.put("phase","transferring");persist();}
   if(item.optBoolean("directory")){String destination;synchronized(this){destination=batch.getJSONObject("destination").getString("uri");}ensureDirectory(context,Uri.parse(destination),clean(item.getString("relative")));synchronized(this){batch.put("index",index+1);persist();}continue;}
   MobileFiles files=MobileFiles.get(context);JSONObject started=(JSONObject)files.call(new JSONObject().put("operation","download").put("ownerId",item.getString("ownerId")).put("entry",item.getJSONObject("entry")));activeJob=started.getString("id");
   JSONObject job;for(;;){if(paused){files.call(new JSONObject().put("operation","cancel").put("jobId",activeJob));return;}job=(JSONObject)files.call(new JSONObject().put("operation","download-job").put("jobId",activeJob));synchronized(this){long done=0;for(int n=0;n<index;n++)done+=batch.getJSONArray("items").getJSONObject(n).getJSONObject("entry").getLong("size");batch.put("bytes",done+job.getLong("bytes"));batch.put("phase",job.optString("phase").equals("verifying")?"verifying":"transferring");}String phase=job.getString("phase");if(phase.equals("completed"))break;if(phase.equals("failed"))throw new IOException(job.optString("error","Download failed."));Thread.sleep(250);}
   if(paused)return;synchronized(this){batch.put("phase","saving");persist();}
   String destination; synchronized(this){destination=batch.getJSONObject("destination").getString("uri");}
   files.exportDownload(item.getString("ownerId"),item.getJSONObject("entry"),Uri.parse(destination),item.getString("relative"));
   synchronized(this){batch.put("index",index+1);persist();}
  }
 }catch(Exception e){synchronized(this){try{if(batch!=null&&id.equals(batch.optString("id"))){batch.put("phase",paused?"paused":"failed").put("error",e.getMessage()==null?"Download interrupted. Resume to retry.":e.getMessage());persist();}}catch(Exception ignored){}}}}
 private synchronized JSONObject summary()throws Exception {if(batch==null)return new JSONObject().put("phase","idle");JSONObject result=new JSONObject(batch.toString());result.remove("items");return result;}
 static String[] clean(String path)throws IOException {String[] parts=path.split("/",-1);for(String p:parts)if(p.isEmpty()||p.equals(".")||p.equals("..")||p.indexOf('\\')>=0||p.indexOf('\0')>=0)throw new IOException("Invalid download path.");return parts;}
 static Uri ensureDirectory(Context context,Uri tree,String[] parts)throws Exception {Uri parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));for(String part:parts){Uri found=null;Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(parent));try(Cursor q=context.getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)){while(q!=null&&q.moveToNext())if(part.equals(q.getString(1))){if(!DocumentsContract.Document.MIME_TYPE_DIR.equals(q.getString(2)))throw new IOException("A file blocks folder "+part);found=DocumentsContract.buildDocumentUriUsingTree(tree,q.getString(0));break;}}parent=found!=null?found:DocumentsContract.createDocument(context.getContentResolver(),parent,DocumentsContract.Document.MIME_TYPE_DIR,part);if(parent==null)throw new IOException("Cannot create download folder.");}return parent;}
 static Uri export(Context context,File file,Uri tree,String relative)throws Exception {
  String[] parts=clean(relative);Uri parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
  for(int i=0;i<parts.length-1;i++){Uri found=null;Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(parent));try(Cursor q=context.getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)){while(q!=null&&q.moveToNext())if(parts[i].equals(q.getString(1))){if(!DocumentsContract.Document.MIME_TYPE_DIR.equals(q.getString(2)))throw new IOException("A file blocks folder "+parts[i]);found=DocumentsContract.buildDocumentUriUsingTree(tree,q.getString(0));break;}}parent=found!=null?found:DocumentsContract.createDocument(context.getContentResolver(),parent,DocumentsContract.Document.MIME_TYPE_DIR,parts[i]);if(parent==null)throw new IOException("Cannot create download folder.");}
  String name=parts[parts.length-1];java.util.HashSet<String> names=new java.util.HashSet<>();Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(parent));try(Cursor q=context.getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){while(q!=null&&q.moveToNext())names.add(q.getString(0));}String chosen=name;int dot=name.lastIndexOf('.');for(int n=1;names.contains(chosen);n++)chosen=dot>0?name.substring(0,dot)+" ("+n+")"+name.substring(dot):name+" ("+n+")";
  Uri output=DocumentsContract.createDocument(context.getContentResolver(),parent,"application/octet-stream",chosen);if(output==null)throw new IOException("Download folder is not writable.");try(InputStream in=new FileInputStream(file);OutputStream out=context.getContentResolver().openOutputStream(output,"w")){if(out==null)throw new IOException("Cannot write download.");byte[] buffer=new byte[262144];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);}catch(Exception error){try{DocumentsContract.deleteDocument(context.getContentResolver(),output);}catch(Exception ignored){}throw error;}return output;
 }
 private void persist()throws Exception {AtomicFile file=new AtomicFile(new File(context.getFilesDir(),"phone-download-batch.json"));FileOutputStream stream=file.startWrite();try{stream.write(batch.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));file.finishWrite(stream);}catch(Exception e){file.failWrite(stream);throw e;}}
}
