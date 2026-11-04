using System;using System.Drawing;using System.IO;using System.Linq;using System.Windows.Forms;
public class EmptyGroupsRegression {
 static void Check(bool yes,string msg){if(!yes)throw new Exception(msg);}
 [STAThread]public static void Main(string[] args){if(args.Length==2&&args[0]=="--guard"){PaneCoordinator.Guard(args[1]);return;}
 var dir=Path.Combine(Path.GetTempPath(),"empty-groups-"+Guid.NewGuid());Directory.CreateDirectory(dir);
 using(var host=new Form()){host.ShowInTaskbar=false;host.StartPosition=FormStartPosition.Manual;host.Bounds=new Rectangle(-20000,-20000,1400,900);host.Show();
 var p=new PaneCoordinator(host.Handle,Path.Combine(dir,"recovery.json"),Path.Combine(dir,"log"),s=>{},32,null,"test",true);
 try{
 p.SetViewport(new Rectangle(-20000,-20000,1400,900),1);
 p.AddDocument("preview:one","main",p.Scope.BindingGeneration,p.Scope.StateRevision);
 p.AddDocument("preview:two","main",p.Scope.BindingGeneration,p.Scope.StateRevision);
 p.SplitAndMove("preview:two","main","other","right",p.Scope.BindingGeneration,p.Scope.StateRevision);
 Check(p.Scope.Groups.Count==2,"split preserved both occupied groups");
 p.MoveTab("preview:one","other",p.Scope.BindingGeneration,p.Scope.StateRevision);
 Check(p.Scope.Groups.Count==1&&!p.Scope.Groups.ContainsKey("main"),"last-tab move collapses source");
 Check(p.Scope.Root.Leaf&&p.Scope.Root.GroupId=="other"&&p.Scope.Order.SequenceEqual(new[]{"other"}),"tree and order collapse");
 p.SplitAndMove("preview:one","other","nested","bottom",p.Scope.BindingGeneration,p.Scope.StateRevision);
 p.AddDormant(new PaneMountPeer{TabId="dead",Title="Retained"},"nested");
 p.MoveTab("preview:one","other",p.Scope.BindingGeneration,p.Scope.StateRevision);
 Check(p.Scope.Groups.ContainsKey("nested")&&p.Dormant("dead")!=null,"dormant tab keeps source occupied");
 p.RemoveDocument("dead",p.Scope.BindingGeneration,p.Scope.StateRevision);
 Check(!p.Scope.Groups.ContainsKey("nested"),"explicit final removal collapses source");
 p.SplitAndMove("preview:one","other","last","right",p.Scope.BindingGeneration,p.Scope.StateRevision);
 p.SplitAndMove("preview:one","other","replacement","bottom",p.Scope.BindingGeneration,p.Scope.StateRevision);
 Check(!p.Scope.Groups.ContainsKey("last")&&p.Scope.Groups.Count==2,"split move retires singleton source");
 p.RemoveDocument("preview:one",p.Scope.BindingGeneration,p.Scope.StateRevision);
 p.RemoveDocument("preview:two",p.Scope.BindingGeneration,p.Scope.StateRevision);
 Check(p.Scope.Groups.Count==1&&p.Scope.Root!=null,"final workspace group retained");
 Console.WriteLine("empty group move, split, dormant retention, removal and final group verified");
 }finally{p.Release();}}}
}
