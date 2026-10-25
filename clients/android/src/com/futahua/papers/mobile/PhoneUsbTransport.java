package com.futahua.papers.mobile;

import java.io.IOException;
import java.net.*;
import java.util.*;
import android.os.SystemClock;

/** Standard HTTP proxy selection retains logical owner/tus URLs and their journals. */
final class PhoneUsbTransport extends ProxySelector {
  private static PhoneUsbTransport instance;
  private final ProxySelector previous;
  private volatile String origin;
  private volatile long until;
  private final Proxy cable=new Proxy(Proxy.Type.HTTP,new InetSocketAddress("127.0.0.1",48243));
  private PhoneUsbTransport(ProxySelector previous){this.previous=previous;}
  static synchronized void enable(String address)throws Exception {
    URI uri=new URI(address);
    if(!"http".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||!uri.getPath().isEmpty())throw new IOException("Invalid USB owner");
    if(instance==null){instance=new PhoneUsbTransport(ProxySelector.getDefault());ProxySelector.setDefault(instance);}
    instance.origin=uri.toString();instance.until=SystemClock.elapsedRealtime()+12000;
  }
  public List<Proxy> select(URI uri){
    if(SystemClock.elapsedRealtime()<until&&("http://"+uri.getRawAuthority()).equals(origin))return Arrays.asList(cable,Proxy.NO_PROXY);
    return previous==null?Collections.singletonList(Proxy.NO_PROXY):previous.select(uri);
  }
  public void connectFailed(URI uri,SocketAddress address,IOException failure){
    if(cable.address().equals(address))until=0;
    else if(previous!=null)previous.connectFailed(uri,address,failure);
  }
}
