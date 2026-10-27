package com.futahua.papers.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;

/**
 * Native Flow on this phone reaches Proxima's embed bridge here, the phone
 * counterpart of the desktop host's flow-embed-exchange mailbox.
 *
 * Bound to 127.0.0.1 only, and every request must carry the pairing token the
 * creator approved in Papers (see MainActivity pair-flow). Without the token,
 * any app on the phone could read embedded files and saved embed data.
 *
 * It owns no file content or sync state: requests go to the phone's Proxima
 * owner page (flow-embed-bridge.js through PhoneOwnerEngine), which answers with
 * the existing workspace replica; file bytes come from WorkspaceFiles.
 */
final class FlowEmbedServer {
  static final int PORT = 47812;
  private static final int MAX_JSON = 8 * 1024 * 1024;
  private static final long MAX_UPLOAD = 200L * 1024 * 1024;
  private final Context context;
  private final PhonePeerServer peer;
  private final ExecutorService connections = Executors.newFixedThreadPool(4);
  private ServerSocket listener;
  private volatile boolean running;

  FlowEmbedServer(Context context, PhonePeerServer peer) {
    this.context = context.getApplicationContext();
    this.peer = peer;
  }

  /** The token Flow must present: the secret both apps are built with, or else one created
   * here and handed over by the pairing link. */
  static synchronized String token(Context context) {
    try (InputStream in = context.getAssets().open("flow-embeds.secret")) {
      String secret = new String(read(in, in.available()), StandardCharsets.UTF_8).trim();
      if (secret.matches("[0-9a-f]{64}")) return secret;
    } catch (IOException ignored) {}
    SharedPreferences prefs = context.getSharedPreferences("flow-embeds", Context.MODE_PRIVATE);
    String token = prefs.getString("token", null);
    if (token == null) {
      byte[] bytes = new byte[32];
      new SecureRandom().nextBytes(bytes);
      token = PhonePeerServer.hex(bytes);
      prefs.edit().putString("token", token).apply();
    }
    return token;
  }

  void start() throws IOException {
    listener = new ServerSocket();
    listener.setReuseAddress(true);
    // IPv4 loopback explicitly: getLoopbackAddress() is ::1 on some phones, and Flow dials 127.0.0.1.
    listener.bind(new InetSocketAddress(InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), PORT), 8);
    running = true;
    Thread accept = new Thread(() -> {
      while (running) {
        try {
          Socket socket = listener.accept();
          connections.execute(() -> serve(socket));
        } catch (Exception e) {
          if (running) android.util.Log.w("PapersFlow", "accept failed: " + e.getMessage());
        }
      }
    }, "Papers-flow-embeds");
    accept.setDaemon(true);
    accept.start();
  }

  void close() {
    running = false;
    try { if (listener != null) listener.close(); } catch (IOException ignored) {}
    connections.shutdownNow();
  }

  private void serve(Socket socket) {
    try (Socket connection = socket) {
      connection.setSoTimeout(60000);
      if (!connection.getInetAddress().isLoopbackAddress()) return;
      InputStream input = new BufferedInputStream(connection.getInputStream());
      OutputStream output = connection.getOutputStream();
      String[] first = line(input).split(" ");
      if (first.length != 3) return;
      String method = first[0];
      URI url = new URI(first[1]);
      Map<String, String> headers = new HashMap<>();
      for (;;) {
        String text = line(input);
        if (text.isEmpty()) break;
        int colon = text.indexOf(':');
        if (colon < 1 || headers.size() > 64) { json(output, 400, error("Invalid request.")); return; }
        headers.put(text.substring(0, colon).toLowerCase(Locale.ROOT), text.substring(colon + 1).trim());
      }
      String auth = headers.getOrDefault("authorization", "");
      String expected = "Bearer " + token(context);
      if (!MessageDigest.isEqual(auth.getBytes(StandardCharsets.UTF_8), expected.getBytes(StandardCharsets.UTF_8))) {
        json(output, 401, error("Flow is not paired with Papers."));
        return;
      }
      long length = Long.parseLong(headers.getOrDefault("content-length", "0"));
      Map<String, String> query = query(url.getRawQuery());
      String route = url.getPath();
      if (route.equals("/flow-embeds/exchange") && method.equals("POST")) {
        if (length < 0 || length > MAX_JSON) { json(output, 413, error("Request too large.")); return; }
        JSONObject request = new JSONObject(new String(read(input, (int) length), StandardCharsets.UTF_8));
        JSONObject owner = new JSONObject().put("operation", "flow-embeds")
          .put("wants", request.optJSONArray("wants") == null ? new JSONArray() : request.getJSONArray("wants"))
          .put("docs", request.optJSONArray("docs") == null ? new JSONArray() : request.getJSONArray("docs"))
          .put("lookups", request.optJSONArray("lookups") == null ? new JSONArray() : request.getJSONArray("lookups"));
        json(output, 200, peer.flowEmbeds(owner));
        return;
      }
      if (route.equals("/flow-embeds/file") && method.equals("GET")) {
        JSONObject path = WorkspaceFiles.get(context).call(new JSONObject()
          .put("operation", "path").put("workspaceId", query.get("workspaceId")).put("entryId", query.get("entryId")).put("name", "embed"));
        File file = new File(path.getString("path"));
        if (!path.optBoolean("available") || !file.isFile()) { json(output, 404, error("This file is not on the phone yet.")); return; }
        String head = "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: " + file.length()
          + "\r\nX-Embed-Hash: " + path.optString("hash", "") + "\r\nX-Embed-Name: " + URLEncoder.encode(file.getName(), "UTF-8")
          + "\r\nConnection: close\r\n\r\n";
        output.write(head.getBytes(StandardCharsets.UTF_8));
        try (InputStream in = new FileInputStream(file)) {
          byte[] buffer = new byte[64 * 1024];
          for (int n; (n = in.read(buffer)) > 0; ) output.write(buffer, 0, n);
        }
        output.flush();
        return;
      }
      if (route.equals("/flow-embeds/import") && method.equals("POST")) {
        String requestId = query.getOrDefault("requestId", ""), name = query.getOrDefault("name", "");
        if (!requestId.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}") || name.isEmpty() || name.length() > 200 || name.matches(".*[<>:\"/\\\\|?*\\x00-\\x1f].*")) {
          json(output, 400, error("Invalid import."));
          return;
        }
        if (length <= 0 || length > MAX_UPLOAD) { json(output, 413, error("This file is too large to embed from the phone.")); return; }
        File incoming = new File(WorkspaceFiles.get(context).call(new JSONObject().put("operation", "incoming-root")).getString("path"));
        File staged = new File(incoming, "flow-" + requestId);
        staged.mkdirs();
        File target = new File(staged, name);
        try {
          try (OutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[64 * 1024];
            long left = length;
            while (left > 0) {
              int n = input.read(buffer, 0, (int) Math.min(buffer.length, left));
              if (n < 0) throw new EOFException("The upload ended early.");
              out.write(buffer, 0, n);
              left -= n;
            }
          }
          JSONObject owner = new JSONObject().put("operation", "flow-embeds")
            .put("imports", new JSONArray().put(new JSONObject().put("requestId", requestId).put("path", target.getPath())));
          json(output, 200, peer.flowEmbeds(owner));
        } finally {
          target.delete();
          staged.delete();
        }
        return;
      }
      json(output, 404, error("Unknown request."));
    } catch (Exception e) {
      android.util.Log.w("PapersFlow", "request failed: " + e.getMessage());
    }
  }

  private static JSONObject error(String message) {
    try { return new JSONObject().put("ok", false).put("message", message); } catch (Exception e) { return new JSONObject(); }
  }

  private static void json(OutputStream out, int status, JSONObject value) throws IOException {
    byte[] body = value.toString().getBytes(StandardCharsets.UTF_8);
    String reason = status == 200 ? "OK" : status == 401 ? "Unauthorized" : status == 404 ? "Not Found" : status == 413 ? "Payload Too Large" : "Bad Request";
    out.write(("HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
    out.write(body);
    out.flush();
  }

  private static String line(InputStream in) throws IOException {
    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    for (int b; (b = in.read()) >= 0; ) {
      if (b == '\n') break;
      if (b != '\r') buffer.write(b);
      if (buffer.size() > 8192) throw new IOException("Line too long.");
    }
    return buffer.toString("UTF-8");
  }

  private static byte[] read(InputStream in, int length) throws IOException {
    byte[] bytes = new byte[length];
    int offset = 0;
    while (offset < length) {
      int n = in.read(bytes, offset, length - offset);
      if (n < 0) throw new EOFException("The request ended early.");
      offset += n;
    }
    return bytes;
  }

  private static Map<String, String> query(String raw) throws UnsupportedEncodingException {
    Map<String, String> values = new HashMap<>();
    if (raw == null) return values;
    for (String pair : raw.split("&")) {
      int equals = pair.indexOf('=');
      if (equals > 0) values.put(URLDecoder.decode(pair.substring(0, equals), "UTF-8"), URLDecoder.decode(pair.substring(equals + 1), "UTF-8"));
    }
    return values;
  }
}
