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
      if(!arguments.getString("editStage","").isEmpty()){editCheck(files,result);finish(Activity.RESULT_OK,result);return;}
      if(!arguments.getString("backpackStage","").isEmpty()){backpackCheck(files,result);finish(Activity.RESULT_OK,result);return;}
      if(!arguments.getString("mutationStage","").isEmpty()){mutationCheck(files,result);finish(Activity.RESULT_OK,result);return;}
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
  private void editCheck(MobileFiles files,Bundle result) throws Exception {
    if("resume".equals(arguments.getString("editStage"))){
      File checkpoint=new File(getTargetContext().getFilesDir(),"generated-edit-recovery.json");JSONObject retained;
      try(InputStream input=new FileInputStream(checkpoint)){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[1024];int count;while((count=input.read(buffer))!=-1)bytes.write(buffer,0,count);retained=new JSONObject(bytes.toString("UTF-8"));}
      JSONObject before=new MobileEditCopies(getTargetContext()).read(retained.getString("editId"));if(!"uncertain".equals(before.getString("phase")))throw new IOException("Interrupted save state not retained");
      JSONObject saved=(JSONObject)files.call(new JSONObject().put("operation","edit-save").put("editId",retained.getString("editId")));
      if(!"saved".equals(saved.getString("phase"))||!before.getString("saveId").equals(saved.getString("saveId"))||!before.getString("uploadId").equals(saved.getString("uploadId")))throw new IOException("Resume did not keep saved identities");
      result.putString("result","PASS: restarted phone resumed retained owner prefix and same save/upload identities");return;
    }
    files.call(new JSONObject().put("operation","pair").put("address",arguments.getString("address")).put("code",arguments.getString("code")));
    org.json.JSONArray devices=((JSONObject)files.call(new JSONObject().put("operation","status"))).getJSONArray("devices");String owner=devices.getJSONObject(devices.length()-1).getString("id");
    JSONObject shares=(JSONObject)files.call(new JSONObject().put("operation","browse").put("ownerId",owner));String folder=shares.getJSONArray("entries").getJSONObject(0).getString("id");
    JSONObject source=browse(files,owner,folder).getJSONArray("entries").getJSONObject(0);
    JSONObject edit=(JSONObject)files.call(new JSONObject().put("operation","edit-begin").put("ownerId",owner).put("entry",source));String id=edit.getString("id");
    byte[] bytes="Generated phone edit, retained locally".getBytes(java.nio.charset.StandardCharsets.UTF_8);
    if("loss".equals(arguments.getString("editStage"))){bytes=new byte[5*1024*1024];new java.security.SecureRandom().nextBytes(bytes);}
    android.net.Uri uri=new android.net.Uri.Builder().scheme("content").authority("com.futahua.papers.mobile.files").appendPath("edit").appendPath(id).build();
    try(OutputStream output=getTargetContext().getContentResolver().openOutputStream(uri,"wt")){if(output==null)throw new IOException("Missing editable URI stream");output.write(bytes);}
    File original=new File(new File(new File(getTargetContext().getFilesDir(),"remote-edits"),id),"original.bin");
    if(!MobileEditCopies.digest(original).equals(edit.getJSONObject("session").getString("sourceSha256")))throw new IOException("Editable URI changed the original");
    if("loss".equals(arguments.getString("editStage"))){
      boolean refused=false;try{files.call(new JSONObject().put("operation","edit-save").put("editId",id));}catch(Exception expected){refused=true;}
      JSONObject retained=new MobileEditCopies(getTargetContext()).read(id);if(!refused||!"uncertain".equals(retained.getString("phase")))throw new IOException("Lost acknowledgement was not retained");
      try(FileOutputStream output=new FileOutputStream(new File(getTargetContext().getFilesDir(),"generated-edit-recovery.json"))){output.write(new JSONObject().put("editId",id).put("ownerId",owner).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));output.getFD().sync();}
      result.putString("result","PASS: lost phone upload acknowledgement retained local snapshot and save/upload identities");return;
    }
    JSONObject saved=(JSONObject)files.call(new JSONObject().put("operation","edit-save").put("editId",id));
    if("conflict".equals(arguments.getString("editStage"))){
      if(!"conflict".equals(saved.getString("phase")))throw new IOException("Changed source was overwritten");
      if(!MobileEditCopies.digest(original).equals(edit.getJSONObject("session").getString("sourceSha256")))throw new IOException("Conflict lost original");
      result.putString("result","PASS: external owner edit returned conflict; phone original, working copy and save snapshot retained");return;
    }
    if(!"saved".equals(saved.getString("phase")))throw new IOException("Phone save not confirmed: "+saved.getString("phase"));
    JSONObject repeated=(JSONObject)files.call(new JSONObject().put("operation","edit-save").put("editId",id));if(!saved.getString("saveId").equals(repeated.getString("saveId")))throw new IOException("Retry changed save identity");
    JSONObject updated=browse(files,owner,folder).getJSONArray("entries").getJSONObject(0);JSONObject download=(JSONObject)files.call(new JSONObject().put("operation","download").put("ownerId",owner).put("entry",updated));
    boolean done=false;for(int attempt=0;attempt<300;attempt++){org.json.JSONArray jobs=((JSONObject)files.call(new JSONObject().put("operation","status"))).getJSONArray("jobs");for(int i=0;i<jobs.length();i++){JSONObject job=jobs.getJSONObject(i);if(download.getString("id").equals(job.getString("id"))){if("failed".equals(job.getString("phase")))throw new IOException(job.optString("error"));done="completed".equals(job.getString("phase"));}}if(done)break;Thread.sleep(100);}if(!done)throw new IOException("Saved file verification download timed out");
    String expected=MobileEditCopies.digest(new MobileEditCopies(getTargetContext()).working(id));org.json.JSONArray copies=(org.json.JSONArray)files.call(new JSONObject().put("operation","offline").put("ownerId",owner));boolean verified=false;
    for(int i=0;i<copies.length();i++)if(updated.getString("version").equals(copies.getJSONObject(i).getJSONObject("entry").getString("version")))verified=expected.equals(copies.getJSONObject(i).getString("sha256"));
    if(!verified)throw new IOException("Owner saved bytes do not match phone working copy");
    JSONObject reopened=new MobileEditCopies(getTargetContext()).read(id);if(!"saved".equals(reopened.getString("phase")))throw new IOException("Save receipt did not survive local owner recreation");
    result.putString("result","PASS: phone native session, editable URI, retained original, checked HTTP save, duplicate receipt, verified owner bytes, reopened local journal");
  }
  private JSONObject browse(MobileFiles files,String owner,String folder) throws Exception {return (JSONObject)files.call(new JSONObject().put("operation","browse").put("ownerId",owner).put("resourceId",folder));}
  private void backpackCheck(MobileFiles files,Bundle result) throws Exception {
    boolean offline="offline".equals(arguments.getString("backpackStage"));
    if(!arguments.getString("code","").isEmpty())files.call(new JSONObject().put("operation","pair").put("address",arguments.getString("address")).put("code",arguments.getString("code")));
    org.json.JSONArray devices=((JSONObject)files.call(new JSONObject().put("operation","status"))).getJSONArray("devices");String owner=devices.getJSONObject(devices.length()-1).getString("id");
    JSONObject catalog=(JSONObject)files.call(new JSONObject().put("operation","backpacks").put("ownerId",owner));if(catalog.getBoolean("online")==offline||catalog.getJSONArray("entries").length()!=1)throw new IOException("Wrong shared catalog state");
    String id=catalog.getJSONArray("entries").getJSONObject(0).getString("id");JSONObject response=(JSONObject)files.call(new JSONObject().put("operation","backpack-snapshot").put("ownerId",owner).put("resourceId",id));if(response.getBoolean("online")==offline)throw new IOException("Wrong snapshot state");
    org.json.JSONArray tasks=response.getJSONObject("snapshot").getJSONObject("records").getJSONArray("tasks");boolean found=false;for(int i=0;i<tasks.length();i++){JSONObject task=tasks.getJSONObject(i);if("Source task".equals(task.getString("name")))found="Exact copied note".equals(task.getString("note"))&&task.getInt("weight")==7;}if(!found)throw new IOException("Approved facts were not retained");
    Activity activity=startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));Thread.sleep(1500);
    String script="(async()=>{const wait=async(test)=>{for(let n=0;n<600;n++){if(test())return;await new Promise(r=>setTimeout(r,100));}throw Error('UI wait timed out');};try{document.querySelector('#data').click();const root=document.querySelector('section[aria-label=\\\"Proxima on another device\\\"]');await wait(()=>[...root.querySelectorAll('button')].some(b=>b.textContent==='Open Proxima'));[...root.querySelectorAll('button')].filter(b=>b.textContent==='Open Proxima').at(-1).click();await wait(()=>[...root.querySelectorAll('button')].some(b=>b.textContent==='View'));[...root.querySelectorAll('button')].find(b=>b.textContent==='View').click();await wait(()=>root.innerText.includes('Source task'));if(root.querySelector('input,textarea')||root.innerText.includes('Create local copy')||root.innerText.includes('Copy selected'))throw Error('Phone source exposes edits');[...root.querySelectorAll('button')].find(b=>b.textContent==='Calendar and timeline').click();const frame=root.querySelector('iframe');await wait(()=>getComputedStyle(frame).display!=='none'&&frame.clientWidth>0&&frame.clientHeight>0&&!root.innerText.includes('Source task'));await wait(()=>frame.contentDocument?.body?.innerText.includes('Read-only source meeting'));const child=frame.contentDocument;if(frame.contentWindow.Store!==undefined)throw Error('Source frame loaded a local Store');const calendarButton=[...child.querySelectorAll('button')].find(b=>b.textContent.includes('Read-only source meeting'));calendarButton.click();await wait(()=>child.querySelector('#details').open);if(!child.querySelector('#details').innerText.includes('Source calendar detail'))throw Error('Calendar detail missing');child.querySelector('#closeDetails').click();child.querySelector('#timelineTab').click();await wait(()=>[...child.querySelectorAll('.exact-interval')].some(b=>b.getAttribute('aria-label')==='Read-only source blob'));if([...child.querySelectorAll('input,textarea,.exact-unlink,.exact-actions')].some(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'))throw Error('Source overview exposes edits');child.querySelector('#zoomIn').click();child.querySelector('#today').click();window.backpackCheck='PASS: readonly shared Proxima calendar and timeline UI '+JSON.stringify({display:getComputedStyle(frame).display,width:frame.clientWidth,height:frame.clientHeight,recordsHidden:frame.previousElementSibling.hidden});}catch(e){window.backpackCheck='FAIL: '+e.message;}})();";
    runOnMainSync(()->{WebView view=(WebView)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);view.evaluateJavascript(script,null);});
    for(int attempt=0;attempt<1200;attempt++){CountDownLatch ready=new CountDownLatch(1);final String[] state={""};runOnMainSync(()->{WebView view=(WebView)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);view.evaluateJavascript("window.backpackCheck||''",text->{state[0]=text;ready.countDown();});});if(!ready.await(5,TimeUnit.SECONDS))throw new IOException("UI response timed out");if(state[0].contains("FAIL:"))throw new IOException(state[0]);if(state[0].contains("PASS:")){captureOverview(activity);result.putString("uiState",state[0]);result.putString("result",offline?"PASS: disconnected owner; cached catalog and approved Proxima facts; readonly calendar/timeline UI":"PASS: paired data-only grant; live Proxima owner facts; readonly calendar/timeline UI");return;}Thread.sleep(100);}throw new IOException("Readonly data UI timed out");
  }
  private void captureOverview(Activity activity) throws Exception {
    CountDownLatch done=new CountDownLatch(1);final int[] status={-1};final android.graphics.Bitmap[] bitmap={null};
    runOnMainSync(()->{WebView view=(WebView)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);view.postVisualStateCallback(1,new WebView.VisualStateCallback(){@Override public void onComplete(long requestId){view.invalidate();view.postDelayed(()->{android.view.View decor=activity.getWindow().getDecorView();bitmap[0]=android.graphics.Bitmap.createBitmap(decor.getWidth(),decor.getHeight(),android.graphics.Bitmap.Config.ARGB_8888);android.view.PixelCopy.request(activity.getWindow(),bitmap[0],value->{status[0]=value;done.countDown();},new android.os.Handler(android.os.Looper.getMainLooper()));},200);}});});
    if(!done.await(10,TimeUnit.SECONDS)||status[0]!=android.view.PixelCopy.SUCCESS)throw new IOException("Overview screenshot unavailable");
    java.io.File file=new java.io.File(getTargetContext().getExternalFilesDir(null),"papers-overview-check.png");try(java.io.FileOutputStream output=new java.io.FileOutputStream(file)){bitmap[0].compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);}bitmap[0].recycle();
  }
  private JSONObject named(JSONObject listing,String name) throws Exception {org.json.JSONArray entries=listing.getJSONArray("entries");for(int i=0;i<entries.length();i++)if(name.equals(entries.getJSONObject(i).getString("name")))return entries.getJSONObject(i);throw new IOException("Missing check entry: "+name);}
  private void completed(MobileFiles files,String owner,String id) throws Exception {
    for(int attempt=0;attempt<300;attempt++){org.json.JSONArray jobs=(org.json.JSONArray)files.call(new JSONObject().put("operation","changes").put("ownerId",owner));for(int i=0;i<jobs.length();i++){JSONObject job=jobs.getJSONObject(i);if(id.equals(job.getString("commandId"))){String phase=job.getString("phase");if("completed".equals(phase))return;if("failed".equals(phase)||"uncertain".equals(phase))throw new IOException(job.optString("error",phase));}}Thread.sleep(100);}throw new IOException("File change did not complete");
  }
  private void change(MobileFiles files,String owner,JSONObject entry,String operation,JSONObject extra) throws Exception {
    String id=java.util.UUID.randomUUID().toString();JSONObject command=new JSONObject().put("commandId",id).put("operation",operation).put("resourceId",entry.getString("id")).put("expectedVersion",entry.getString("version"));java.util.Iterator<String> keys=extra.keys();while(keys.hasNext()){String key=keys.next();command.put(key,extra.get(key));}files.call(new JSONObject().put("operation","change").put("ownerId",owner).put("command",command));completed(files,owner,id);
  }
  private void mutationCheck(MobileFiles files,Bundle result) throws Exception {
    File checkpoint=new File(getTargetContext().getCacheDir(),"mutation-check.json");
    if("ui".equals(arguments.getString("mutationStage"))){
      Activity activity=startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));Thread.sleep(1500);
      String script="(async()=>{const wait=async(test)=>{for(let n=0;n<150;n++){if(test())return;await new Promise(r=>setTimeout(r,100));}throw Error('UI wait timed out');};const click=(root,label)=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent===label&&!b.disabled);if(!b)throw Error('Missing control '+label);b.click();};const row=name=>[...document.querySelectorAll('.navigator-row')].find(r=>r.firstElementChild?.textContent===name);try{const devices=[...document.querySelectorAll('.navigator-row')];click(devices.at(-1),'Browse');await wait(()=>row('Device check files'));click(row('Device check files'),'Open folder');await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='New folder'&&!b.disabled));click(document,'New folder');await wait(()=>document.querySelector('section form'));let form=document.querySelector('section form');form.querySelector('input').value='ui-created';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await wait(()=>row('ui-created'));click(row('ui-created'),'Rename');await wait(()=>document.querySelector('section form'));form=document.querySelector('section form');form.querySelector('input').value='ui-renamed';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await wait(()=>row('ui-renamed')&&!row('ui-created'));click(row('ui-renamed'),'Recycle');await wait(()=>[...document.querySelectorAll('.navigator-row')].some(r=>r.firstElementChild?.textContent.includes('Move ui-renamed to')));const confirm=[...document.querySelectorAll('.navigator-row')].find(r=>r.firstElementChild?.textContent.includes('Move ui-renamed to'));click(confirm,'Recycle');await wait(()=>!row('ui-renamed')&&!document.body.innerText.includes('Move ui-renamed to'));window.deviceCheck='PASS: shared UI create/rename/recycle forms, native bridge, automatic refresh';}catch(e){window.deviceCheck='FAIL: '+e.message;}})();";
      runOnMainSync(()->{WebView view=(WebView)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);view.evaluateJavascript(script,null);});
      for(int attempt=0;attempt<650;attempt++){CountDownLatch ready=new CountDownLatch(1);final String[] state={""};runOnMainSync(()->{WebView view=(WebView)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);view.evaluateJavascript("window.deviceCheck||''",text->{state[0]=text;ready.countDown();});});if(!ready.await(5,TimeUnit.SECONDS))throw new IOException("UI response timed out");if(state[0].contains("FAIL:"))throw new IOException(state[0]);if(state[0].contains("PASS:")){result.putString("result",state[0]);return;}Thread.sleep(100);}throw new IOException("UI operations timed out");
    }
    if("prepare".equals(arguments.getString("mutationStage"))){
      files.call(new JSONObject().put("operation","pair").put("address",arguments.getString("address")).put("code",arguments.getString("code")));
      JSONObject state=(JSONObject)files.call(new JSONObject().put("operation","status"));org.json.JSONArray devices=state.getJSONArray("devices");String owner=devices.getJSONObject(devices.length()-1).getString("id");
      JSONObject shares=(JSONObject)files.call(new JSONObject().put("operation","browse").put("ownerId",owner));String folder=shares.getJSONArray("entries").getJSONObject(0).getString("id");JSONObject listing=browse(files,owner,folder);if(!listing.getJSONObject("capabilities").getBoolean("changes"))throw new IOException("Write grant missing");
      change(files,owner,listing.getJSONObject("folder"),"create-folder",new JSONObject().put("newName","phone-created"));
      JSONObject entry=named(browse(files,owner,folder),"device-check.bin");String id=java.util.UUID.randomUUID().toString();
      JSONObject command=new JSONObject().put("commandId",id).put("operation","rename").put("resourceId",entry.getString("id")).put("expectedVersion",entry.getString("version")).put("newName","response-loss.bin");
      boolean refused=false;try{files.call(new JSONObject().put("operation","change").put("ownerId",owner).put("command",command));}catch(IOException expected){refused=true;}if(!refused)throw new IOException("Fixture must suppress acknowledgement");
      JSONObject fresh=new JSONObject(command.toString()).put("commandId",java.util.UUID.randomUUID().toString());boolean blocked=false;try{files.call(new JSONObject().put("operation","change").put("ownerId",owner).put("command",fresh));}catch(IOException expected){blocked=expected.getMessage().contains("Retry the saved request");}if(!blocked)throw new IOException("A fresh operation was allowed before resolving the saved request");
      org.json.JSONArray pending=((JSONObject)files.call(new JSONObject().put("operation","status"))).getJSONArray("commandJobs");boolean retained=false;for(int i=0;i<pending.length();i++)if(id.equals(pending.getJSONObject(i).getString("commandId")))retained="uncertain".equals(pending.getJSONObject(i).getString("phase"));if(!retained)throw new IOException("Unacknowledged request was not retained");
      try(FileOutputStream output=new FileOutputStream(checkpoint)){output.write(new JSONObject().put("owner",owner).put("folder",folder).put("commandId",id).toString().getBytes("UTF-8"));output.getFD().sync();}
      result.putString("result","PASS: native create, durable acceptance with suppressed response, saved retry identity; ready for process restart");return;
    }
    JSONObject saved;try(InputStream input=new FileInputStream(checkpoint)){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] block=new byte[1024];int count;while((count=input.read(block))>=0)bytes.write(block,0,count);saved=new JSONObject(bytes.toString("UTF-8"));}
    String owner=saved.getString("owner"),folder=saved.getString("folder"),id=saved.getString("commandId");
    org.json.JSONArray pending=((JSONObject)files.call(new JSONObject().put("operation","status"))).getJSONArray("commandJobs");boolean retained=false;for(int i=0;i<pending.length();i++)if(id.equals(pending.getJSONObject(i).getString("commandId")))retained="uncertain".equals(pending.getJSONObject(i).getString("phase"));if(!retained)throw new IOException("Retry identity did not survive process restart");
    files.call(new JSONObject().put("operation","change-retry").put("ownerId",owner).put("commandId",id));completed(files,owner,id);
    JSONObject listing=browse(files,owner,folder),entry=named(listing,"response-loss.bin"),destination=named(listing,"phone-created");
    JSONObject destListing=browse(files,owner,destination.getString("id"));
    change(files,owner,entry,"copy",new JSONObject().put("destinationId",destination.getString("id")).put("destinationVersion",destListing.getJSONObject("folder").getString("version")));
    change(files,owner,named(browse(files,owner,folder),"response-loss.bin"),"rename",new JSONObject().put("newName","phone-moved.bin"));
    entry=named(browse(files,owner,folder),"phone-moved.bin");destListing=browse(files,owner,destination.getString("id"));
    change(files,owner,entry,"move",new JSONObject().put("destinationId",destination.getString("id")).put("destinationVersion",destListing.getJSONObject("folder").getString("version")));
    JSONObject copied=named(browse(files,owner,destination.getString("id")),"response-loss.bin");JSONObject download=(JSONObject)files.call(new JSONObject().put("operation","download").put("ownerId",owner).put("entry",copied));boolean downloaded=false;
    for(int attempt=0;attempt<300;attempt++){org.json.JSONArray transfers=((JSONObject)files.call(new JSONObject().put("operation","status"))).getJSONArray("jobs");for(int i=0;i<transfers.length();i++){JSONObject job=transfers.getJSONObject(i);if(download.getString("id").equals(job.getString("id"))){if("failed".equals(job.getString("phase")))throw new IOException(job.optString("error"));downloaded="completed".equals(job.getString("phase"));}}if(downloaded)break;Thread.sleep(100);}if(!downloaded)throw new IOException("Changed file download failed");
    org.json.JSONArray offline=(org.json.JSONArray)files.call(new JSONObject().put("operation","offline").put("ownerId",owner));if(offline.length()!=1||!arguments.getString("sha256").equals(offline.getJSONObject(0).getString("sha256")))throw new IOException("Changed file bytes differ");
    change(files,owner,named(browse(files,owner,folder),"phone-created"),"delete",new JSONObject());if(browse(files,owner,folder).getJSONArray("entries").length()!=0)throw new IOException("Owner folder did not refresh after recycle");
    Activity activity=startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));Thread.sleep(2000);CountDownLatch ready=new CountDownLatch(1);
    runOnMainSync(()->{WebView view=(WebView)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);view.evaluateJavascript("document.body.innerText",text->{result.putString("uiText",text);ready.countDown();});});
    if(!ready.await(10,TimeUnit.SECONDS)||!result.getString("uiText","").contains("Papers device check"))throw new IOException("Updated shared UI failed");
    result.putString("result","PASS: request identity survives killed phone process; retry deduplicated; real native create/rename/copy/move/recycle; refreshed listing; verified copied bytes; shared UI");
  }
}
