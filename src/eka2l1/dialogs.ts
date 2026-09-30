import type {BrowserSession,Dialog} from "./core.js";
export function createNativeDialogs(win:Window,target:HTMLElement,getSession:()=>BrowserSession|undefined,blockInput:(blocked:boolean)=>void){
  let panel:HTMLDivElement|undefined;
  const close=()=>{panel?.remove();panel=undefined;blockInput(false);};
  const show=(dialog:Dialog)=>{
    close();if(dialog.kind==="close")return;
    blockInput(true);panel=win.document.createElement("div");panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");
    Object.assign(panel.style,{position:"absolute",inset:"15% 5% auto",zIndex:"3",background:"white",color:"black",padding:"16px",border:"1px solid black"});
    const label=win.document.createElement("p");label.textContent=dialog.text??"";panel.append(label);
    const respond=(choice:number,text:string)=>{getSession()?.reply(dialog.id,choice,text);close();};
    if(dialog.kind==="text"){
      const form=win.document.createElement("form"),input=win.document.createElement("input"),submit=win.document.createElement("button");
      input.value=dialog.text??"";input.maxLength=Math.min(1024,Math.max(1,dialog.maximum??1024));input.setAttribute("aria-label","Game text input");
      submit.type="submit";submit.textContent="OK";form.append(input,submit);form.onsubmit=event=>{event.preventDefault();respond(0,input.value);};panel.append(form);target.append(panel);input.focus();
    }else{
      for(const [index,text] of (dialog.buttons??["OK","Cancel"]).entries()){
        const button=win.document.createElement("button");button.type="button";button.textContent=text;button.onclick=()=>respond(index,"");panel.append(button);
      }
      target.append(panel);panel.querySelector("button")?.focus();
    }
  };
  return {show,close};
}
