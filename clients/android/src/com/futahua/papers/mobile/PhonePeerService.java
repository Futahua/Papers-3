package com.futahua.papers.mobile;

import android.app.*;
import android.content.*;
import android.net.*;
import android.os.*;

/** Android, rather than an Activity or WebView, owns peer reachability. */
public final class PhonePeerService extends Service {
  private static volatile PhonePeerServer server;
  private final java.util.concurrent.ExecutorService network = java.util.concurrent.Executors.newSingleThreadExecutor();
  private ConnectivityManager connectivity;
  private ConnectivityManager.NetworkCallback callback;
  static void start(Context context) {
    context.startForegroundService(new Intent(context, PhonePeerService.class));
  }
  static org.json.JSONObject localFiles(org.json.JSONObject request)throws Exception {
    PhonePeerServer peer=server;if(peer==null)throw new java.io.IOException("Phone file owner is starting; try again.");return peer.localFiles(request);
  }
  static void changed() { PhonePeerServer peer = server; if (peer != null) peer.changed(false); }
  static void announce() { PhonePeerServer peer = server; if (peer != null) new Thread(peer::announce, "Papers-peer-announce").start(); }
  @Override public void onCreate() {
    super.onCreate();
    NotificationManager notifications = getSystemService(NotificationManager.class);
    notifications.createNotificationChannel(new NotificationChannel("papers-sharing", "Papers sharing", NotificationManager.IMPORTANCE_LOW));
    PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification notification = new Notification.Builder(this, "papers-sharing")
      .setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("Papers is sharing")
      .setContentText("Available to your computers over Tailscale").setContentIntent(open).setOngoing(true).build();
    startForeground(48240, notification);
    MobileFiles.get(this).startEditingWorker();
    network.execute(() -> {
      try { PhonePeerServer peer = new PhonePeerServer(this); peer.start(); server = peer; peer.announce(); }
      catch (Exception error) { android.util.Log.e("PapersPeer", "Peer startup failed", error); stopSelf(); }
    });
    connectivity = getSystemService(ConnectivityManager.class);
    callback = new ConnectivityManager.NetworkCallback() {
      @Override public void onAvailable(Network ignored) { network.execute(() -> { PhonePeerServer peer = server; if (peer != null) peer.announce(); }); }
    };
    connectivity.registerDefaultNetworkCallback(callback);
  }
  @Override public int onStartCommand(Intent intent, int flags, int startId) { network.execute(() -> { PhonePeerServer peer = server; if (peer != null) peer.announce(); }); return START_STICKY; }
  @Override public IBinder onBind(Intent intent) { return null; }
  @Override public void onDestroy() {
    MobileFiles.get(this).stopEditingWorker();
    if (callback != null) connectivity.unregisterNetworkCallback(callback);
    PhonePeerServer peer = server; server = null;
    if (peer != null) try { peer.close(); } catch (Exception ignored) {}
    network.shutdownNow(); super.onDestroy();
  }
  public static final class Boot extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) { if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) start(context); }
  }
}
