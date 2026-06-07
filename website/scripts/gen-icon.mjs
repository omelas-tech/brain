// Generates the canonical "Neon glow" Brain Memory icon (palette: multi, style:
// glow) from the approved design's renderer + locked tweak geometry, then writes
// every SVG asset and rasterizes the PNGs. Run: node website/scripts/gen-icon.mjs
//
// The renderer (generate + svg) is copied VERBATIM from the design handoff
// (brain-icon/project/icon-render.js) so the output matches the explorer exactly.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Locked geometry from Brain Icon Explorations.html (TWEAK_DEFAULTS).
const TWEAKS = { pattern: "radial", count: 5, spread: 1.3, contrast: 0.2, density: 3, seed: 84741 };
// User's pick: "Neon glow — bright cores + halos on dark", multicolor palette.
const STYLE = "glow", PALETTE = "multi";
const TILE = "#07090A"; // brand near-black, matches site + connector surfaces

// ---------------------------------------------------------------------------
// ↓↓↓ verbatim from icon-render.js (generate + svg + helpers) ↓↓↓
const PALETTES = {
  warm:  ['#F5C24B', '#F0A03E', '#EC7E3C', '#E65C44', '#EFB85E'],
  cool:  ['#5A6B84', '#3F8E8E', '#6FA8D6', '#4E7CA8', '#7FBFB3'],
  multi: ['#F0A03E', '#E65C44', '#5A6B84', '#3F8E8E', '#6FA8D6', '#F5C24B'],
  mono:  ['#5A6B84'],
};
function hx(c){const n=parseInt(c.slice(1),16);return{r:(n>>16)&255,g:(n>>8)&255,b:n&255};}
function toHex(o){const h=v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');return'#'+h(o.r)+h(o.g)+h(o.b);}
function mix(a,b,t){const A=hx(a),B=hx(b);return toHex({r:A.r+(B.r-A.r)*t,g:A.g+(B.g-A.g)*t,b:A.b+(B.b-A.b)*t});}
function lighten(c,t){return mix(c,'#FFFFFF',t);}
function nodeColor(pal,n,i,xmin,xmax){if(pal.length===1)return pal[0];const span=(xmax-xmin)||1;const t=(n.x-xmin)/span;const idx=Math.min(pal.length-1,Math.floor(t*pal.length));return pal[(idx+(i%2))%pal.length];}
let UID=0;
function radius(a){return 9+a*17;}
function svg(opts){
  opts=opts||{};
  const pal=PALETTES[opts.palette||'warm'];
  const style=opts.style||'flat';
  const size=opts.size||256;
  const withLinks=opts.links!==false;
  const uid='bi'+(UID++);
  const nodes=opts.nodes;
  const edges=opts.edges;
  const xs=nodes.map(n=>n.x);
  const xmin=Math.min.apply(null,xs),xmax=Math.max.apply(null,xs);
  const colors=nodes.map((n,i)=>nodeColor(pal,n,i,xmin,xmax));
  let defs='';let body='';
  if(withLinks){
    let lines='';
    for(const [i,j] of edges){
      if(!nodes[i]||!nodes[j])continue;
      const aAvg=(nodes[i].a+nodes[j].a)/2;
      const col=mix(colors[i],colors[j],0.5);
      const w=(1.6+aAvg*3.2).toFixed(2);
      const op=(0.18+aAvg*0.34).toFixed(2);
      lines+=`<line x1="${nodes[i].x}" y1="${nodes[i].y}" x2="${nodes[j].x}" y2="${nodes[j].y}" stroke="${col}" stroke-width="${w}" stroke-opacity="${op}" stroke-linecap="round"/>`;
    }
    if(style==='glow'){
      defs+=`<filter id="${uid}-lg" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>`;
      body+=`<g filter="url(#${uid}-lg)" opacity="0.9">${lines}</g>`;
    }else{body+=`<g>${lines}</g>`;}
  }
  nodes.forEach((n,i)=>{
    const c=colors[i];const r=radius(n.a);
    if(style==='glow'){
      const gid=`${uid}-g${i}`;
      defs+=`<radialGradient id="${gid}"><stop offset="0%" stop-color="${lighten(c,0.5)}" stop-opacity="${(0.5+n.a*0.5).toFixed(2)}"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient>`;
      body+=`<circle cx="${n.x}" cy="${n.y}" r="${(r*2.4).toFixed(2)}" fill="url(#${gid})"/>`;
      body+=`<circle cx="${n.x}" cy="${n.y}" r="${(r*0.72).toFixed(2)}" fill="${lighten(c,0.78)}" fill-opacity="${(0.7+n.a*0.3).toFixed(2)}"/>`;
    }
  });
  return { defs, body, size };
}
function generate(o){
  o=o||{};
  const count=Math.max(3,Math.min(16,Math.round(o.count||8)));
  const pattern=o.pattern||'organic';
  const spread=o.spread!=null?o.spread:1.0;
  const contrast=o.contrast!=null?o.contrast:0.5;
  const density=Math.max(1,Math.round(o.density||2));
  let s=(o.seed||1)>>>0;if(s===0)s=1;
  const rnd=()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};
  const cx=128,cy=128;
  const maxR=Math.min(110,64*spread+34);
  const rot=rnd()*Math.PI*2;
  const TAU=Math.PI*2;
  const nodes=[];
  if(pattern==='organic'){
    const golden=Math.PI*(3-Math.sqrt(5));
    for(let i=0;i<count;i++){const t=count>1?i/(count-1):0;const rr=Math.sqrt(t)*maxR;const ang=i*golden+rot;nodes.push({x:cx+Math.cos(ang)*rr+(rnd()-0.5)*9,y:cy+Math.sin(ang)*rr+(rnd()-0.5)*9});}
  }else if(pattern==='scattered'){
    nodes.push({x:cx+(rnd()-0.5)*18,y:cy+(rnd()-0.5)*18});
    const minSep=maxR*0.5;let tries=0;
    while(nodes.length<count&&tries<3000){tries++;const ang=rnd()*TAU,rr=Math.sqrt(rnd())*maxR;const x=cx+Math.cos(ang)*rr,y=cy+Math.sin(ang)*rr;if(nodes.every(n=>Math.hypot(n.x-x,n.y-y)>minSep))nodes.push({x,y});}
    while(nodes.length<count){const ang=rnd()*TAU,rr=Math.sqrt(rnd())*maxR;nodes.push({x:cx+Math.cos(ang)*rr,y:cy+Math.sin(ang)*rr});}
  }else{
    nodes.push({x:cx,y:cy});
    const rest=count-1;
    if(rest<=6){for(let i=0;i<rest;i++){const ang=rot+(i/rest)*TAU+(rnd()-0.5)*0.35;nodes.push({x:cx+Math.cos(ang)*maxR*0.94,y:cy+Math.sin(ang)*maxR*0.94});}}
    else{const inner=Math.ceil(rest*0.4),outer=rest-inner;for(let i=0;i<inner;i++){const ang=rot+(i/inner)*TAU+(rnd()-0.5)*0.35;nodes.push({x:cx+Math.cos(ang)*maxR*0.55,y:cy+Math.sin(ang)*maxR*0.55});}for(let i=0;i<outer;i++){const ang=rot+0.4+(i/outer)*TAU+(rnd()-0.5)*0.3;nodes.push({x:cx+Math.cos(ang)*maxR*0.98,y:cy+Math.sin(ang)*maxR*0.98});}}
  }
  nodes.forEach((n,i)=>{n.x=Math.round(Math.max(16,Math.min(240,n.x))*10)/10;n.y=Math.round(Math.max(16,Math.min(240,n.y))*10)/10;n.a=i===0?1.0:Math.round((0.3+0.65*Math.pow(rnd(),1+contrast*2.4))*100)/100;});
  const edges=[],seen=new Set();
  for(let i=0;i<nodes.length;i++){const d=[];for(let j=0;j<nodes.length;j++)if(j!==i)d.push([j,Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y)]);d.sort((a,b)=>a[1]-b[1]);for(let k=0;k<Math.min(density,d.length);k++){const j=d[k][0];const key=i<j?i+'-'+j:j+'-'+i;if(!seen.has(key)){seen.add(key);edges.push([Math.min(i,j),Math.max(i,j)]);}}}
  return { nodes, edges };
}
// ↑↑↑ end verbatim ↑↑↑
// ---------------------------------------------------------------------------

const geo = generate(TWEAKS);
UID = 0; // deterministic ids
const { defs, body } = svg({ palette: PALETTE, style: STYLE, nodes: geo.nodes, edges: geo.edges });

// Compose a tile SVG in 256-space (rx 56 ≈ 22% squircle). vb=256, sized via w/h.
const tileSvg = (px) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${px}" height="${px}" role="img" aria-label="Brain Memory">` +
  `<defs>${defs}</defs>` +
  `<rect x="0" y="0" width="256" height="256" rx="56" ry="56" fill="${TILE}"/>` +
  `${body}</svg>\n`;
// Transparent mark (no tile) — for embedding on surfaces that already have a bg.
const markSvg = (px) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${px}" height="${px}" role="img" aria-label="Brain Memory">` +
  `<defs>${defs}</defs>${body}</svg>\n`;

// ---- write SVGs ----
const writes = {
  "website/public/icon.svg": tileSvg(1024),
  "website/public/favicon.svg": tileSvg(32),
  "website/public/icon-mark.svg": markSvg(1024), // transparent variant for in-page use
  "assets/icon.svg": tileSvg(1024),
};
for (const [rel, content] of Object.entries(writes)) {
  fs.writeFileSync(path.join(ROOT, rel), content);
  console.log("svg  ✓", rel);
}

// ---- rasterize PNGs from the 1024 master ----
const master = path.join(ROOT, "website/public/icon.svg");
const png = (rel, px) => {
  const out = path.join(ROOT, rel);
  execFileSync("rsvg-convert", ["-w", String(px), "-h", String(px), master, "-o", out]);
  console.log("png  ✓", rel, px + "px");
};
png("website/public/icon.png", 1024);
png("website/public/favicon-32.png", 32);
png("website/public/favicon-16.png", 16);
fs.copyFileSync(path.join(ROOT, "website/public/icon.png"), path.join(ROOT, "assets/icon.png"));
console.log("png  ✓ assets/icon.png (copied)");

// Emit the raw defs+body so other surfaces (connector inline glyph) can reuse it.
fs.writeFileSync(path.join(ROOT, "website/scripts/icon-glyph.json"), JSON.stringify({ defs, body }, null, 2));
console.log("\nGeometry nodes:", geo.nodes.length, "edges:", geo.edges.length);
console.log("done.");
