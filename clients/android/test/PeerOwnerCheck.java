package com.futahua.papers.mobile;
import android.app.*;
import android.os.Bundle;
import org.json.*;
import java.util.UUID;
public final class PeerOwnerCheck extends Instrumentation {
  @Override public void onCreate(Bundle args){start();}
  @Override public void onStart(){Bundle results=new Bundle();PhoneOwnerEngine engine=new PhoneOwnerEngine(getTargetContext(),"peer-check-"+UUID.randomUUID()+".papers.local");
    try{
      JSONObject source=new JSONObject().put("ownerId","check-owner").put("backpackId","check-backpack");
      JSONObject before=engine.request(new JSONObject().put("operation","snapshot").put("source",source)).getJSONObject("snapshot");
      JSONObject command=new JSONObject().put("commandId",UUID.randomUUID().toString()).put("expectedSeq",before.getJSONObject("source").getLong("seq")).put("type","task.create").put("payload",new JSONObject().put("name","Isolated phone copy check"));
      JSONObject created=engine.request(new JSONObject().put("operation","command").put("source",source).put("command",command));if(!created.getJSONObject("command").getBoolean("ok"))throw new Exception(created.toString());
      JSONObject replacement=created.getJSONObject("snapshot");long seq=replacement.getJSONObject("source").getLong("seq");
      JSONObject copied=engine.request(new JSONObject().put("operation","replace").put("source",source).put("snapshot",replacement).put("expectedSeq",seq).put("from","isolated fixture"));
      if(!copied.getBoolean("replaced")||copied.getJSONObject("snapshot").getJSONObject("source").getLong("seq")!=seq+1)throw new Exception("Replacement checkpoint mismatch");
      boolean refused=false;try{engine.request(new JSONObject().put("operation","replace").put("source",source).put("snapshot",replacement).put("expectedSeq",seq).put("from","stale fixture"));}catch(Exception e){refused=true;}if(!refused)throw new Exception("Stale replacement accepted");
      java.lang.reflect.Field field=PhoneOwnerEngine.class.getDeclaredField("view");field.setAccessible(true);android.webkit.WebView web=(android.webkit.WebView)field.get(engine);
      java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);final String[] observed={null};
      runOnMainSync(()->web.evaluateJavascript("new Promise((resolve,reject)=>{const r=indexedDB.open('proxima-backups',1);r.onsuccess=()=>{const t=r.result.transaction('backups'),q=t.objectStore('backups').getAll();q.onsuccess=()=>{document.title='BACKUPS:'+q.result.length+':'+q.result[0].state.seq;resolve();};};})",v->done.countDown()));
      done.await(5,java.util.concurrent.TimeUnit.SECONDS);Thread.sleep(300);runOnMainSync(()->observed[0]=web.getTitle());
      if(!("BACKUPS:1:"+seq).equals(observed[0]))throw new Exception("Backup is missing: "+observed[0]);
      results.putString("result","4/4: isolated owner command, direct replacement, stale refusal, durable prior-state backup");finish(Activity.RESULT_OK,results);
    }catch(Exception e){results.putString("error",e.toString());finish(Activity.RESULT_CANCELED,results);}finally{engine.close();}
  }
}
