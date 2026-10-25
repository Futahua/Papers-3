package com.futahua.papers.mobile;
import android.app.*;
import android.content.Intent;
import android.os.Bundle;
import org.json.*;
import java.io.*;

/** Private real-device fixture; credentials never enter instrumentation output. */
public final class PeerCheck extends Instrumentation {
  @Override public void onCreate(Bundle args) { start(); }
  @Override public void onStart() {
    Bundle result = new Bundle();
    try {
      PhonePeerServer peer = new PhonePeerServer(getTargetContext());
      JSONObject data = new JSONObject().put("owner", peer.owner).put("invitations", MobileFiles.get(getTargetContext()).peerInvitations(peer.owner));
      try (FileOutputStream out = getTargetContext().openFileOutput("peer-check.json", 0)) { out.write(data.toString().getBytes("UTF-8")); }
      startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      result.putString("result", "Peer fixture prepared"); finish(Activity.RESULT_OK, result);
    } catch (Exception error) { result.putString("error", error.toString()); finish(Activity.RESULT_CANCELED, result); }
  }
}
