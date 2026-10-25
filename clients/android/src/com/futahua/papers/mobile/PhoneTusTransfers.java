package com.futahua.papers.mobile;

import android.content.Context;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import me.desair.tus.server.TusFileUploadService;
import me.desair.tus.server.upload.UploadInfo;
import java.io.*;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.JSONObject;

/** Servlet bridge only. The maintained tus-java-server owns the transfer protocol. */
final class PhoneTusTransfers {
  static final String ROOT="/v1/files/transfers";
  interface Destination { void check(String folder) throws Exception; JSONObject publish(String folder,String name,long size,String sha,InputStream bytes) throws Exception; }
  private final TusFileUploadService service;
  private final File receipts;
  PhoneTusTransfers(Context context)throws Exception {
    this(new File(context.getFilesDir(),"tus-transfers"));
  }
  PhoneTusTransfers(File directory)throws Exception {
    directory.mkdirs();
    receipts=new File(directory,"receipts");receipts.mkdirs();
    service=new TusFileUploadService().withStoragePath(directory.getPath()).withUploadUri(ROOT).withMaxUploadSize(512L*1024*1024*1024).withThreadLocalCache(false).withUploadDeduplication(false);
  }
  private static void validate(Map<String,String> m)throws Exception {
    String name=m.get("name");if(!m.getOrDefault("folderId","").matches("[a-f0-9-]{36}")||!m.getOrDefault("sha256","").matches("[a-f0-9]{64}")||name==null||name.isEmpty()||name.length()>255||name.equals(".")||name.equals("..")||name.indexOf('/')>=0||name.indexOf('\\')>=0||name.indexOf('\0')>=0)throw new IOException("Invalid transfer metadata");
  }
  String createEditUpload(String device,long size,String sha)throws Exception {
    Map<String,String> headers=new HashMap<>();headers.put("tus-resumable","1.0.0");headers.put("upload-length",String.valueOf(size));
    Map<String,String> metadata=new LinkedHashMap<>();metadata.put("folderId","00000000-0000-4000-8000-000000000000");metadata.put("name","working.bin");metadata.put("sha256",sha);
    StringJoiner encoded=new StringJoiner(",");for(Map.Entry<String,String> item:metadata.entrySet())encoded.add(item.getKey()+" "+java.util.Base64.getEncoder().encodeToString(item.getValue().getBytes(StandardCharsets.UTF_8)));headers.put("upload-metadata",encoded.toString());
    ByteArrayOutputStream response=new ByteArrayOutputStream();handle("POST",ROOT,headers,0,new ByteArrayInputStream(new byte[0]),response,device,internalDestination);
    String text=response.toString("UTF-8");if(!text.startsWith("HTTP/1.1 201 "))throw new IOException("Upload creation refused");for(String line:text.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("location:")){String uri=line.substring(9).trim();return uri.substring(uri.lastIndexOf('/')+1);}throw new IOException("Upload identity missing");
  }
  UploadInfo editInfo(String device,String id)throws Exception{return service.getUploadInfo(ROOT+"/"+id,device);}
  InputStream editBytes(String device,String id)throws Exception{return service.getUploadedBytes(ROOT+"/"+id,device);}
  void appendEdit(String device,String id,long offset,long length,InputStream input)throws Exception {
    Map<String,String> headers=new HashMap<>();headers.put("tus-resumable","1.0.0");headers.put("content-type","application/offset+octet-stream");headers.put("upload-offset",String.valueOf(offset));
    ByteArrayOutputStream response=new ByteArrayOutputStream();handle("PATCH",ROOT+"/"+id,headers,length,input,response,device,internalDestination);
    if(!response.toString("UTF-8").startsWith("HTTP/1.1 204 "))throw new IOException("Upload offset was not confirmed");
  }
  private static final Destination internalDestination=new Destination(){public void check(String folder){}public JSONObject publish(String folder,String name,long size,String sha,InputStream bytes){throw new UnsupportedOperationException();}};
  synchronized JSONObject publish(String device,String uri,Destination destination)throws Exception {
    String id=uri.substring(ROOT.length()+1);if(!id.matches("[a-f0-9-]{36}"))throw new IOException("Invalid transfer identity");
    File receipt=new File(receipts,PhonePeerServer.hash((device+":"+id).getBytes(StandardCharsets.UTF_8))+".json");
    android.util.AtomicFile atomic=new android.util.AtomicFile(receipt);
    try{return new JSONObject(new String(atomic.readFully(),StandardCharsets.UTF_8));}catch(FileNotFoundException ignored){}
    UploadInfo info=service.getUploadInfo(uri,device);
    if(info==null||info.isUploadInProgress()||!info.getLength().equals(info.getOffset()))throw new IOException("Transfer incomplete");
    Map<String,String> metadata=info.getMetadata();validate(metadata);JSONObject result;
    try(InputStream input=service.getUploadedBytes(uri,device)){result=destination.publish(metadata.get("folderId"),metadata.get("name"),info.getLength(),metadata.get("sha256"),input);}
    FileOutputStream output=atomic.startWrite();try{output.write(result.toString().getBytes(StandardCharsets.UTF_8));atomic.finishWrite(output);}catch(Exception error){atomic.failWrite(output);throw error;}return result;
  }
  boolean handle(String method,String uri,Map<String,String> headers,long length,InputStream input,OutputStream output,String device,Destination destination)throws Exception {
    if(!uri.equals(ROOT)&&!uri.startsWith(ROOT+"/"))return false;
    if(uri.endsWith("/commit")){
      if(!method.equals("POST")||length>4096)throw new IOException("Invalid publish request");
      for(long n=0;n<length;n++)if(input.read()<0)throw new EOFException();
      JSONObject entry=publish(device,uri.substring(0,uri.length()-7),destination);
      send(output,200,new HashMap<>(),new JSONObject().put("ok",true).put("entry",entry).toString().getBytes(StandardCharsets.UTF_8));return true;
    }
    if(method.equals("GET")||method.equals("DELETE"))throw new IOException("Use transfer status; completed user files are retained");
    if(method.equals("POST")){
      Map<String,String> metadata=new HashMap<>();for(String pair:headers.getOrDefault("upload-metadata","").split(",")){String[] parts=pair.trim().split(" ",2);if(parts.length==2)metadata.put(parts[0],new String(java.util.Base64.getDecoder().decode(parts[1]),StandardCharsets.UTF_8));}
      validate(metadata);destination.check(metadata.get("folderId"));
    }
    final long[] remaining={length};
    ServletInputStream body=new ServletInputStream(){public int read()throws IOException{if(remaining[0]<=0)return -1;int n=input.read();if(n<0)throw new EOFException();remaining[0]--;return n;}public int read(byte[] b,int off,int len)throws IOException{if(remaining[0]<=0)return -1;int n=input.read(b,off,(int)Math.min(len,remaining[0]));if(n<0)throw new EOFException();remaining[0]-=n;return n;}public boolean isFinished(){return remaining[0]==0;}public boolean isReady(){return true;}public void setReadListener(ReadListener listener){throw new UnsupportedOperationException();}};
    Map<String,Object> attributes=new HashMap<>();
    HttpServletRequest request=(HttpServletRequest)Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{HttpServletRequest.class},(proxy,call,args)->{
      String name=call.getName();switch(name){case "getMethod":return method;case "getRequestURI":case "getServletPath":return uri;case "getRequestURL":return new StringBuffer(uri);case "getContextPath":return "";case "getHeader":return headers.get(((String)args[0]).toLowerCase(Locale.ROOT));case "getHeaders":return Collections.enumeration(headers.containsKey(((String)args[0]).toLowerCase(Locale.ROOT))?Collections.singletonList(headers.get(((String)args[0]).toLowerCase(Locale.ROOT))):Collections.emptyList());case "getHeaderNames":return Collections.enumeration(headers.keySet());case "getContentLengthLong":return length;case "getContentLength":return (int)length;case "getInputStream":return body;case "getRemoteAddr":return device;case "getAttribute":return attributes.get(args[0]);case "setAttribute":attributes.put((String)args[0],args[1]);return null;case "removeAttribute":attributes.remove(args[0]);return null;case "getCharacterEncoding":return "UTF-8";case "getProtocol":return "HTTP/1.1";case "getScheme":return "http";case "isSecure":return false;default:if(call.getReturnType()==boolean.class)return false;if(call.getReturnType()==int.class)return 0;if(call.getReturnType()==long.class)return 0L;return null;}
    });
    int[] status={200};Map<String,String> responseHeaders=new LinkedHashMap<>();ByteArrayOutputStream bytes=new ByteArrayOutputStream();
    ServletOutputStream sink=new ServletOutputStream(){public void write(int b)throws IOException{if(bytes.size()>=16384)throw new IOException("Transfer response too large");bytes.write(b);}public boolean isReady(){return true;}public void setWriteListener(WriteListener listener){throw new UnsupportedOperationException();}};
    PrintWriter writer=new PrintWriter(new OutputStreamWriter(sink,StandardCharsets.UTF_8));
    HttpServletResponse response=(HttpServletResponse)Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{HttpServletResponse.class},(proxy,call,args)->{
      switch(call.getName()){case "setStatus":case "sendError":status[0]=(Integer)args[0];return null;case "getStatus":return status[0];case "setHeader":case "addHeader":responseHeaders.put((String)args[0],String.valueOf(args[1]));return null;case "getHeader":return responseHeaders.get(args[0]);case "containsHeader":return responseHeaders.containsKey(args[0]);case "getHeaderNames":return responseHeaders.keySet();case "getOutputStream":return sink;case "getWriter":return writer;case "isCommitted":return false;case "flushBuffer":writer.flush();return null;case "encodeURL":case "encodeRedirectURL":return args[0];default:if(call.getReturnType()==boolean.class)return false;if(call.getReturnType()==int.class)return 0;if(call.getReturnType()==long.class)return 0L;return null;}
    });
    service.process(request,response,device);writer.flush();send(output,status[0],responseHeaders,bytes.toByteArray());return true;
  }
  private static void send(OutputStream output,int status,Map<String,String> headers,byte[] bytes)throws Exception {
    StringBuilder head=new StringBuilder("HTTP/1.1 "+status+" Result\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: "+bytes.length+"\r\n");
    for(Map.Entry<String,String> header:headers.entrySet()){if(header.getKey().equalsIgnoreCase("content-length"))continue;if(header.getKey().indexOf('\r')>=0||header.getKey().indexOf('\n')>=0||header.getValue().indexOf('\r')>=0||header.getValue().indexOf('\n')>=0)throw new IOException("Invalid response header");head.append(header.getKey()).append(": ").append(header.getValue()).append("\r\n");}head.append("\r\n");output.write(head.toString().getBytes(StandardCharsets.UTF_8));output.write(bytes);output.flush();
  }
}
