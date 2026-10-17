package com.futahua.papers.mobile;
import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.net.*;
import java.util.*;
import org.json.JSONObject;
/** Exercises the actual Android servlet bridge against the maintained Java engine. */
public final class TusBridgeCheck {
 public static void main(String[] args)throws Exception {
  PhoneTusTransfers transfers=new PhoneTusTransfers(new File(args[0]));
  if(args.length>1&&args[1].equals("internal")){
   String sha="a".repeat(64),id=transfers.createEditUpload("fixture-peer",6,sha);transfers.appendEdit("fixture-peer",id,0,3,new ByteArrayInputStream(new byte[]{1,2,3}));
   if(transfers.editInfo("fixture-peer",id).getOffset()!=3)throw new IOException("Partial offset differs");
   try(InputStream partial=transfers.editBytes("fixture-peer",id)){if(partial.readAllBytes().length!=3)throw new IOException("Partial bytes differ");}
   PhoneTusTransfers restarted=new PhoneTusTransfers(new File(args[0]));restarted.appendEdit("fixture-peer",id,3,3,new ByteArrayInputStream(new byte[]{4,5,6}));
   if(restarted.editInfo("fixture-peer",id).getOffset()!=6)throw new IOException("Resumed offset differs");System.out.println("Java edit adapter restart/prefix checks: PASS");return;
  }
  HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/",exchange->{try{
   Map<String,String> headers=new HashMap<>();exchange.getRequestHeaders().forEach((key,value)->headers.put(key.toLowerCase(Locale.ROOT),value.get(0)));
   ByteArrayOutputStream raw=new ByteArrayOutputStream();
   transfers.handle(exchange.getRequestMethod(),exchange.getRequestURI().getPath(),headers,Long.parseLong(headers.getOrDefault("content-length","0")),exchange.getRequestBody(),raw,"fixture-peer",new PhoneTusTransfers.Destination(){public void check(String folder){}public JSONObject publish(String folder,String name,long size,String sha,InputStream bytes){throw new UnsupportedOperationException();}});
   byte[] result=raw.toByteArray();int split=-1;for(int i=0;i<result.length-3;i++)if(result[i]==13&&result[i+1]==10&&result[i+2]==13&&result[i+3]==10){split=i;break;}
   String[] lines=new String(result,0,split,java.nio.charset.StandardCharsets.UTF_8).split("\r\n");int code=Integer.parseInt(lines[0].split(" ")[1]);
   for(int i=1;i<lines.length;i++){int colon=lines[i].indexOf(':');if(colon>0&&!lines[i].substring(0,colon).equalsIgnoreCase("content-length"))exchange.getResponseHeaders().set(lines[i].substring(0,colon),lines[i].substring(colon+1).trim());}
   byte[] body=Arrays.copyOfRange(result,split+4,result.length);exchange.sendResponseHeaders(code,exchange.getRequestMethod().equals("HEAD")||code==204?-1:body.length);if(!exchange.getRequestMethod().equals("HEAD")&&code!=204)exchange.getResponseBody().write(body);
  }catch(Throwable error){error.printStackTrace();exchange.sendResponseHeaders(500,-1);}finally{exchange.close();}});
  server.start();System.out.println(server.getAddress().getPort());System.out.flush();
 }
}
