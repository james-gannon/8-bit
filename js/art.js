// Moonforge — sprite atlas (programmatic pixel art)
// Everything is drawn at runtime to small offscreen canvases, then blitted.

const TILE = 16;

// --- palette ----------------------------------------------------------------
const PAL = {
  ink:'#0a0e27', ink2:'#1a1530',
  grass:['#3a6a3d','#4a7c4f','#5e9460','#76b376'],
  darkGrass:['#1f3a25','#2a4a30','#365a3a','#447048'],
  dirt:['#5a3a22','#6b4a2b','#7c5a35','#8e6c44'],
  sand:['#d8b878','#e8c890','#f0d8a0','#fae6b8'],
  stone:['#5a6878','#6e7d8c','#8b9bab','#a8b8c8'],
  mossStone:['#3a5a44','#4a6a54','#6e8a78','#8aa890'],
  water:['#1a3a6c','#2a5a8c','#4a8cbc','#7ec0e0'],
  path:['#6a5a40','#7a6850','#8a7860','#9a8870'],
  snow:['#c8d8e8','#dce8f4','#eef4fa','#ffffff'],
  // accents
  moon:'#d8c8ff', moon2:'#b8a6ff', moon3:'#7c5dd6',
  gold:'#ffd86b', gold2:'#f0a050', gold3:'#a8642a',
  teal:'#4fd1c5', magic:'#e870d0', magic2:'#a83a8a',
  hp:'#e84a5f', mp:'#5b9fff',
  wood:['#3a2412','#5a3a22','#7c5a35','#9c7a4a'],
  leaf:['#1a4a25','#2a6a35','#3a8a48','#5cb060'],
  moonleaf:['#2a1d5a','#3d2470','#5a3a8a','#8a6ad0'],
  copper:'#c87850', silver:'#c8d0d8', gold4:'#ffd86b',
  mythril:'#6ae0c0', moonstone:'#c8a8ff', ruby:'#e84a5f', sapph:'#5b9fff',
};

// --- helpers ----------------------------------------------------------------
function mkCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function px(ctx,x,y,c){ctx.fillStyle=c;ctx.fillRect(x|0,y|0,1,1);}
function rect(ctx,x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x|0,y|0,w|0,h|0);}
// Tiny seedable RNG for deterministic art
function srand(seed){let s=seed>>>0||1;return ()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}

// Dither/noise tile painter — picks shades from a 4-step palette
function paintTerrain(ctx,ox,oy,palette,seed,opts={}){
  const r=srand(seed);
  for(let y=0;y<TILE;y++)for(let x=0;x<TILE;x++){
    const n=r();
    let i=1;
    if(n<0.10)i=0; else if(n<0.55)i=1; else if(n<0.90)i=2; else i=3;
    px(ctx,ox+x,oy+y,palette[i]);
  }
  // border softening for seam blending
  if(opts.edge){
    for(let i=0;i<TILE;i++){
      if(r()<0.25)px(ctx,ox+i,oy,palette[0]);
      if(r()<0.25)px(ctx,ox+i,oy+TILE-1,palette[0]);
      if(r()<0.25)px(ctx,ox,oy+i,palette[0]);
      if(r()<0.25)px(ctx,ox+TILE-1,oy+i,palette[0]);
    }
  }
}

// Water animated frames (subtle horizontal shimmer)
function paintWater(ctx,ox,oy,frame){
  const r=srand(7);
  for(let y=0;y<TILE;y++)for(let x=0;x<TILE;x++){
    const n=r();
    let i=1;
    if(n<0.20)i=0; else if(n<0.75)i=1; else i=2;
    px(ctx,ox+x,oy+y,PAL.water[i]);
  }
  // moving highlights
  for(let y=2;y<TILE-1;y+=4){
    const xx=((frame+y)%TILE);
    px(ctx,ox+xx,oy+y,PAL.water[3]);
    px(ctx,ox+(xx+1)%TILE,oy+y,PAL.water[3]);
    px(ctx,ox+(xx+5)%TILE,oy+y+1,PAL.water[2]);
  }
}

// --- Build the tile atlas ---------------------------------------------------
// Layout: 4 columns x N rows, animated water gets multiple frames horizontally
const T = { GRASS:0, GRASS2:1, DGRASS:2, DIRT:3, SAND:4, STONE:5, MOSS:6, PATH:7, SNOW:8, WATER:9 };
const WATER_FRAMES = 4;

const tileAtlas = mkCanvas(TILE*(10+WATER_FRAMES-1), TILE);
{
  const ctx=tileAtlas.getContext('2d');
  paintTerrain(ctx, T.GRASS*TILE, 0, PAL.grass, 11);
  paintTerrain(ctx, T.GRASS2*TILE,0, PAL.grass, 23);
  paintTerrain(ctx, T.DGRASS*TILE,0, PAL.darkGrass, 41);
  paintTerrain(ctx, T.DIRT*TILE,  0, PAL.dirt, 53);
  paintTerrain(ctx, T.SAND*TILE,  0, PAL.sand, 67);
  paintTerrain(ctx, T.STONE*TILE, 0, PAL.stone, 79);
  paintTerrain(ctx, T.MOSS*TILE,  0, PAL.mossStone, 89);
  paintTerrain(ctx, T.PATH*TILE,  0, PAL.path, 97);
  paintTerrain(ctx, T.SNOW*TILE,  0, PAL.snow, 103);
  for(let f=0;f<WATER_FRAMES;f++) paintWater(ctx,(T.WATER+f)*TILE,0,f*3);
}

function drawTile(ctx, t, dx, dy, frame){
  const sx = (t===T.WATER ? T.WATER + (frame % WATER_FRAMES) : t) * TILE;
  ctx.drawImage(tileAtlas, sx, 0, TILE, TILE, dx|0, dy|0, TILE, TILE);
}

// --- Object sprites (24x24 for trees, 16x16 for the rest) -------------------
const OBJ = {};

function _ellipse(ctx,cx,cy,rx,ry,c){
  ctx.fillStyle=c;
  for(let y=-ry;y<=ry;y++)for(let x=-rx;x<=rx;x++){
    if((x*x)/(rx*rx)+(y*y)/(ry*ry)<=1) ctx.fillRect((cx+x)|0,(cy+y)|0,1,1);
  }
}

function makeTree(palLeaf, palWood, glow){
  const c=mkCanvas(24,28);const ctx=c.getContext('2d');
  // shadow
  ctx.fillStyle='rgba(0,0,0,0.25)';
  for(let y=0;y<3;y++)for(let x=0;x<14;x++){
    if((x-7)*(x-7)/49+(y)*(y)/3<=1) ctx.fillRect(5+x,24+y,1,1);
  }
  // trunk
  rect(ctx,10,16,4,9,palWood[1]);
  rect(ctx,10,16,1,9,palWood[0]);
  rect(ctx,13,16,1,9,palWood[0]);
  rect(ctx,11,18,1,1,palWood[2]);
  rect(ctx,12,21,1,1,palWood[2]);
  // canopy — three overlapping ellipses of leaves
  _ellipse(ctx,12,10,9,7,palLeaf[1]);
  _ellipse(ctx,9,8,5,4,palLeaf[2]);
  _ellipse(ctx,15,9,5,4,palLeaf[2]);
  _ellipse(ctx,12,6,4,3,palLeaf[3]);
  // dapples & outline
  const r=srand(palLeaf[1].charCodeAt(2)*13);
  for(let i=0;i<24;i++){
    const x=4+(r()*16)|0, y=3+(r()*12)|0;
    const ix=(x-12)/9, iy=(y-10)/7;
    if(ix*ix+iy*iy<=1){
      px(ctx,x,y, r()<0.5?palLeaf[3]:palLeaf[0]);
    }
  }
  if(glow){
    // moonbloom sparkles
    px(ctx,8,5,'#fff');px(ctx,16,7,'#fff');px(ctx,11,11,PAL.moon);
    px(ctx,14,4,PAL.moon);px(ctx,7,9,PAL.magic);
  }
  return c;
}

OBJ.tree   = makeTree(PAL.leaf,    PAL.wood, false);
OBJ.tree2  = makeTree(PAL.leaf,    PAL.wood, false);
OBJ.moon   = makeTree(PAL.moonleaf,PAL.wood, true);
OBJ.pine   = (function(){
  const c=mkCanvas(24,28),ctx=c.getContext('2d');
  ctx.fillStyle='rgba(0,0,0,0.25)';for(let x=0;x<14;x++)ctx.fillRect(5+x,25,1,1);
  rect(ctx,11,18,2,8,PAL.wood[1]);rect(ctx,11,18,1,8,PAL.wood[0]);
  // triangular tiers
  for(let t=0;t<4;t++){
    const yy=4+t*4, w=4+t*2;
    for(let y=0;y<5;y++)for(let x=-w-1;x<=w+1;x++){
      if(Math.abs(x)<=w-Math.floor(y*0.7)) px(ctx,12+x,yy+y, x<0?PAL.leaf[1]:(x===w-Math.floor(y*0.7)?PAL.leaf[3]:PAL.leaf[2]));
    }
  }
  px(ctx,12,2,'#fff');px(ctx,13,3,PAL.gold);
  return c;
})();

// Rocks & ores (16x16) — all share a base rock shape
function makeRock(veinColor){
  const c=mkCanvas(TILE,TILE);const ctx=c.getContext('2d');
  ctx.fillStyle='rgba(0,0,0,0.25)';
  for(let x=2;x<14;x++)ctx.fillRect(x,14,1,1);
  // body
  const shape=[
    "................",
    "................",
    "....AAAAA.......",
    "...ABBBBBA......",
    "..ABBBBCBBA.....",
    "..ABCBBBBBBA....",
    ".ABBBBCCBBBBA...",
    ".ABBBBBBBBBBBA..",
    ".ABBBBBBBBBBA...",
    "..ABBBBBBBBA....",
    "...AAAAAAAA.....",
    "................",
    "................",
    "................",
    "................",
    "................",
  ];
  const map={A:PAL.stone[0],B:PAL.stone[2],C:PAL.stone[3]};
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const ch=shape[y][x]; if(map[ch]) px(ctx,x,y,map[ch]);
  }
  if(veinColor){
    // sprinkle vein
    const veins=[[5,5],[7,4],[8,6],[10,5],[6,7],[9,7],[11,6]];
    for(const[x,y]of veins){px(ctx,x,y,veinColor);px(ctx,x+1,y,veinColor);}
    // glint
    px(ctx,7,4,'#fff');
  }
  return c;
}

OBJ.rock     = makeRock(null);
OBJ.copper   = makeRock(PAL.copper);
OBJ.silver   = makeRock(PAL.silver);
OBJ.goldOre  = makeRock(PAL.gold4);
OBJ.mythril  = makeRock(PAL.mythril);
OBJ.moonOre  = makeRock(PAL.moonstone);

// Bushes, mushrooms, flowers, crystals
OBJ.bush = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  _ellipse(ctx,8,10,5,4,PAL.leaf[1]);
  _ellipse(ctx,6,9,2,2,PAL.leaf[2]);
  _ellipse(ctx,10,9,2,2,PAL.leaf[2]);
  px(ctx,7,8,PAL.leaf[3]);px(ctx,11,10,PAL.leaf[3]);
  px(ctx,5,12,'#e84a5f');px(ctx,11,11,'#e84a5f');
  return c;
})();

OBJ.mushroom = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  rect(ctx,7,10,2,4,'#e8d8b8');
  _ellipse(ctx,8,8,4,3,'#c44a4a');
  px(ctx,6,7,'#fff');px(ctx,9,7,'#fff');px(ctx,10,9,'#fff');
  rect(ctx,7,8,2,1,'#7a2a2a');
  return c;
})();

OBJ.flower = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  rect(ctx,8,10,1,4,PAL.leaf[2]);
  px(ctx,7,12,PAL.leaf[3]);px(ctx,9,11,PAL.leaf[3]);
  px(ctx,8,8,PAL.gold);px(ctx,7,7,PAL.magic);px(ctx,9,7,PAL.magic);
  px(ctx,7,9,PAL.magic);px(ctx,9,9,PAL.magic);px(ctx,8,9,PAL.gold2);
  return c;
})();

OBJ.crystal = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  // crystal cluster
  const draw=(cx,cy,h,col,hi)=>{
    for(let y=0;y<h;y++){
      const w=Math.max(1,Math.floor((h-y)/2));
      for(let x=-w;x<=w;x++) px(ctx,cx+x,cy-y, x===w?PAL.ink:col);
    }
    px(ctx,cx,cy-h+1,hi);
  };
  draw(8,14,7,PAL.moon2,'#fff');
  draw(5,13,4,PAL.magic,'#fff');
  draw(11,13,5,PAL.teal,'#fff');
  return c;
})();

OBJ.campfire = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  // logs
  rect(ctx,4,12,8,2,PAL.wood[1]);
  rect(ctx,3,13,2,1,PAL.wood[0]);rect(ctx,11,13,2,1,PAL.wood[0]);
  rect(ctx,5,12,1,1,PAL.wood[3]);rect(ctx,9,12,1,1,PAL.wood[3]);
  // stones
  px(ctx,3,14,PAL.stone[1]);px(ctx,12,14,PAL.stone[1]);
  // flame
  _ellipse(ctx,8,9,3,4,'#ff8030');
  _ellipse(ctx,8,10,2,3,'#ffd86b');
  px(ctx,8,7,'#fff');px(ctx,7,9,'#ffe89a');
  return c;
})();

OBJ.anvil = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  rect(ctx,5,13,6,2,PAL.stone[0]);
  rect(ctx,4,9,8,3,PAL.stone[1]);
  rect(ctx,3,8,10,1,PAL.stone[1]);
  rect(ctx,2,7,12,1,PAL.stone[2]);
  rect(ctx,4,9,8,1,PAL.stone[2]);
  rect(ctx,4,12,8,1,PAL.stone[0]);
  px(ctx,2,7,PAL.stone[0]);px(ctx,13,7,PAL.stone[0]);
  return c;
})();

// --- Player sprite (4 directions x 2 frames) -------------------------------
// Drawn with shapes — small adventurer with hood and cape.
function makePlayer(dir, frame){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  const bob = frame ? -1 : 0;
  const stepL = frame ? 1 : 0;
  const stepR = frame ? 0 : 1;
  // shadow
  ctx.fillStyle='rgba(0,0,0,0.30)';
  for(let x=4;x<12;x++) ctx.fillRect(x,14,1,1);
  ctx.fillRect(5,15,6,1);
  // cape
  rect(ctx,4,7+bob,8,5,PAL.moon3);
  rect(ctx,4,7+bob,1,5,'#3a2470');
  rect(ctx,11,7+bob,1,5,'#3a2470');
  rect(ctx,4,11+bob,8,1,'#3a2470');
  // hood
  rect(ctx,4,3+bob,8,4,PAL.moon2);
  rect(ctx,3,4+bob,1,3,PAL.moon2);
  rect(ctx,12,4+bob,1,3,PAL.moon2);
  rect(ctx,4,3+bob,8,1,PAL.moon3);
  // face
  if(dir==='down'){
    rect(ctx,5,7+bob,6,2,'#f5d0a9');
    px(ctx,6,8+bob,PAL.ink);px(ctx,9,8+bob,PAL.ink);
    px(ctx,7,9+bob,'#c87878');px(ctx,8,9+bob,'#c87878');
  } else if(dir==='up'){
    rect(ctx,5,7+bob,6,2,'#3a2470'); // back of hood, no face
  } else if(dir==='left'){
    rect(ctx,4,7+bob,5,2,'#f5d0a9');
    px(ctx,5,8+bob,PAL.ink);
  } else { // right
    rect(ctx,7,7+bob,5,2,'#f5d0a9');
    px(ctx,10,8+bob,PAL.ink);
  }
  // body / legs
  rect(ctx,5,12+bob,6,1,PAL.wood[0]); // belt
  rect(ctx,5,13+bob,3,2,PAL.moon3);   // left leg
  rect(ctx,8,13+bob,3,2,PAL.moon3);   // right leg
  rect(ctx,5,14+bob+stepL,3,1,PAL.ink2);
  rect(ctx,8,14+bob+stepR,3,1,PAL.ink2);
  // hood star
  px(ctx,7,4+bob,PAL.gold);px(ctx,8,3+bob,PAL.gold);
  return c;
}

const PLAYER = {
  down:  [makePlayer('down',0),  makePlayer('down',1)],
  up:    [makePlayer('up',0),    makePlayer('up',1)],
  left:  [makePlayer('left',0),  makePlayer('left',1)],
  right: [makePlayer('right',0), makePlayer('right',1)],
};

// --- Mobs ------------------------------------------------------------------
const MOB = {};

MOB.slime = (function(){
  const frames=[];
  for(let f=0;f<2;f++){
    const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
    const sq=f? -1:0;
    ctx.fillStyle='rgba(0,0,0,0.30)';for(let x=3;x<13;x++)ctx.fillRect(x,14,1,1);
    _ellipse(ctx,8,11+sq,5,3-sq,'#5cb060');
    _ellipse(ctx,8,10+sq,4,2-sq,'#76c878');
    px(ctx,6,10+sq,'#fff');px(ctx,10,10+sq,'#fff');
    px(ctx,6,11+sq,PAL.ink);px(ctx,10,11+sq,PAL.ink);
    frames.push(c);
  }
  return frames;
})();

MOB.bat = (function(){
  const frames=[];
  for(let f=0;f<2;f++){
    const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
    const wing=f?2:0;
    rect(ctx,7,7,2,3,'#3a2470'); // body
    px(ctx,7,7,PAL.magic);px(ctx,8,7,PAL.magic); // ear
    px(ctx,7,8,'#fff');px(ctx,8,8,'#fff');
    // wings
    rect(ctx,3,8-wing,4,2+wing,'#5a3a8a');
    rect(ctx,9,8-wing,4,2+wing,'#5a3a8a');
    px(ctx,3,8-wing,PAL.ink);px(ctx,12,8-wing,PAL.ink);
    frames.push(c);
  }
  return frames;
})();

MOB.wisp = (function(){
  const frames=[];
  for(let f=0;f<2;f++){
    const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
    const off=f?-1:0;
    _ellipse(ctx,8,8+off,4,4,PAL.magic);
    _ellipse(ctx,8,8+off,3,3,'#ffb0e8');
    _ellipse(ctx,8,8+off,1,1,'#fff');
    px(ctx,5,5+off,PAL.magic);px(ctx,11,5+off,PAL.magic);
    px(ctx,5,11+off,PAL.magic);px(ctx,11,11+off,PAL.magic);
    frames.push(c);
  }
  return frames;
})();

OBJ.chest = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  rect(ctx,3,7,10,7,PAL.wood[1]);
  rect(ctx,3,7,10,1,PAL.wood[0]);
  rect(ctx,3,13,10,1,PAL.wood[0]);
  rect(ctx,3,7,1,7,PAL.wood[0]);
  rect(ctx,12,7,1,7,PAL.wood[0]);
  rect(ctx,3,9,10,1,PAL.gold);
  rect(ctx,7,9,2,3,PAL.gold);
  px(ctx,8,11,PAL.ink);
  rect(ctx,4,8,8,1,PAL.wood[3]);
  return c;
})();

// --- Item icons (16x16) ----------------------------------------------------
const ITEM = {};

function _outline(ctx, shape, palette){
  for(let y=0;y<shape.length;y++)for(let x=0;x<shape[y].length;x++){
    const ch=shape[y][x]; if(palette[ch]) px(ctx,x,y,palette[ch]);
  }
}

ITEM.wood = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  rect(ctx,2,5,12,6,PAL.wood[1]);
  rect(ctx,2,5,12,1,PAL.wood[3]);
  rect(ctx,2,10,12,1,PAL.wood[0]);
  for(let i=0;i<3;i++) px(ctx,4+i*3,7,PAL.wood[0]);
  for(let i=0;i<3;i++) px(ctx,4+i*3,9,PAL.wood[2]);
  return c;
})();

ITEM.plank = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  rect(ctx,2,4,12,8,PAL.wood[2]);
  rect(ctx,2,4,12,1,PAL.wood[3]);
  rect(ctx,2,11,12,1,PAL.wood[0]);
  rect(ctx,2,7,12,1,PAL.wood[1]);
  return c;
})();

ITEM.stick = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  for(let i=0;i<10;i++) px(ctx,3+i,8-Math.floor(i/3),PAL.wood[2]);
  for(let i=0;i<10;i++) px(ctx,3+i,9-Math.floor(i/3),PAL.wood[1]);
  return c;
})();

ITEM.stone = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  _ellipse(ctx,8,9,5,3,PAL.stone[1]);
  _ellipse(ctx,8,8,4,2,PAL.stone[2]);
  px(ctx,7,7,PAL.stone[3]);
  return c;
})();

function makeIngot(c1,c2,c3){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  rect(ctx,2,7,12,4,c1);
  rect(ctx,2,7,12,1,c3);
  rect(ctx,2,10,12,1,c2);
  rect(ctx,2,7,1,4,c2);
  rect(ctx,13,7,1,4,c2);
  return c;
}
ITEM.copperIngot  = makeIngot(PAL.copper,'#7a4030','#ffc090');
ITEM.silverIngot  = makeIngot(PAL.silver,'#8090a0','#ffffff');
ITEM.goldIngot    = makeIngot(PAL.gold4, PAL.gold3,'#ffe89a');
ITEM.mythrilIngot = makeIngot(PAL.mythril,'#2a8070','#c0fff0');
ITEM.moonIngot    = makeIngot(PAL.moonstone,PAL.moon3,'#fff');

ITEM.copperOre  = (function(){const c=mkCanvas(TILE,TILE),x=c.getContext('2d');_ellipse(x,8,9,5,3,PAL.stone[1]);_ellipse(x,8,8,4,2,PAL.stone[2]);px(x,6,7,PAL.copper);px(x,9,8,PAL.copper);px(x,7,9,PAL.copper);return c;})();
ITEM.silverOre  = (function(){const c=mkCanvas(TILE,TILE),x=c.getContext('2d');_ellipse(x,8,9,5,3,PAL.stone[1]);_ellipse(x,8,8,4,2,PAL.stone[2]);px(x,6,7,PAL.silver);px(x,9,8,PAL.silver);px(x,7,9,PAL.silver);return c;})();
ITEM.goldOre    = (function(){const c=mkCanvas(TILE,TILE),x=c.getContext('2d');_ellipse(x,8,9,5,3,PAL.stone[1]);_ellipse(x,8,8,4,2,PAL.stone[2]);px(x,6,7,PAL.gold4);px(x,9,8,PAL.gold4);px(x,7,9,PAL.gold4);return c;})();
ITEM.mythrilOre = (function(){const c=mkCanvas(TILE,TILE),x=c.getContext('2d');_ellipse(x,8,9,5,3,PAL.stone[1]);_ellipse(x,8,8,4,2,PAL.stone[2]);px(x,6,7,PAL.mythril);px(x,9,8,PAL.mythril);px(x,7,9,PAL.mythril);return c;})();
ITEM.moonOre    = (function(){const c=mkCanvas(TILE,TILE),x=c.getContext('2d');_ellipse(x,8,9,5,3,PAL.stone[1]);_ellipse(x,8,8,4,2,PAL.stone[2]);px(x,6,7,PAL.moonstone);px(x,9,8,PAL.moonstone);px(x,7,9,PAL.moonstone);return c;})();

ITEM.gem = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  for(let y=4;y<12;y++){const w=Math.min(y-3,11-y);for(let x=-w;x<=w;x++)px(ctx,8+x,y,x===-w||x===w?PAL.ink:PAL.magic);}
  px(ctx,7,5,'#fff');px(ctx,8,5,'#ffb0e8');
  return c;
})();

ITEM.berry = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  _ellipse(ctx,6,9,2,2,PAL.hp);_ellipse(ctx,11,10,2,2,PAL.hp);
  px(ctx,5,8,'#ff8090');px(ctx,10,9,'#ff8090');
  px(ctx,7,7,PAL.leaf[2]);px(ctx,9,7,PAL.leaf[3]);
  return c;
})();

ITEM.herb = OBJ.flower;
ITEM.mushroom = OBJ.mushroom;

function makePotion(liquid){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  rect(ctx,6,3,4,2,PAL.wood[1]);
  rect(ctx,5,5,6,1,PAL.stone[2]);
  rect(ctx,5,6,6,7,'#dcecf4');
  rect(ctx,5,9,6,4,liquid);
  px(ctx,6,10,'#fff');
  rect(ctx,5,12,6,1,PAL.ink);
  return c;
}
ITEM.potionHp = makePotion(PAL.hp);
ITEM.potionMp = makePotion(PAL.mp);

function makeTool(headColor,headColor2,head){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  // handle (diagonal)
  for(let i=0;i<10;i++)px(ctx,3+i,12-i,PAL.wood[1]);
  for(let i=0;i<10;i++)px(ctx,4+i,12-i,PAL.wood[3]);
  // head
  if(head==='pickaxe'){
    rect(ctx,9,1,2,2,headColor2);
    rect(ctx,7,2,6,3,headColor);
    rect(ctx,5,3,3,2,headColor2);
    rect(ctx,12,3,3,2,headColor2);
    px(ctx,10,2,'#fff');
  } else if(head==='sword'){
    rect(ctx,10,1,2,8,headColor);
    rect(ctx,11,1,1,8,headColor2);
    px(ctx,10,1,'#fff');
    rect(ctx,8,9,6,1,PAL.gold);
    rect(ctx,10,10,2,2,PAL.wood[1]);
  } else if(head==='axe'){
    rect(ctx,8,2,5,5,headColor);
    rect(ctx,8,2,5,1,headColor2);
    rect(ctx,7,3,1,3,headColor);
    px(ctx,12,3,'#fff');
  } else if(head==='hammer'){
    rect(ctx,7,2,7,4,headColor);
    rect(ctx,7,2,7,1,headColor2);
    px(ctx,9,3,'#fff');
  }
  return c;
}
ITEM.pickaxeWood    = makeTool(PAL.stone[1],PAL.stone[3],'pickaxe');
ITEM.pickaxeCopper  = makeTool(PAL.copper,'#ffc090','pickaxe');
ITEM.pickaxeMythril = makeTool(PAL.mythril,'#c0fff0','pickaxe');
ITEM.swordWood      = makeTool(PAL.wood[2],PAL.wood[3],'sword');
ITEM.swordCopper    = makeTool(PAL.copper,'#ffc090','sword');
ITEM.swordMythril   = makeTool(PAL.mythril,'#c0fff0','sword');
ITEM.swordMoon      = makeTool(PAL.moonstone,'#fff','sword');
ITEM.axeWood        = makeTool(PAL.stone[1],PAL.stone[3],'axe');
ITEM.axeCopper      = makeTool(PAL.copper,'#ffc090','axe');
ITEM.hammer         = makeTool(PAL.stone[1],PAL.stone[3],'hammer');

ITEM.feather = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  for(let i=0;i<10;i++)px(ctx,3+i,12-i,PAL.wood[2]);
  _ellipse(ctx,9,5,3,4,PAL.moon2);
  _ellipse(ctx,9,5,2,3,PAL.moon);
  px(ctx,10,3,'#fff');
  return c;
})();

ITEM.lantern = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  rect(ctx,6,3,4,1,PAL.stone[1]);
  rect(ctx,5,4,6,7,PAL.stone[1]);
  rect(ctx,6,5,4,5,PAL.gold);
  px(ctx,7,7,'#fff');px(ctx,8,8,'#ffe89a');
  rect(ctx,5,11,6,1,PAL.stone[0]);
  rect(ctx,7,2,2,1,PAL.stone[0]);
  return c;
})();

ITEM.seed = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  _ellipse(ctx,8,8,3,4,PAL.moon2);
  _ellipse(ctx,8,8,2,3,PAL.moon);
  px(ctx,7,6,'#fff');
  px(ctx,5,5,PAL.magic);px(ctx,11,5,PAL.magic);
  px(ctx,5,11,PAL.magic);px(ctx,11,11,PAL.magic);
  return c;
})();

ITEM.scroll = (function(){
  const c=mkCanvas(TILE,TILE),ctx=c.getContext('2d');
  rect(ctx,3,5,10,6,'#f4e9c8');
  rect(ctx,2,5,1,6,'#a86438');
  rect(ctx,13,5,1,6,'#a86438');
  rect(ctx,5,7,6,1,PAL.ink);
  rect(ctx,5,9,4,1,PAL.ink);
  return c;
})();

// --- exported registry & draw helpers --------------------------------------
function drawSprite(ctx, sprite, dx, dy, scale){
  scale = scale || 1;
  ctx.drawImage(sprite, 0, 0, sprite.width, sprite.height,
    dx|0, dy|0, sprite.width*scale|0, sprite.height*scale|0);
}

window.ART = { TILE, T, PAL, tileAtlas, drawTile, drawSprite, OBJ, PLAYER, MOB, ITEM };

