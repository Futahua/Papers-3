import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
async function hash(file){const digest=createHash('sha256');await pipeline(createReadStream(file),digest);return digest.digest('hex');}
function absent(){const result=spawnSync('powershell.exe',['-NoProfile','-Command','(Get-Process -Name Papers -ErrorAction SilentlyContinue | Measure-Object).Count'],{encoding:'utf8',windowsHide:true});if(result.status!==0||!/^0\s*$/.test(result.stdout))throw Error('Papers must close normally before updating.');}
async function inventory(root){const result=[];async function visit(folder,relative){for(const name of (await fs.readdir(folder)).sort()){const file=path.join(folder,name),stat=await fs.lstat(file),key=path.join(relative,name).replaceAll('\\','/');if(stat.isSymbolicLink())throw Error('Backup link requires review');if(stat.isDirectory())await visit(file,key);else if(stat.isFile())result.push({name:key,bytes:stat.size,sha256:await hash(file)});else throw Error('Unsupported backup object');}}await visit(root,'');return result;}
absent();if(await hash(config.installer)!==config.installerSha256||await hash(path.join(config.app,'resources/app.asar'))!==config.oldAsar)throw Error('Checked installation artifact or current app changed');
const roots=[config.data,...config.backpacks],before=await Promise.all(roots.map(inventory));await fs.mkdir(config.recovery);
for(let i=0;i<roots.length;i++){const target=path.join(config.recovery,'root-'+i);await fs.cp(roots[i],target,{recursive:true,force:false,errorOnExist:true});if(JSON.stringify(await inventory(target))!==JSON.stringify(before[i])||JSON.stringify(await inventory(roots[i]))!==JSON.stringify(before[i]))throw Error('Recovery copy differs from quiesced files');console.log('Recovery root '+i+' verified: '+before[i].length+' files');}
const previousApp=await inventory(config.app);await fs.cp(config.app,path.join(config.recovery,'App'),{recursive:true,force:false,errorOnExist:true});if(JSON.stringify(await inventory(path.join(config.recovery,'App')))!==JSON.stringify(previousApp)||JSON.stringify(await inventory(config.app))!==JSON.stringify(previousApp))throw Error('Previous app backup mismatch');
if(config.previousInstaller){const destination=path.join(config.recovery,'previous-installer.exe');await fs.copyFile(config.previousInstaller,destination,fs.constants.COPYFILE_EXCL);if(await hash(destination)!==await hash(config.previousInstaller))throw Error('Previous installer backup mismatch');}
await fs.writeFile(path.join(config.recovery,'backup-verified.json'),JSON.stringify({roots,files:before,app:previousApp,oldAsar:config.oldAsar}));
absent();await new Promise((resolve,reject)=>{const child=spawn(config.installer,['/S','/currentuser','/D='+path.win32.normalize(config.app)],{windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Installer failed: '+code)));});
if(await hash(path.join(config.app,'resources/app.asar'))!==config.newAsar)throw Error('Installed app does not match checked build');
for(let i=0;i<roots.length;i++)if(JSON.stringify(await inventory(roots[i]))!==JSON.stringify(before[i]))throw Error('Installer changed profile or Backpack bytes');
await fs.writeFile(path.join(config.recovery,'installed-verified.json'),JSON.stringify({at:new Date().toISOString(),asar:config.newAsar,files:before.map(entries=>entries.length)}));console.log('Supported desktop owner installed; profile and Backpack bytes preserved.');
