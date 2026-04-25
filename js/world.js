// Moonforge — world generation
// Chunk-based, seeded value-noise. Biomes drive terrain, objects, and mobs.

const CHUNK = 32; // tiles per side
const CHUNK_PX = CHUNK * 16;

// --- seeded RNG ------------------------------------------------------------
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = a; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(seed,x,y){
  let h = seed ^ (x * 374761393) ^ (y * 668265263);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smooth(t){return t*t*(3-2*t);}
function valueNoise(seed,x,y){
  const xi=Math.floor(x), yi=Math.floor(y);
  const xf=x-xi, yf=y-yi;
  const a=hash2(seed,xi,yi),   b=hash2(seed,xi+1,yi);
  const c=hash2(seed,xi,yi+1), d=hash2(seed,xi+1,yi+1);
  const u=smooth(xf), v=smooth(yf);
  return (a*(1-u)+b*u)*(1-v) + (c*(1-u)+d*u)*v;
}
function fbm(seed,x,y,octaves){
  let amp=1,freq=1,sum=0,norm=0;
  for(let i=0;i<octaves;i++){
    sum  += valueNoise(seed+i*131,x*freq,y*freq)*amp;
    norm += amp;
    amp  *= 0.5; freq *= 2;
  }
  return sum/norm;
}

// --- biome decision --------------------------------------------------------
// Returns: 'meadow' | 'forest' | 'moon_grove' | 'desert' | 'tundra' | 'rocky' | 'beach' | 'water'
function biomeAt(seed, tx, ty){
  const e = fbm(seed, tx*0.018, ty*0.018, 4);          // elevation
  const m = fbm(seed+777, tx*0.03,  ty*0.03,  3);      // moisture
  const t = fbm(seed+1337,tx*0.012, ty*0.012, 2);      // temperature
  const magic = fbm(seed+421, tx*0.05, ty*0.05, 2);    // magic veins
  if(e < 0.36) return 'water';
  if(e < 0.40) return 'beach';
  if(magic > 0.72 && e < 0.65) return 'moon_grove';
  if(e > 0.72) return 'rocky';
  if(t < 0.28) return 'tundra';
  if(m < 0.32) return 'desert';
  if(m > 0.62) return 'forest';
  return 'meadow';
}

// --- chunk generation ------------------------------------------------------
// terrain[i] = tile id (0..9); objects[i] = 0 none, 1..N object id; damage[i] = uint
// Object ids:
const O = {
  NONE:0, TREE:1, TREE2:2, MOON_TREE:3, PINE:4,
  ROCK:5, COPPER:6, SILVER:7, GOLD:8, MYTHRIL:9, MOONORE:10,
  BUSH:11, MUSHROOM:12, FLOWER:13, CRYSTAL:14,
  CAMPFIRE:15, ANVIL:16, CHEST:17,
};

const OBJECT_HARDNESS = {
  [O.TREE]:3, [O.TREE2]:3, [O.MOON_TREE]:5, [O.PINE]:3,
  [O.ROCK]:4, [O.COPPER]:5, [O.SILVER]:7, [O.GOLD]:9,
  [O.MYTHRIL]:12, [O.MOONORE]:14,
  [O.BUSH]:1, [O.MUSHROOM]:1, [O.FLOWER]:1, [O.CRYSTAL]:6,
  [O.CAMPFIRE]:2, [O.ANVIL]:8, [O.CHEST]:2,
};
const OBJECT_TOOL = {
  [O.TREE]:'axe', [O.TREE2]:'axe', [O.MOON_TREE]:'axe', [O.PINE]:'axe',
  [O.ROCK]:'pickaxe', [O.COPPER]:'pickaxe', [O.SILVER]:'pickaxe',
  [O.GOLD]:'pickaxe', [O.MYTHRIL]:'pickaxe', [O.MOONORE]:'pickaxe',
  [O.CRYSTAL]:'pickaxe',
  [O.BUSH]:'hand', [O.MUSHROOM]:'hand', [O.FLOWER]:'hand',
  [O.CHEST]:'hand',
};

function biomeTerrain(b, r){
  switch(b){
    case 'water':  return ART.T.WATER;
    case 'beach':  return ART.T.SAND;
    case 'desert': return r<0.05 ? ART.T.PATH : ART.T.SAND;
    case 'tundra': return r<0.1 ? ART.T.STONE : ART.T.SNOW;
    case 'rocky':  return r<0.15 ? ART.T.MOSS  : ART.T.STONE;
    case 'forest': return r<0.06 ? ART.T.PATH  : (r<0.5 ? ART.T.DGRASS : ART.T.GRASS);
    case 'moon_grove': return r<0.4 ? ART.T.DGRASS : ART.T.GRASS2;
    case 'meadow':
    default: return r<0.04 ? ART.T.PATH : (r<0.55 ? ART.T.GRASS : ART.T.GRASS2);
  }
}

function biomeObject(b, r1, r2){
  // r1 decides if any object spawns; r2 picks which.
  switch(b){
    case 'forest':
      if(r1 < 0.18) return r2<0.55?O.TREE:(r2<0.85?O.TREE2:O.PINE);
      if(r1 < 0.21) return O.BUSH;
      if(r1 < 0.225) return O.MUSHROOM;
      return O.NONE;
    case 'meadow':
      if(r1 < 0.04) return O.TREE;
      if(r1 < 0.07) return O.BUSH;
      if(r1 < 0.10) return O.FLOWER;
      return O.NONE;
    case 'moon_grove':
      if(r1 < 0.14) return O.MOON_TREE;
      if(r1 < 0.18) return O.CRYSTAL;
      if(r1 < 0.22) return O.FLOWER;
      if(r1 < 0.235) return O.MOONORE;
      return O.NONE;
    case 'rocky':
      if(r1 < 0.12) return O.ROCK;
      if(r1 < 0.15) return O.COPPER;
      if(r1 < 0.165) return O.SILVER;
      if(r1 < 0.172) return O.GOLD;
      if(r1 < 0.176) return O.MYTHRIL;
      return O.NONE;
    case 'tundra':
      if(r1 < 0.06) return O.PINE;
      if(r1 < 0.08) return O.ROCK;
      return O.NONE;
    case 'desert':
      if(r1 < 0.02) return O.ROCK;
      if(r1 < 0.025) return O.GOLD;
      return O.NONE;
    case 'beach':
      if(r1 < 0.01) return O.ROCK;
      return O.NONE;
    default: return O.NONE;
  }
}

// In-memory chunk cache. Each chunk is generated lazily and never regenerated
// (so the player's harvests persist for the session).
class World {
  constructor(seed){
    this.seed = seed >>> 0;
    this.chunks = new Map();
    this.modified = new Map(); // sparse override map: "cx,cy" -> {objects:Map<i,id>}
  }
  key(cx,cy){return cx+','+cy;}
  getChunk(cx,cy){
    const k=this.key(cx,cy);
    let c=this.chunks.get(k);
    if(c) return c;
    c = this._generate(cx,cy);
    this.chunks.set(k,c);
    return c;
  }
  _generate(cx,cy){
    const seed=this.seed;
    const terrain=new Uint8Array(CHUNK*CHUNK);
    const objects=new Uint8Array(CHUNK*CHUNK);
    const damage =new Uint8Array(CHUNK*CHUNK);
    for(let ly=0;ly<CHUNK;ly++)for(let lx=0;lx<CHUNK;lx++){
      const tx = cx*CHUNK+lx, ty = cy*CHUNK+ly;
      const b  = biomeAt(seed, tx, ty);
      const r0 = hash2(seed^0xA1, tx, ty);
      const t  = biomeTerrain(b, r0);
      terrain[ly*CHUNK+lx] = t;
      // objects only on solid ground
      if(t!==ART.T.WATER){
        const r1 = hash2(seed^0xB7, tx, ty);
        const r2 = hash2(seed^0xC9, tx, ty);
        objects[ly*CHUNK+lx] = biomeObject(b, r1, r2);
      }
    }
    // apply persisted modifications, if any
    const mod=this.modified.get(this.key(cx,cy));
    if(mod){
      for(const[i,id]of mod.objects) objects[i]=id;
    }
    return {cx,cy,terrain,objects,damage,biome:biomeAt(seed,cx*CHUNK+CHUNK/2,cy*CHUNK+CHUNK/2)};
  }
  // Tile/object accessors using world tile coords
  tileAt(tx,ty){
    const cx=Math.floor(tx/CHUNK), cy=Math.floor(ty/CHUNK);
    const c=this.getChunk(cx,cy);
    const lx=tx-cx*CHUNK, ly=ty-cy*CHUNK;
    return c.terrain[ly*CHUNK+lx];
  }
  objectAt(tx,ty){
    const cx=Math.floor(tx/CHUNK), cy=Math.floor(ty/CHUNK);
    const c=this.getChunk(cx,cy);
    const lx=tx-cx*CHUNK, ly=ty-cy*CHUNK;
    return c.objects[ly*CHUNK+lx];
  }
  setObject(tx,ty,id){
    const cx=Math.floor(tx/CHUNK), cy=Math.floor(ty/CHUNK);
    const c=this.getChunk(cx,cy);
    const lx=tx-cx*CHUNK, ly=ty-cy*CHUNK;
    const i=ly*CHUNK+lx;
    c.objects[i]=id;
    c.damage[i]=0;
    const k=this.key(cx,cy);
    let m=this.modified.get(k);
    if(!m){ m={objects:new Map()}; this.modified.set(k,m); }
    m.objects.set(i,id);
  }
  hitObject(tx,ty,amount){
    const cx=Math.floor(tx/CHUNK), cy=Math.floor(ty/CHUNK);
    const c=this.getChunk(cx,cy);
    const lx=tx-cx*CHUNK, ly=ty-cy*CHUNK;
    const i=ly*CHUNK+lx;
    const id=c.objects[i]; if(!id) return null;
    c.damage[i]+=amount;
    const dmg=c.damage[i];
    const hardness=OBJECT_HARDNESS[id]||1;
    if(dmg>=hardness){
      this.setObject(tx,ty,O.NONE);
      return {broken:true,id};
    }
    return {broken:false,id,progress:dmg/hardness};
  }
  isWalkable(tx,ty){
    const t=this.tileAt(tx,ty);
    if(t===ART.T.WATER) return false;
    const o=this.objectAt(tx,ty);
    if(!o) return true;
    // walk-through props
    if(o===O.FLOWER||o===O.MUSHROOM) return true;
    return false;
  }
  // Returns {x,y} world tile of a safe spawn near origin.
  findSpawn(){
    const seed=this.seed;
    for(let r=0;r<200;r++){
      for(let i=0;i<8;i++){
        const ang=Math.random()*Math.PI*2;
        const tx=Math.floor(Math.cos(ang)*r), ty=Math.floor(Math.sin(ang)*r);
        if(this.isWalkable(tx,ty) && this.tileAt(tx,ty)!==ART.T.WATER){
          return {tx,ty};
        }
      }
    }
    return {tx:0,ty:0};
  }
  serialize(){
    const out={seed:this.seed,mods:[]};
    for(const[k,m]of this.modified){
      const arr=[]; for(const[i,id]of m.objects) arr.push([i,id]);
      out.mods.push([k,arr]);
    }
    return out;
  }
  static deserialize(data){
    const w=new World(data.seed);
    for(const[k,arr]of data.mods){
      const m={objects:new Map()};
      for(const[i,id]of arr) m.objects.set(i,id);
      w.modified.set(k,m);
    }
    return w;
  }
}

window.WORLD = { CHUNK, CHUNK_PX, World, O, OBJECT_HARDNESS, OBJECT_TOOL, biomeAt };
