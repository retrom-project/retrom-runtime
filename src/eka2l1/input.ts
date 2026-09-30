export type KeypadOptions = {rotation:number;confirmKey:"ENTER"|"CENTER"|"NUM5"};
type Pad = Pick<Gamepad,"connected"|"mapping"|"axes"> & {buttons:readonly Pick<GamepadButton,"pressed"|"value">[]};
const arrows=[16,15,17,14]; // phone Up, Right, Down, Left scan codes
const rotated=(direction:number,rotation:number)=>arrows[(direction+(360-rotation)/90)%4];
export function keyboardKey(code:string,options:KeypadOptions):number|null {
  const direction=["ArrowUp","ArrowRight","ArrowDown","ArrowLeft"].indexOf(code);
  if(direction>=0)return rotated(direction,options.rotation);
  if(/^Digit[0-9]$/u.test(code))return 48+Number(code.slice(-1));
  return ({Enter:3,Space:5,Escape:4,F1:164,F2:165} as Record<string,number>)[code]??null;
}
export function gamepadKeys(pads:readonly (Pad|null)[],options:KeypadOptions):Set<number> {
  const keys=new Set<number>();
  for(const pad of pads){
    if(!pad?.connected||pad.mapping!=="standard")continue;
    const down=(index:number)=>Boolean(pad.buttons[index]?.pressed||pad.buttons[index]?.value>0.5);
    for(const [direction,button,axis,sign] of [[0,12,1,-1],[1,15,0,1],[2,13,1,1],[3,14,0,-1]])
      if(down(button)||Number.isFinite(pad.axes[axis])&&pad.axes[axis]*sign>0.45)keys.add(rotated(direction,options.rotation));
    const confirm={ENTER:3,CENTER:167,NUM5:53}[options.confirmKey];
    for(const [button,key] of [[0,confirm],[1,4],[2,5],[3,167],[8,164],[9,3]])if(down(button))keys.add(key);
  }
  return keys;
}
export function updateKeys(previous:Set<number>,next:Set<number>,send:(key:number,pressed:boolean)=>void){
  for(const key of previous)if(!next.has(key))send(key,false);
  for(const key of next)if(!previous.has(key))send(key,true);
}
export function installInput(win:Window,options:KeypadOptions,send:(key:number,pressed:boolean)=>void){
  const keyboard=new Set<string>();
  let held=new Set<number>(),request=0,paused=false,stopped=false,focused=true;
  const clear=()=>{keyboard.clear();updateKeys(held,new Set(),send);held.clear();};
  const tick=()=>{
    if(stopped)return;
    const next=new Set<number>();
    if(!paused&&focused&&!win.document.hidden){
      for(const key of gamepadKeys(Array.from(win.navigator.getGamepads?.()??[]),options))next.add(key);
      for(const code of keyboard){const key=keyboardKey(code,options);if(key!==null)next.add(key);}
    }
    updateKeys(held,next,send);held=next;request=win.requestAnimationFrame(tick);
  };
  const key=(event:KeyboardEvent)=>{
    if(stopped||paused||keyboardKey(event.code,options)===null||(event.target as Element|null)?.closest?.("input,textarea,button,[role=dialog]"))return;
    event.preventDefault();if(event.type==="keydown")keyboard.add(event.code);else keyboard.delete(event.code);
  };
  const blur=()=>{focused=false;clear();};
  const focus=()=>{focused=true;};
  const visibility=()=>{if(win.document.hidden)clear();};
  for(const type of ["keydown","keyup"])win.addEventListener(type,key as EventListener);
  win.addEventListener("blur",blur);win.addEventListener("focus",focus);request=win.requestAnimationFrame(tick);
  win.document.addEventListener("visibilitychange",visibility);
  return {pause(value:boolean){paused=value;if(value)clear();},stop(){
    if(stopped)return;stopped=true;win.cancelAnimationFrame(request);clear();
    for(const type of ["keydown","keyup"])win.removeEventListener(type,key as EventListener);
    win.removeEventListener("blur",blur);win.removeEventListener("focus",focus);
    win.document.removeEventListener("visibilitychange",visibility);
  }};
}
