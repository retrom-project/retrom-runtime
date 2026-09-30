import {afterEach, expect, it, vi} from "vitest";
import {installInput} from "./input.js";

afterEach(()=>vi.restoreAllMocks());

it("releases a held key immediately when the document hides, without another animation frame",()=>{
  let tick:FrameRequestCallback=()=>{};
  vi.spyOn(window,"requestAnimationFrame").mockImplementation(callback=>{tick=callback;return 1;});
  vi.spyOn(window,"cancelAnimationFrame").mockImplementation(()=>{});
  let hidden=false;
  vi.spyOn(document,"hidden","get").mockImplementation(()=>hidden);
  const send=vi.fn(),controls=installInput(window,{rotation:270,confirmKey:"ENTER"},send);
  try{
    window.dispatchEvent(new KeyboardEvent("keydown",{code:"ArrowRight"}));tick(0);
    expect(send.mock.calls).toEqual([[17,true]]);
    hidden=true;document.dispatchEvent(new Event("visibilitychange"));
    expect(send.mock.calls).toEqual([[17,true],[17,false]]);
    hidden=false;document.dispatchEvent(new Event("visibilitychange"));tick(1);
    expect(send.mock.calls).toHaveLength(2);
    window.dispatchEvent(new KeyboardEvent("keydown",{code:"Space"}));tick(2);
    controls.pause(true);expect(send.mock.calls.slice(-2)).toEqual([[5,true],[5,false]]);
    controls.pause(false);tick(3);expect(send.mock.calls).toHaveLength(4);
    window.dispatchEvent(new KeyboardEvent("keydown",{code:"Enter"}));tick(4);
    controls.stop();controls.stop();expect(send.mock.calls.slice(-2)).toEqual([[3,true],[3,false]]);
    window.dispatchEvent(new KeyboardEvent("keydown",{code:"Space"}));tick(5);
    expect(send.mock.calls).toHaveLength(6);
  }finally{controls.stop();}
});
