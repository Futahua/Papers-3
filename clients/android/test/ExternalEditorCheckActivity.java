package com.futahua.papers.mobile;
import android.app.Activity;
import android.os.Bundle;
import android.os.ResultReceiver;
import android.net.Uri;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Separate test-package UID checks the exact content-URI grant, not instrumentation privileges. */
public final class ExternalEditorCheckActivity extends Activity {
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);Bundle result=new Bundle();
    ResultReceiver receiver=getIntent().getParcelableExtra("receiver");
    try {
      int uid=android.os.Process.myUid();if(uid==getIntent().getIntExtra("ownerUid",-1))throw new Exception("Fixture shares owner UID");
      Uri working=getIntent().getData();if(working==null||!"com.futahua.papers.mobile.files".equals(working.getAuthority()))throw new Exception("Wrong fixture URI");
      boolean cachedWriteRefused=false;
      try(OutputStream output=getContentResolver().openOutputStream(Uri.parse(getIntent().getStringExtra("cacheUri")),"wt")){if(output!=null)output.write(1);}
      catch(Exception expected){cachedWriteRefused=true;}
      if(!cachedWriteRefused)throw new Exception("Read cache allowed writing");
      try(OutputStream output=getContentResolver().openOutputStream(working,"wt")){if(output==null)throw new Exception("Missing working stream");output.write("Generated separate-UID edit".getBytes(StandardCharsets.UTF_8));}
      result.putInt("uid",uid);result.putBoolean("cacheWriteRefused",cachedWriteRefused);result.putBoolean("passed",true);
    } catch(Exception error){result.putString("failure",error.toString());}
    if(receiver!=null)receiver.send(0,result);finish();
  }
}
