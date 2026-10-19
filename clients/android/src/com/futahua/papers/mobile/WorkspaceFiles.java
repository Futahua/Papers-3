package com.futahua.papers.mobile;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.UUID;

/** Native counterpart of workspaceFiles.ts; same checked journal and file contract. */
final class WorkspaceFiles {
  private static WorkspaceFiles instance;
  static synchronized WorkspaceFiles get(Context context){if(instance==null)instance=new WorkspaceFiles(context);return instance;}
  private final Context context;private final File root;private final java.util.Map<String,String> verifiedContent=new java.util.HashMap<>();
  private String journalStamp,journalRaw,journalRevision;
  private static String journalStamp(File target)throws Exception {
    // AtomicFile may restore its backup on read; never cache through that recovery.
    if(new File(target.getPath()+".bak").exists())return null;
    try {
      java.nio.file.attribute.BasicFileAttributes s=Files.readAttributes(target.toPath(),java.nio.file.attribute.BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
      if(!s.isRegularFile()||s.isSymbolicLink())throw new IOException("Workspace journal was replaced.");
      android.system.StructStat nativeStat=android.system.Os.lstat(target.getPath());
      return s.fileKey()+":"+s.size()+":"+s.lastModifiedTime()+":"+nativeStat.st_ctime;
    }catch(java.nio.file.NoSuchFileException absent){return "absent";}
  }
  private WorkspaceFiles(Context context){this.context=context.getApplicationContext();root=new File(Environment.getExternalStorageDirectory(),"Documents/Papers Workspaces");}
  private static String id(String value)throws IOException {if(!value.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}")||value.equals(".")||value.equals(".."))throw new IOException("Invalid workspace identity.");return value;}
  private static String hash(String value)throws IOException {if(!value.matches("[a-f0-9]{64}"))throw new IOException("Invalid content hash.");return value;}
  private static String name(String value)throws IOException {if(value.trim().isEmpty()||value.length()>220||value.matches(".*[<>:\"/\\\\|?*\\x00-\\x1f].*")||value.endsWith(".")||value.endsWith(" ")||value.matches("(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\..*)?"))throw new IOException("Invalid workspace filename.");return value;}
  private File directory(String... parts)throws Exception {File current=root;if(!current.exists()&&!current.mkdirs())throw new IOException("Workspace storage is unavailable.");if(Files.isSymbolicLink(current.toPath())||!current.isDirectory())throw new IOException("Workspace storage was replaced.");for(String part:parts){current=new File(current,part);if(!current.exists()&&!current.mkdir())throw new IOException("Workspace directory could not be created.");if(Files.isSymbolicLink(current.toPath())||!current.isDirectory())throw new IOException("Workspace directory was replaced.");}return current;}
  private static String read(File file)throws Exception {return new String(new AtomicFile(file).readFully(),StandardCharsets.UTF_8);}
  private static void write(File file,JSONObject value)throws Exception {AtomicFile atomic=new AtomicFile(file);FileOutputStream stream=atomic.startWrite();try{stream.write(value.toString().getBytes(StandardCharsets.UTF_8));atomic.finishWrite(stream);}catch(Exception error){atomic.failWrite(stream);throw error;}}
  private static String digest(File file)throws Exception {MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] buffer=new byte[1024*1024];for(int n;(n=in.read(buffer))!=-1;)digest.update(buffer,0,n);}return PhonePeerServer.hex(digest.digest());}
  private static String stamp(File file)throws Exception {java.nio.file.attribute.BasicFileAttributes value=Files.readAttributes(file.toPath(),java.nio.file.attribute.BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);if(!value.isRegularFile()||value.isSymbolicLink())throw new IOException("The working file was replaced.");return value.size()+":"+value.lastModifiedTime()+":"+value.creationTime()+":"+String.valueOf(value.fileKey());}
  private File source(String value)throws Exception {if(value.startsWith("content://")){File file=PhoneStorage.file(Uri.parse(value));if(file==null)throw new IOException("Choose a file in phone storage.");return file;}File file=new File(value);if(!file.isAbsolute())throw new IOException("An absolute workspace source is required.");return file;}
  private static void sync(File file)throws Exception {try(RandomAccessFile handle=new RandomAccessFile(file,"rw")){handle.getFD().sync();}}
  private boolean contentAvailable(String hash)throws Exception {
    File file=new File(directory("content"),hash);if(!file.exists()){verifiedContent.remove(hash);return false;}
    String before=stamp(file);if(before.equals(verifiedContent.get(hash)))return true;
    String actual=digest(file),after=stamp(file);if(!before.equals(after))throw new IOException("Workspace content changed while being checked.");
    if(!actual.equals(hash)){Files.move(file.toPath(),new File(directory("recovery"),hash+"-"+UUID.randomUUID()).toPath());verifiedContent.remove(hash);return false;}
    verifiedContent.put(hash,after);return true;
  }
  private JSONObject capture(File source)throws Exception {
    String before=stamp(source);long size=source.length();File temp=new File(directory("content"),".capture-"+UUID.randomUUID());
    try {
      Files.copy(source.toPath(),temp.toPath());sync(temp);String hash=digest(temp);
      if(!before.equals(stamp(source)))throw new IOException("The file changed while being captured.");
      File target=new File(directory("content"),hash);if(!contentAvailable(hash))Files.move(temp.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE);
      verifiedContent.put(hash,stamp(target));return new JSONObject().put("hash",hash).put("size",size).put("stamp",before);
    }finally {temp.delete();}
  }
  /** Same contract as workspaceFiles.ts tidyContent: "<hash> (n)" copies left by simultaneous pushes
   * are removed once the original is verified, become the original when it is missing, and move to
   * recovery (never deleted) when their bytes do not match their name. */
  private JSONObject tidyContent()throws Exception {
    File folder=directory("content");int adopted=0,removed=0,quarantined=0;File[] names=folder.listFiles();if(names==null)throw new IOException("Workspace content cannot be read.");
    for(File copy:names){
      java.util.regex.Matcher match=java.util.regex.Pattern.compile("^([a-f0-9]{64}) \\(\\d+\\)$").matcher(copy.getName());if(!match.matches()||!copy.isFile()||Files.isSymbolicLink(copy.toPath()))continue;
      String hash=match.group(1);
      if(!digest(copy).equals(hash)){Files.move(copy.toPath(),new File(directory("recovery"),copy.getName()+"-"+UUID.randomUUID()).toPath());quarantined++;continue;}
      if(contentAvailable(hash)){if(!copy.delete())throw new IOException("A duplicate content copy could not be removed.");removed++;continue;}
      Files.move(copy.toPath(),new File(folder,hash).toPath(),StandardCopyOption.ATOMIC_MOVE);verifiedContent.remove(hash);if(contentAvailable(hash))adopted++;
    }
    return new JSONObject().put("adopted",adopted).put("removed",removed).put("quarantined",quarantined);
  }
  synchronized JSONObject call(JSONObject request)throws Exception {
    String operation=request.getString("operation");
    if(operation.equals("journal-load")||operation.equals("journal-save")){
      File target=new File(context.getFilesDir(),"workspace-journal.json");String before=journalStamp(target),raw,revision;
      // Save always reads durable bytes: an external replacement cannot bypass CAS.
      if(operation.equals("journal-load")&&before!=null&&before.equals(journalStamp)){
        raw=journalRaw;revision=journalRevision;
      }else{
        journalStamp=null;
        try{raw=read(target);}catch(FileNotFoundException missing){raw="";}
        revision=raw.isEmpty()?"absent":PhonePeerServer.hash(raw.getBytes(StandardCharsets.UTF_8));
        if(before!=null&&before.equals(journalStamp(target))){journalRaw=raw;journalRevision=revision;journalStamp=before;}
      }
      // The page keeps its last copy: when it already holds this revision, nothing is rebuilt or sent.
      if(operation.equals("journal-load")&&revision.equals(request.optString("known",null)))return new JSONObject().put("unchanged",true).put("revision",revision);
      if(operation.equals("journal-load"))return new JSONObject().put("state",raw.isEmpty()?JSONObject.NULL:new JSONObject(raw)).put("revision",revision);
      if(!revision.equals(request.getString("revision")))return new JSONObject().put("ok",false).put("code","STALE_REVISION").put("revision",revision);
      JSONObject value=request.getJSONObject("state");journalStamp=null;write(target,value);return new JSONObject().put("ok",true).put("revision",PhonePeerServer.hash(value.toString().getBytes(StandardCharsets.UTF_8)));
    }
    if(operation.equals("content-root")){File folder=directory("content");String base=Environment.getExternalStorageDirectory().getCanonicalPath();String uri=android.provider.DocumentsContract.buildDocumentUri("com.android.externalstorage.documents","primary:"+folder.getCanonicalPath().substring(base.length()+1)).toString();return new JSONObject().put("path",folder.getPath()).put("transportPath",PhoneStorage.outward(uri));}
    if(operation.equals("storage-status")){File folder=directory("content");android.os.StatFs volume=new android.os.StatFs(folder.getPath());long bytes=0;int count=0;File[] entries=folder.listFiles();if(entries==null)throw new IOException("Sync content cannot be read.");for(File item:entries)if(item.getName().matches("[a-f0-9]{64}")&&!Files.isSymbolicLink(item.toPath())&&item.isFile()){bytes+=item.length();count++;}return new JSONObject().put("at",System.currentTimeMillis()).put("volume","Internal storage").put("totalBytes",volume.getTotalBytes()).put("freeBytes",volume.getAvailableBytes()).put("syncBytes",bytes).put("syncFiles",count);}
    if(operation.equals("cache-list")){JSONArray items=new JSONArray();File[] files=directory("content").listFiles();if(files==null)throw new IOException("Content cannot be listed.");for(File item:files)if(item.getName().matches("[a-f0-9]{64}")&&!Files.isSymbolicLink(item.toPath())&&item.isFile())items.put(new JSONObject().put("hash",item.getName()).put("size",item.length()).put("at",Files.readAttributes(item.toPath(),java.nio.file.attribute.BasicFileAttributes.class).creationTime().toMillis()));return new JSONObject().put("items",items);}
    if(operation.equals("cache-evict"))return evict(request);
    if(operation.equals("incoming-root"))return new JSONObject().put("path",directory("incoming").getPath());
    if(operation.equals("enumerate")){File file=source(request.getString("path"));if(Files.isSymbolicLink(file.toPath()))throw new IOException("Symbolic links are not imported recursively.");if(file.isFile())return new JSONObject().put("kind","file").put("name",file.getName());if(!file.isDirectory())throw new IOException("Choose a file or folder.");JSONArray entries=new JSONArray();File[] children=file.listFiles();if(children==null)throw new IOException("Folder cannot be read.");for(File child:children)if(!Files.isSymbolicLink(child.toPath())&&(child.isFile()||child.isDirectory()))entries.put(new JSONObject().put("path",child.getPath()).put("name",child.getName()).put("kind",child.isDirectory()?"folder":"file"));return new JSONObject().put("kind","folder").put("name",file.getName()).put("entries",entries);}
    if(operation.equals("content-tidy"))return tidyContent();
    if(operation.equals("content-check")){String hash=hash(request.getString("hash"));File target=new File(directory("content"),hash);boolean available=contentAvailable(hash);JSONObject result=new JSONObject().put("available",available);if(available)result.put("path",target.getPath()).put("size",target.length());return result;}
    String workspace=id(request.getString("workspaceId")),entry=id(request.getString("entryId"));File folder=directory(workspace,"entries",entry),recordFile=new File(folder,".binding.json");JSONObject record;try{record=new JSONObject(read(recordFile));}catch(FileNotFoundException missing){record=null;}
    String name=name(record==null?request.getString("name"):record.getString("name"));File target=new File(folder,record==null?name:name(record.getString("name")));
    if(operation.equals("cache-protect")){if(record!=null){record.put("cacheProtected",true);write(recordFile,record);}return new JSONObject().put("ok",true);}
    if(record!=null&&record.has("pending")&&record.getJSONObject("pending").isNull("versionId")&&!target.exists()){
      String pendingHash=hash(record.getJSONObject("pending").getString("hash"));if(contentAvailable(pendingHash)){File temporary=new File(folder,".import-"+UUID.randomUUID());try{Files.copy(new File(directory("content"),pendingHash).toPath(),temporary.toPath());sync(temporary);if(target.exists())throw new IOException("The import target changed.");Files.move(temporary.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE);}finally{temporary.delete();}}
    }
    if(record!=null&&record.has("pending")&&target.isFile()&&digest(target).equals(record.getJSONObject("pending").getString("hash"))){JSONObject pending=record.getJSONObject("pending");record.put("hash",pending.getString("hash")).put("versionId",pending.opt("versionId")).put("stamp",stamp(target));record.remove("pending");write(recordFile,record);}
    if(target.exists())stamp(target);
    if(operation.equals("path"))return new JSONObject().put("path",target.getPath()).put("available",target.isFile()).put("versionId",record==null?JSONObject.NULL:record.opt("versionId")).put("hash",record==null?JSONObject.NULL:record.opt("hash"));
    if(operation.equals("import")||operation.equals("capture")){
      File input=operation.equals("import")&&record==null?source(request.getString("path")):target;JSONObject captured=record!=null&&!record.isNull("hash")&&record.optString("stamp").equals(stamp(input))&&contentAvailable(record.getString("hash"))?new JSONObject().put("hash",record.getString("hash")).put("size",input.length()):capture(input);
      // Same bytes, new file times: remember them, or every later check copies the whole file again.
      if(operation.equals("capture")&&record!=null&&!record.has("pending")&&captured.has("stamp")&&record.optString("hash").equals(captured.getString("hash"))&&!record.optString("stamp").equals(captured.getString("stamp"))){record.put("stamp",captured.getString("stamp"));write(recordFile,record);}
      if(operation.equals("import")&&record==null){String initialHash=captured.getString("hash");write(recordFile,new JSONObject().put("name",name).put("hash",JSONObject.NULL).put("versionId",JSONObject.NULL).put("pending",new JSONObject().put("hash",initialHash).put("versionId",JSONObject.NULL)));
        File temporary=new File(folder,".import-"+UUID.randomUUID());try{Files.copy(new File(directory("content"),initialHash).toPath(),temporary.toPath());sync(temporary);if(target.exists())throw new IOException("An unknown file already occupies this import target.");Files.move(temporary.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE);}finally{temporary.delete();}
        write(recordFile,new JSONObject().put("name",name).put("hash",initialHash).put("versionId",JSONObject.NULL).put("stamp",stamp(target)));}
      return captured.put("path",target.getPath()).put("baseVersion",record==null?JSONObject.NULL:record.opt("versionId")).put("baseHash",record==null?JSONObject.NULL:record.opt("hash"));
    }
    String version=id(request.getString("versionId")),actual=target.isFile()?digest(target):null;
    if(operation.equals("delete")){
      if(record==null)return new JSONObject().put("ok",true);
      if(actual!=null&&!actual.equals(record.optString("hash")))return new JSONObject().put("ok",false).put("localChange",capture(target)).put("baseVersion",record.opt("versionId"));
      if(actual!=null)Files.move(target.toPath(),new File(directory(workspace,"bin",entry),version).toPath());
      record.put("hash",JSONObject.NULL).put("versionId",version);write(recordFile,record);return new JSONObject().put("ok",true);
    }
    if(!operation.equals("publish"))throw new IOException("Unknown workspace file operation.");
    String hash=hash(request.getString("hash"));File content=new File(directory("content"),hash);if(!contentAvailable(hash))throw new IOException("Waiting for workspace file contents.");
    if(actual!=null&&!actual.equals(record==null?null:record.optString("hash"))&&!actual.equals(hash))return new JSONObject().put("ok",false).put("localChange",capture(target)).put("baseVersion",record==null?JSONObject.NULL:record.opt("versionId"));
    String beforePublication=target.exists()?stamp(target):null;
    JSONObject next=record==null?new JSONObject().put("name",name).put("hash",JSONObject.NULL).put("versionId",JSONObject.NULL):record;
    next.put("pending",new JSONObject().put("hash",hash).put("versionId",version));write(recordFile,next);
    if(!hash.equals(actual)){File temp=new File(folder,".publish-"+UUID.randomUUID());try{Files.copy(content.toPath(),temp.toPath());sync(temp);String latest=target.exists()?stamp(target):null;if(!java.util.Objects.equals(latest,beforePublication))return new JSONObject().put("ok",false).put("localChange",target.exists()?capture(target):true).put("baseVersion",record==null?JSONObject.NULL:record.opt("versionId"));Files.move(temp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}finally{temp.delete();}}
    next.remove("pending");next.put("hash",hash).put("versionId",version).put("stamp",stamp(target));write(recordFile,next);return new JSONObject().put("ok",true).put("path",target.getPath()).put("hash",hash).put("versionId",version);
  }
  private JSONObject evict(JSONObject request)throws Exception {
    String hash=hash(request.getString("hash"));JSONArray expected=request.getJSONArray("bindings");
    java.util.ArrayList<File> targets=new java.util.ArrayList<>(),moved=new java.util.ArrayList<>();
    java.util.ArrayList<java.io.RandomAccessFile> handles=new java.util.ArrayList<>();
    java.util.Map<String,?> viewed=context.getSharedPreferences("shared-file-views",0).getAll();
    long bytes=0;boolean completed=false;
    try{
      File[] scopes=root.listFiles();if(scopes==null)throw new IOException("Workspace storage unavailable.");
      for(File scope:scopes){if(!scope.isDirectory()||Files.isSymbolicLink(scope.toPath()))continue;File entries=new File(scope,"entries");if(!entries.isDirectory()||Files.isSymbolicLink(entries.toPath()))continue;File[] children=entries.listFiles();if(children==null)throw new IOException("Working copies unavailable.");
        for(File entry:children){if(!entry.isDirectory()||Files.isSymbolicLink(entry.toPath()))continue;File metadata=new File(entry,".binding.json");if(!metadata.isFile())continue;JSONObject record=new JSONObject(read(metadata));if(hash.equals(record.optJSONObject("pending")==null?null:record.optJSONObject("pending").optString("hash")))throw new IOException("An unfinished save is protected.");if(!hash.equals(record.optString("hash")))continue;
          boolean match=false;for(int i=0;i<expected.length();i++){JSONObject value=expected.getJSONObject(i);if(scope.getName().equals(value.getString("workspaceId"))&&entry.getName().equals(value.getString("entryId"))&&record.optString("versionId").equals(value.getString("versionId")))match=true;}
          if(!match||record.has("pending")||record.optBoolean("cacheProtected"))throw new IOException("A working copy is protected.");
          File file=new File(entry,name(record.getString("name")));if(file.exists()){if(Files.isSymbolicLink(file.toPath())||!file.isFile()||viewed.containsValue(file.getCanonicalPath()))throw new IOException("An opened file is protected.");targets.add(file);}
        }
      }
      File content=new File(directory("content"),hash);if(content.exists())targets.add(content);
      for(File target:targets){if(Files.isSymbolicLink(target.toPath())||!target.isFile())throw new IOException("File identity changed.");java.io.RandomAccessFile handle=new java.io.RandomAccessFile(target,"rw");handles.add(handle);if(handle.getChannel().tryLock()==null)throw new IOException("A file is busy.");if(!hash.equals(digest(target)))throw new IOException("A local edit is protected.");bytes+=target.length();}
      for(File target:targets){File temporary=new File(target.getParentFile(),".cache-evict-"+UUID.randomUUID());Files.move(target.toPath(),temporary.toPath(),StandardCopyOption.ATOMIC_MOVE);moved.add(temporary);}
      for(File temporary:moved)if(!hash.equals(digest(temporary)))throw new IOException("A local edit is protected.");
      for(File temporary:moved)Files.delete(temporary.toPath());completed=true;verifiedContent.remove(hash);return new JSONObject().put("ok",true).put("bytes",bytes);
    }catch(Exception error){return new JSONObject().put("ok",false).put("bytes",0).put("error",error.getMessage()==null?"Cache removal deferred.":error.getMessage());}
    finally{for(java.io.RandomAccessFile handle:handles)try{handle.close();}catch(Exception ignored){}if(!completed)for(int i=0;i<moved.size();i++)try{if(moved.get(i).exists()&&!targets.get(i).exists())Files.move(moved.get(i).toPath(),targets.get(i).toPath(),StandardCopyOption.ATOMIC_MOVE);}catch(Exception ignored){}}
  }
}
