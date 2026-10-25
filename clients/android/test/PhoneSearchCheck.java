package com.futahua.papers.mobile;
import android.app.*;import android.os.*;import android.provider.DocumentsContract;import org.json.*;import java.io.*;
public final class PhoneSearchCheck extends Instrumentation {
 private PhoneIndex index;private int passed;private JSONArray checks=new JSONArray();
 private void check(boolean ok,String label)throws Exception{if(!ok)throw new IOException(label);passed++;checks.put(label);}
 private JSONObject call(String op,String key,String value)throws Exception{return index.call(getTargetContext(),new JSONObject().put("operation",op).put(key,value));}
 private JSONObject search(String query)throws Exception{return call("phone-search","query",query);}
 private JSONObject waitFor(String query,int expected,long timeout)throws Exception{long end=System.currentTimeMillis()+timeout;JSONObject result;do{result=search(query);if(result.getInt("total")==expected)return result;Thread.sleep(200);}while(System.currentTimeMillis()<end);throw new IOException("Timed out: "+query+" expected "+expected+" got "+result.getInt("total"));}
 private void write(File f,int bytes)throws Exception{try(FileOutputStream out=new FileOutputStream(f)){out.write(new byte[bytes]);out.getFD().sync();}}
 private void remove(File f){if(f.isDirectory()){File[] children=f.listFiles();if(children!=null)for(File c:children)remove(c);}f.delete();}
 @Override public void onCreate(Bundle args){start();}
 @Override public void onStart(){Bundle result=new Bundle();int outcome=Activity.RESULT_OK;File fixture=new File(Environment.getExternalStorageDirectory(),"Download/PapersIndexCheck-"+java.util.UUID.randomUUID());
  try {fixture.mkdirs();File file=new File(fixture,"Điện thoại sample.pdf");write(file,17);new File(fixture,".nomedia").createNewFile();index=PhoneIndex.get(getTargetContext());index.refreshSoon();
   long end=System.currentTimeMillis()+180000;JSONObject status;do{status=call("phone-index-status","x","");if(status.optBoolean("ready")&&!status.optBoolean("refreshing"))break;Thread.sleep(300);}while(System.currentTimeMillis()<end);check(status.optBoolean("ready"),"catalogue ready");
   String name=fixture.getName().toLowerCase();JSONObject hit=waitFor(name+"/ dien thoai ext:pdf",1,3000);check(hit.getJSONArray("results").getJSONObject(0).getInt("size")==17,"diacritics/path/extension and nomedia coverage");
   JSONObject entry=hit.getJSONArray("results").getJSONObject(0);String uri=entry.getString("uri");check(PhoneStorage.file(android.net.Uri.parse(uri)).equals(file.getCanonicalFile()),"search URI resolves exact file");
   String folderUri=DocumentsContract.buildDocumentUri("com.android.externalstorage.documents","primary:Download/"+fixture.getName()).toString();check(call("phone-stat","uri",folderUri).getString("kind").equals("folder"),"real folder stat");check(call("phone-list","uri",folderUri).getJSONArray("items").length()==2,"real folder lists children");
   long before=fixture.lastModified();write(file,8192);fixture.setLastModified(before);check(waitFor(name+"/ ext:pdf size:>4kb",1,8000).getJSONArray("results").getJSONObject(0).getInt("size")==8192,"in-place edit updates without folder timestamp change");
   File sub=new File(fixture,"new nested");sub.mkdir();File nested=new File(sub,"born.txt");write(nested,19);check(waitFor(name+"/ born",1,8000).getInt("total")==1,"new directory and file observed");
   File renamed=new File(sub,"renamed.txt");check(nested.renameTo(renamed),"fixture rename");waitFor(name+"/ born",0,8000);check(waitFor(name+"/ renamed",1,8000).getInt("total")==1,"rename removes old and adds new");
   renamed.delete();check(waitFor(name+"/ renamed",0,8000).getInt("total")==0,"delete observed");
   boolean refused=false;try{search("size:nope");}catch(IllegalArgumentException e){refused=true;}check(refused,"invalid filter refused");
   refused=false;try{call("phone-stat","uri",DocumentsContract.buildDocumentUri("com.android.externalstorage.documents","primary:../../data/local/tmp").toString());}catch(Exception e){refused=true;}check(refused,"outside-storage URI refused");
   JSONArray timings=new JSONArray();for(String q:new String[]{"pdf","download","2026","q","dien thoai"}){long t=System.nanoTime();JSONObject answer=search(q);timings.put(new JSONObject().put("query",q).put("ms",(System.nanoTime()-t)/1e6).put("total",answer.getInt("total")));}
   result.putString("result",new JSONObject().put("passed",passed).put("checks",checks).put("status",status).put("queries",timings).toString());
  }catch(Exception e){result.putString("error",e.toString());result.putInt("passed",passed);outcome=Activity.RESULT_CANCELED;}finally{remove(fixture);}
  finish(outcome,result);
 }
}
