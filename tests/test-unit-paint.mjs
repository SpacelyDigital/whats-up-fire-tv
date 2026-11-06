// node --test tests/  — paintMap (kit.mjs): a ring on a layer's shared path ends with a line back to its first point,
// not closePath (Chromium's closePath costs more for every subpath already on the path: the 10 mi street map's 9,500
// rings took 0.9 s at 1x and 3.5 s at a stick's pace, on every paint); only a ring stroked with a butt or square cap,
// which a line back would notch where it starts, keeps closePath. Lines stay open, and a layer is filled once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {paintMap,useSettings} from '../web/kit.mjs';

// A 2D context that records every call (properties stay as set).
function recorder(){
  const calls=[],g=new Proxy({},{get:(t,k)=>k in t?t[k]:typeof k==='symbol'?undefined:(...a)=>{calls.push([k,...a]);return k==='createRadialGradient'?{addColorStop(){}}:undefined;}});
  return {calls,canvas:{getContext:()=>g,_k:1,width:200,height:200}};
}
// The subpaths drawn (moveTo starts one, lineTo extends it), closePath, fill and stroke, in order.
function trace(calls){
  const out=[];let p=null;
  for(const [op,...a] of calls){if(op==='moveTo'){p=[a];out.push(p);}else if(op==='lineTo')p.push(a);else if(op==='closePath'||op==='fill'||op==='stroke')out.push(op);}
  return out;
}

test('paintMap: a ring is closed by a line back to its first point, not closePath, unless a butt-capped stroke needs the join; a line stays open; one fill per layer',()=>{
  useSettings({mapMiles:10,distance:'mi'});
  const ring=(...v)=>Int16Array.of(...v);
  const detail={latitude:41.85,longitude:-87.65,per:1000,decoded:true,water:[],shore:[],waterways:[],
    landuse:[{c:'residential',r:ring(0,0,1000,0,1000,1000,0,1000)},{c:'residential',r:ring(2000,2000,3000,2000,3000,3000)},{c:'retail',r:ring(5000,5000,6000,5000,6000,6000)}],
    parks:[{c:'park',r:ring(-1000,-1000,-2000,-1000,-2000,-2000,-1000,-2000)}],
    roads:[{c:'minor',p:ring(0,0,1000,1000,2000,1000)}],
    aero:[{c:'runway',r:ring(0,0,4000,0,4000,1000,0,1000)},{c:'runway',p:ring(0,0,4000,0)},{c:'apron',r:ring(0,0,500,0,500,500)}],
    buildings:[{r:ring(-3000,-3000,-2000,-3000,-2000,-2000)}]};
  const base={latitude:41.85,longitude:-87.65,range:10,water:[[[0,0],[1,0],[1,1]]],shore:[],rivers:[],roads:[{c:'trunk',p:[[0,0],[2,2]]}],runways:[]};
  const {calls,canvas}=recorder();
  paintMap(canvas,{base,detail},{cx:100,cy:100,ppm:10,clip:{x:0,y:0,w:200,h:200}},[
    {layer:'landuse',classes:['residential'],fill:'#eee'},{layer:'parks',fill:'#ded'},{layer:'roads',from:'detail',classes:['minor'],stroke:'#fff',width:1},
    {layer:'aero',classes:['runway'],stroke:'#585a69',width:4.5,cap:'butt'},{layer:'aero',classes:['apron'],fill:'#e2dfea'},{layer:'buildings',fill:'#d9cfbf',stroke:'#c3b59f',width:.35},
    {layer:'water',fill:'#ace'},{layer:'roads',classes:['trunk'],stroke:'#000',width:2}]);
  assert.deepEqual(trace(calls),[
    [[100,100],[110,100],[110,90],[100,90],[100,100]],[[120,80],[130,80],[130,70],[120,80]],'fill', // landuse: the two residential rings (retail skipped), each back at its start, one fill
    [[90,110],[80,110],[80,120],[90,120],[90,110]],'fill',                                           // parks
    [[100,100],[110,90],[120,90]],'stroke',                                                          // a road is a line: left open
    [[100,100],[140,100],[140,90],[100,90]],'closePath',[[100,100],[140,100]],'stroke',              // a runway area stroked with butt caps keeps closePath; the runway line is open
    [[100,100],[105,100],[105,95],[100,100]],'fill',                                                 // an apron ring, filled: a line back
    [[70,130],[80,130],[80,120],[70,130]],'fill','stroke',                                           // a building: filled and stroked with round caps: a line back
    [[100,100],[110,100],[110,90],[100,100]],'fill',                                                 // a base water ring ([x,y] pairs) closes the same way
    [[100,100],[120,80]],'stroke']);                                                                 // a base road: left open
  assert.deepEqual(calls.filter(c=>c[0]==='fill'),Array(5).fill(['fill','nonzero']),'one nonzero fill per filled layer');
});
