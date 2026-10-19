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
  private static final Map<String,Long> ownerResponses=new ConcurrentHashMap<>();
  private final Context context;
  private final File root;
  private final MobileCommandOutbox outbox;
  private final MobileEditCopies editCopies;
  private final Map<String, JSONObject> jobs = new ConcurrentHashMap<>();
  private final Map<String, Future<?>> workers = new ConcurrentHashMap<>();
  private final Map<String, Object> editLocks = new ConcurrentHashMap<>();
  private final Map<String, Object> transferLocks = new ConcurrentHashMap<>();
  private final ExecutorService downloads = Executors.newFixedThreadPool(2);
  private ScheduledExecutorService editingWorker;
  private final Map<String,String> editingGenerations=new ConcurrentHashMap<>();
  private final Set<String> changedEdits=ConcurrentHashMap.newKeySet();
  void editChanged(String id){changedEdits.add(id);}
  synchronized void startEditingWorker(){if(editingWorker!=null)return;editingWorker=Executors.newSingleThreadScheduledExecutor();editingWorker.scheduleWithFixedDelay(()->{try{pollEditing();}catch(Exception error){Log.w(TAG,"Editing owner unavailable; local copies retained");}},3,5,TimeUnit.SECONDS);}
  synchronized void stopEditingWorker(){if(editingWorker!=null)editingWorker.shutdownNow();editingWorker=null;}
  private void pollEditing()throws Exception {
    JSONArray connections=connections();
    for(int i=0;i<connections.length();i++)try{
      String owner=connections.getJSONObject(i).getString("id");JSONArray assignments=json(request(owner,"/v1/files/edits/assignments",null,null)).getJSONArray("assignments"),copies=editCopies.list(owner,false);
      for(int k=0;k<copies.length();k++){JSONObject old=copies.getJSONObject(k);String assignmentId=old.getJSONObject("session").optString("assignmentId");for(int j=0;j<assignments.length();j++){JSONObject a=assignments.getJSONObject(j);if(a.getString("id").equals(assignmentId)&&!a.optBoolean("active")){String oldId=old.getString("id");try{synchronized(editLocks.computeIfAbsent(oldId,key->new Object())){editCopies.removeUnlinked(oldId);}}catch(Exception cleanupBlocked){/* Retry this stopped copy next poll without blocking active assignments. */}finally{editingGenerations.remove(oldId);changedEdits.remove(oldId);}break;}}}
      for(int j=0;j<assignments.length();j++){
        JSONObject assignment=assignments.getJSONObject(j);if(!assignment.optBoolean("active")||!assignment.optBoolean("mine"))continue;JSONObject copy=null;
        for(int k=0;k<copies.length();k++)if(copies.getJSONObject(k).getJSONObject("session").optString("assignmentId").equals(assignment.getString("id")))copy=copies.getJSONObject(k);
        if(copy==null){copy=beginEdit(owner,assignment.getJSONObject("entry"));if(!copy.getJSONObject("session").optString("assignmentId").equals(assignment.getString("id")))continue;/* Mark first; opening an editor requires a separate user action. */}
        String id=copy.getString("id");Object lock=editLocks.computeIfAbsent(id,key->new Object());synchronized(lock){copy=editCopies.read(id);if(copy.getString("phase").equals("conflict"))continue;File working=editCopies.working(id);String generation=working.length()+":"+working.lastModified();boolean changed=changedEdits.remove(id);if(copy.getString("phase").equals("editing")&&!changed&&generation.equals(editingGenerations.get(id)))continue;editingGenerations.put(id,generation);
          if(!copy.getString("phase").equals("saved")){try{copy=saveEditLocked(id);}catch(Exception unchangedOrOffline){continue;}}
          if(copy.getString("phase").equals("saved")){JSONObject session=copy.getJSONObject("session"),source=json(request(owner,"/v1/files/"+session.getString("resourceId")+"/stat",null,null)).getJSONObject("entry");if(!source.getString("version").equals(session.getString("savedVersion")))continue;JSONObject next=json(editRequest(owner,"/v1/files/edits",new JSONObject().put("resourceId",source.getString("id")).put("sourceVersion",source.getString("version")))).getJSONObject("session");editCopies.nextRevision(id,next);}
        }
      }
    }catch(Exception ownerUnavailable){/* Keep local bytes and pending saves across connection loss. */}
  }
  MobileFiles(Context context) { this.context = context; root = new File(context.getFilesDir(), "remote-files"); root.mkdirs(); outbox=new MobileCommandOutbox(root); editCopies=new MobileEditCopies(context); PhoneIndex.get(context); }

  Object call(JSONObject request) throws Exception {
    String operation = request.getString("operation");
    if(operation.equals("workspace-files"))return WorkspaceFiles.get(context).call(request.getJSONObject("request"));
    if(operation.equals("workspace-transfer"))return workspaceTransfer(request);
    if(operation.equals("workspace-peer-exchange")){
      String peer=request.getString("ownerId");JSONArray shares=backpacks(peer).getJSONArray("entries");JSONObject share=null;for(int i=0;i<shares.length();i++)if(shares.getJSONObject(i).optString("kind").equals("proxima")){share=shares.getJSONObject(i);break;}if(share==null)throw new IOException("The device is not sharing Proxima.");
      JSONObject envelope=new JSONObject().put("version",1).put("source",new JSONObject().put("ownerId","proxima-sync").put("backpackId","proxima").put("seq",0).put("observedAt",java.time.Instant.now().toString())).put("records",new JSONObject().put("tasks","proxima-sync")).put("proximaSync",request.getJSONObject("message"));
      Object response=call(new JSONObject().put("operation","backpack-replace").put("ownerId",peer).put("resourceId",share.getString("id")).put("snapshot",envelope));
      JSONObject value=(JSONObject)response;for(int i=0;i<3&&!value.has("proximaSync")&&value.opt("result") instanceof JSONObject;i++)value=value.getJSONObject("result");return value.getJSONObject("proximaSync");
    }
    if(operation.equals("phone-target-delete")){JSONObject target=PhoneTargets.get(context).resolve(request.getString("targetId"));if(!target.optString("status").equals("present")||target.getLong("revision")!=request.getLong("expectedRevision"))throw new IOException("The file changed; refresh before recycling it.");PhonePeerService.localFiles(new JSONObject().put("operation","phone-change").put("action","delete").put("uri",target.getString("uri")).put("targetId",request.getString("targetId")).put("expectedRevision",request.getLong("expectedRevision")).put("commandId",request.getString("commandId")));return target.put("status","pending");}
    if(operation.startsWith("phone-target-"))return PhoneTargets.get(context).call(request);
    if (operation.equals("phone-editing") || operation.equals("phone-change") || operation.equals("phone-change-status")) return PhonePeerService.localFiles(request);
    if (PhoneIndex.handles(operation)) return PhoneIndex.get(context).call(context,request);
    String owner = request.optString("ownerId");
    switch (operation) {
      case "pair": return pair(request.getString("address"), request.getString("code"));
      case "status": joinOwners(); return snapshot();
      case "browse": return browse(owner, request.optString("resourceId"), request.optInt("offset", 0));
      case "targets": return json(http(address(connection(owner).getString("address"))+"/v1/files/targets",open(connection(owner).getString("secret")),null,request.getJSONObject("request"))).getJSONObject("target");
      case "download": return download(owner, request.getJSONObject("entry"));
      case "phone-upload-start": return uploadPhone(owner, request);
      case "phone-save-cache": return saveCacheToFolder(owner,request);
      case "download-job": {JSONObject job=jobs.get(request.getString("jobId"));if(job==null)throw new IOException("Download is unavailable.");synchronized(job){return new JSONObject(job.toString());}}
      case "download-folder": case "public-download-start": case "public-download-status": case "public-download-pause": case "public-download-resume": return PhoneDownloads.get(context).call(request);
      case "offline": return offline(owner);
      case "working-folder": {File folder=editCopies.workingRoot();folder.mkdirs();String relative=android.os.Environment.getExternalStorageDirectory().toPath().relativize(folder.toPath()).toString();return new JSONObject().put("uri",android.provider.DocumentsContract.buildDocumentUri("com.android.externalstorage.documents","primary:"+relative).toString());}
      case "edit-assignments": {JSONArray copies=editCopies.list(owner,false),local=new JSONArray();JSONObject result;try{result=json(request(owner,"/v1/files/edits/assignments",null,null));}catch(Exception offline){if(copies.length()==0)throw offline;String editor=connection(owner).getString("deviceId");JSONArray assignments=new JSONArray();for(int i=0;i<copies.length();i++){JSONObject c=copies.getJSONObject(i),s=c.getJSONObject("session");if(s.has("assignmentId"))assignments.put(new JSONObject().put("id",s.getString("assignmentId")).put("active",true).put("mine",true).put("editorDeviceId",editor).put("entry",new JSONObject().put("id",s.getString("resourceId"))));}result=new JSONObject().put("offline",true).put("assignments",assignments).put("editors",new JSONArray().put(new JSONObject().put("id",editor).put("name",android.os.Build.MODEL)));}for(int i=0;i<copies.length();i++){JSONObject copy=copies.getJSONObject(i);if(copy.getJSONObject("session").has("assignmentId"))local.put(new JSONObject().put("id",copy.getString("id")).put("assignmentId",copy.getJSONObject("session").getString("assignmentId")).put("phase",copy.getString("phase")));}return result.put("localCopies",local);}
      case "edit-assign": {JSONObject entry=request.getJSONObject("entry");return json(editRequest(owner,"/v1/files/edits/assignments",new JSONObject().put("resourceId",entry.getString("id")).put("sourceVersion",entry.getString("version")).put("editorDeviceId",request.getString("editorDeviceId"))));}
      case "edit-stop": return json(editRequest(owner,"/v1/files/edits/assignments",new JSONObject().put("action","stop").put("id",request.getString("assignmentId"))));
      case "edit-list": return editCopies.list(owner);
      case "edit-begin": return beginEdit(owner,request.getJSONObject("entry"));
      case "edit-open": {String id=request.getString("editId");editCopies.working(id);CachedFilesProvider.edit(context,id,editCopies.read(id).getString("name"));return new JSONObject().put("opened",true);}
      case "edit-save": return saveEdit(request.getString("editId"));
      case "edit-continue": return continueEdit(request.getString("editId"));
      case "workspaces": { JSONObject result = json(request(owner, "/v1/workspaces", null, null)); if (!owner.equals(result.getJSONObject("owner").getString("id"))) throw new IOException("Owner identity changed."); return result.getJSONArray("entries"); }
      case "workspace-load": { String id = request.getString("workspaceId"); if (!id.matches("[a-f0-9-]{36}")) throw new IOException("Invalid workspace identity."); String key = owner + "|" + id; JSONObject held = workspaceDocuments.get(key); JSONObject device = connection(owner); JSONObject loaded; try { loaded = largeJson(http(address(device.getString("address")) + "/v1/workspaces/" + id + "/state", open(device.getString("secret")), null, null, null, held == null ? null : held.optString("revision", null))); } catch (IOException error) { if (String.valueOf(error.getMessage()).startsWith("Access revoked")) forget(owner); throw error; }
        // Device panes ask every few seconds: an updated owner answers "unchanged" for the revision already held.
        if (loaded.optBoolean("unchanged") && held != null && held.optString("revision").equals(loaded.optString("revision"))) return held;
        if (loaded.has("revision") && loaded.has("state")) workspaceDocuments.put(key, loaded); return loaded; }
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
      case "custom-icons": { String id=request.optString("resourceId");if(!id.matches("[a-f0-9-]{36}"))return new JSONObject();return json(request(owner,"/v1/files/"+id+"/custom-icons",null,null)).getJSONObject("icons"); }
      case "custom-icon-set": { String id=request.getString("resourceId");if(!id.matches("[a-f0-9-]{36}"))throw new IOException("Invalid file identity.");JSONObject device=connection(owner);PhoneCustomIcons.valid(request.opt("icon"));json(http(address(device.getString("address"))+"/v1/files/"+id+"/custom-icon",open(device.getString("secret")),null,new JSONObject().put("icon",request.opt("icon")==null?JSONObject.NULL:request.opt("icon"))));return new JSONObject().put("ok",true); }
      case "phone-custom-icons": { File folder=PhoneStorage.file(android.net.Uri.parse(request.getString("uri")));if(folder==null||!folder.isDirectory())return new JSONObject();return PhoneCustomIcons.get(context).inFolder(folder); }
      case "phone-custom-icon-set": { org.json.JSONArray uris=request.getJSONArray("uris");for(int i=0;i<uris.length();i++){File item=PhoneStorage.file(android.net.Uri.parse(uris.getString(i)));if(item==null||!item.exists())throw new IOException("Only files in the phone's storage can have a custom picture.");PhoneCustomIcons.get(context).set(item,request.opt("icon"));}return new JSONObject().put("ok",true); }
      case "thumbnail": { String id=request.getString("resourceId");if(!id.matches("[a-f0-9-]{36}"))throw new IOException("Invalid file identity.");return json(request(owner,"/v1/files/"+id+"/thumbnail",null,null)).getJSONObject("preview"); }
      case "preview": { String id = request.getString("resourceId"); if (!id.matches("[a-f0-9-]{36}")) throw new IOException("Invalid file identity."); return largeJson(request(owner, "/v1/files/" + id + "/preview", null, null)).getJSONObject("preview"); }
      case "local-state-load": return localState();
      case "local-state-save": return saveLocalState(request.getString("state"), request.getString("revision"));
      case "backpacks": return backpacks(owner);
      case "backpack-snapshot": return backpackSnapshot(owner,request.getString("resourceId"));
      case "cache-preview": return cachePreview(owner, request.getJSONObject("entry"));
      case "publish-proxima": PhonePeerService.changed(); return new JSONObject().put("published",true);
      case "backpack-replace": { String id = request.getString("resourceId"); if (!id.matches("[a-f0-9-]{36}")) throw new IOException("Invalid shared Backpack identity."); JSONObject device = connection(owner); return exchange("POST", address(device.getString("address")) + "/v1/backpacks/" + id + "/replace", open(device.getString("secret")), request.getJSONObject("snapshot").toString(), 180000); }
      case "peer-replacement": return peerReplacement();
      case "peer-replacement-done": { JSONObject device = connection(owner); return exchange("DELETE", address(device.getString("address")) + "/v1/peer/proxima/replacement", open(device.getString("secret")), null, 30000); }
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
  private String peerGrantBasis=null;
  private JSONArray peerGrantCache=null;
  synchronized JSONArray peerInvitations(JSONObject phoneOwner)throws Exception {
    JSONArray result=new JSONArray(),all=connections();
    // Read current sealed pairings on every request so revocation is immediate.
    // Hardware-keystore decryption/HMAC derivation is only needed when they change.
    String basis=phoneOwner.getString("id")+"|"+all.toString();
    if(basis.equals(peerGrantBasis)&&peerGrantCache!=null)return new JSONArray(peerGrantCache.toString());
    for(int i=0;i<all.length();i++){JSONObject pc=all.getJSONObject(i);Mac mac=Mac.getInstance("HmacSHA256");mac.init(new javax.crypto.spec.SecretKeySpec(open(pc.getString("secret")).getBytes(StandardCharsets.UTF_8),"HmacSHA256"));String token=Base64.encodeToString(mac.doFinal(("papers-phone-peer-v1|"+phoneOwner.getString("id")+"|"+pc.getString("id")).getBytes(StandardCharsets.UTF_8)),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);result.put(new JSONObject().put("pc",pc).put("owner",phoneOwner).put("deviceId",UUID.nameUUIDFromBytes((phoneOwner.getString("id")+"|"+pc.getString("id")).getBytes(StandardCharsets.UTF_8)).toString()).put("token",token));}
    peerGrantBasis=basis;peerGrantCache=new JSONArray(result.toString());return result;
  }
  void announcePeer(JSONObject phoneOwner)throws Exception {JSONArray invitations=peerInvitations(phoneOwner);for(int i=0;i<invitations.length();i++){JSONObject item=invitations.getJSONObject(i),pc=item.getJSONObject("pc");JSONObject invitation=new JSONObject(item.toString());invitation.remove("pc");try{exchange("PUT",address(pc.getString("address"))+"/v1/peer/connect",open(pc.getString("secret")),invitation.toString(),15000);}catch(Exception error){Log.w(TAG,"phone peer announce failed: "+error.getMessage());}}}
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
    next.put(device); write(new File(root, "connections.json"), new JSONObject().put("connections", next));PhonePeerService.announce();
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
  private JSONObject saveCacheToFolder(String owner,JSONObject request)throws Exception {
    JSONObject entry=request.getJSONObject("entry");validate(entry);String name=entry.getString("name");
    if(name.isEmpty()||name.equals(".")||name.equals("..")||name.indexOf('/')>=0||name.indexOf('\\')>=0)throw new IOException("Invalid downloaded filename.");
    android.net.Uri uri=android.net.Uri.parse(request.getString("destinationUri"));
    if(android.provider.DocumentsContract.isTreeUri(uri))uri=android.provider.DocumentsContract.buildDocumentUri("com.android.externalstorage.documents",android.provider.DocumentsContract.getTreeDocumentId(uri));
    File folder=PhoneStorage.file(uri);if(folder==null||!folder.isDirectory()||!folder.canWrite())throw new IOException("Choose a writable phone folder.");
    String key=sha(new JSONArray().put(owner).put(entry.getString("id")).put(entry.getString("version")).toString().getBytes(StandardCharsets.UTF_8));File source=checkedFile(owner,key);
    File identical=PhoneContentReuse.find(folder,name,source.length(),hashFile(source));if(identical!=null)return new JSONObject().put("path",PhoneStorage.inward(PhoneStorage.outward(uri.toString())+"\\"+identical.getName()));
    int dot=name.lastIndexOf('.');File target=new File(folder,name);int n=1;
    while(!target.createNewFile()){String next=dot>0?name.substring(0,dot)+" ("+n+")"+name.substring(dot):name+" ("+n+")";target=new File(folder,next);n++;}
    try {try(InputStream in=new FileInputStream(source);OutputStream out=new FileOutputStream(target)){byte[] b=new byte[262144];int count;while((count=in.read(b))!=-1)out.write(b,0,count);}
      if(target.length()!=source.length()||!hashFile(target).equals(hashFile(source)))throw new IOException("The phone copy could not be verified.");
    }catch(Exception error){target.delete();throw error;}
    return new JSONObject().put("path",PhoneStorage.inward(PhoneStorage.outward(uri.toString())+"\\"+target.getName()));
  }
  /** Upload through the paired PC's existing verified, keep-both receiver. Never removes the source. */
  private JSONObject uploadPhone(String owner, JSONObject request) throws Exception {
    String folder=request.getString("folderId"), name=request.getString("name");
    if(!folder.matches("[a-f0-9-]{36}") || name.isEmpty() || name.equals(".") || name.equals("..") || name.indexOf('/')>=0 || name.indexOf('\\')>=0 || name.indexOf('\0')>=0)throw new IOException("Invalid upload destination.");
    android.net.Uri uri=android.net.Uri.parse(request.getString("uri"));
    if(!"content".equals(uri.getScheme()))throw new IOException("Choose a readable phone file.");
    JSONObject device=connection(owner);String base=address(device.getString("address")),token=open(device.getString("secret"));
    String id=UUID.randomUUID().toString();JSONObject job=new JSONObject().put("id",id).put("direction","upload").put("ownerId",owner).put("phase","preparing").put("bytes",0).put("name",name);
    jobs.put(id,job);
    workers.put(id,downloads.submit(()->{
      File snapshot=new File(root,"upload-"+id+".part");
      try {
        MessageDigest hash=MessageDigest.getInstance("SHA-256");long size=0;
        File source=PhoneStorage.file(uri);
        try(InputStream input=source!=null?new FileInputStream(source):context.getContentResolver().openInputStream(uri);OutputStream out=new FileOutputStream(snapshot)){
          if(input==null)throw new IOException("The phone file cannot be read.");byte[] buffer=new byte[262144];int read;
          while((read=input.read(buffer))!=-1){out.write(buffer,0,read);hash.update(buffer,0,read);size+=read;}
        }
        StringBuilder digest=new StringBuilder();for(byte b:hash.digest())digest.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
        String query="?name="+URLEncoder.encode(name,"UTF-8")+"&size="+size+"&sha256="+digest;
        JSONObject reused=null;try{reused=json(request(owner,"/v1/files/"+folder+"/upload"+query,null,null)).optJSONObject("entry");}catch(Exception unsupported){}if(reused!=null){synchronized(job){job.put("phase","completed").put("bytes",size).put("entry",reused);}return;}
        if(PhoneTusClient.supported(base,token)){final long total=size;synchronized(job){job.put("phase","transferring").put("total",size);}URL location=PhoneTusClient.upload(context,base,token,snapshot,folder,name,digest.toString(),accepted->{synchronized(job){job.put("bytes",accepted);}});JSONObject result=json(http(location.toString()+"/commit",token,null,new JSONObject()));JSONObject received=result.getJSONObject("entry");validate(received);if(received.getLong("size")!=size)throw new IOException("Upload receipt differs");synchronized(job){job.put("phase","completed").put("bytes",total).put("entry",received);}return;}
        HttpURLConnection upload=(HttpURLConnection)new URL(base+"/v1/files/"+folder+"/upload"+query).openConnection();
        upload.setInstanceFollowRedirects(false);upload.setConnectTimeout(15000);upload.setReadTimeout(60000);upload.setRequestMethod("PUT");upload.setRequestProperty("Authorization","Bearer "+token);upload.setRequestProperty("Content-Type","application/octet-stream");upload.setDoOutput(true);upload.setFixedLengthStreamingMode(size);
        synchronized(job){job.put("phase","transferring").put("total",size);}
        try {
          try(InputStream in=new FileInputStream(snapshot);OutputStream out=upload.getOutputStream()){
            byte[] buffer=new byte[262144];int read;long sent=0;
            while((read=in.read(buffer))!=-1){out.write(buffer,0,read);sent+=read;synchronized(job){job.put("bytes",sent);}}
          }
          synchronized(job){job.put("phase","verifying");}
          JSONObject result=json(upload);if(upload.getResponseCode()!=201||!result.optBoolean("ok"))throw new IOException(result.optString("message","The PC did not confirm the upload."));
          JSONObject entry=result.getJSONObject("entry");validate(entry);if(!"file".equals(entry.getString("kind"))||entry.getLong("size")!=size)throw new IOException("The upload receipt differs from the phone copy.");
          synchronized(job){job.put("phase","completed").put("entry",entry).put("bytes",size);}
        } finally {upload.disconnect();}
      }catch(Exception error){try{synchronized(job){job.put("phase","failed").put("error",error.getMessage()==null?"Upload interrupted. The phone original is unchanged.":error.getMessage());}}catch(Exception ignored){}}
      finally{snapshot.delete();}
    }));
    return new JSONObject().put("id",id);
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
  /** Preview of a computer's file that the computer cannot render as text or an image (a PDF, audio,
   * video): the verified local copy (downloaded now if needed, within the preview's time) rendered on the phone. */
  private JSONObject cachePreview(String owner, JSONObject entry) throws Exception {
    validate(entry); if (!"file".equals(entry.getString("kind"))) throw new IOException("Choose a file to preview.");
    long size = entry.getLong("size"); if (size > 60L * 1024 * 1024) throw new IOException("This file is too large to preview on the phone.");
    String key = sha(new JSONArray().put(owner).put(entry.getString("id")).put(entry.getString("version")).toString().getBytes(StandardCharsets.UTF_8));
    File complete = new File(root, key + ".bin");
    if (!(complete.exists() && complete.length() == size)) {
      String id = download(owner, entry).getString("id"); long deadline = System.currentTimeMillis() + 40000;
      while (true) {
        JSONObject job = jobs.get(id); String phase; synchronized (job) { phase = job.getString("phase"); }
        if ("completed".equals(phase)) break;
        if ("failed".equals(phase)) { synchronized (job) { throw new IOException(job.optString("error", "The file could not be fetched for preview.")); } }
        if (System.currentTimeMillis() > deadline) throw new IOException("Still fetching this file for preview; try again in a moment.");
        Thread.sleep(250);
      }
    }
    return PhonePreview.preview(PhonePreview.file(complete, entry.getString("name")));
  }
  /** The phone's own Proxima, published to every computer so they can view it (each keeps the latest). */
  private JSONObject publishProxima(JSONObject snapshot) throws Exception {
    JSONArray all = connections(), done = new JSONArray(), failed = new JSONArray(); String body = snapshot.toString();
    for (int i = 0; i < all.length(); i++) {
      JSONObject device = all.getJSONObject(i);
      try { exchange("PUT", address(device.getString("address")) + "/v1/peer/proxima", open(device.getString("secret")), body, 60000); done.put(device.getString("name")); }
      catch (Exception error) { failed.put(device.getString("name") + ": " + error.getMessage()); }
    }
    return new JSONObject().put("published", done).put("failed", failed);
  }
  /** A replacement a computer left for this phone's Proxima, if any (the first found). */
  private Object peerReplacement() throws Exception {
    JSONArray all = connections();
    for (int i = 0; i < all.length(); i++) {
      JSONObject device = all.getJSONObject(i);
      try {
        JSONObject answer = exchange("GET", address(device.getString("address")) + "/v1/peer/proxima/replacement", open(device.getString("secret")), null, 30000);
        if (answer.optJSONObject("replacement") != null) return answer.getJSONObject("replacement").put("ownerId", device.getString("id"));
      } catch (Exception ignored) { /* offline computers simply have nothing to offer now */ }
    }
    return JSONObject.NULL;
  }
  /** One JSON request with any method (the shared helper only knows GET and POST). */
  private JSONObject exchange(String method, String url, String token, String body, int timeout) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection(); c.setInstanceFollowRedirects(false); c.setConnectTimeout(15000); c.setReadTimeout(timeout);
    c.setRequestMethod(method); c.setRequestProperty("Authorization", "Bearer " + token);
    if (body != null) { c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/json"); try (OutputStream out = c.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); } }
    int status = c.getResponseCode();
    if (status < 200 || status >= 300) { String detail = ""; try (InputStream error = c.getErrorStream()) { if (error != null) detail = new JSONObject(new String(readAll(error), StandardCharsets.UTF_8)).optString("message", ""); } catch (Exception ignored) {} c.disconnect(); throw new IOException(detail.isEmpty() ? "Remote operation failed (" + status + ")." : detail); }
    return largeJson(c);
  }
  private static byte[] readAll(InputStream input) throws IOException { ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[16384]; int count; while ((count = input.read(buffer)) >= 0) { bytes.write(buffer, 0, count); if (bytes.size() > 1024 * 1024) break; } return bytes.toByteArray(); }
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
      return read(cache).put("online",System.currentTimeMillis()-ownerResponses.getOrDefault(new URL(address(connection(owner).getString("address"))).getAuthority(),0L)<15000).put("stale",true).put("error", error.getMessage() == null ? "Owner unavailable." : error.getMessage());
    }
  }
  private synchronized JSONObject download(String owner, JSONObject entry) throws Exception {
    validate(entry); connection(owner);
    if (!"file".equals(entry.getString("kind"))) throw new IOException("Choose a file.");
    for (JSONObject existing : jobs.values()) synchronized (existing) {
      if (!"upload".equals(existing.optString("direction")) && owner.equals(existing.optString("ownerId")) && entry.getString("id").equals(existing.getJSONObject("entry").getString("id")) && entry.getString("version").equals(existing.getJSONObject("entry").getString("version")) && !"failed".equals(existing.getString("phase"))) return new JSONObject(existing.toString());
    }
    String id = UUID.randomUUID().toString();
    JSONObject job = new JSONObject().put("id", id).put("ownerId", owner).put("entry", entry).put("phase", "queued").put("bytes", 0); jobs.put(id, job);
    String transferKey=owner+"|"+entry.getString("id")+"|"+entry.getString("version");Object transferLock=transferLocks.computeIfAbsent(transferKey,key->new Object());
    Future<?> worker = downloads.submit(() -> { try { synchronized(transferLock){if(Thread.currentThread().isInterrupted())throw new IOException("Transfer paused. Retry to resume.");transfer(owner, entry, job);} } catch (Exception error) { try { synchronized (job) { job.put("phase", "failed").put("error", error.getMessage() == null ? "Transfer interrupted. Retry to resume." : error.getMessage()); } } catch (Exception ignored) {} } finally { workers.remove(id); } });
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
  void exportDownload(String owner,JSONObject entry,android.net.Uri tree,String relative)throws Exception {String key=sha(new JSONArray().put(owner).put(entry.getString("id")).put(entry.getString("version")).toString().getBytes(StandardCharsets.UTF_8));PhoneDownloads.export(context,checkedFile(owner,key),tree,relative);}
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
  private HttpURLConnection editRequest(String owner,String route,JSONObject body)throws Exception{JSONObject peer=connection(owner);return http(address(peer.getString("address"))+route,open(peer.getString("secret")),null,body);}
  private final java.util.Map<String, JSONObject> workspaceDocuments = new java.util.concurrent.ConcurrentHashMap<>();
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
  private HttpURLConnection http(String url, String token, String version, JSONObject body, String range) throws Exception { return http(url, token, version, body, range, null); }
  private HttpURLConnection http(String url, String token, String version, JSONObject body, String range, String knownRevision) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection(); c.setInstanceFollowRedirects(false); c.setConnectTimeout(15000); c.setReadTimeout(30000);
    if (knownRevision != null) c.setRequestProperty("X-Papers-Known-Revision", knownRevision);
    if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
    if (version != null) c.setRequestProperty("If-Match", '"' + version + '"');
    if (range != null) c.setRequestProperty("Range", range);
    if (body != null) { c.setRequestMethod("POST"); c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/json"); try (OutputStream out = c.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); } }
    int status = c.getResponseCode();ownerResponses.put(new URL(url).getAuthority(),System.currentTimeMillis()); if (status < 200 || status >= 300) { c.disconnect(); throw new IOException(status == 412 ? "Source changed. Refresh before downloading." : status == 401 ? "Access revoked. Pair again." : "Remote operation failed (" + status + ")."); }
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
  private JSONObject workspaceResource(String remote)throws Exception {
    if(!remote.startsWith("\\\\papers~"))throw new IOException("Not a paired device path.");int separator=remote.indexOf('\\',9);if(separator<0)throw new IOException("A file or folder path is required.");String peer=remote.substring(9,separator);if(!peer.matches("[a-f0-9-]{36}"))throw new IOException("Invalid paired device identity.");String parent="";JSONObject found=null;
    for(String part:remote.substring(separator+1).split("\\\\")){if(part.isEmpty())continue;int offset=0;found=null;do{JSONObject listing=browse(peer,parent,offset);JSONArray entries=listing.getJSONArray("entries");for(int i=0;i<entries.length();i++){JSONObject entry=entries.getJSONObject(i);if(entry.getString("name").equalsIgnoreCase(part)){found=entry;break;}}if(found!=null)break;offset=listing.isNull("nextOffset")?-1:listing.optInt("nextOffset",-1);}while(offset>=0);if(found==null)throw new IOException("Workspace content is not available on the peer yet.");parent=found.getString("id");}
    return new JSONObject().put("ownerId",peer).put("entry",found);
  }
  private static String workspaceUri(String raw)throws Exception {
    if(raw.startsWith("content://"))return raw;String base=android.os.Environment.getExternalStorageDirectory().getCanonicalPath();File file=new File(raw).getCanonicalFile();if(!file.getPath().startsWith(base+"/"))throw new IOException("Workspace storage is outside phone shared storage.");return android.provider.DocumentsContract.buildDocumentUri("com.android.externalstorage.documents","primary:"+file.getPath().substring(base.length()+1)).toString();
  }
  private JSONObject workspaceTransfer(JSONObject request)throws Exception {
    JSONArray paths=request.getJSONArray("paths");if(paths.length()!=1)throw new IOException("Workspace transfer expects one immutable content file.");String source=paths.getString(0),destination=request.getString("destination");
    if(destination.startsWith("\\\\papers~")){
      JSONObject target=workspaceResource(destination),folder=target.getJSONObject("entry");String uri=workspaceUri(source);File file=PhoneStorage.file(android.net.Uri.parse(uri));if(file==null)throw new IOException("Workspace content is unavailable.");JSONObject job=uploadPhone(target.getString("ownerId"),new JSONObject().put("folderId",folder.getString("id")).put("name",file.getName()).put("uri",uri));Future<?> work=workers.get(job.getString("id"));if(work!=null)work.get();JSONObject result=jobs.get(job.getString("id"));if(result==null||!result.optString("phase").equals("completed"))throw new IOException(result==null?"Workspace upload was not confirmed.":result.optString("error","Workspace upload is pending."));return new JSONObject().put("ok",true);
    }
    JSONObject target=workspaceResource(source),entry=target.getJSONObject("entry");String peer=target.getString("ownerId");JSONObject job=download(peer,entry);Future<?> work=workers.get(job.getString("id"));if(work!=null)work.get();JSONObject result=jobs.get(job.getString("id"));if(result==null||!result.optString("phase").equals("completed"))throw new IOException(result==null?"Workspace download was not confirmed.":result.optString("error","Workspace download is pending."));return saveCacheToFolder(peer,new JSONObject().put("entry",entry).put("destinationUri",workspaceUri(destination))).put("ok",true);
  }
  private String hex(byte[] bytes) { StringBuilder text = new StringBuilder(); for (byte value : bytes) text.append(String.format(Locale.ROOT, "%02x", value & 255)); return text.toString(); }
  private javax.crypto.SecretKey key() throws Exception { KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); if (!store.containsAlias("papers-connections")) { KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"); generator.init(new KeyGenParameterSpec.Builder("papers-connections", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); generator.generateKey(); } return (javax.crypto.SecretKey) store.getKey("papers-connections", null); }
  private String seal(String value) throws Exception { Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key()); return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP); }
  private String open(String value) throws Exception { String[] parts = value.split(":"); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP))); return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8); }
}
