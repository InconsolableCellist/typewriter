// Writes the per-port contact forces of a few strikes to <dir>/strike{22,28,50}.bin (Float32, 11 ports interleaved, 48 kHz).
import machine from '../../src/machine/frontstrike1926.js';
import { deriveGeometry } from '../../src/machine/geometry.js';
import { MechanicalSim, SUBSTEP_HZ } from '../../src/sim/mechanics.js';
import { loadGlyphsNode } from '../../src/sim/harness.js';
import { PORT } from '../../src/sim/ports.js';
import { writeFileSync } from 'node:fs';
const glyphs=await loadGlyphsNode(); const geo=deriveGeometry(machine);
const sim=new MechanicalSim({machine,geometry:geo,glyphs});
const nP=PORT.COUNT, sr=48000, sub=SUBSTEP_HZ/sr;
function run(dur,actions,tag){
 const N=Math.round(dur*sr); const out=new Float32Array(N*nP);
 let acts=actions.slice().sort((a,b)=>a[0]-b[0]), fi=0, acc=0;
 for(let i=0;i<N;i++){ const t=i/sr; while(fi<acts.length&&acts[fi][0]<=t){acts[fi][1]();fi++;}
   acc+=sub; let s=acc|0; acc-=s; let k=s; while(k-->0) sim.step();
   if(s>0) for(let p=0;p<nP;p++) sim.ports[p]/=s;
   for(let p=0;p<nP;p++){ out[i*nP+p]=sim.ports[p]; sim.ports[p]=0; } }
 writeFileSync(tag+'.bin',Buffer.from(out.buffer));
 const names=Object.keys(PORT).slice(0,nP); const s=[]; 
 for(let p=0;p<nP;p++){let m=0,mi=-1,e=0; for(let i=0;i<N;i++){const v=Math.abs(out[i*nP+p]); if(v>m){m=v;mi=i} e+=v*v;} s.push(names[p]+': max '+m.toFixed(2)+' @'+(mi/sr).toFixed(4)+'s E '+(e/sr).toExponential(2));}
 console.log(tag,'\n ',s.join('\n  '));
}
const key=c=>geo.keys.findIndex(k=>k.kind==='print'&&(k.lower===c));
process.chdir(process.argv[2] ?? ".");
run(0.7,[[0.02,()=>sim.pressKey(key('e'),28,0.09)]],'strike28');
run(0.7,[[0.02,()=>sim.pressKey(key('e'),22,0.09)]],'strike22');
run(0.7,[[0.02,()=>sim.pressKey(key('e'),50,0.09)]],'strike50');
