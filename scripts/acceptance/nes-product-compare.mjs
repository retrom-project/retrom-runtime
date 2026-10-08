/* global window, document, location */
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {observeNESCheckpoint} from './nes-native-observation.mjs';
import {acceptanceArgs,openAcceptanceBrowser} from './product-browser.mjs';
const args=acceptanceArgs(['game-id']);
const output=resolve(args.output), base=args.base;
await mkdir(output,{recursive:true});
const browser=await openAcceptanceBrowser(args);
const context=await browser.newContext({storageState:args['storage-state'],viewport:{width:1440,height:1000}});
const apiPage=await context.newPage();await apiPage.goto(base+'/library');
try {for(const coreId of (args.cores??'fceumm,nestopia').split(',')) {await trial(coreId);}}
finally {await browser.close();}
async function trial(coreId) {
  const response=await api('POST','/api/v1/runs',{gameId:args['game-id'],purpose:args.purpose??'play',coreId,...(args['save-id']?{saveId:args['save-id']}: {})});
  if(response.status!==200){throw new Error(`RUN_CREATE:${response.status}:${JSON.stringify(response.value)}`);}
  const run=response.value, page=await context.newPage();
  const evidence={coreId,runId:run.id,gameId:run.gameId,coreFingerprint:run.coreFingerprint,romHash:run.romHash,
    providerModuleUrl:run.providerModuleUrl,errors:[],consoleErrors:[],httpFailures:[],screenshots:[],frames:[],input:[],save:null,navigation:[]};
  for(const event of ['frameattached','framedetached','framenavigated']){page.on(event,frame=>evidence.navigation.push({event,url:frame.url(),at:Date.now(),main:frame===page.mainFrame()}));}
  page.on('pageerror',error=>evidence.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'){evidence.consoleErrors.push(message.text());}});
  page.on('response',result=>{if(result.status()>=400){evidence.httpFailures.push({url:result.url(),status:result.status()});}});
  try {
    await page.goto(`${base}/play/${run.id}?returnTo=${encodeURIComponent(`/games/${run.gameId}`)}`);
    await page.getByRole('button',{name:'保存',exact:true}).waitFor({timeout:45000});
    await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(frame=>{try{return Boolean(frame.contentDocument?.querySelector('canvas'));}catch{return false;}}),null,{timeout:45000});
    await page.waitForTimeout(Number(args['warmup-ms']??12000));
    const frame=page.frames().find(frame=>frame!==page.mainFrame()&&frame.url()==='about:blank');
    if(!frame){throw new Error('EMULATOR_FRAME_MISSING');}
    const canvas=frame.locator('canvas').first(); await canvas.waitFor();
    await snapshot(page,evidence,'initial');
    if(args['expected-counter']!==undefined&&evidence.coreId==='fceumm'&&evidence.nativeObservations[0].p1Counter!==Number(args['expected-counter'])){throw new Error('NES_RESTORED_RAM_MISMATCH');}
    await frame.evaluate(()=>{const manager=window.EJS_emulator?.gameManager;window.retromAcceptanceInputs=[];
      if(manager?.simulateInput){const original=manager.simulateInput;manager.simulateInput=function(...parameters){window.retromAcceptanceInputs.push(parameters);return original.apply(this,parameters);};}});
    await canvas.click({position:{x:120,y:120}});
    for(const key of (args.keys??'d,1,k').split(',')) {
      await page.keyboard.down(key);await page.waitForTimeout(180);await page.keyboard.up(key);
      await page.waitForTimeout(1000);await snapshot(page,evidence,key);
    }
    await page.waitForTimeout(5000);await snapshot(page,evidence,'after-5s');
    await page.waitForTimeout(Number(args['after-ms']??10000));await snapshot(page,evidence,'after-final');
    if(coreId==='fceumm'&&args.keys==='d'){
      const samples=evidence.nativeObservations,initial=samples[0],changed=samples.find(sample=>sample.name==='d');
      const stable=samples.filter(sample=>sample.name.startsWith('after-')).every(sample=>sample.p1Counter===changed.p1Counter);
      evidence.stateSemantics={restoredInitial:initial.p1Counter,inputCounter:changed.p1Counter,inputChanged:changed.p1Counter!==initial.p1Counter,stableAfterInput:stable};
      if(!evidence.stateSemantics.inputChanged||!stable){throw new Error('NES_INPUT_RAM_NOT_STABLE');}
    }
    evidence.input=await frame.evaluate(()=>window.retromAcceptanceInputs??[]);
    if(args.purpose==='review'){await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByText('预览存档已保留，审核结束后清除。',{exact:true}).waitFor({timeout:15000});evidence.localPreview=true;}
    else{const saved=page.waitForResponse(result=>['POST','PUT'].includes(result.request().method())&&/\/saves(?:\/[^/]+)?$/.test(result.url()),{timeout:30000});
    await page.getByRole('button',{name:'保存',exact:true}).click();const result=await saved;
    evidence.save={status:result.status(),body:await result.json()};}
    evidence.body=(await page.locator('body').innerText()).slice(-3000);
  } catch(error) {evidence.failure=error.message;await snapshot(page,evidence,'failure');}
  finally {
    await page.close();try{const close=await api('DELETE',`/api/v1/runs/${run.id}`);evidence.closeStatus=close.status;}catch(error){evidence.closeFailure=error.message;}
    await writeFile(join(output,`${args.label??'nes'}-${coreId}.json`),JSON.stringify(evidence,null,2));
    process.stdout.write(`${JSON.stringify({coreId,runId:run.id,failure:evidence.failure??null,errors:evidence.errors,inputs:evidence.input,save:evidence.save?.status})}\n`);
  }
}
async function snapshot(page,evidence,name) {
  const filename=`${args.label??'nes'}-${evidence.coreId}-${name}.png`;
  await page.screenshot({path:join(output,filename),fullPage:true});evidence.screenshots.push(filename);
  evidence.frames.push({name,frames:await Promise.all(page.frames().map(frame=>frame.evaluate(()=>({url:location.href,frameCount:window.EJS_emulator?.gameManager?.getFrameNum?.()??null,paused:window.EJS_emulator?.paused??null,visibility:document.visibilityState,canvases:[...document.querySelectorAll('canvas')].map(canvas=>{const sample=document.createElement('canvas');sample.width=canvas.width;sample.height=canvas.height;const ctx=sample.getContext('2d');ctx.drawImage(canvas,0,0);const pixels=ctx.getImageData(0,0,sample.width,sample.height).data;let visible=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]+pixels[i+1]+pixels[i+2]>40){visible++;}}return{width:canvas.width,height:canvas.height,rect:canvas.getBoundingClientRect().toJSON(),visiblePixels:visible};})})).catch(()=>({detached:true}))))});
  if(evidence.coreId==='fceumm'){
    const frame=page.frames().find(frame=>frame!==page.mainFrame()&&frame.url()==='about:blank');
    if(frame&&name!=='failure'){evidence.nativeObservations??=[];evidence.nativeObservations.push({name,...await frame.evaluate(observeNESCheckpoint)});}
  }
}

async function api(method,path,data) {return apiPage.evaluate(async({method,path,data})=>{const auth=await(await fetch('/api/v1/auth/context')).json();const response=await fetch(path,{method,headers:{'Content-Type':'application/json','X-Retrom-Csrf':auth.csrfToken},body:data?JSON.stringify(data):undefined});const text=await response.text();let value=null;try{value=text?JSON.parse(text):null;}catch{value=text;}return {status:response.status,value};},{method,path,data});}
