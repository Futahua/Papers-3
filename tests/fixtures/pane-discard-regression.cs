using System;using System.Drawing;using System.IO;using System.Linq;using System.Windows.Forms;using System.Web.Script.Serialization;
public class DiscardRegression {
 static void Check(bool yes,string msg){if(!yes)throw new Exception(msg);}
 [STAThread]public static void Main(string[] args){if(args.Length==2&&args[0]=="--guard"){PaneCoordinator.Guard(args[1]);return;}
 var dir=Path.Combine(Path.GetTempPath(),"discard-"+Guid.NewGuid());Directory.CreateDirectory(dir);
 using(var host=new Form()){host.ShowInTaskbar=false;host.StartPosition=FormStartPosition.Manual;host.Bounds=new Rectangle(-20000,-20000,1200,800);host.Show();
 var pane=new PaneCoordinator(host.Handle,Path.Combine(dir,"recovery.json"),Path.Combine(dir,"log"),s=>{},32,null,"test",true);
 try{pane.SetViewport(new Rectangle(-20000,-20000,1200,800),1);
 pane.CreateGroup("main","empty","right",pane.Scope.BindingGeneration,pane.Scope.StateRevision);
 pane.AddDocument("preview:workspace-files","main",pane.Scope.BindingGeneration,pane.Scope.StateRevision);
 pane.AddDocument("preview:workspace-preview","main",pane.Scope.BindingGeneration,pane.Scope.StateRevision);
 pane.AddDocument("preview:page","main",pane.Scope.BindingGeneration,pane.Scope.StateRevision);
 pane.AddDormant(new PaneMountPeer{TabId="dead",Title="Dead"},"empty");
 var json=new JavaScriptSerializer();var tree=json.Serialize(pane.Scope.Root);var frame=pane.Group("empty").ResolvedFrame;
 pane.AddDormant(new PaneMountPeer{TabId="replace",Title="Old peer"},"empty");
 pane.SelectTab("empty","replace",pane.Scope.BindingGeneration,pane.Scope.StateRevision);
 // This controlled peer must allow the fixture's off-screen viewport, independently
 // of the current monitor's default maximum tracking height.
 using(var incoming=new Form()){incoming.MaximumSize=new Size(1200,800);incoming.ShowInTaskbar=false;incoming.StartPosition=FormStartPosition.Manual;incoming.Bounds=new Rectangle(50,50,400,400);incoming.CreateControl();uint pid;Native.GetWindowThreadProcessId(incoming.Handle,out pid);
 string attached=pane.AttachShiftDrop(incoming.Handle,pid,"empty",pane.Scope.BindingGeneration,pane.Scope.StateRevision);
 Check(attached=="replace"&&pane.Dormant("replace")==null,"Shift drop retains dead slot identity");
 Check(pane.Group("empty").OrderedTabs.Count==2&&pane.Group("empty").SelectedTab=="replace","Shift drop replaces instead of appending");
 Check(json.Serialize(pane.Scope.Root)==tree,"replacement keeps topology");
 pane.DetachTab(attached,pane.Scope.BindingGeneration,pane.Scope.StateRevision);}
 pane.AddDormant(new PaneMountPeer{TabId="refused",Title="Refused peer"},"empty");pane.SelectTab("empty","refused",pane.Scope.BindingGeneration,pane.Scope.StateRevision);
 bool refused=false;try{pane.AttachShiftDrop(IntPtr.Zero,0,"empty",pane.Scope.BindingGeneration,pane.Scope.StateRevision);}catch{refused=true;}
 Check(refused&&pane.Dormant("refused")!=null&&pane.Group("empty").SelectedTab=="refused","failed replacement preserves dead slot");pane.RemoveDocument("refused",pane.Scope.BindingGeneration,pane.Scope.StateRevision);
 Check(pane.DiscardDeadWindows(pane.Scope.BindingGeneration,pane.Scope.StateRevision)==1,"one dead removed");
 Check(pane.Group("empty").OrderedTabs.Count==0,"empty pane remains");
 Check(json.Serialize(pane.Scope.Root)==tree&&pane.Group("empty").ResolvedFrame==frame,"tree and sizes unchanged");
 Check(pane.Group("main").OrderedTabs.Count==3,"protected panels and page preserved");
 Check(pane.DiscardDeadWindows(pane.Scope.BindingGeneration,pane.Scope.StateRevision)==0,"repeat cleanup idempotent");
 var mount=Path.Combine(dir,"mount.json");pane.SaveMount(mount);Check(!File.ReadAllText(mount).Contains("Dead"),"dead entry not persisted");
 Console.WriteLine("dead tabs removed; empty panes, sizes and documents preserved; saved cleanup verified");
 }finally{pane.Release();}}
 }
}
