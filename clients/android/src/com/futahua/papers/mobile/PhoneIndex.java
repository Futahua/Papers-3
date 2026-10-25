package com.futahua.papers.mobile;

import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.os.FileObserver;
import android.database.Cursor;
import android.database.DatabaseUtils;
import android.database.sqlite.SQLiteDatabase;
import android.content.ContentValues;
import java.text.Normalizer;
import android.provider.DocumentsContract;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;

/** Native filename catalogue. SQLite/WAL keeps the last committed census readable while
 * the single writer refreshes. Directory watchers refresh metadata after writes as well
 * as creates/moves. A successful listing is required before pruning; inaccessible folders
 * and interrupted scans never become evidence of deletion. Search does not walk storage. */
final class PhoneIndex {
  private static final File INTERNAL=Environment.getExternalStorageDirectory();
  private static final String AUTHORITY = "com.android.externalstorage.documents";
  private static final long PERIOD_MS = 30 * 60_000L;
  private static PhoneIndex instance;
  private static volatile List<File> rootSnapshot=Collections.emptyList();
  static synchronized PhoneIndex get(Context context) { if (instance == null) instance = new PhoneIndex(context.getApplicationContext()); return instance; }
  static boolean handles(String operation) { return Arrays.asList("phone-search","phone-index-status","phone-stat","phone-list","phone-roots","phone-index-refresh").contains(operation); }
  private final SQLiteDatabase db;
  SQLiteDatabase targetDatabase(){return db;}
  static final class ListedMetadata {
    final boolean directory;final long size,modified;
    ListedMetadata(boolean directory,long size,long modified){this.directory=directory;this.size=size;this.modified=modified;}
  }
  /** Indexed metadata is display-only; live names are enumerated independently and
   * every mutation, download and preview revalidates the actual resource. */
  Map<String,ListedMetadata> listedMetadata(File folder)throws Exception {
    if(!ready)return Collections.emptyMap();
    Map<String,ListedMetadata> found=new HashMap<>();
    try(Cursor rows=db.rawQuery("SELECT path,dir,size,modified FROM files WHERE parent=?",new String[]{folder.getCanonicalPath()})){
      while(rows.moveToNext())found.put(rows.getString(0),new ListedMetadata(rows.getInt(1)!=0,rows.getLong(2),rows.getLong(3)));
    }
    return found;
  }
  private final Context context;
  private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
  private final Map<String,FileObserver> watchers = new ConcurrentHashMap<>();
  private final Set<String> dirty = new HashSet<>();
  private volatile boolean ready, refreshing;
  private volatile long refreshedAt, passMs;
  private volatile int unreadable;
  private volatile String error;
  private boolean dirtyQueued;
  private Future<?> census;
  private int scanned;
  private long deadline;
  private PhoneIndex(Context context) {
    this.context=context;
    rootSnapshot=PhoneStorage.roots();
    db = SQLiteDatabase.openOrCreateDatabase(new File(context.getFilesDir(), "phone-index.sqlite"), null);
    db.enableWriteAheadLogging();
    db.execSQL("CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,parent TEXT NOT NULL,volume TEXT NOT NULL,rel TEXT NOT NULL,name TEXT NOT NULL,fold TEXT NOT NULL,foldpath TEXT NOT NULL,dir INTEGER NOT NULL,size INTEGER NOT NULL,modified INTEGER NOT NULL)");
    db.execSQL("CREATE INDEX IF NOT EXISTS file_parent ON files(parent)");
    boolean hasIdentity=false;try(Cursor c=db.rawQuery("PRAGMA table_info(files)",null)){while(c.moveToNext())if(c.getString(1).equals("identity"))hasIdentity=true;}
    if(!hasIdentity)db.execSQL("ALTER TABLE files ADD COLUMN identity TEXT");db.execSQL("CREATE INDEX IF NOT EXISTS file_identity ON files(identity)");
    db.execSQL("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value INTEGER)");
    refreshedAt=DatabaseUtils.longForQuery(db,"SELECT coalesce((SELECT value FROM meta WHERE key='refreshed'),0)",null);ready=refreshedAt>0;
    refreshSoon();
    worker.scheduleWithFixedDelay(this::refreshSoon,PERIOD_MS,PERIOD_MS,TimeUnit.MILLISECONDS);
  }
  static String fold(String text) { return Normalizer.normalize(text.toLowerCase(Locale.ROOT),Normalizer.Form.NFD).replaceAll("\\p{M}+", "").replace('đ','d'); }
  synchronized void refreshSoon() { if(census==null||census.isDone())census=worker.submit(this::refresh); }

  JSONObject call(Context context, JSONObject request) throws Exception {
    switch (request.getString("operation")) {
      case "phone-roots": { JSONArray items=new JSONArray();for(File root:PhoneStorage.roots())items.put(describe(root));return new JSONObject().put("items",items); }
      case "phone-index-refresh": refreshSoon(); return status();
      case "phone-search": return search(request.optString("query", ""), Math.max(1, Math.min(1000, request.optInt("limit", 200))));
      case "phone-index-status": return status();
      case "phone-stat": return describe(target(request.getString("uri")));
      case "phone-list": {
        File folder = target(request.getString("uri"));
        if (!folder.isDirectory()) throw new IOException("Not a folder on the phone.");
        File[] children = folder.listFiles(); if(children==null)throw new IOException("The folder cannot be read."); JSONArray items = new JSONArray();
        if (children != null) {
          Arrays.sort(children, (a, b) -> a.isDirectory() != b.isDirectory() ? (a.isDirectory() ? -1 : 1) : a.getName().compareToIgnoreCase(b.getName()));
          for (File child : children) items.put(describe(child));
        }
        return new JSONObject().put("entry", describe(folder)).put("items", items);
      }
      default: throw new IOException("Unknown phone operation.");
    }
  }

  // ── Addresses ──
  private static File target(String text) throws Exception {
    File file = PhoneStorage.file(Uri.parse(text));
    if (file == null) throw new IOException("Not a file or folder in the phone's storage.");
    if (!file.exists()) throw new FileNotFoundException("PHONE_FILE_NOT_FOUND");
    if (!file.canRead()) throw new IOException("The phone file cannot be read.");
    return file;
  }
  private static String[] place(File file) throws Exception {
    String path = file.getCanonicalPath();
    for (File root : rootSnapshot) {
      String base = root.getCanonicalPath();
      if (path.equals(base) || path.startsWith(base + "/")) return new String[] { root.equals(INTERNAL) ? "primary" : root.getName(), path.equals(base) ? "" : path.substring(base.length() + 1), (root.equals(INTERNAL)?"Internal storage":root.getName()) };
    }
    throw new IOException("Outside the phone's storage.");
  }
  private static String uri(String volume, String rel) { return DocumentsContract.buildDocumentUri(AUTHORITY, volume + ":" + rel).toString(); }
  private static String display(String volume, String rel) throws Exception {
    for (File root : rootSnapshot) if ((root.equals(INTERNAL) ? "primary" : root.getName()).equals(volume)) return (root.equals(INTERNAL)?"Internal storage":root.getName()) + (rel.isEmpty() ? "" : "\\" + rel.replace('/', '\\'));
    return rel.replace('/', '\\');
  }
  private static String iso(long ms) { SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT); f.setTimeZone(TimeZone.getTimeZone("UTC")); return f.format(new Date(ms)); }
  private static JSONObject describe(File file) throws Exception {
    String[] at = place(file);
    String name = at[1].isEmpty() ? at[2] : file.getName();
    return new JSONObject().put("uri", uri(at[0], at[1])).put("name", name).put("kind", file.isDirectory() ? "folder" : "file")
      .put("parentUri", at[1].isEmpty() ? JSONObject.NULL : uri(at[0], at[1].contains("/") ? at[1].substring(0,at[1].lastIndexOf('/')) : "")).put("size", file.isDirectory() ? JSONObject.NULL : file.length()).put("modifiedAt", file.lastModified()).put("folder", display(at[0], at[1].contains("/") ? at[1].substring(0, at[1].lastIndexOf('/')) : ""));
  }

  // One strongly retained watch per directory; FileObserver is not recursive.
  void watchReferenced(File folder){if(folder!=null&&folder.isDirectory()){watch(folder);File parent=folder.getParentFile();if(parent!=null&&parent.isDirectory())try{place(parent);watch(parent);}catch(Exception ignored){}}}
  private synchronized void watch(File directory) {
    String path=directory.getAbsolutePath();if(watchers.containsKey(path))return;
    FileObserver observer=new FileObserver(path,FileObserver.CREATE|FileObserver.DELETE|FileObserver.MOVED_FROM|FileObserver.MOVED_TO|FileObserver.CLOSE_WRITE|FileObserver.ATTRIB|FileObserver.DELETE_SELF|FileObserver.MOVE_SELF) {
      @Override public void onEvent(int event,String name) { if((event&FileObserver.DELETE)!=0&&name!=null)PhoneTargets.notifyDeleted(context,new File(path,name));synchronized(dirty) { dirty.add(path);if(!dirtyQueued){dirtyQueued=true;worker.schedule(PhoneIndex.this::drain,350,TimeUnit.MILLISECONDS);} } }
    };
    watchers.put(path,observer);observer.startWatching();
  }
  private void drain() {
    Set<String> changed; synchronized(dirty){changed=new HashSet<>(dirty);dirty.clear();dirtyQueued=false;}
    scanned=0;deadline=System.currentTimeMillis()+120_000;
    try { db.beginTransaction();try { for(String path:changed){File dir=new File(path);if(dir.isDirectory())scan(dir,new HashSet<>(),0);else if(!dir.exists()){File parent=dir.getParentFile();try{place(parent);if(parent.isDirectory())scan(parent,new HashSet<>(),0);}catch(IOException unavailable){/* detached storage is not proof of deletion */}}}db.setTransactionSuccessful();}finally{db.endTransaction();} }
    catch(Exception e){error=e.getMessage();android.util.Log.w("PapersIndex","change reconciliation failed",e);}
  }
  private void refresh() {
    rootSnapshot=PhoneStorage.roots();refreshing=true;long start=System.nanoTime();unreadable=0;scanned=0;deadline=System.currentTimeMillis()+120_000;
    try {
      db.beginTransaction();try { Set<String> seen=new HashSet<>();for(File root:PhoneStorage.roots())scan(root,seen,0);long now=System.currentTimeMillis();db.execSQL("INSERT OR REPLACE INTO meta(key,value) VALUES('refreshed',?)",new Object[]{now});db.setTransactionSuccessful();refreshedAt=now;ready=true;error=null; }finally{db.endTransaction();}
    } catch(Exception e){error=e.getMessage();android.util.Log.w("PapersIndex","census failed",e);}
    finally { passMs=(System.nanoTime()-start)/1_000_000;refreshing=false; }
  }
  private void prune(String path) {
    // Literal prefix via substr, not LIKE: filename wildcards must not delete other rows.
    db.delete("files","path=? OR substr(path,1,?)=?",new String[]{path,String.valueOf(path.length()+1),path+"/"});
    for(String watched:new ArrayList<>(watchers.keySet()))if(watched.equals(path)||watched.startsWith(path+"/")){watchers.remove(watched).stopWatching();}
  }
  private void scan(File directory,Set<String> seen,int depth)throws Exception {
    if(depth>128||scanned>200_000||System.currentTimeMillis()>deadline)throw new IOException("Phone index scan limit reached; previous catalogue kept.");
    if(java.nio.file.Files.isSymbolicLink(directory.toPath()))return;
    String path=directory.getCanonicalPath();if(!seen.add(path))return;
    String[] at=place(directory);if(at[1].equals("Android/data")||at[1].equals("Android/obb"))return;
    watch(directory);File[] children=directory.listFiles();if(children==null){unreadable++;return;}
    Set<String> present=new HashSet<>();List<File> subdirectories=new ArrayList<>();
    for(File child:children) {
      if(++scanned>200_000||System.currentTimeMillis()>deadline)throw new IOException("Phone index scan interrupted; previous catalogue kept.");
      if(java.nio.file.Files.isSymbolicLink(child.toPath()))continue;
      String childPath=child.getCanonicalPath();if(!childPath.startsWith(path+"/"))throw new IOException("Phone index path escaped its folder.");String[] location=new String[]{at[0],at[1].isEmpty()?child.getName():at[1]+"/"+child.getName()};present.add(childPath);
      ContentValues row=new ContentValues();row.put("path",childPath);row.put("parent",path);row.put("volume",location[0]);row.put("rel",location[1]);row.put("name",child.getName());row.put("fold",fold(child.getName()));row.put("foldpath",fold(location[1]));boolean dir=child.isDirectory();row.put("dir",dir?1:0);row.put("size",dir?-1:child.length());row.put("modified",child.lastModified());if(db.insertWithOnConflict("files",null,row,SQLiteDatabase.CONFLICT_REPLACE)<0)throw new IOException("Phone catalogue could not be saved.");
      db.execSQL("UPDATE files SET identity=? WHERE path=?",new Object[]{PhoneTargets.identity(child),childPath});
      if(dir)subdirectories.add(child);
    }
    List<String> absent=new ArrayList<>();try(Cursor c=db.rawQuery("SELECT path FROM files WHERE parent=?",new String[]{path})){while(c.moveToNext())if(!present.contains(c.getString(0)))absent.add(c.getString(0));}for(String removed:absent)prune(removed);
    for(File child:subdirectories)scan(child,seen,depth+1);
  }
  private JSONObject status()throws Exception {return new JSONObject().put("ready",ready).put("count",DatabaseUtils.longForQuery(db,"SELECT count(*) FROM files",null)).put("refreshedAt",refreshedAt==0?JSONObject.NULL:iso(refreshedAt)).put("passMs",passMs).put("refreshing",refreshing).put("unreadableFolders",unreadable).put("error",error==null?JSONObject.NULL:error);}

  // ── Everything's rules ──
  /** Words must all appear (in the name, or in the path when the word holds a \ or /); "quoted text"
   * is one word; !word excludes. Filters: ext:pdf;jpg, size:>10mb (also <, =, kb/mb/gb), dm:today,
   * dm:yesterday, dm:thisweek, dm:thismonth, dm:thisyear, dm:2026-10-14, folder:, file:. */
  private JSONObject search(String query, int limit) throws Exception {
    long started = System.nanoTime();
    List<String> words = new ArrayList<>(), not = new ArrayList<>(), pathWords = new ArrayList<>(); Set<String> exts = null;
    Long minSize = null, maxSize = null, after = null, before = null; Boolean onlyDirs = null;
    java.util.regex.Matcher tokens = java.util.regex.Pattern.compile("\"([^\"]*)\"|(\\S+)").matcher(fold(query));
    while (tokens.find()) {
      String token = tokens.group(1) != null ? tokens.group(1) : tokens.group(2);
      if (token.isEmpty()) continue;
      if (token.startsWith("ext:")) { exts = new HashSet<>(Arrays.asList(token.substring(4).replace(".", "").split("[;,]"))); continue; }
      if (token.equals("folder:")) { onlyDirs = true; continue; }
      if (token.equals("file:")) { onlyDirs = false; continue; }
      if (token.startsWith("size:")) { long[] range = size(token.substring(5)); if (range == null) throw new IllegalArgumentException("Invalid size filter."); minSize = range[0]; maxSize = range[1]; continue; }
      if (token.startsWith("dm:")) { long[] range = date(token.substring(3)); if (range == null) throw new IllegalArgumentException("Invalid date filter."); after = range[0]; before = range[1]; continue; }
      if (token.startsWith("!") && token.length() > 1) { not.add(token.substring(1)); continue; }
      if (token.contains("\\") || token.contains("/")) pathWords.add(token.replace('\\', '/')); else words.add(token);
    }
    List<String> conditions=new ArrayList<>(),args=new ArrayList<>();
    for(String word:words){conditions.add("instr(fold,?)>0");args.add(word);}
    for(String word:pathWords){conditions.add("instr(foldpath,?)>0");args.add(word);}
    for(String word:not){conditions.add("instr(fold,?)=0");args.add(word);}
    if(onlyDirs!=null){conditions.add("dir=?");args.add(onlyDirs?"1":"0");}
    if(exts!=null){List<String> suffixes=new ArrayList<>();for(String ext:exts){suffixes.add("substr(fold,-?)=?");args.add(String.valueOf(ext.length()+1));args.add("."+ext);}conditions.add("dir=0 AND ("+String.join(" OR ",suffixes)+")");}
    if(minSize!=null){conditions.add("dir=0 AND size>=? AND size<=?");args.add(String.valueOf(minSize));args.add(String.valueOf(maxSize));}
    if(after!=null){conditions.add("modified>=? AND modified<?");args.add(String.valueOf(after));args.add(String.valueOf(before));}
    String where=conditions.isEmpty()?"1":"("+String.join(") AND (",conditions)+")";String[] bound=args.toArray(new String[0]);
    long total=DatabaseUtils.longForQuery(db,"SELECT count(*) FROM files WHERE "+where,bound);JSONArray results=new JSONArray();
    try(Cursor c=db.rawQuery("SELECT volume,rel,name,dir,size,modified FROM files WHERE "+where+" ORDER BY dir DESC,modified DESC,foldpath ASC LIMIT "+limit,bound)){
      while(c.moveToNext()){String volume=c.getString(0),rel=c.getString(1);String parent=rel.contains("/")?rel.substring(0,rel.lastIndexOf('/')):"";boolean dir=c.getInt(3)!=0;results.put(new JSONObject().put("uri",uri(volume,rel)).put("name",c.getString(2)).put("kind",dir?"folder":"file").put("size",dir?JSONObject.NULL:c.getLong(4)).put("modifiedAt",c.getLong(5)).put("folder",display(volume,parent)));}
    }
    return new JSONObject().put("results",results).put("total",total).put("indexed",DatabaseUtils.longForQuery(db,"SELECT count(*) FROM files",null)).put("ready",ready).put("refreshing",refreshing).put("ms",(System.nanoTime()-started)/1_000_000);
  }

  private static long[] size(String text) {
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("([<>]=?|=)?([0-9.]+)(b|kb|mb|gb)?").matcher(text);
    if (!m.matches()) return null;
    double value;try{value=Double.parseDouble(m.group(2));}catch(NumberFormatException e){throw new IllegalArgumentException("Invalid size filter.");} String unit = m.group(3) == null ? "b" : m.group(3);
    long bytes = (long) (value * (unit.equals("gb") ? 1L << 30 : unit.equals("mb") ? 1L << 20 : unit.equals("kb") ? 1L << 10 : 1));
    String op = m.group(1) == null ? "=" : m.group(1);
    switch (op) { case ">": return new long[] { bytes + 1, Long.MAX_VALUE }; case ">=": return new long[] { bytes, Long.MAX_VALUE }; case "<": return new long[] { 0, bytes - 1 }; case "<=": return new long[] { 0, bytes }; default: return new long[] { bytes, bytes }; }
  }
  private static long[] date(String text) {
    Calendar day = Calendar.getInstance(); day.set(Calendar.HOUR_OF_DAY, 0); day.set(Calendar.MINUTE, 0); day.set(Calendar.SECOND, 0); day.set(Calendar.MILLISECOND, 0);
    long start = day.getTimeInMillis(), dayMs = 86_400_000L;
    switch (text) {
      case "today": return new long[] { start, start + dayMs };
      case "yesterday": return new long[] { start - dayMs, start };
      case "thisweek": { Calendar c = (Calendar) day.clone(); c.set(Calendar.DAY_OF_WEEK, c.getFirstDayOfWeek()); return new long[] { c.getTimeInMillis(), Long.MAX_VALUE }; }
      case "thismonth": { Calendar c = (Calendar) day.clone(); c.set(Calendar.DAY_OF_MONTH, 1); return new long[] { c.getTimeInMillis(), Long.MAX_VALUE }; }
      case "thisyear": { Calendar c = (Calendar) day.clone(); c.set(Calendar.DAY_OF_YEAR, 1); return new long[] { c.getTimeInMillis(), Long.MAX_VALUE }; }
      default:
        try { SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT); f.setLenient(false); if(!text.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))return null; long at = f.parse(text).getTime(); return new long[] { at, at + dayMs }; } catch (Exception e) { return null; }
    }
  }
}
