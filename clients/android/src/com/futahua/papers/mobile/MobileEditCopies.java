package com.futahua.papers.mobile;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

/** Phone-owned originals and editable copies, never the verified read cache. */
final class MobileEditCopies {
  private final File root,workingRoot;
  MobileEditCopies(Context context) { root = new File(context.getFilesDir(), "remote-edits"); root.mkdirs();workingRoot=new File(context.getExternalFilesDir(null),"Papers/Working files");workingRoot.mkdirs(); }
  private File directory(String id) throws IOException {
    if (!id.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")) throw new IOException("Invalid local edit identity");
    return new File(root, id);
  }
  JSONObject create(String owner, JSONObject session, String name, File download) throws Exception {
    if (!owner.matches("[a-f0-9-]{36}") || !session.getString("id").matches("[a-f0-9-]{36}") || !"editing".equals(session.getString("phase")) || !session.getString("sourceSha256").matches("[a-f0-9]{64}")) throw new IOException("A checked edit session is required");
    String id = UUID.randomUUID().toString(); File folder = directory(id);
    if (!folder.mkdir()) throw new IOException("Working-copy folder could not be created");
    File original = new File(folder,"original.bin"); copy(download,original);
    if (!digest(original).equals(session.getString("sourceSha256"))) throw new IOException("Downloaded source changed; retained copy needs recovery");
    String workingName=name.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]","_");if(workingName.isEmpty()||workingName.equals(".")||workingName.equals(".."))workingName="Untitled";
    File editable=new File(workingRoot,id);JSONArray folders=new JSONArray(),parts=session.optJSONArray("originalParts");if(parts!=null)for(int i=0;i<parts.length()-1;i++){String part=parts.getString(i).replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]","_");if(part.isEmpty()||part.equals(".")||part.equals(".."))part="_";folders.put(part);editable=new File(editable,part);}if(!editable.mkdirs())throw new IOException("Working folder unavailable");copy(original,new File(editable,workingName));
    JSONObject record = new JSONObject().put("id",id).put("ownerId",owner).put("session",session).put("name",name).put("workingName",workingName).put("workingFolders",folders).put("phase","editing");
    retain(record); return record;
  }
  JSONObject read(String id) throws Exception {
    try(InputStream input = new AtomicFile(new File(directory(id),"edit.json")).openRead()) {
      ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
      while((count=input.read(buffer))!=-1) { if(bytes.size()+count>65536)throw new IOException("Edit journal is too large"); bytes.write(buffer,0,count); }
      JSONObject record = new JSONObject(bytes.toString("UTF-8"));
      if(!id.equals(record.getString("id")) || !record.getString("ownerId").matches("[a-f0-9-]{36}"))throw new IOException("Edit journal requires recovery");
      return record;
    }
  }
  JSONArray list(String owner) throws Exception {return list(owner,true);}
  JSONArray list(String owner,boolean verifyChanges) throws Exception {
    JSONArray records = new JSONArray(); File[] folders=root.listFiles(); if(folders==null)return records;
    for(File folder:folders)if(folder.isDirectory() && new File(folder,"edit.json").isFile()) {
      JSONObject record=read(folder.getName()); if(owner.isEmpty()||owner.equals(record.getString("ownerId"))){if(verifyChanges&&"saved".equals(record.getString("phase")))record.put("newerLocalEdits",!digest(working(record.getString("id"))).equals(record.optString("editedSha256")));records.put(record);}
    }
    return records;
  }
  File working(String id) throws Exception {
    JSONObject record=read(id);if("preparing".equals(record.getString("phase")))throw new IOException("Working-copy preparation requires recovery");String name=record.optString("workingName","working.bin");if(!new File(name).getName().equals(name)||name.equals(".")||name.equals(".."))throw new IOException("Invalid working filename");File base=record.has("workingName")?workingRoot:root;File file=new File(new File(base,id),name);
    File directory=new File(base,id);JSONArray folders=record.optJSONArray("workingFolders");if(folders!=null)for(int i=0;i<folders.length();i++){String part=folders.getString(i);if(part.equals(".")||part.equals("..")||part.contains("/")||part.contains("\\"))throw new IOException("Invalid working folder");directory=new File(directory,part);}file=new File(directory,name);
    File expected = new File(base.getCanonicalFile(),id);expected=new File(expected,folders==null?"":String.join(File.separator,java.util.stream.IntStream.range(0,folders.length()).mapToObj(i->folders.optString(i)).toArray(String[]::new)));expected=new File(expected,name);
    if(!file.isFile() || !file.getCanonicalFile().equals(expected))throw new IOException("Working copy is unavailable");
    return file;
  }
  void removeUnlinked(String id)throws Exception {
    JSONObject record=read(id);File[] roots=record.has("workingName")?new File[]{new File(workingRoot,id),directory(id)}:new File[]{directory(id)};
    for(File folder:roots){if(java.nio.file.Files.isSymbolicLink(folder.toPath()))throw new IOException("Working folder identity changed");if(!folder.exists())continue;java.util.List<java.nio.file.Path> entries;try(java.util.stream.Stream<java.nio.file.Path> stream=java.nio.file.Files.walk(folder.toPath())){entries=stream.sorted(java.util.Comparator.reverseOrder()).collect(java.util.stream.Collectors.toList());}for(java.nio.file.Path file:entries)java.nio.file.Files.delete(file);}
  }
  File workingRoot(){return workingRoot;}
  void retain(JSONObject record) throws Exception {
    AtomicFile file=new AtomicFile(new File(directory(record.getString("id")),"edit.json")); FileOutputStream stream=null;
    try { stream=file.startWrite(); stream.write(record.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(stream); }
    catch(Exception error){if(stream!=null)file.failWrite(stream);throw error;}
  }
  void nextRevision(String id,JSONObject session)throws Exception {
    JSONObject record=read(id),previous=record.getJSONObject("session");
    if(!record.getString("phase").equals("saved")||!session.getString("sourceVersion").equals(previous.getString("savedVersion"))||!session.getString("sourceSha256").equals(record.getString("editedSha256"))||!session.optString("assignmentId").equals(previous.optString("assignmentId")))throw new IOException("Next revision differs from save receipt");
    File baseline=new File(directory(id),session.getString("id")+".baseline");copy(snapshot(id),baseline);
    record.put("session",session).put("phase","editing").put("baseline",baseline.getName());for(String key:new String[]{"saveId","uploadId","editedSha256","editedBytes"})record.remove(key);retain(record);
  }
  JSONObject importCopy(String previousId,InputStream input) throws Exception {
    JSONObject previous=read(previousId);
    if(!"editing".equals(previous.getString("phase"))||previous.has("saveId")||previous.has("importedCopyId"))throw new IOException("Choose the current editable copy before importing another file");
    String id=UUID.randomUUID().toString();File folder=directory(id);if(!folder.mkdir())throw new IOException("Import folder could not be created");
    JSONObject record=new JSONObject().put("id",id).put("ownerId",previous.getString("ownerId")).put("session",new JSONObject(previous.getJSONObject("session").toString())).put("name",previous.getString("name")).put("phase","preparing").put("importedFrom",previousId);retain(record);
    File original=new File(directory(previousId),"original.bin");
    if(!digest(original).equals(record.getJSONObject("session").getString("sourceSha256")))throw new IOException("Retained original requires recovery");
    copy(original,new File(folder,"original.bin"));
    try(FileOutputStream output=new FileOutputStream(new File(folder,"working.bin"))){byte[] buffer=new byte[65536];long bytes=0;int count;while((count=input.read(buffer))!=-1){if(Thread.currentThread().isInterrupted())throw new IOException("Import paused; retained copies are available");bytes+=count;if(bytes>64L*1024*1024*1024)throw new IOException("Edited copy exceeds supported size");output.write(buffer,0,count);}output.getFD().sync();}
    record.put("phase","editing");retain(record);previous.put("importedCopyId",id);retain(previous);return record;
  }
  synchronized JSONObject prepare(String id) throws Exception {
    JSONObject record=read(id);if(record.has("saveId"))return record;
    if(record.has("importedCopyId"))throw new IOException("Use the imported edited copy. This previous working file is retained for recovery.");
    File working=working(id);String hash=digest(working);
    if(hash.equals(record.getJSONObject("session").getString("sourceSha256")))throw new IOException("No changes were found in this working copy. Your editor may have saved a separate copy; retain that file before saving back.");
    String saveId=UUID.randomUUID().toString();File snapshot=new File(directory(id),saveId+".save");copy(working,snapshot);
    if(!hash.equals(digest(snapshot))||!hash.equals(digest(working)))throw new IOException("Working copy changed while preparing; retained copies are available for recovery");
    record.put("saveId",saveId).put("editedSha256",hash).put("editedBytes",snapshot.length()).put("phase","saving");retain(record);return record;
  }
  void carry(String previousId,String nextId) throws Exception {
    JSONObject previous=read(previousId),next=read(nextId);
    if(!"saved".equals(previous.getString("phase"))||!"editing".equals(next.getString("phase"))||!previous.getString("ownerId").equals(next.getString("ownerId"))||!previous.getJSONObject("session").getString("resourceId").equals(next.getJSONObject("session").getString("resourceId"))||!previous.getJSONObject("session").getString("savedVersion").equals(next.getJSONObject("session").getString("sourceVersion")))throw new IOException("Continued session does not match the saved source");
    File source=working(previousId),target=working(nextId);next.put("phase","preparing");retain(next);
    String expected=digest(source);File retained=new File(directory(nextId),"continued-"+UUID.randomUUID()+".bin");copy(source,retained);
    if(!expected.equals(digest(retained))||!expected.equals(digest(source)))throw new IOException("Local edits changed while continuing; both copies retained");
    AtomicFile file=new AtomicFile(target);FileOutputStream output=null;
    try{output=file.startWrite();try(InputStream input=new FileInputStream(retained)){byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);}file.finishWrite(output);}
    catch(Exception error){if(output!=null)file.failWrite(output);throw error;}
    if(!expected.equals(digest(target)))throw new IOException("Continued working copy requires recovery");next.put("phase","editing");retain(next);
  }
  File snapshot(String id) throws Exception {
    JSONObject record=read(id);String saveId=record.getString("saveId");
    if(!saveId.matches("[a-f0-9-]{36}"))throw new IOException("Invalid save identity");
    File file=new File(directory(id),saveId+".save");
    if(file.length()!=record.getLong("editedBytes")||!digest(file).equals(record.getString("editedSha256")))throw new IOException("Retained save snapshot requires recovery");return file;
  }
  static void copy(File source,File destination) throws Exception {
    if(destination.exists())throw new IOException("Working-copy destination already exists");
    try(InputStream input=new FileInputStream(source);FileOutputStream output=new FileOutputStream(destination)) {
      byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);output.getFD().sync();
    }
  }
  static String digest(File file) throws Exception {
    MessageDigest hash=MessageDigest.getInstance("SHA-256");try(InputStream input=new FileInputStream(file)){byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)hash.update(buffer,0,count);}
    StringBuilder text=new StringBuilder();for(byte value:hash.digest())text.append(String.format(java.util.Locale.ROOT,"%02x",value&255));return text.toString();
  }
}
