using System;using System.Collections.Generic;using System.Diagnostics;using System.Drawing;using System.IO;using System.Runtime.InteropServices;using System.Threading;using System.Web.Script.Serialization;using System.Windows.Forms;
public static class Native {
 [StructLayout(LayoutKind.Sequential)]public struct Rect{public int L,T,R,B;public Rectangle Box{get{return Rectangle.FromLTRB(L,T,R,B);}}}
 [StructLayout(LayoutKind.Sequential)]public struct Point{public int X,Y;}
 [StructLayout(LayoutKind.Sequential)]public struct Placement{public int Length,Flags,Show;public Point Min,Max;public Rect Normal;}
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]public static extern bool GetWindowPlacement(IntPtr h,ref Placement p);
 [DllImport("user32.dll")]public static extern bool SetWindowPlacement(IntPtr h,ref Placement p);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")]public static extern int GetWindowLong(IntPtr h,int i);
 [DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr z,int x,int y,int w,int height,uint flags);
 [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);
 [DllImport("dwmapi.dll")]public static extern int DwmGetWindowAttribute(IntPtr h,int a,out Rect r,int n);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern IntPtr GetWindow(IntPtr h,uint relation);
 [DllImport("user32.dll")]public static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")]public static extern IntPtr BeginDeferWindowPos(int count);
 [DllImport("user32.dll")]public static extern IntPtr DeferWindowPos(IntPtr batch,IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 [DllImport("user32.dll")]public static extern bool EndDeferWindowPos(IntPtr batch);
 public delegate void Event(IntPtr hook,uint ev,IntPtr h,int obj,int child,uint thread,uint time);
 [DllImport("user32.dll")]public static extern IntPtr SetWinEventHook(uint a,uint b,IntPtr m,Event callback,uint pid,uint thread,uint flags);
 [DllImport("user32.dll")]public static extern bool UnhookWinEvent(IntPtr h);
}
public class SavedWindow{public long Handle;public uint Pid;public int ExStyle;public Native.Placement Placement;public bool Visible;}
public class RecoveryFile{public int HostPid;public List<SavedWindow> Windows=new List<SavedWindow>();}
public sealed class WindowSession:IDisposable{
 public readonly SavedWindow Saved;public IntPtr Handle{get{return new IntPtr(Saved.Handle);}}public bool Fullscreen,Visible;public Rectangle Requested;
 public WindowSession(long hwnd,uint pid){uint actual;Native.GetWindowThreadProcessId(new IntPtr(hwnd),out actual);if(actual!=pid)throw new Exception("Window identity changed: "+hwnd);var p=new Native.Placement{Length=Marshal.SizeOf(typeof(Native.Placement))};if(!Native.GetWindowPlacement(new IntPtr(hwnd),ref p))throw new Exception("Cannot save placement: "+hwnd);Saved=new SavedWindow{Handle=hwnd,Pid=pid,ExStyle=Native.GetWindowLong(new IntPtr(hwnd),-20),Placement=p,Visible=Native.IsWindowVisible(new IntPtr(hwnd))};}
 public bool Valid(){uint pid;Native.GetWindowThreadProcessId(Handle,out pid);return pid==Saved.Pid;}
 public void Show(bool show){Visible=show;if(!Valid())return;if(show&&Native.IsWindowVisible(Handle)&&!Native.IsIconic(Handle))return;if(!show&&Native.IsIconic(Handle))return;Native.ShowWindow(Handle,show?4:7);}
 public void Fit(Rectangle box,bool top){Requested=box;if(!Valid()||Fullscreen)return;Native.Rect current;Native.GetWindowRect(Handle,out current);if(current.Box!=box)Native.SetWindowPos(Handle,top?new IntPtr(-1):IntPtr.Zero,box.X,box.Y,box.Width,box.Height,top?0x10u:0x14u);}
 public Rectangle Frame(){Native.Rect r;if(Native.DwmGetWindowAttribute(Handle,9,out r,16)!=0)Native.GetWindowRect(Handle,out r);return r.Box;}
 public void Top(bool top){if(Valid())Native.SetWindowPos(Handle,new IntPtr(top||(Saved.ExStyle&8)!=0?-1:-2),0,0,0,0,0x13);}
 public static void Restore(SavedWindow w){var h=new IntPtr(w.Handle);uint pid;Native.GetWindowThreadProcessId(h,out pid);if(pid!=w.Pid)return;Native.SetWindowPos(h,new IntPtr((w.ExStyle&8)!=0?-1:-2),0,0,0,0,0x13);var p=w.Placement;if(p.Show==0)p.Show=1;Native.SetWindowPlacement(h,ref p);Native.ShowWindow(h,p.Show==2||p.Show==6||p.Show==7?7:4);}
 public void Dispose(){Restore(Saved);}
}
