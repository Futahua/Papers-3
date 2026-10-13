package com.futahua.papers.mobile;

import android.content.Context;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

final class MobileFiles {
  private static MobileFiles instance;
  static synchronized MobileFiles get(Context context) { if (instance == null) instance = new MobileFiles(context.getApplicationContext()); return instance; }
  private final Context context;
  private final File root;
  private final MobileCommandOutbox outbox;
  private final MobileEditCopies editCopies;
  private final Map<String, JSONObject> jobs = new ConcurrentHashMap<>();
  private final Map<String, Future<?>> workers = new ConcurrentHashMap<>();
  private final Map<String, Object> editLocks = new ConcurrentHashMap<>();
  private final ExecutorService downloads = Executors.newFixedThreadPool(2);
  MobileFiles(Context context) { this.context = context; root = new File(context.getFilesDir(), "remote-files"); root.mkdirs(); outbox=new MobileCommandOutbox(root); editCopies=new MobileEditCopies(context); }

  Object call(JSONObject request) throws Exception {
    String operation = request.getString("operation");
    String owner = request.optString("ownerId");
    switch (operation) {
      case "pair": return pair(request.getString("address"), request.getString("code"));
      case "status": joinOwners(); return snapshot();
      case "browse": return browse(owner, request.optString("resourceId"), request.optInt("offset", 0));
      case "download": return download(owner, request.getJSONObject("entry"));
      case "offline": return offline(owner);
      case "edit-list": return editCopies.list(owner);
      case "edit-begin": return beginEdit(owner,request.getJSONObject("entry"));
      case "edit-open": {String id=request.getString("editId");editCopies.working(id);CachedFilesProvider.edit(context,id,editCopies.read(id).getString("name"));return new JSONObject().put("opened",true);}
      case "edit-save": return saveEdit(request.getString("editId"));
      case "edit-continue": return continueEdit(request.getString("editId"));
      case "workspaces": { JSONObject result = json(request(owner, "/v1/workspaces", null, null)); if (!owner.equals(result.getJSONObject("owner").getString("id"))) throw new IOException("Owner identity changed."); return result.getJSONArray("entries"); }
      case "workspace-load": { String id = request.getString("workspaceId"); if (!id.matches("[a-f0-9-]{36}")) throw new IOException("Invalid workspace identity."); return largeJson(request(owner, "/v1/workspaces/" + id + "/state", null, null)); }
      case "workspace-save": { String id = request.getString("workspaceId"); if (!id.matches("[a-f0-9-]{36}")) throw new IOException("Invalid workspace identity."); JSONObject device = connection(owner); return largeJson(http(address(device.getString("address")) + "/v1/workspaces/" + id + "/state", open(device.getString("secret")), null, new JSONObject().put("state", request.getString("state")).put("revision", request.getString("revision")))).getJSONObject("save"); }
      case "workspace-icon": {
        String id = request.getString("workspaceId"), name = request.getString("name");
        if (!id.matches("[a-f0-9-]{36}") || !name.matches("[a-f0-9]{64}\\.[a-z]{2,4}")) throw new IOException("Invalid icon.");
        HttpURLConnection icon = request(owner, "/v1/workspaces/" + id + "/icons/" + name, null, null);
        try (InputStream input = icon.getInputStream()) {
          String type = String.valueOf(icon.getContentType()); if (!type.matches("image/[a-z+.-]+")) throw new IOException("Invalid icon.");
          ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[16384]; int count;
          while ((count = input.read(buffer)) >= 0) { bytes.write(buffer, 0, count); if (bytes.size() > 4 * 1024 * 1024) throw new IOException("Icon is too large."); }
          return "data:" + type + ";base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        } finally { icon.disconnect(); }
      }
      case "inbox": return json(request(owner, "/v1/files/inbox", null, null));
      case "search": return json(request(owner, "/v1/files/search?q=" + URLEncoder.encode(request.getString("query"), "UTF-8") + "&limit=" + Math.max(1, Math.min(1000, request.optInt("limit", 200))), null, null)).getJSONArray("results");
      case "preview": { String id = request.getString("resourceId"); if (!id.matches("[a-f0-9-]{36}")) throw new IOException("Invalid file identity."); return largeJson(request(owner, "/v1/files/" + id + "/preview", null, null)).getJSONObject("preview"); }
      case "local-state-load": return localState();
      case "local-state-save": return saveLocalState(request.getString("state"), request.getString("revision"));
      case "backpacks": return backpacks(owner);
      case "backpack-snapshot": return backpackSnapshot(owner,request.getString("resourceId"));
      case "backpack-view": return backpackControl(owner,request.getString("resourceId"),null);
      case "backpack-command": return backpackControl(owner,request.getString("resourceId"),request.getJSONObject("command"));
      case "change": { JSONObject device=connection(owner);return outbox.send(owner,device.optString("deviceId"),request.getJSONObject("command"),command->dispatchChange(device,command)); }
      case "change-retry": { JSONObject device=connection(owner);return outbox.retry(owner,device.optString("deviceId"),request.getString("commandId"),command->dispatchChange(device,command)); }
      case "changes": { JSONArray changes=json(request(owner,"/v1/files/changes",null,null)).getJSONArray("jobs");outbox.reconcile(owner,changes);return changes; }
      case "cancel": { String id = request.getString("jobId"); Future<?> worker = workers.get(id); if (worker != null) worker.cancel(true); JSONObject job = jobs.get(id); if (job != null) synchronized (job) { if (!"completed".equals(job.getString("phase"))) job.put("phase", "failed").put("error", "Transfer paused. Retry to resume."); } return new JSONObject().put("canceled", true); }
      case "open-cache": { File file = checkedFile(owner, request.getString("key")); CachedFilesProvider.open(context, file, metadata(request.getString("key")).getJSONObject("entry").getString("name")); return new JSONObject().put("opened", true); }
      default: throw new IOException("Unknown file operation.");
    }
  }
  private JSONArray connections() throws Exception {
    File file = new File(root, "connections.json");
    return file.exists() ? read(file).getJSONArray("connections") : new JSONArray();
  }
  private JSONObject connection(String owner) throws Exception {
    JSONArray devices = connections();
    for (int i = 0; i < devices.length(); i++) if (devices.getJSONObject(i).getString("id").equals(owner)) return devices.getJSONObject(i);
    throw new IOException("Device is not connected.");
  }
  private synchronized JSONObject pair(String address, String code) throws Exception {
    String base = address(address);
    remember(base, json(http(base + "/v1/devices/pair", null, null, new JSONObject().put("code", code).put("name", Build.MODEL))));
    return new JSONObject().put("connected", true);
  }
  private synchronized void remember(String base, JSONObject response) throws Exception {
    JSONObject owner = response.getJSONObject("owner");
    if (!owner.getString("id").matches("[a-f0-9-]{36}") || !response.getString("token").matches("[A-Za-z0-9_-]{43}")) throw new IOException("Invalid pairing response.");
    if(!response.getString("deviceId").matches("[a-f0-9-]{36}"))throw new IOException("Invalid pairing identity.");
    JSONObject device = new JSONObject().put("id", owner.getString("id")).put("deviceId",response.getString("deviceId")).put("name", owner.getString("name")).put("address", base).put("secret", seal(response.getString("token")));
    JSONArray previous = connections(), next = new JSONArray();
    for (int i = 0; i < previous.length(); i++) { JSONObject item = previous.getJSONObject(i); if (!item.getString("id").equals(owner.getString("id")) && !base.equals(item.optString("address"))) next.put(item); }
    next.put(device); write(new File(root, "connections.json"), new JSONObject().put("connections", next));
  }
  /** Joins the creator's own computers (same Tailscale account, listed at build time). No codes. */
  private static final String TAG = "PapersDevices";
  private long lastJoin;
  private synchronized void joinOwners() {
    if (System.currentTimeMillis() - lastJoin < 30000) return; lastJoin = System.currentTimeMillis();
    try (InputStream input = context.getAssets().open("owners.json")) {
      ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count; while ((count = input.read(buffer)) >= 0) bytes.write(buffer, 0, count);
      JSONArray owners = new JSONArray(bytes.toString("UTF-8")), known = connections();
      // Drop connections that are not one of the creator's computers (stale test owners).
      Set<String> allowed = new HashSet<>(); for (int i = 0; i < owners.length(); i++) allowed.add(address(owners.getString(i)));
      // One connection per computer: the newest entry for an address wins.
      Set<String> seen = new HashSet<>(); List<JSONObject> newest = new ArrayList<>();
      for (int i = known.length() - 1; i >= 0; i--) { String at = known.getJSONObject(i).optString("address"); if (allowed.contains(at) && seen.add(at)) newest.add(0, known.getJSONObject(i)); }
      JSONArray kept = new JSONArray(); for (JSONObject item : newest) kept.put(item);
      Log.i(TAG, "owners=" + allowed + " stored=" + known.length() + " kept=" + kept.length());
      if (kept.length() != known.length()) { write(new File(root, "connections.json"), new JSONObject().put("connections", kept)); known = kept; }
      outer: for (int i = 0; i < owners.length(); i++) {
        String base = address(owners.getString(i));
        for (int j = 0; j < known.length(); j++) if (base.equals(known.getJSONObject(j).optString("address"))) { Log.i(TAG, "already connected " + base); continue outer; }
        try { URI target = new URI(base); try (java.net.Socket probe = new java.net.Socket()) { probe.connect(new java.net.InetSocketAddress(target.getHost(), target.getPort()), 3000); } remember(base, json(http(base + "/v1/devices/join", null, null, new JSONObject().put("name", Build.MODEL)))); Log.i(TAG, "joined " + base); } catch (Exception error) { Log.w(TAG, "join " + base + " failed: " + error); }
      }
    } catch (Exception error) { Log.w(TAG, "owner discovery failed: " + error); }
  }
  private JSONObject snapshot() throws Exception {
    JSONArray devices = new JSONArray(), transfers = new JSONArray(), connections = connections();
    for (int i = 0; i < connections.length(); i++) { JSONObject c = connections.getJSONObject(i); devices.put(new JSONObject().put("id", c.getString("id")).put("name", c.getString("name")).put("address", c.getString("address"))); }
    for (JSONObject job : jobs.values()) synchronized (job) { transfers.put(new JSONObject(job.toString())); }
    return new JSONObject().put("capabilities",new JSONObject().put("edits",true).put("editImport",true).put("editContinue",true)).put("devices", devices).put("jobs", transfers).put("commandJobs",outbox.snapshot());
  }
  private JSONObject dispatchChange(JSONObject device,JSONObject command) throws Exception { return json(http(address(device.getString("address"))+"/v1/files/changes",open(device.getString("secret")),null,command)).getJSONObject("job"); }
  private JSONObject beginEdit(String owner,JSONObject entry) throws Exception {
    validate(entry);if(!"file".equals(entry.getString("kind")))throw new IOException("Choose a file to edit");
    JSONObject device=connection(owner);
    JSONObject session=json(http(address(device.getString("address"))+"/v1/files/edits",open(device.getString("secret")),null,new JSONObject().put("resourceId",entry.getString("id")).put("sourceVersion",entry.getString("version")))).getJSONObject("session");
    if(!entry.getString("id").equals(session.getString("resourceId"))||!entry.getString("version").equals(session.getString("sourceVersion")))throw new IOException("Invalid edit source receipt");
    JSONObject started=download(owner,entry);String jobId=started.getString("id");Future<?> worker=workers.get(jobId);if(worker!=null)worker.get();
    JSONObject job=jobs.get(jobId);synchronized(job){if(!"completed".equals(job.getString("phase")))throw new IOException(job.optString("error","Source download is incomplete"));}
    String key=sha(new JSONArray().put(owner).put(entry.getString("id")).put(entry.getString("version")).toString().getBytes(StandardCharsets.UTF_8));
    return editCopies.create(owner,session,entry.getString("name"),checkedFile(owner,key));
  }
  private JSONObject saveEdit(String id) throws Exception {
    if(!id.matches("[a-f0-9-]{36}"))throw new IOException("Invalid local edit identity");
    Object lock=editLocks.computeIfAbsent(id,key->new Object());synchronized(lock){return saveEditLocked(id);}
  }
  private JSONObject continueEdit(String id) throws Exception {
    if(!id.matches("[a-f0-9-]{36}"))throw new IOException("Invalid local edit identity");
    Object lock=editLocks.computeIfAbsent(id,key->new Object());synchronized(lock){
      JSONObject previous=editCopies.read(id);if(!"saved".equals(previous.getString("phase")))throw new IOException("Resolve the previous save before continuing");
      String owner=previous.getString("ownerId");JSONObject session=previous.getJSONObject("session");JSONObject source=json(request(owner,"/v1/files/"+session.getString("resourceId")+"/stat",null,null)).getJSONObject("entry");
      if(!source.getString("version").equals(session.getString("savedVersion")))throw new IOException("The owner changed this file after your save. Keep your local edits and compare the current owner file.");
      JSONObject next=beginEdit(owner,source);editCopies.carry(id,next.getString("id"));return editCopies.read(next.getString("id"));
    }
  }
  private JSONObject saveEditLocked(String id) throws Exception {
    JSONObject record=editCopies.prepare(id);String phase=record.getString("phase");if("saved".equals(phase)||"conflict".equals(phase))return record;
    String owner=record.getString("ownerId"),sessionId=record.getJSONObject("session").getString("id"),hash=record.getString("editedSha256");long size=record.getLong("editedBytes");
    File snapshot=editCopies.snapshot(id);JSONObject device=connection(owner);String base=address(device.getString("address")),token=open(device.getString("secret"));
    try {
      if(!record.has("uploadId")){
        String uploadId=json(http(base+"/v1/files/edits/"+sessionId+"/uploads",token,null,new JSONObject().put("bytes",size).put("sha256",hash))).getString("uploadId");
        if(!uploadId.matches("[a-f0-9-]{36}"))throw new IOException("Invalid upload receipt");record.put("uploadId",uploadId);editCopies.retain(record);
      }
      String uploadRoute=base+"/v1/files/edits/uploads/"+record.getString("uploadId");
      JSONObject status=json(http(uploadRoute,token,null,null)).getJSONObject("upload");long offset=status.getLong("receivedBytes");
      if(!sessionId.equals(status.getString("sessionId"))||size!=status.getLong("bytes")||!hash.equals(status.getString("sha256"))||offset<0||offset>size)throw new IOException("Upload resume receipt differs from this save");
      MessageDigest prefix=MessageDigest.getInstance("SHA-256");
      try(RandomAccessFile file=new RandomAccessFile(snapshot,"r")){
        byte[] buffer=new byte[65536];long remaining=offset;while(remaining>0){int count=file.read(buffer,0,(int)Math.min(buffer.length,remaining));if(count<0)throw new IOException("Retained prefix is incomplete");prefix.update(buffer,0,count);remaining-=count;}
        StringBuilder prefixText=new StringBuilder();for(byte value:prefix.digest())prefixText.append(String.format(java.util.Locale.ROOT,"%02x",value&255));
        if(!prefixText.toString().equals(status.getString("prefixSha256")))throw new IOException("Owner prefix differs; retain both copies for recovery");
        while(offset<size){
          if(Thread.currentThread().isInterrupted())throw new IOException("Save paused; retained snapshot can be resumed");
          long count=Math.min(4L*1024*1024,size-offset);HttpURLConnection upload=(HttpURLConnection)new URL(uploadRoute+"?offset="+offset).openConnection();
          upload.setInstanceFollowRedirects(false);upload.setConnectTimeout(15000);upload.setReadTimeout(60000);upload.setRequestMethod("PUT");upload.setRequestProperty("Authorization","Bearer "+token);upload.setDoOutput(true);upload.setFixedLengthStreamingMode(count);
          try {
            try(OutputStream output=upload.getOutputStream()){long chunkRemaining=count;while(chunkRemaining>0){int read=file.read(buffer,0,(int)Math.min(buffer.length,chunkRemaining));if(read<0)throw new IOException("Retained snapshot changed");output.write(buffer,0,read);chunkRemaining-=read;}}
            if(upload.getResponseCode()!=200||json(upload).getLong("receivedBytes")!=offset+count)throw new IOException("Upload was not confirmed; retained snapshot can be resumed");offset+=count;
          } finally {upload.disconnect();}
        }
      }
      json(http(uploadRoute+"/seal",token,null,new JSONObject()));
      JSONObject result=json(http(base+"/v1/files/edits/"+sessionId+"/save",token,null,new JSONObject().put("saveId",record.getString("saveId")).put("uploadId",record.getString("uploadId")).put("sha256",hash))).getJSONObject("session");
      if(!sessionId.equals(result.getString("id"))||!record.getString("saveId").equals(result.getString("saveId"))||!hash.equals(result.getString("editedSha256"))||!Arrays.asList("saved","conflict","uncertain").contains(result.getString("phase")))throw new IOException("Invalid save receipt; retain local copies");
      record.put("phase",result.getString("phase")).put("session",result);editCopies.retain(record);return record;
    } catch(Exception error){record.put("phase","uncertain");editCopies.retain(record);throw error;}
  }
  private JSONObject backpacks(String owner) throws Exception {
    File cache=new File(root,"backpacks-"+sha(owner.getBytes(StandardCharsets.UTF_8))+".json");
    try{JSONObject result=json(request(owner,"/v1/backpacks",null,null));if(!owner.equals(result.getJSONObject("owner").getString("id")))throw new IOException("Owner identity changed.");JSONArray entries=result.getJSONArray("entries");for(int i=0;i<entries.length();i++){JSONObject item=entries.getJSONObject(i);if(!item.getString("id").matches("[a-f0-9-]{36}")||!"proxima".equals(item.getString("kind")))throw new IOException("Invalid shared Backpack listing.");}write(cache,result);return result.put("online",true);}catch(Exception error){if(!cache.exists())throw error;return read(cache).put("online",false).put("error",error.getMessage());}
  }
  private JSONObject backpackSnapshot(String owner,String id) throws Exception {
    if(!id.matches("[a-f0-9-]{36}"))throw new IOException("Invalid shared Backpack identity.");File cache=new File(root,"backpack-"+sha((owner+":"+id).getBytes(StandardCharsets.UTF_8))+".json");
    try{JSONObject result=json(request(owner,"/v1/backpacks/"+id+"/snapshot",null,null));if(!owner.equals(result.getJSONObject("owner").getString("id"))||!id.equals(result.getString("resourceId"))||!"proxima".equals(result.getString("kind")))throw new IOException("Shared Backpack identity changed.");write(cache,result);return result.put("online",true);}catch(Exception error){if(!cache.exists())throw error;return read(cache).put("online",false).put("error",error.getMessage());}
  }
  /** Proxima control, as a computer's remote view does it: the live owner's view, or one command the owner
   * applies and confirms (with its new snapshot). Nothing is cached or queued here; offline simply fails. */
  private JSONObject backpackControl(String owner,String id,JSONObject command) throws Exception {
    if(!id.matches("[a-f0-9-]{36}"))throw new IOException("Invalid shared Backpack identity.");
    JSONObject device=connection(owner);String base=address(device.getString("address"));
    JSONObject result=largeJson(command==null?http(base+"/v1/backpacks/"+id+"/snapshot?control=1",open(device.getString("secret")),null,null):http(base+"/v1/backpacks/"+id+"/commands",open(device.getString("secret")),null,command));
    if(!owner.equals(result.getJSONObject("owner").getString("id"))||!id.equals(result.getString("resourceId"))||!"proxima".equals(result.getString("kind"))||!result.has("snapshot"))throw new IOException("Owner confirmation is invalid.");
    if(command!=null&&!result.has("command"))throw new IOException("Owner did not confirm the command.");
    return result.put("online",true);
  }
  private JSONObject browse(String owner, String id, int offset) throws Exception {
    if (!id.isEmpty() && !id.matches("[a-f0-9-]{36}")) throw new IOException("Invalid file identity.");
    if (offset < 0) throw new IOException("Invalid listing page.");
    File cache = new File(root, "listing-" + sha((owner + ":" + id + ":" + offset).getBytes(StandardCharsets.UTF_8)) + ".json");
    try {
      JSONObject result = json(request(owner, id.isEmpty() ? "/v1/files/shares" : "/v1/files/" + id + "/list?offset=" + offset, null, null));
      if (result.has("owner") && !result.getJSONObject("owner").getString("id").equals(owner)) throw new IOException("Owner identity changed. Pair again.");
      JSONArray entries = result.getJSONArray("entries"); for (int i = 0; i < entries.length(); i++) validate(entries.getJSONObject(i));
      if (!result.has("nextOffset")) result.put("nextOffset", JSONObject.NULL);
      write(cache, result); result.put("online", true); return result;
    } catch (Exception error) {
      if (!cache.exists()) throw error;
      return read(cache).put("online", false).put("error", error.getMessage() == null ? "Owner unavailable." : error.getMessage());
    }
  }
  private synchronized JSONObject download(String owner, JSONObject entry) throws Exception {
    validate(entry); connection(owner);
    if (!"file".equals(entry.getString("kind"))) throw new IOException("Choose a file.");
    for (JSONObject existing : jobs.values()) synchronized (existing) {
      if (owner.equals(existing.getString("ownerId")) && entry.getString("id").equals(existing.getJSONObject("entry").getString("id")) && entry.getString("version").equals(existing.getJSONObject("entry").getString("version")) && !"failed".equals(existing.getString("phase"))) return new JSONObject(existing.toString());
    }
    String id = UUID.randomUUID().toString();
    JSONObject job = new JSONObject().put("id", id).put("ownerId", owner).put("entry", entry).put("phase", "queued").put("bytes", 0); jobs.put(id, job);
    Future<?> worker = downloads.submit(() -> { try { transfer(owner, entry, job); } catch (Exception error) { try { synchronized (job) { job.put("phase", "failed").put("error", error.getMessage() == null ? "Transfer interrupted. Retry to resume." : error.getMessage()); } } catch (Exception ignored) {} } finally { workers.remove(id); } });
    workers.put(id, worker); return new JSONObject(job.toString());
  }
  private void transfer(String owner, JSONObject entry, JSONObject job) throws Exception {
    String id = entry.getString("id"), version = entry.getString("version"); long size = entry.getLong("size");
    JSONObject digest = json(request(owner, "/v1/files/" + id + "/digest", version, null));
    if (!version.equals(digest.getString("version")) || size != digest.getLong("size") || !digest.getString("sha256").matches("[a-f0-9]{64}")) throw new IOException("Invalid source verification.");
    String key = sha(new JSONArray().put(owner).put(id).put(version).toString().getBytes(StandardCharsets.UTF_8));
    File partial = new File(root, key + ".partial"), complete = new File(root, key + ".bin"); long offset = partial.exists() ? partial.length() : 0;
    if (offset > size) { if (!partial.renameTo(new File(root, key + ".invalid-" + UUID.randomUUID()))) throw new IOException("Cannot retain damaged partial file."); offset = 0; }
    update(job, "transferring", offset);
    if (offset < size) {
      HttpURLConnection connection = request(owner, "/v1/files/" + id + "/content", version, offset > 0 ? "bytes=" + offset + "-" : null);
      if (!('"' + version + '"').equals(connection.getHeaderField("ETag")) || (offset > 0 && (connection.getResponseCode() != 206 || !("bytes " + offset + "-" + (size - 1) + "/" + size).equals(connection.getHeaderField("Content-Range"))))) { connection.disconnect(); throw new IOException("Source cannot resume safely."); }
      try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial, offset > 0)) {
        byte[] buffer = new byte[65536]; int count; long written = offset;
        while ((count = input.read(buffer)) >= 0) { if (Thread.currentThread().isInterrupted()) throw new IOException("Transfer paused. Retry to resume."); output.write(buffer, 0, count); written += count; update(job, "transferring", written); }
        output.getFD().sync();
      } finally { connection.disconnect(); }
    } else if (!partial.exists()) { try (FileOutputStream output = new FileOutputStream(partial)) { output.getFD().sync(); } }
    update(job, "verifying", size);
    if (partial.length() != size || !hashFile(partial).equals(digest.getString("sha256"))) { partial.renameTo(new File(root, key + ".invalid-" + UUID.randomUUID())); throw new IOException("Verification failed. Retry for a clean copy."); }
    if (!partial.renameTo(complete)) throw new IOException("Cannot finish local file.");
    write(new File(root, key + ".json"), new JSONObject().put("ownerId", owner).put("entry", entry).put("key", key).put("sha256", digest.getString("sha256")));
    update(job, "completed", size);
  }
  private void update(JSONObject job, String phase, long bytes) throws Exception { synchronized (job) { job.put("phase", phase).put("bytes", bytes); } }
  private JSONArray offline(String owner) throws Exception {
    JSONArray result = new JSONArray(); File[] files = root.listFiles(); if (files == null) return result;
    for (File file : files) if (file.getName().matches("[a-f0-9]{64}\\.json")) {
      try { JSONObject metadata = read(file); if (owner.equals(metadata.getString("ownerId")) && new File(root, metadata.getString("key") + ".bin").length() == metadata.getJSONObject("entry").getLong("size")) result.put(metadata); } catch (Exception ignored) {}
    }
    return result;
  }
  private JSONObject metadata(String key) throws Exception { if (!key.matches("[a-f0-9]{64}")) throw new IOException("Invalid cache identity."); return read(new File(root, key + ".json")); }
  private File checkedFile(String owner, String key) throws Exception { JSONObject metadata = metadata(key); File file = new File(root, key + ".bin"); if (!owner.equals(metadata.getString("ownerId")) || !hashFile(file).equals(metadata.getString("sha256"))) throw new IOException("Offline file is damaged or unavailable."); return file; }
  private HttpURLConnection request(String owner, String route, String version, String range) throws Exception {
    JSONObject device = connection(owner);
    try { return http(address(device.getString("address")) + route, open(device.getString("secret")), version, null, range); }
    catch (IOException error) { if (String.valueOf(error.getMessage()).startsWith("Access revoked")) forget(owner); throw error; }
  }
  /** A revoked grant is dropped so owner discovery joins again on the next status call. */
  private synchronized void forget(String owner) throws Exception {
    JSONArray previous = connections(), next = new JSONArray();
    for (int i = 0; i < previous.length(); i++) if (!previous.getJSONObject(i).getString("id").equals(owner)) next.put(previous.getJSONObject(i));
    write(new File(root, "connections.json"), new JSONObject().put("connections", next)); lastJoin = 0;
    Log.i(TAG, "grant revoked by " + owner + "; will rejoin");
  }
  private HttpURLConnection http(String url, String token, String version, JSONObject body) throws Exception { return http(url, token, version, body, null); }
  private HttpURLConnection http(String url, String token, String version, JSONObject body, String range) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection(); c.setInstanceFollowRedirects(false); c.setConnectTimeout(15000); c.setReadTimeout(30000);
    if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
    if (version != null) c.setRequestProperty("If-Match", '"' + version + '"');
    if (range != null) c.setRequestProperty("Range", range);
    if (body != null) { c.setRequestMethod("POST"); c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/json"); try (OutputStream out = c.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); } }
    int status = c.getResponseCode(); if (status < 200 || status >= 300) { c.disconnect(); throw new IOException(status == 412 ? "Source changed. Refresh before downloading." : status == 401 ? "Access revoked. Pair again." : "Remote operation failed (" + status + ")."); }
    return c;
  }
  /** Workspace documents and previews may carry embedded images, so they get a larger bound than metadata. */
  private JSONObject largeJson(HttpURLConnection connection) throws Exception { try (InputStream input = connection.getInputStream()) { ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[65536]; int count; while ((count = input.read(buffer)) >= 0) { bytes.write(buffer, 0, count); if (bytes.size() > 64 * 1024 * 1024) throw new IOException("Response is too large."); } return new JSONObject(bytes.toString("UTF-8")); } finally { connection.disconnect(); } }
  // The phone's own As you Go document. The revision is the SHA-256 of the saved bytes; a save built on an older one is refused.
  private File localStateFile() { File directory = new File(context.getFilesDir(), "as-you-go"); directory.mkdirs(); return new File(directory, "state.json"); }
  private synchronized JSONObject localState() throws Exception {
    File file = localStateFile();
    if (!file.exists()) return new JSONObject().put("state", JSONObject.NULL).put("revision", "empty");
    byte[] bytes; try (InputStream input = new AtomicFile(file).openRead()) { ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[65536]; int count; while ((count = input.read(buffer)) >= 0) out.write(buffer, 0, count); bytes = out.toByteArray(); }
    return new JSONObject().put("state", new String(bytes, StandardCharsets.UTF_8)).put("revision", sha(bytes));
  }
  private synchronized JSONObject saveLocalState(String state, String revision) throws Exception {
    new JSONObject(state);
    String current = localState().getString("revision");
    if (!current.equals(revision)) return new JSONObject().put("ok", false).put("code", "STALE_REVISION").put("revision", current);
    byte[] bytes = state.getBytes(StandardCharsets.UTF_8);
    AtomicFile atomic = new AtomicFile(localStateFile()); FileOutputStream out = atomic.startWrite();
    try { out.write(bytes); atomic.finishWrite(out); } catch (Exception error) { atomic.failWrite(out); throw error; }
    return new JSONObject().put("ok", true).put("revision", sha(bytes));
  }
  private JSONObject json(HttpURLConnection connection) throws Exception { try (InputStream input = connection.getInputStream()) { ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count; while ((count = input.read(buffer)) >= 0) { bytes.write(buffer, 0, count); if (bytes.size() > 8 * 1024 * 1024) throw new IOException("Metadata response is too large."); } return new JSONObject(bytes.toString("UTF-8")); } finally { connection.disconnect(); } }
  private String address(String input) throws Exception { URI uri = new URI(input); String host = uri.getHost(); if (!"http".equals(uri.getScheme()) || host == null || !host.matches("100\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}") || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))) throw new IOException("Use the private Tailscale address shown by Papers."); String[] octets = host.split("\\."); int second = Integer.parseInt(octets[1]); if (second < 64 || second > 127 || Integer.parseInt(octets[2]) > 255 || Integer.parseInt(octets[3]) > 255) throw new IOException("Invalid private address."); return "http://" + host + (uri.getPort() == -1 ? "" : ":" + uri.getPort()); }
  private void validate(JSONObject entry) throws Exception { if (!entry.getString("id").matches("[a-f0-9-]{36}") || !entry.getString("version").matches("[a-f0-9]{64}") || entry.getLong("size") < 0 || !Arrays.asList("file", "folder").contains(entry.getString("kind"))) throw new IOException("Invalid file metadata."); }
  private JSONObject read(File file) throws Exception { try (InputStream input = new AtomicFile(file).openRead()) { ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count; while ((count = input.read(buffer)) >= 0) { bytes.write(buffer, 0, count); if (bytes.size() > 8 * 1024 * 1024) throw new IOException("Local metadata is too large."); } return new JSONObject(bytes.toString("UTF-8")); } }
  private void write(File file, JSONObject value) throws Exception { AtomicFile atomic = new AtomicFile(file); FileOutputStream out = atomic.startWrite(); try { out.write(value.toString().getBytes(StandardCharsets.UTF_8)); atomic.finishWrite(out); } catch (Exception error) { atomic.failWrite(out); throw error; } }
  private String sha(byte[] bytes) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
  private String hashFile(File file) throws Exception { MessageDigest digest = MessageDigest.getInstance("SHA-256"); try (InputStream input = new FileInputStream(file)) { byte[] buffer = new byte[65536]; int count; while ((count = input.read(buffer)) >= 0) digest.update(buffer, 0, count); } return hex(digest.digest()); }
  private String hex(byte[] bytes) { StringBuilder text = new StringBuilder(); for (byte value : bytes) text.append(String.format(Locale.ROOT, "%02x", value & 255)); return text.toString(); }
  private javax.crypto.SecretKey key() throws Exception { KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); if (!store.containsAlias("papers-connections")) { KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"); generator.init(new KeyGenParameterSpec.Builder("papers-connections", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); generator.generateKey(); } return (javax.crypto.SecretKey) store.getKey("papers-connections", null); }
  private String seal(String value) throws Exception { Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key()); return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP); }
  private String open(String value) throws Exception { String[] parts = value.split(":"); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP))); return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8); }
}
