using System;using System.Collections.Generic;using System.Drawing;using System.Linq;using System.Web.Script.Serialization;
public class SpanRegression {
 static void Check(bool value,string message){if(!value)throw new Exception(message);}
 static PaneSplit Branch(string axis,double ratio,PaneSplit a,PaneSplit b){return new PaneSplit{Axis=axis,Ratio=ratio,First=a,Second=b};}
 static PaneScope Fixture(bool transpose,bool mirror){
  var right=Branch("Y",.5,PaneLayout.Leaf("b"),PaneLayout.Leaf("c"));
  var bottom=Branch("X",.5,PaneLayout.Leaf("phone"),right);
  var root=Branch("Y",.5,PaneLayout.Leaf("a"),bottom);
  if(mirror)Mirror(root);if(transpose)Transpose(root);
  var scope=new PaneScope("test",32){Viewport=transpose?new Rectangle(10,20,1600,2000):new Rectangle(10,20,2000,1600),Root=root};
  foreach(var id in PaneLayout.Leaves(root))scope.Add(id);
  Check(PaneLayout.Resolve(scope,g=>new Size(240,160)),"fixture must resolve");return scope;
 }
 static void Mirror(PaneSplit node){if(node.Leaf)return;if(node.Axis=="X"){var a=node.First;node.First=node.Second;node.Second=a;}Mirror(node.First);Mirror(node.Second);}
 static void Transpose(PaneSplit node){if(node.Leaf)return;node.Axis=node.Axis=="X"?"Y":"X";Transpose(node.First);Transpose(node.Second);}
 static Dictionary<string,Rectangle> Slots(PaneScope scope){return scope.Groups.Keys.ToDictionary(id=>id,id=>PaneLayout.Slot(scope,scope.Groups[id]));}
 static void Tiling(PaneScope scope){var slots=Slots(scope);Check(slots.Values.Sum(r=>(long)r.Width*r.Height)==(long)scope.Viewport.Width*scope.Viewport.Height,"layout must cover viewport exactly");foreach(var a in slots)foreach(var b in slots)if(a.Key!=b.Key)Check(!a.Value.IntersectsWith(b.Value),"panes overlap");}
 public static void Main(){int count=0;
  foreach(bool transpose in new[]{false,true})foreach(bool mirror in new[]{false,true})foreach(var ids in new[]{new[]{"a"},new[]{"b"},new[]{"c"},new[]{"a","b"},new[]{"b","c"},new[]{"a","b","c"}}){
   var scope=Fixture(transpose,mirror);var before=Slots(scope);var edge=transpose?(mirror?"top":"bottom"):(mirror?"left":"right");
   scope.Add("insert");Check(PaneLayout.Split(scope.Root,ids[0],"insert","span-"+edge+":"+string.Join(",",ids)),"span intent rejected");
   Check(PaneLayout.Resolve(scope,g=>new Size(240,160)),"span cannot resolve: "+edge+string.Join(",",ids));Tiling(scope);
   var after=Slots(scope);var union=ids.Select(id=>before[id]).Aggregate(Rectangle.Union);var added=after["insert"];
   Check(transpose?added.Left==union.Left&&added.Right==union.Right:added.Top==union.Top&&added.Bottom==union.Bottom,"insert must span exactly selected bands");
   foreach(var id in before.Keys.Except(ids))Check(after[id]==before[id],"unrelated pane moved: "+id);
   var saved=new JavaScriptSerializer().Serialize(scope.Root);scope.Root=new JavaScriptSerializer().Deserialize<PaneSplit>(saved);
   Check(PaneLayout.Resolve(scope,g=>new Size(240,160)),"saved span cannot restore");Check(Slots(scope).All(p=>p.Value==after[p.Key]),"restored geometry differs");
   if(scope.Root.Span){
    scope.Groups["insert"].Presentation="minimized";Check(PaneLayout.Resolve(scope,g=>new Size(240,160)),"span minimize failed");
    var compact=PaneLayout.Slot(scope,scope.Groups["insert"]);Check(transpose?compact.Height==32:compact.Width==32,"minimized span must be a restore strip");Tiling(scope);
    scope.Groups["insert"].Presentation="normal";Check(PaneLayout.Resolve(scope,g=>new Size(240,160)),"span restore failed");Check(Slots(scope).All(p=>p.Value==after[p.Key]),"restoring span changed authored geometry");
    string resizeEdge=edge=="right"?"left":edge=="left"?"right":edge=="bottom"?"top":"bottom";
    int position=edge=="right"?added.Left+20:edge=="left"?added.Right-20:edge=="bottom"?added.Top+20+scope.HeaderHeight:added.Bottom-20;
    Check(PaneLayout.AcceptEdge(scope,"insert",resizeEdge,position,g=>new Size(240,160)),"span edge resize failed");Tiling(scope);
   }
   scope.Root=PaneLayout.Remove(scope.Root,"insert");scope.Groups.Remove("insert");scope.Order.Remove("insert");
   Check(PaneLayout.Resolve(scope,g=>new Size(240,160)),"removing inserted span failed");Check(Slots(scope).All(p=>p.Value==before[p.Key]),"removing span did not restore base layout");count++;
  }
  var invalid=Fixture(false,false);invalid.Add("insert");Check(PaneLayout.Split(invalid.Root,"a","insert","span-right:a,c"),"parse gapped intent");Check(!PaneLayout.Resolve(invalid,g=>new Size(240,160)),"gapped spans must be refused");
  var narrow=Fixture(false,false);narrow.Add("insert");PaneLayout.Split(narrow.Root,"a","insert","span-right:a,b");Check(!PaneLayout.Resolve(narrow,g=>g.Id=="insert"?new Size(1900,160):new Size(240,160)),"minimum-size violation must be refused");
  foreach(var side in new[]{"left","right","top","bottom"}){
   var scope=Fixture(false,false);scope.Add("insert");PaneLayout.Split(scope.Root,"a","insert","span-right:a,b");Check(PaneLayout.Resolve(scope,g=>new Size(240,160)),"nested fixture");
   scope.Add("extra");Check(PaneLayout.Split(scope.Root,"a","extra",side),"nested split rejected");Check(PaneLayout.Resolve(scope,g=>new Size(240,160)),"splitting a carved pane must retain its span: "+side);Tiling(scope);
  }
  Console.WriteLine(count+" spans: four directions, exact tiling, unrelated slots, recovery, edge resize and removal pass; gaps/minimum violations refused.");
 }
}
