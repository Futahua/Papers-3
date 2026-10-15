import { spawnSync } from 'node:child_process';
import { mkdir, copyFile, readdir, writeFile, access, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const sdk=process.env.PAPERS_ANDROID_SDK || 'D:/Programs/AndroidSDK';
const jdk=process.env.PAPERS_ANDROID_JDK || 'D:/Programs/Android Studio/jbr';
const ayg=process.env.PAPERS_AYG_SOURCE || 'D:/Programs/CodexTemp/AYGCrossDeviceSource';
const proxima=process.env.PAPERS_PROXIMA_SOURCE || 'D:/Programs/CodexTemp/ProximaCrossDeviceSource';
const output=path.join(root,'build');
const tools=path.join(sdk,'build-tools','36.0.0');
const library=path.join(sdk,'platforms','android-36','android.jar');
const classes=path.join(output,'classes'),assets=path.join(output,'assets'),dex=path.join(output,'dex');
await Promise.all([classes,assets,dex,path.join(assets,'app')].map(directory=>mkdir(directory,{recursive:true})));
for(const name of await readdir(path.join(root,'assets')))await cp(path.join(root,'assets',name),path.join(assets,name),{recursive:true});
// The phone cannot list Tailscale peers, so bake in the creator's own computers (same account) at build time.
{const status=JSON.parse(spawnSync(process.platform==='win32'?'C:/Program Files/Tailscale/tailscale.exe':'tailscale',['status','--json'],{encoding:'utf8',windowsHide:true}).stdout||'{}');
const user=status.Self?.UserID,computers=[status.Self,...Object.values(status.Peer??{})].filter(node=>node&&node.UserID===user&&/^(windows|macOS|linux)$/.test(node.OS));
await writeFile(path.join(assets,'owners.json'),JSON.stringify(computers.map(node=>`http://${node.TailscaleIPs.find(ip=>ip.startsWith('100.'))}:48240`)));}
await copyFile(path.join(ayg,'public/app/remote-file-view.js'),path.join(assets,'app/remote-file-view.js'));
// The phone runs As you Go itself: the same page as on Windows, served from the app.
await cp(path.join(ayg,'public'),path.join(assets,'ayg'),{recursive:true});
await cp(path.join(proxima,'public'),path.join(assets,'proxima'),{recursive:true});
for(const name of ['remote-domain.js','remote-devices-view.js','remote-overview.html','remote-overview.css','remote-overview.js','schedule-projection.js','date-strip.js','marquee-controller.js','exact-timeline.js','app.css'])await copyFile(path.join(proxima,'public',name),path.join(assets,'app',name));
function run(executable,args){const result=spawnSync(executable,args,{stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${path.basename(executable)} failed (${result.status})`);}
const sources=(await readdir(path.join(root,'src/com/futahua/papers/mobile'))).filter(name=>name.endsWith('.java')).map(name=>path.join(root,'src/com/futahua/papers/mobile',name));
run(path.join(jdk,'bin/javac.exe'),['-source','8','-target','8','-classpath',library,'-d',classes,...sources]);
run(path.join(jdk,'bin/jar.exe'),['cf',path.join(output,'classes.jar'),'-C',classes,'.']);
run(path.join(jdk,'bin/java.exe'),['-cp',path.join(tools,'lib/d8.jar'),'com.android.tools.r8.D8','--min-api','26','--lib',library,'--output',dex,path.join(output,'classes.jar')]);
const iconDirectory=path.join(output,'res/drawable');await mkdir(iconDirectory,{recursive:true});await copyFile(path.join(root,'../../assets/icon.png'),path.join(iconDirectory,'papers.png'));
run(path.join(tools,'aapt2.exe'),['compile',path.join(iconDirectory,'papers.png'),'-o',path.join(output,'icon.zip')]);
run(path.join(tools,'aapt2.exe'),['link','-I',library,'--manifest',path.join(root,'AndroidManifest.xml'),'-R',path.join(output,'icon.zip'),'-o',path.join(output,'unsigned.apk')]);
// Windows aapt2 writes backslashes into nested asset entry names. The JDK jar
// tool emits portable ZIP paths, so package assets with it instead.
run(path.join(jdk,'bin/jar.exe'),['uf',path.join(output,'unsigned.apk'),'-C',output,'assets']);
run(path.join(jdk,'bin/jar.exe'),['uf',path.join(output,'unsigned.apk'),'-C',dex,'classes.dex']);
run(path.join(tools,'zipalign.exe'),['-f','4',path.join(output,'unsigned.apk'),path.join(output,'aligned.apk')]);
const keystore=process.env.PAPERS_ANDROID_KEYSTORE;
if(!keystore){console.log('Built unsigned APK. Set PAPERS_ANDROID_KEYSTORE and signing credentials to sign.');process.exit(0);}
await access(keystore);
run(path.join(jdk,'bin/java.exe'),['-jar',path.join(tools,'lib/apksigner.jar'),'sign','--ks',keystore,'--ks-pass','env:PAPERS_ANDROID_STORE_PASSWORD','--key-pass','env:PAPERS_ANDROID_KEY_PASSWORD','--out',path.join(output,'Papers.apk'),path.join(output,'aligned.apk')]);
run(path.join(jdk,'bin/java.exe'),['-jar',path.join(tools,'lib/apksigner.jar'),'verify','--verbose',path.join(output,'Papers.apk')]);
if(process.argv.includes('--device-checks')){
  const testClasses=path.join(output,'test-classes'),testDex=path.join(output,'test-dex');
  await Promise.all([testClasses,testDex].map(directory=>mkdir(directory,{recursive:true})));
  const testSources=(await readdir(path.join(root,'test'))).filter(name=>name.endsWith('.java')).map(name=>path.join(root,'test',name));
  run(path.join(jdk,'bin/javac.exe'),['-source','8','-target','8','-classpath',library+path.delimiter+classes,'-d',testClasses,...testSources]);
  const jar=path.join(output,'test-classes.jar');run(path.join(jdk,'bin/jar.exe'),['cf',jar,'-C',testClasses,'.']);
  run(path.join(jdk,'bin/java.exe'),['-cp',path.join(tools,'lib/d8.jar'),'com.android.tools.r8.D8','--min-api','26','--lib',library,'--classpath',path.join(output,'classes.jar'),'--output',testDex,jar]);
  const unsigned=path.join(output,'test-unsigned.apk'),aligned=path.join(output,'test-aligned.apk');
  run(path.join(tools,'aapt2.exe'),['link','-I',library,'--manifest',path.join(root,'test/AndroidManifest.xml'),'-o',unsigned]);
  run(path.join(jdk,'bin/jar.exe'),['uf',unsigned,'-C',testDex,'classes.dex']);
  run(path.join(tools,'zipalign.exe'),['-f','4',unsigned,aligned]);
  run(path.join(jdk,'bin/java.exe'),['-jar',path.join(tools,'lib/apksigner.jar'),'sign','--ks',keystore,'--ks-pass','env:PAPERS_ANDROID_STORE_PASSWORD','--key-pass','env:PAPERS_ANDROID_KEY_PASSWORD','--out',path.join(output,'PapersDeviceChecks.apk'),aligned]);
}
