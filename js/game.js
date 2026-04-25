// Moonforge — main game logic
(function(){
'use strict';

const { TILE, T, PAL, drawTile, drawSprite, OBJ, PLAYER, MOB, ITEM } = window.ART;
const { CHUNK, World, O, OBJECT_HARDNESS, OBJECT_TOOL } = window.WORLD;

// --- canvas + camera -------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const view = { w: 480, h: 270, scale: 1 };
function resize(){
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  // target ~16-tile-wide viewport on phone, ~30 on desktop
  const targetW = Math.min(560, Math.max(280, W * 0.55));
  const scale = Math.max(1, Math.floor(W / targetW));
  view.w = Math.ceil(W / scale);
  view.h = Math.ceil(H / scale);
  view.scale = scale;
  canvas.width  = view.w * dpr;
  canvas.height = view.h * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

// --- input -----------------------------------------------------------------
const keys = new Set();
const input = { mx:0,my:0, joy:{x:0,y:0,active:false}, action:false, spell:false };
window.addEventListener('keydown', e => {
  keys.add(e.key.toLowerCase());
  if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase()))e.preventDefault();
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

// virtual joystick
(function(){
  const stick = document.getElementById('stick');
  const knob  = document.getElementById('knob');
  let id=null, cx=0, cy=0, R=50;
  function start(e){
    const t = e.touches ? e.touches[0] : e;
    id = e.touches ? t.identifier : 'mouse';
    const rect = stick.getBoundingClientRect();
    cx = rect.left + rect.width/2; cy = rect.top + rect.height/2;
    move(e);
    e.preventDefault();
  }
  function move(e){
    let t;
    if(e.touches){ for(const tt of e.touches) if(tt.identifier===id){t=tt;break;} if(!t) return; }
    else t=e;
    let dx=t.clientX-cx, dy=t.clientY-cy;
    const d=Math.hypot(dx,dy);
    if(d>R){ dx*=R/d; dy*=R/d; }
    knob.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;
    input.joy.x = dx/R; input.joy.y = dy/R; input.joy.active = (Math.abs(dx)+Math.abs(dy))>4;
    e.preventDefault();
  }
  function end(e){
    if(e.changedTouches){ let found=false; for(const tt of e.changedTouches) if(tt.identifier===id){found=true;break;} if(!found) return; }
    id=null;
    knob.style.transform='translate(-50%,-50%)';
    input.joy.x=0; input.joy.y=0; input.joy.active=false;
  }
  stick.addEventListener('touchstart', start, {passive:false});
  stick.addEventListener('touchmove',  move,  {passive:false});
  stick.addEventListener('touchend',   end);
  stick.addEventListener('touchcancel',end);
  stick.addEventListener('mousedown',  start);
  window.addEventListener('mousemove', e=>{if(id==='mouse')move(e);});
  window.addEventListener('mouseup',   e=>{if(id==='mouse')end({changedTouches:[]});});
})();

// touch action buttons
document.getElementById('btnAction').addEventListener('touchstart',e=>{input.action=true;e.preventDefault();},{passive:false});
document.getElementById('btnAction').addEventListener('touchend',  e=>{input.action=false;});
document.getElementById('btnAction').addEventListener('mousedown', e=>{input.action=true;});
document.getElementById('btnAction').addEventListener('mouseup',   e=>{input.action=false;});
document.getElementById('btnSpell').addEventListener('touchstart', e=>{input.spell=true;e.preventDefault();},{passive:false});
document.getElementById('btnSpell').addEventListener('touchend',   e=>{input.spell=false;});
document.getElementById('btnSpell').addEventListener('mousedown',  e=>{input.spell=true;});
document.getElementById('btnSpell').addEventListener('mouseup',    e=>{input.spell=false;});

// --- game state ------------------------------------------------------------
const SAVE_KEY = 'moonforge.save.v1';

const state = {
  world: null,
  player: null,
  mobs: [],
  drops: [],          // {x,y,vy,item,qty,life}
  particles: [],
  popups: [],         // float text
  time: 0,            // seconds
  dayTime: 0.30,      // 0..1, 0.25 sunrise, 0.5 noon, 0.75 sunset, 0..0.2 night
  dayLength: 240,     // seconds per full day
  day: 1,
  paused: false,
  selectedHotbar: 0,
  ui: { invOpen:false, tab:'inv', recipeIdx:0, heldSlot:-1 },
  stats: null,
};

function defaultPlayer(spawn){
  return {
    x: spawn.tx*16+8, y: spawn.ty*16+8,
    facing: 'down', moving: false, frame: 0, animT: 0,
    hp: 20, maxHp: 20,
    mp: 10, maxMp: 10,
    xp: 0, level: 1,
    nextLevel: 30,
    swing: 0, // animation timer
    invuln: 0,
    inventory: new Array(32).fill(null), // {item, qty}
    equip: { weapon:null, tool:null, charm:null },
    discovered: new Set(),
  };
}

// Items registry: id -> {name, icon, stack, kind, power, desc}
const ITEMS = {
  wood:           { name:'Heartwood',   icon:ITEM.wood,  stack:99, kind:'mat', desc:'A bundle of fragrant logs.' },
  plank:          { name:'Plank',       icon:ITEM.plank, stack:99, kind:'mat', desc:'Smoothed by hand. Ready to build.' },
  stick:          { name:'Stick',       icon:ITEM.stick, stack:99, kind:'mat', desc:'A simple shaft for tools.' },
  stone:          { name:'Stone',       icon:ITEM.stone, stack:99, kind:'mat', desc:'Heavy and reliable.' },
  copperOre:      { name:'Copper Ore',  icon:ITEM.copperOre, stack:99, kind:'mat' },
  silverOre:      { name:'Silver Ore',  icon:ITEM.silverOre, stack:99, kind:'mat' },
  goldOre:        { name:'Gold Ore',    icon:ITEM.goldOre,   stack:99, kind:'mat' },
  mythrilOre:     { name:'Mythril Ore', icon:ITEM.mythrilOre,stack:99, kind:'mat' },
  moonOre:        { name:'Moonstone',   icon:ITEM.moonOre,   stack:99, kind:'mat' },
  copperIngot:    { name:'Copper Ingot',icon:ITEM.copperIngot, stack:99, kind:'mat' },
  silverIngot:    { name:'Silver Ingot',icon:ITEM.silverIngot, stack:99, kind:'mat' },
  goldIngot:      { name:'Gold Ingot',  icon:ITEM.goldIngot,   stack:99, kind:'mat' },
  mythrilIngot:   { name:'Mythril Ingot',icon:ITEM.mythrilIngot,stack:99, kind:'mat' },
  moonIngot:      { name:'Moonsteel',   icon:ITEM.moonIngot,   stack:99, kind:'mat' },
  gem:            { name:'Starfire Gem',icon:ITEM.gem, stack:99, kind:'mat', desc:'Hums with starlight.' },
  berry:          { name:'Sunberry',    icon:ITEM.berry, stack:99, kind:'food', heal:2, desc:'Restores 2 HP.' },
  mushroom:       { name:'Glow Cap',    icon:ITEM.mushroom, stack:99, kind:'food', mana:2, desc:'Restores 2 MP.' },
  herb:           { name:'Moonpetal',   icon:ITEM.herb, stack:99, kind:'mat' },
  feather:        { name:'Moonbird Feather', icon:ITEM.feather, stack:99, kind:'mat', desc:'Lighter than wind.' },
  potionHp:       { name:'Healing Draught', icon:ITEM.potionHp, stack:20, kind:'food', heal:10 },
  potionMp:       { name:'Mana Draught',    icon:ITEM.potionMp, stack:20, kind:'food', mana:10 },
  pickaxeWood:    { name:'Wooden Pickaxe',  icon:ITEM.pickaxeWood, stack:1, kind:'tool', tool:'pickaxe', power:2 },
  pickaxeCopper:  { name:'Copper Pickaxe',  icon:ITEM.pickaxeCopper, stack:1, kind:'tool', tool:'pickaxe', power:4 },
  pickaxeMythril: { name:'Mythril Pickaxe', icon:ITEM.pickaxeMythril, stack:1, kind:'tool', tool:'pickaxe', power:8 },
  axeWood:        { name:'Wooden Axe',      icon:ITEM.axeWood, stack:1, kind:'tool', tool:'axe', power:2 },
  axeCopper:      { name:'Copper Axe',      icon:ITEM.axeCopper, stack:1, kind:'tool', tool:'axe', power:4 },
  swordWood:      { name:'Wooden Sword',    icon:ITEM.swordWood, stack:1, kind:'weapon', power:3 },
  swordCopper:    { name:'Copper Sword',    icon:ITEM.swordCopper, stack:1, kind:'weapon', power:5 },
  swordMythril:   { name:'Mythril Sword',   icon:ITEM.swordMythril, stack:1, kind:'weapon', power:9 },
  swordMoon:      { name:'Moonblade',       icon:ITEM.swordMoon, stack:1, kind:'weapon', power:14, desc:'Edged with starlight.' },
  hammer:         { name:'Forge Hammer',    icon:ITEM.hammer, stack:1, kind:'tool', tool:'hammer', power:3 },
  lantern:        { name:'Glow Lantern',    icon:ITEM.lantern, stack:1, kind:'charm', light:1 },
  seed:           { name:'Moonbloom Seed',  icon:ITEM.seed, stack:99, kind:'mat' },
  scroll:         { name:'Spell Scroll',    icon:ITEM.scroll, stack:99, kind:'mat' },
  campfire:       { name:'Campfire',         icon:OBJ.campfire, stack:20, kind:'placeable', place:O.CAMPFIRE, desc:'A warm hearth. Place to mark a camp.' },
  anvil:          { name:'Anvil',            icon:OBJ.anvil,    stack:5,  kind:'placeable', place:O.ANVIL,    desc:'For working metal in style.' },
  chest:          { name:'Wooden Chest',     icon:OBJ.chest,    stack:10, kind:'placeable', place:O.CHEST,    desc:'A keepsake for treasures.' },
};

// --- inventory helpers -----------------------------------------------------
function invAdd(p, id, qty){
  qty = qty|0; if(qty<=0) return 0;
  const def = ITEMS[id]; if(!def) return 0;
  const stack = def.stack || 99;
  // first stack onto existing
  for(let i=0;i<p.inventory.length && qty>0;i++){
    const s=p.inventory[i]; if(s && s.item===id && s.qty<stack){
      const add=Math.min(qty, stack-s.qty); s.qty+=add; qty-=add;
    }
  }
  // then place in empty
  for(let i=0;i<p.inventory.length && qty>0;i++){
    if(!p.inventory[i]){
      const add=Math.min(qty, stack);
      p.inventory[i] = { item:id, qty:add }; qty-=add;
    }
  }
  p.discovered.add(id);
  return qty; // overflow, dropped on floor maybe
}
function invCount(p, id){let n=0;for(const s of p.inventory)if(s&&s.item===id)n+=s.qty;return n;}
function invRemove(p, id, qty){
  let need=qty;
  for(let i=0;i<p.inventory.length && need>0;i++){
    const s=p.inventory[i]; if(s && s.item===id){
      const take=Math.min(need,s.qty); s.qty-=take; need-=take;
      if(s.qty<=0) p.inventory[i]=null;
    }
  }
  return qty-need;
}

// --- popups & particles ----------------------------------------------------
function popup(text, x, y, kind){
  state.popups.push({text, x, y, kind:kind||'', t:0});
}
function spark(x,y,color,n,spd){
  n=n||6; spd=spd||1;
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2;
    state.particles.push({x,y,vx:Math.cos(a)*spd*Math.random(),vy:Math.sin(a)*spd*Math.random()-0.5,life:1,color,size:1});
  }
}

// --- game start / load -----------------------------------------------------
function newGame(){
  const seed = (Math.random()*0xFFFFFFFF)>>>0;
  state.world = new World(seed);
  const spawn = state.world.findSpawn();
  state.player = defaultPlayer(spawn);
  // starter kit
  invAdd(state.player, 'pickaxeWood', 1);
  invAdd(state.player, 'axeWood', 1);
  invAdd(state.player, 'swordWood', 1);
  state.player.equip.weapon = 'swordWood';
  state.player.equip.tool = 'pickaxeWood';
  invAdd(state.player, 'berry', 3);
  state.day = 1; state.dayTime = 0.30;
  state.mobs = []; state.drops = []; state.particles = []; state.popups = [];
  hideSplash();
  saveNow();
}

function loadGame(){
  try{
    const raw = localStorage.getItem(SAVE_KEY); if(!raw) return false;
    const data = JSON.parse(raw);
    state.world = World.deserialize(data.world);
    state.player = data.player;
    state.player.discovered = new Set(data.player.discovered || []);
    if(!state.player.inventory) state.player.inventory = new Array(32).fill(null);
    state.day = data.day || 1;
    state.dayTime = data.dayTime ?? 0.3;
    state.mobs = []; state.drops = []; state.particles = []; state.popups = [];
    hideSplash();
    return true;
  }catch(e){ console.warn('load failed', e); return false; }
}

function saveNow(){
  if(!state.player) return;
  try{
    const p = state.player;
    const data = {
      world: state.world.serialize(),
      player: { ...p, discovered: Array.from(p.discovered) },
      day: state.day, dayTime: state.dayTime,
      ts: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  }catch(e){ console.warn('save failed',e); }
}
setInterval(()=>{ if(state.player && !state.paused) saveNow(); }, 8000);

function hideSplash(){
  const s=document.getElementById('splash'); s.classList.add('hidden');
  state.paused = false;
}
document.getElementById('btnNew').addEventListener('click', newGame);
document.getElementById('btnContinue').addEventListener('click', ()=>{ if(!loadGame()) newGame(); });
if(localStorage.getItem(SAVE_KEY)){
  document.getElementById('btnContinue').classList.remove('hidden');
}

// --- player update ---------------------------------------------------------
function playerUpdate(dt){
  const p = state.player; if(!p) return;
  let dx=0, dy=0;
  if(keys.has('w')||keys.has('arrowup'))    dy-=1;
  if(keys.has('s')||keys.has('arrowdown'))  dy+=1;
  if(keys.has('a')||keys.has('arrowleft'))  dx-=1;
  if(keys.has('d')||keys.has('arrowright')) dx+=1;
  if(input.joy.active){ dx += input.joy.x; dy += input.joy.y; }
  const m = Math.hypot(dx,dy);
  if(m>0.05){
    dx/=Math.max(m,1); dy/=Math.max(m,1);
    p.moving = true;
    if(Math.abs(dx)>Math.abs(dy)) p.facing = dx<0?'left':'right';
    else                          p.facing = dy<0?'up':'down';
  } else { p.moving=false; }

  const speed = 60; // px/sec
  const nx = p.x + dx*speed*dt;
  const ny = p.y + dy*speed*dt;
  // tile collision (separate axes)
  if(canStand(nx, p.y)) p.x = nx;
  if(canStand(p.x, ny)) p.y = ny;

  // animation
  p.animT += dt;
  if(p.moving){ if(p.animT>0.18){ p.animT=0; p.frame=(p.frame+1)%2; } }
  else { p.frame=0; }

  // swing decay
  if(p.swing>0) p.swing -= dt;
  if(p.invuln>0) p.invuln -= dt;

  // action: mine/attack
  if((keys.has('e')||keys.has(' ')||input.action) && p.swing<=0){
    doAction();
    p.swing = 0.32;
  }
  // spell
  if(keys.has('q') || input.spell){
    castSpell();
  }
  // hotbar number keys
  for(let i=0;i<8;i++){
    if(keys.has(String(i+1))){ state.selectedHotbar=i; }
  }
}

function canStand(px, py){
  // sample 4 corners of a 10px collision box centered on the feet
  const r=5;
  for(const[ox,oy]of[[-r,-2],[r-1,-2],[-r,r-1],[r-1,r-1]]){
    const tx=Math.floor((px+ox)/16), ty=Math.floor((py+oy)/16);
    if(!state.world.isWalkable(tx,ty)) return false;
  }
  return true;
}

// --- interact: mine/attack -------------------------------------------------
function tileInFront(p){
  const fx = p.facing==='left'?-12:p.facing==='right'?12:0;
  const fy = p.facing==='up'  ?-12:p.facing==='down' ?12:0;
  return { tx: Math.floor((p.x+fx)/16), ty: Math.floor((p.y+fy)/16), wx:p.x+fx, wy:p.y+fy };
}

function doAction(){
  const p = state.player;
  const hit = tileInFront(p);
  // attack any mob in range first
  for(const m of state.mobs){
    if(m.dead) continue;
    const dx=m.x-hit.wx, dy=m.y-hit.wy;
    if(dx*dx+dy*dy < 18*18){
      const dmg = (ITEMS[p.equip.weapon]?.power || 1) + Math.floor(p.level/2);
      m.hp -= dmg; m.knock = { x:Math.sign(m.x-p.x)*40, y:Math.sign(m.y-p.y)*40, t:0.18 };
      popup(''+dmg, m.x, m.y-14, 'dmg');
      spark(m.x,m.y, '#fff', 6, 1.6);
      if(m.hp<=0){ m.dead=true; mobLoot(m); }
      return;
    }
  }
  // else mine the tile in front
  const obj = state.world.objectAt(hit.tx, hit.ty);
  if(!obj) return;
  const tool = OBJECT_TOOL[obj];
  const eq = p.equip.tool ? ITEMS[p.equip.tool] : null;
  let power = 1;
  if(tool==='hand') power = 1;
  else if(eq && eq.tool===tool) power = eq.power;
  else power = 0; // wrong tool
  if(power===0){
    popup('Need '+tool, p.x, p.y-18, '');
    return;
  }
  const r = state.world.hitObject(hit.tx, hit.ty, power);
  spark(hit.tx*16+8, hit.ty*16+8, '#fff', 4, 1);
  if(r && r.broken){
    onBreak(obj, hit.tx, hit.ty);
  }
}

function onBreak(obj, tx, ty){
  const wx=tx*16+8, wy=ty*16+8;
  const drops = lootFor(obj);
  for(const[id,qty]of drops){
    invAdd(state.player, id, qty);
    popup('+'+qty+' '+ITEMS[id].name, wx, wy-14, 'xp');
  }
  spark(wx,wy,'#fff',12,2);
  // chance for moonbird feather from moon trees
  if(obj===O.MOON_TREE && Math.random()<0.4){
    invAdd(state.player,'feather',1); popup('+Feather',wx,wy-26,'xp');
  }
  gainXp(obj===O.MOONORE||obj===O.MYTHRIL?12: obj===O.GOLD?6: obj===O.SILVER?4: 2);
}

function lootFor(obj){
  switch(obj){
    case O.TREE: case O.TREE2: case O.PINE: return [['wood', 2+Math.floor(Math.random()*2)]];
    case O.MOON_TREE: return [['wood',3],['seed',1]];
    case O.ROCK:   return [['stone', 2+Math.floor(Math.random()*2)]];
    case O.COPPER: return [['copperOre', 1+Math.floor(Math.random()*2)],['stone',1]];
    case O.SILVER: return [['silverOre', 1+Math.floor(Math.random()*2)],['stone',1]];
    case O.GOLD:   return [['goldOre',   1],['stone',1]];
    case O.MYTHRIL:return [['mythrilOre',1],['gem', Math.random()<0.4?1:0]].filter(x=>x[1]>0);
    case O.MOONORE:return [['moonOre',   1+Math.floor(Math.random()*2)],['gem',1]];
    case O.BUSH:   return [['berry', 1+Math.floor(Math.random()*2)]];
    case O.MUSHROOM:return [['mushroom',1]];
    case O.FLOWER: return [['herb',1]];
    case O.CRYSTAL:return [['gem',1+Math.floor(Math.random()*2)],['stone',1]];
    case O.CHEST:  return chestLoot();
    default: return [];
  }
}
function chestLoot(){
  const out=[]; const r=Math.random();
  if(r<0.5) out.push(['potionHp',1]); else out.push(['potionMp',1]);
  out.push(['gem',1+Math.floor(Math.random()*2)]);
  if(Math.random()<0.25) out.push(['scroll',1]);
  return out;
}

// --- xp / level ------------------------------------------------------------
function gainXp(n){
  const p=state.player; p.xp+=n;
  popup('+'+n+' XP', p.x, p.y-22, 'xp');
  while(p.xp>=p.nextLevel){
    p.xp-=p.nextLevel; p.level++; p.nextLevel = Math.floor(p.nextLevel*1.6);
    p.maxHp += 4; p.maxMp += 2; p.hp = p.maxHp; p.mp = p.maxMp;
    popup('LEVEL UP!', p.x, p.y-30, 'heal');
    spark(p.x,p.y,'#ffd86b',24,2.5);
  }
}

// --- combat / mobs ---------------------------------------------------------
const MOB_DEFS = {
  slime:  { hp:6,  atk:2, speed:24, sprites:MOB.slime, sight:90,  loot:['mushroom','herb'], xp:3 },
  bat:    { hp:4,  atk:2, speed:55, sprites:MOB.bat,   sight:120, loot:['feather'],         xp:4 },
  wisp:   { hp:10, atk:4, speed:35, sprites:MOB.wisp,  sight:140, loot:['gem','moonOre'],   xp:8 },
};

function spawnMob(kind, x, y){
  const d = MOB_DEFS[kind];
  state.mobs.push({ kind, x, y, hp:d.hp, maxHp:d.hp, t:0, frame:0, dead:false, knock:null });
}

let lastSpawn = 0;
function maybeSpawn(dt){
  // night spawns near the player; cap at 12
  const night = isNight();
  const cap = night ? 14 : 4;
  if(state.mobs.filter(m=>!m.dead).length >= cap) return;
  lastSpawn -= dt;
  if(lastSpawn>0) return;
  lastSpawn = night ? 1.6 : 6;
  const p = state.player; if(!p) return;
  for(let tries=0;tries<8;tries++){
    const a=Math.random()*Math.PI*2;
    const r=160+Math.random()*120;
    const x=p.x+Math.cos(a)*r, y=p.y+Math.sin(a)*r;
    const tx=Math.floor(x/16), ty=Math.floor(y/16);
    if(!state.world.isWalkable(tx,ty)) continue;
    let kind='slime';
    const roll=Math.random();
    if(night){
      if(roll<0.35) kind='slime';
      else if(roll<0.75) kind='bat';
      else kind='wisp';
    } else {
      kind = roll<0.7?'slime':'bat';
    }
    spawnMob(kind,x,y);
    return;
  }
}

function mobLoot(m){
  const d = MOB_DEFS[m.kind];
  for(const id of d.loot){ if(Math.random()<0.6) invAdd(state.player, id, 1); }
  gainXp(d.xp);
  spark(m.x,m.y,'#fff',8,2);
}

function mobsUpdate(dt){
  const p = state.player; if(!p) return;
  for(let i=state.mobs.length-1;i>=0;i--){
    const m=state.mobs[i];
    if(m.dead){ if(m.fade===undefined)m.fade=0.4; m.fade-=dt; if(m.fade<=0)state.mobs.splice(i,1); continue; }
    const d = MOB_DEFS[m.kind];
    m.t += dt;
    if(m.t>0.16){ m.t=0; m.frame=(m.frame+1)%2; }
    const dx=p.x-m.x, dy=p.y-m.y, dist=Math.hypot(dx,dy);
    if(m.knock && m.knock.t>0){
      m.x += m.knock.x*dt; m.y += m.knock.y*dt; m.knock.t-=dt;
    } else if(dist < d.sight){
      const sp = d.speed;
      const ux=dx/Math.max(dist,1), uy=dy/Math.max(dist,1);
      const nx = m.x + ux*sp*dt, ny = m.y + uy*sp*dt;
      const tx=Math.floor(nx/16), ty=Math.floor(ny/16);
      if(state.world.isWalkable(tx,ty)){ m.x=nx; m.y=ny; }
      else { m.x += (Math.random()-0.5)*8; }
      // attack
      if(dist < 14 && p.invuln<=0){
        const dmg = d.atk;
        p.hp -= dmg; p.invuln = 0.6;
        popup('-'+dmg, p.x, p.y-14, 'dmg');
        spark(p.x,p.y,'#ff8090',8,2);
        if(p.hp<=0) onDeath();
      }
    }
  }
}

function onDeath(){
  const p=state.player;
  popup('You collapse...', p.x, p.y-30, 'dmg');
  // respawn at safe point with half stuff
  setTimeout(()=>{
    p.hp = Math.max(1, p.maxHp/2|0); p.mp = p.maxMp; p.invuln = 2;
    const sp = state.world.findSpawn();
    p.x = sp.tx*16+8; p.y = sp.ty*16+8;
    state.mobs = [];
  }, 800);
}

// --- magic / spells --------------------------------------------------------
function castSpell(){
  const p = state.player;
  if(p.spellCd && p.spellCd>0) return;
  const cost = 3;
  if(p.mp < cost){ popup('No mana', p.x, p.y-22, 'mana'); p.spellCd = 0.3; return; }
  p.mp -= cost;
  p.spellCd = 0.45;
  // bolt: shoots a magic projectile in facing direction
  const dx = p.facing==='left'?-1:p.facing==='right'?1:0;
  const dy = p.facing==='up'?-1:p.facing==='down'?1:0;
  const lvlBonus = Math.floor(p.level/2);
  state.particles.push({
    x:p.x, y:p.y-4, vx:dx*120, vy:dy*120,
    life:1.2, color:'#e870d0', size:2, projectile:true,
    dmg: 4 + lvlBonus,
    homing: invCount(p,'feather')>0 ? 0.8 : 0,
  });
  spark(p.x,p.y,'#e870d0',8,1);
}

// --- particle update -------------------------------------------------------
function particlesUpdate(dt){
  for(let i=state.particles.length-1;i>=0;i--){
    const pa = state.particles[i];
    pa.life -= dt;
    if(pa.projectile){
      // homing toward nearest mob
      if(pa.homing){
        let best=null,bd=99999;
        for(const m of state.mobs) if(!m.dead){
          const d=(m.x-pa.x)**2+(m.y-pa.y)**2; if(d<bd){bd=d;best=m;}
        }
        if(best){
          const ang=Math.atan2(best.y-pa.y, best.x-pa.x);
          const sp=Math.hypot(pa.vx,pa.vy);
          pa.vx += (Math.cos(ang)*sp - pa.vx)*pa.homing*dt;
          pa.vy += (Math.sin(ang)*sp - pa.vy)*pa.homing*dt;
        }
      }
      pa.x += pa.vx*dt; pa.y += pa.vy*dt;
      // hit mob?
      for(const m of state.mobs){
        if(m.dead) continue;
        if((m.x-pa.x)**2+(m.y-pa.y)**2 < 12*12){
          m.hp -= pa.dmg; popup('-'+pa.dmg, m.x, m.y-14, 'dmg');
          m.knock={x:pa.vx*0.3,y:pa.vy*0.3,t:0.15};
          spark(m.x,m.y,'#e870d0',8,1.6);
          pa.life = 0;
          if(m.hp<=0){ m.dead=true; mobLoot(m); }
          break;
        }
      }
      // tile collision
      const tx=Math.floor(pa.x/16), ty=Math.floor(pa.y/16);
      if(!state.world.isWalkable(tx,ty)){ pa.life = 0; spark(pa.x,pa.y,'#e870d0',6,1); }
    } else {
      pa.x += pa.vx; pa.y += pa.vy; pa.vy += 0.05;
    }
    if(pa.life<=0) state.particles.splice(i,1);
  }
}

// --- popups update ---------------------------------------------------------
function popupsUpdate(dt){
  for(let i=state.popups.length-1;i>=0;i--){
    const pp=state.popups[i]; pp.t+=dt; if(pp.t>1.0) state.popups.splice(i,1);
  }
}

// --- day/night -------------------------------------------------------------
function isNight(){ return state.dayTime<0.20 || state.dayTime>0.82; }
function dayLabel(){
  const t=state.dayTime;
  if(t<0.2)  return 'Night · Day '+state.day;
  if(t<0.32) return 'Dawn · Day '+state.day;
  if(t<0.48) return 'Morning · Day '+state.day;
  if(t<0.55) return 'Noon · Day '+state.day;
  if(t<0.72) return 'Afternoon · Day '+state.day;
  if(t<0.82) return 'Dusk · Day '+state.day;
  return 'Night · Day '+state.day;
}
function lightLevel(){
  // 0=dark night, 1=full day
  const t=state.dayTime;
  if(t<0.18)  return 0.18 + Math.max(0,(t-0)/0.18)*0.05;
  if(t<0.30)  return 0.25 + (t-0.18)/0.12*0.55; // dawn rise
  if(t<0.70)  return 0.95;
  if(t<0.84)  return 0.95 - (t-0.70)/0.14*0.7;  // dusk fall
  return 0.25 - (t-0.84)/0.16*0.07;
}
function ambientTint(){
  const t=state.dayTime;
  // Warm dawn, white noon, golden dusk, deep blue night
  if(t<0.18)  return [40,40,90];
  if(t<0.32)  return [255,180,140]; // dawn
  if(t<0.7)   return [255,250,235]; // day
  if(t<0.84)  return [255,150,90];  // dusk
  return [60,60,140];                // night
}

// --- camera & render -------------------------------------------------------
function camera(){
  const p=state.player; if(!p) return {x:0,y:0};
  return { x: p.x - view.w/2, y: p.y - view.h/2 };
}

function drawWorld(){
  ctx.fillStyle='#0a0e27';
  ctx.fillRect(0,0,view.w,view.h);
  if(!state.player) return;
  const cam = camera();
  const t0x = Math.floor(cam.x/16) - 1;
  const t0y = Math.floor(cam.y/16) - 1;
  const t1x = Math.ceil((cam.x+view.w)/16) + 1;
  const t1y = Math.ceil((cam.y+view.h)/16) + 1;
  const frame = Math.floor(state.time*4);
  // terrain
  for(let ty=t0y;ty<=t1y;ty++)for(let tx=t0x;tx<=t1x;tx++){
    const t = state.world.tileAt(tx,ty);
    drawTile(ctx, t, tx*16-cam.x, ty*16-cam.y, frame);
  }
  // collect drawables (objects + entities) and z-sort by feet y
  const draws = [];
  for(let ty=t0y;ty<=t1y;ty++)for(let tx=t0x;tx<=t1x;tx++){
    const o = state.world.objectAt(tx,ty);
    if(!o) continue;
    let sprite, dx=tx*16-cam.x, dy=ty*16-cam.y, foot=ty*16+16;
    switch(o){
      case O.TREE: sprite=OBJ.tree; dx-=4; dy-=12; break;
      case O.TREE2: sprite=OBJ.tree2; dx-=4; dy-=12; break;
      case O.MOON_TREE: sprite=OBJ.moon; dx-=4; dy-=12; break;
      case O.PINE: sprite=OBJ.pine; dx-=4; dy-=12; break;
      case O.ROCK: sprite=OBJ.rock; break;
      case O.COPPER: sprite=OBJ.copper; break;
      case O.SILVER: sprite=OBJ.silver; break;
      case O.GOLD: sprite=OBJ.goldOre; break;
      case O.MYTHRIL: sprite=OBJ.mythril; break;
      case O.MOONORE: sprite=OBJ.moonOre; break;
      case O.BUSH: sprite=OBJ.bush; break;
      case O.MUSHROOM: sprite=OBJ.mushroom; break;
      case O.FLOWER: sprite=OBJ.flower; break;
      case O.CRYSTAL: sprite=OBJ.crystal; break;
      case O.CAMPFIRE: sprite=OBJ.campfire; break;
      case O.ANVIL: sprite=OBJ.anvil; break;
      case O.CHEST: sprite=OBJ.chest; break;
    }
    if(sprite) draws.push({ y:foot, fn:()=>drawSprite(ctx, sprite, dx, dy) });
  }
  // mobs
  for(const m of state.mobs){
    const d = MOB_DEFS[m.kind];
    const dx = m.x - 8 - cam.x, dy = m.y - 8 - cam.y - (m.kind==='bat'?2:0);
    const sprite = d.sprites[m.frame|0];
    const alpha = m.dead ? Math.max(0,m.fade||0)/0.4 : 1;
    draws.push({ y:m.y, fn:()=>{
      ctx.save(); ctx.globalAlpha=alpha;
      drawSprite(ctx, sprite, dx, dy); ctx.restore();
      // hp bar
      if(!m.dead && m.hp<m.maxHp){
        const w=12, hpR = m.hp/m.maxHp;
        ctx.fillStyle='#000'; ctx.fillRect(dx+2,dy-2,w,2);
        ctx.fillStyle='#e84a5f'; ctx.fillRect(dx+2,dy-2,(w*hpR)|0,2);
      }
    }});
  }
  // player
  const p = state.player;
  draws.push({ y:p.y+1, fn:()=>{
    const frames = PLAYER[p.facing];
    const fr = frames[p.frame%2];
    const dx = p.x-8-cam.x, dy = p.y-12-cam.y;
    if(p.invuln>0 && Math.floor(p.invuln*15)%2===0){
      // skip (flicker)
    } else {
      drawSprite(ctx, fr, dx, dy);
    }
    // swing arc
    if(p.swing>0){
      ctx.save(); ctx.globalAlpha=p.swing*2;
      ctx.fillStyle='rgba(255,255,255,0.9)';
      const fx = p.facing==='left'?-10:p.facing==='right'?10:0;
      const fy = p.facing==='up'  ?-10:p.facing==='down' ?10:0;
      for(let i=0;i<3;i++) ctx.fillRect(p.x-cam.x+fx-2+i, p.y-cam.y+fy-2, 1, 1);
      ctx.restore();
    }
  }});
  draws.sort((a,b)=>a.y-b.y);
  for(const d of draws) d.fn();

  // particles
  for(const pa of state.particles){
    const dx=pa.x-cam.x, dy=pa.y-cam.y;
    if(pa.projectile){
      ctx.fillStyle=pa.color;
      ctx.fillRect(dx-1,dy-1,3,3);
      ctx.fillStyle='#fff';
      ctx.fillRect(dx,dy,1,1);
    } else {
      ctx.globalAlpha = Math.max(0,pa.life);
      ctx.fillStyle = pa.color;
      ctx.fillRect(dx|0, dy|0, pa.size, pa.size);
      ctx.globalAlpha = 1;
    }
  }

  // ambient tint
  const [r,g,b] = ambientTint();
  const lvl = lightLevel();
  if(lvl<0.95){
    ctx.fillStyle = `rgba(${r},${g},${b},${(1-lvl)*0.55})`;
    ctx.fillRect(0,0,view.w,view.h);
  }
  // night player light
  if(lvl<0.6){
    const grad = ctx.createRadialGradient(p.x-cam.x,p.y-cam.y,4, p.x-cam.x,p.y-cam.y,80);
    grad.addColorStop(0,'rgba(255,240,200,0.4)');
    grad.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,view.w,view.h);
  }
  // float popups (drawn in canvas space, small)
  for(const pp of state.popups){
    const dx=pp.x-cam.x, dy=pp.y-cam.y - pp.t*16;
    ctx.font = '8px ui-monospace,monospace';
    const col = pp.kind==='dmg'?'#ff8090':pp.kind==='heal'?'#9bdc8a':pp.kind==='xp'?'#ffd86b':pp.kind==='mana'?'#7ec0e0':'#fff';
    ctx.fillStyle='rgba(0,0,0,0.7)';
    ctx.fillText(pp.text, dx+1, dy+1);
    ctx.fillStyle=col;
    ctx.fillText(pp.text, dx, dy);
  }
}

// --- HUD updates ----------------------------------------------------------
const hpBar = document.querySelector('.bar.hp i');
const hpTxt = document.querySelector('.bar.hp span');
const mpBar = document.querySelector('.bar.mp i');
const mpTxt = document.querySelector('.bar.mp span');
const xpBar = document.querySelector('.bar.xp i');
const xpTxt = document.querySelector('.bar.xp span');
const dayLabelEl = document.getElementById('dayLabel');
const clockOrb = document.getElementById('clockOrb');

function updateHud(){
  const p=state.player; if(!p) return;
  hpBar.style.width = Math.max(0, p.hp/p.maxHp*100) + '%';
  hpTxt.textContent = `${Math.max(0,p.hp|0)} / ${p.maxHp}`;
  mpBar.style.width = Math.max(0, p.mp/p.maxMp*100) + '%';
  mpTxt.textContent = `${p.mp|0} / ${p.maxMp}`;
  xpBar.style.width = Math.min(100, p.xp/p.nextLevel*100) + '%';
  xpTxt.textContent = `LV ${p.level}`;
  dayLabelEl.textContent = dayLabel();
  // orb color shifts day↔night
  const t = state.dayTime;
  if(t<0.18 || t>0.84){
    clockOrb.style.background = 'radial-gradient(circle at 35% 35%,#fff,#d8c8ff 60%,#7c5dd6)';
    clockOrb.style.boxShadow = '0 0 12px rgba(184,166,255,.7)';
  } else if(t<0.32){
    clockOrb.style.background = 'radial-gradient(circle at 35% 35%,#fff7d8,#ffb070 60%,#a83a3a)';
    clockOrb.style.boxShadow = '0 0 12px rgba(255,160,90,.7)';
  } else {
    clockOrb.style.background = 'radial-gradient(circle at 35% 35%,#fff7d8,#ffd86b 60%,#f0a050)';
    clockOrb.style.boxShadow = '0 0 12px rgba(255,216,107,.7)';
  }
}

// minimap -------------------------------------------------------------------
const mmCanvas = document.querySelector('#minimap canvas');
const mmCtx = mmCanvas.getContext('2d');
mmCtx.imageSmoothingEnabled = false;
let mmTimer = 0;
function drawMinimap(dt){
  mmTimer -= dt; if(mmTimer>0) return; mmTimer = 0.25;
  const p = state.player; if(!p) return;
  const W=120,H=120, R=60; // tiles radius
  mmCtx.clearRect(0,0,W,H);
  const cx = Math.floor(p.x/16), cy = Math.floor(p.y/16);
  const colors = {
    [T.GRASS]:'#4a7c4f',[T.GRASS2]:'#5e9460',[T.DGRASS]:'#2a4a30',
    [T.DIRT]:'#6b4a2b',[T.SAND]:'#e8c890',[T.STONE]:'#8b9bab',
    [T.MOSS]:'#4a6a54',[T.PATH]:'#7a6850',[T.SNOW]:'#dce8f4',[T.WATER]:'#2a5a8c',
  };
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const tx=cx + Math.floor((x-W/2)*R/W*2);
    const ty=cy + Math.floor((y-H/2)*R/H*2);
    const t=state.world.tileAt(tx,ty);
    mmCtx.fillStyle = colors[t]||'#000';
    mmCtx.fillRect(x,y,1,1);
    const o=state.world.objectAt(tx,ty);
    if(o===O.MOON_TREE||o===O.MOONORE||o===O.CRYSTAL){ mmCtx.fillStyle='#e870d0'; mmCtx.fillRect(x,y,1,1); }
    else if(o>=O.TREE && o<=O.PINE){ mmCtx.fillStyle='#1a4a25'; mmCtx.fillRect(x,y,1,1); }
    else if(o>=O.ROCK && o<=O.MYTHRIL){ mmCtx.fillStyle='#5a6878'; mmCtx.fillRect(x,y,1,1); }
  }
  // player marker
  mmCtx.fillStyle='#ffd86b';
  mmCtx.fillRect(W/2-1,H/2-1,3,3);
  mmCtx.fillStyle='#fff';
  mmCtx.fillRect(W/2,H/2,1,1);
}

// hotbar --------------------------------------------------------------------
const hotbarEl = document.getElementById('hotbar');
function buildHotbar(){
  hotbarEl.innerHTML = '';
  for(let i=0;i<8;i++){
    const div = document.createElement('div');
    div.className = 'slot' + (i===state.selectedHotbar?' active':'');
    div.dataset.slot = i;
    div.innerHTML = `<div class="key">${i+1}</div>`;
    div.addEventListener('click', ()=>{ state.selectedHotbar = i; refreshHotbar(); });
    hotbarEl.appendChild(div);
  }
  refreshHotbar();
}
function refreshHotbar(){
  const slots = hotbarEl.querySelectorAll('.slot');
  for(let i=0;i<slots.length;i++){
    const s = slots[i];
    s.classList.toggle('active', i===state.selectedHotbar);
    // remove existing icon
    const old = s.querySelector('canvas'); if(old) s.removeChild(old);
    const old2 = s.querySelector('.qty'); if(old2) s.removeChild(old2);
    const item = state.player?.inventory[i];
    if(item){
      const c = document.createElement('canvas'); c.width=16; c.height=16;
      const cx = c.getContext('2d'); cx.imageSmoothingEnabled=false;
      cx.drawImage(ITEMS[item.item].icon,0,0);
      s.appendChild(c);
      if(item.qty>1){
        const q = document.createElement('div'); q.className='qty'; q.textContent=item.qty;
        s.appendChild(q);
      }
    }
  }
}

// --- main loop -------------------------------------------------------------
let last = performance.now();
function loop(now){
  const dt = Math.min(0.05, (now-last)/1000); last = now;
  if(state.player && !state.paused){
    state.time += dt;
    state.dayTime += dt / state.dayLength;
    if(state.dayTime>=1){ state.dayTime-=1; state.day++; }
    playerUpdate(dt);
    mobsUpdate(dt);
    particlesUpdate(dt);
    popupsUpdate(dt);
    maybeSpawn(dt);
    // passive heal during day, mana regen
    state.player.mp = Math.min(state.player.maxMp, state.player.mp + 0.4*dt);
    if(!isNight() && state.player.hp<state.player.maxHp){
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + 0.3*dt);
    }
    if(state.player.spellCd>0) state.player.spellCd-=dt;
  }
  drawWorld();
  updateHud();
  drawMinimap(dt);
  requestAnimationFrame(loop);
}
buildHotbar();
requestAnimationFrame(loop);

// --- inventory & crafting --------------------------------------------------
const RECIPES = [
  { out:['plank',4], ing:[['wood',1]], station:null, name:'Plank' },
  { out:['stick',4], ing:[['plank',2]], station:null, name:'Stick' },
  { out:['pickaxeWood',1], ing:[['plank',3],['stick',2]], station:null, name:'Wooden Pickaxe' },
  { out:['axeWood',1], ing:[['plank',3],['stick',2]], station:null, name:'Wooden Axe' },
  { out:['swordWood',1], ing:[['plank',2],['stick',1]], station:null, name:'Wooden Sword' },
  { out:['hammer',1], ing:[['stone',3],['stick',2]], station:null, name:'Forge Hammer' },
  { out:['campfire',1], ing:[['stone',3],['wood',2]], station:null, name:'Campfire' },
  { out:['chest',1],    ing:[['plank',6],['copperIngot',1]], station:null, name:'Wooden Chest' },
  { out:['anvil',1],    ing:[['stone',6],['copperIngot',2]], station:'hammer', name:'Anvil' },
  // forge requires hammer
  { out:['copperIngot',1], ing:[['copperOre',2]], station:'hammer', name:'Smelt Copper' },
  { out:['silverIngot',1], ing:[['silverOre',2]], station:'hammer', name:'Smelt Silver' },
  { out:['goldIngot',1],   ing:[['goldOre',2]],   station:'hammer', name:'Smelt Gold' },
  { out:['mythrilIngot',1],ing:[['mythrilOre',2],['goldIngot',1]], station:'hammer', name:'Forge Mythril' },
  { out:['moonIngot',1],   ing:[['moonOre',2],['feather',1]], station:'hammer', name:'Forge Moonsteel' },
  { out:['pickaxeCopper',1], ing:[['copperIngot',3],['stick',2]], station:'hammer', name:'Copper Pickaxe' },
  { out:['axeCopper',1],     ing:[['copperIngot',3],['stick',2]], station:'hammer', name:'Copper Axe' },
  { out:['swordCopper',1],   ing:[['copperIngot',2],['stick',1]], station:'hammer', name:'Copper Sword' },
  { out:['pickaxeMythril',1],ing:[['mythrilIngot',3],['stick',2]], station:'hammer', name:'Mythril Pickaxe' },
  { out:['swordMythril',1],  ing:[['mythrilIngot',3],['stick',1]], station:'hammer', name:'Mythril Sword' },
  { out:['swordMoon',1],     ing:[['moonIngot',3],['gem',2],['feather',1]], station:'hammer', name:'Moonblade' },
  { out:['lantern',1],       ing:[['copperIngot',2],['gem',1]], station:'hammer', name:'Glow Lantern' },
  { out:['potionHp',1],      ing:[['berry',3],['herb',1]], station:null, name:'Healing Draught' },
  { out:['potionMp',1],      ing:[['mushroom',3],['herb',1]], station:null, name:'Mana Draught' },
];

// --- inventory UI ---------------------------------------------------------
const screenInv = document.getElementById('screen-inv');
const invGrid   = document.getElementById('invGrid');
const recipeList= document.getElementById('recipeList');
const recipeDet = document.getElementById('recipeDetail');
const codexEl   = document.getElementById('codex');

function openInv(){ state.ui.invOpen=true; state.paused=true; screenInv.classList.remove('hidden'); buildInv(); buildRecipes(); buildCodex(); }
function closeInv(){ state.ui.invOpen=false; state.ui.heldSlot=-1; state.paused=false; screenInv.classList.add('hidden'); refreshHotbar(); }
document.getElementById('btnClose').addEventListener('click', closeInv);
document.getElementById('btnInv').addEventListener('click', ()=>state.ui.invOpen?closeInv():openInv());
window.addEventListener('keydown', e=>{
  const k=e.key.toLowerCase();
  if(k==='i'){ state.ui.invOpen?closeInv():openInv(); }
  if(k==='c'){ if(!state.ui.invOpen)openInv(); switchTab('craft'); }
  if(k==='escape' && state.ui.invOpen) closeInv();
  // use selected hotbar
  if(k==='f'){ useHotbar(); }
});
document.getElementById('btnAction').addEventListener('contextmenu', e=>{e.preventDefault();useHotbar();});

document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click', ()=>switchTab(t.dataset.tab));
});
function switchTab(tab){
  state.ui.tab = tab;
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===tab));
  document.querySelectorAll('.tab-body').forEach(b=>b.classList.toggle('hidden', b.dataset.tab!==tab));
}

function buildInv(){
  const p = state.player; if(!p) return;
  invGrid.innerHTML='';
  for(let i=0;i<p.inventory.length;i++){
    const slot = document.createElement('div');
    slot.className = 'slot';
    if(i<8){ const k=document.createElement('div'); k.className='key'; k.textContent=(i+1); slot.appendChild(k); }
    if(state.ui.heldSlot===i) slot.classList.add('held');
    const it = p.inventory[i];
    if(it){
      const c = document.createElement('canvas'); c.width=16; c.height=16;
      c.getContext('2d').drawImage(ITEMS[it.item].icon,0,0);
      slot.appendChild(c);
      if(it.qty>1){ const q=document.createElement('div'); q.className='qty'; q.textContent=it.qty; slot.appendChild(q); }
      slot.title = ITEMS[it.item].name + (ITEMS[it.item].desc?': '+ITEMS[it.item].desc:'') + '   (click: move · dbl-click: use)';
    }
    slot.addEventListener('click', e=>{ slotPickOrDrop(i); });
    slot.addEventListener('dblclick', e=>{ state.ui.heldSlot=-1; slotUse(i); });
    slot.addEventListener('contextmenu', e=>{ e.preventDefault(); state.ui.heldSlot=-1; slotUse(i); });
    invGrid.appendChild(slot);
  }
  buildEquipDisplay();
}

// Click pick-and-drop: works for both desktop and touch.
function slotPickOrDrop(i){
  const p = state.player;
  const held = state.ui.heldSlot;
  if(held === -1){
    if(p.inventory[i]) state.ui.heldSlot = i;
  } else if(held === i){
    state.ui.heldSlot = -1; // cancel pick-up
  } else {
    const a = p.inventory[held], b = p.inventory[i];
    if(a && b && a.item === b.item){
      // merge stacks (overflow stays in source)
      const stack = ITEMS[a.item].stack || 99;
      const room = stack - b.qty;
      const move = Math.max(0, Math.min(a.qty, room));
      b.qty += move; a.qty -= move;
      if(a.qty <= 0) p.inventory[held] = null;
    } else {
      p.inventory[held] = b; p.inventory[i] = a;
    }
    state.ui.heldSlot = -1;
  }
  buildInv(); refreshHotbar();
}

// Double-click / right-click to use or equip from any slot.
function slotUse(i){
  const p = state.player; if(!p) return;
  const it = p.inventory[i]; if(!it) return;
  const def = ITEMS[it.item]; if(!def) return;
  if(def.kind==='weapon'){ p.equip.weapon = it.item; popup('Wield '+def.name, p.x, p.y-22, 'xp'); }
  else if(def.kind==='tool'){ p.equip.tool = it.item; popup('Wield '+def.name, p.x, p.y-22, 'xp'); }
  else if(def.kind==='charm'){ p.equip.charm = it.item; popup('Equip '+def.name, p.x, p.y-22, 'xp'); }
  else if(def.kind==='food'){
    if(def.heal){ p.hp=Math.min(p.maxHp,p.hp+def.heal); popup('+'+def.heal,p.x,p.y-20,'heal'); }
    if(def.mana){ p.mp=Math.min(p.maxMp,p.mp+def.mana); popup('+'+def.mana,p.x,p.y-20,'mana'); }
    invRemove(p, it.item, 1);
  }
  else if(def.kind==='placeable'){
    const f = tileInFront(p);
    if(state.world.tileAt(f.tx,f.ty)===T.WATER){ popup('Not on water', p.x, p.y-22,''); return; }
    if(state.world.objectAt(f.tx,f.ty)){ popup('Blocked', p.x, p.y-22,''); return; }
    state.world.setObject(f.tx, f.ty, def.place);
    invRemove(p, it.item, 1);
    spark(f.tx*16+8, f.ty*16+8, '#ffd86b', 8, 1.4);
    popup('Placed '+def.name, f.tx*16+8, f.ty*16+8, 'xp');
  }
  buildInv(); refreshHotbar(); buildEquipDisplay();
}

function buildEquipDisplay(){
  const p = state.player;
  document.querySelectorAll('.equip-slot').forEach(es=>{
    const which=es.dataset.slot;
    const target = es.querySelector('div');
    target.innerHTML = '';
    const id = p.equip[which];
    if(id && ITEMS[id]){
      const c=document.createElement('canvas'); c.width=16;c.height=16;
      c.getContext('2d').drawImage(ITEMS[id].icon,0,0);
      target.appendChild(c);
    }
  });
}

function canCraft(r){
  if(r.station==='hammer' && !invCount(state.player,'hammer')) return false;
  return r.ing.every(([id,q])=>invCount(state.player,id)>=q);
}
function buildRecipes(){
  recipeList.innerHTML='';
  RECIPES.forEach((r,i)=>{
    const ok = canCraft(r);
    const div = document.createElement('div');
    div.className = 'recipe' + (ok?'':' locked');
    const c = document.createElement('canvas'); c.width=16;c.height=16;
    c.getContext('2d').drawImage(ITEMS[r.out[0]].icon,0,0);
    const name = document.createElement('div'); name.className='name'; name.textContent=r.name;
    const tick = document.createElement('div'); tick.className='craftable'; tick.textContent = ok?'✦':'';
    div.appendChild(c); div.appendChild(name); div.appendChild(tick);
    div.addEventListener('click', ()=>{ state.ui.recipeIdx=i; showRecipe(i); });
    recipeList.appendChild(div);
  });
  showRecipe(state.ui.recipeIdx);
}
function showRecipe(i){
  const r = RECIPES[i]; if(!r){ recipeDet.innerHTML=''; return; }
  const def = ITEMS[r.out[0]];
  recipeDet.innerHTML='';
  const h=document.createElement('h3'); h.textContent=r.name; recipeDet.appendChild(h);
  if(def.desc){ const d=document.createElement('div'); d.className='desc'; d.textContent=def.desc; recipeDet.appendChild(d); }
  const ings=document.createElement('div'); ings.className='ings';
  for(const[id,q]of r.ing){
    const have = invCount(state.player,id);
    const row=document.createElement('div'); row.className='ing '+(have>=q?'good':'bad');
    const c=document.createElement('canvas'); c.width=16;c.height=16; c.getContext('2d').drawImage(ITEMS[id].icon,0,0);
    row.appendChild(c);
    const t=document.createElement('span'); t.textContent=`${ITEMS[id].name}  ${have}/${q}`;
    row.appendChild(t);
    ings.appendChild(row);
  }
  if(r.station==='hammer'){
    const sn=document.createElement('div'); sn.className='ing '+(invCount(state.player,'hammer')?'good':'bad');
    sn.textContent='Requires: Forge Hammer';
    ings.appendChild(sn);
  }
  recipeDet.appendChild(ings);
  const btn=document.createElement('button'); btn.textContent='Forge';
  btn.disabled = !canCraft(r);
  btn.addEventListener('click', ()=>{
    if(!canCraft(r)) return;
    for(const[id,q]of r.ing) invRemove(state.player,id,q);
    invAdd(state.player, r.out[0], r.out[1]);
    popup('+'+r.out[1]+' '+ITEMS[r.out[0]].name, state.player.x, state.player.y-30, 'xp');
    spark(state.player.x, state.player.y, '#ffd86b', 12, 1.6);
    buildInv(); buildRecipes(); refreshHotbar();
  });
  recipeDet.appendChild(btn);
}

function buildCodex(){
  const p = state.player; if(!p) return;
  let html = `<h2>The Codex</h2>
    <p>You stand in <i>Moonforge</i>, a realm shaped each time you set foot. Mine groves and ruins, forge cunning tools, and chase the moonbird's feather across endless biomes.</p>
    <h3>Controls</h3>
    <p><kbd>WASD</kbd> / <kbd>Arrows</kbd> Move · <kbd>E</kbd> / <kbd>Space</kbd> Action · <kbd>Q</kbd> Spell · <kbd>F</kbd> Use selected · <kbd>I</kbd> Satchel · <kbd>C</kbd> Forge · <kbd>1-8</kbd> Hotbar</p>
    <h3>Satchel</h3>
    <p>The first row of the satchel <b>is</b> your hotbar. <b>Click</b> any slot to pick up its item, then click another slot to swap or drop it. <b>Double-click</b> (or right-click) an item to <b>use it</b> — equip a tool/weapon, drink a potion, or <b>place</b> a campfire/chest/anvil in the tile in front of you.</p>
    <h3>Tips</h3>
    <p>• Equip an axe to fell trees, a pickaxe to break stone and ores. Each tier breaks the next: copper → mythril → moonsteel.<br>
    • Build a Forge Hammer first, then forge ingots from ore at the Forge tab.<br>
    • To deploy a campfire/chest/anvil: move it into a hotbar slot and press <kbd>F</kbd>, or just double-click it in the satchel.<br>
    • Night brings mobs — and rare loot. Carry a <i>Glow Lantern</i> or run.<br>
    • The <i>Moonbird Feather</i> from glowing trees lets your spells home in on foes.<br>
    • Berries and Glow Caps eaten from the satchel restore HP and MP.<br>
    • Your tale is saved automatically every few seconds.</p>
    <h3>Discovered (${p.discovered.size})</h3>`;
  const items = Array.from(p.discovered).map(id=>{
    const def=ITEMS[id]; if(!def) return '';
    return `<span style="display:inline-block;margin:2px;padding:2px 6px;background:#1a1f4a;border-radius:4px">${def.name}</span>`;
  }).join('');
  html += `<p>${items||'<i>Nothing yet — go explore.</i>'}</p>`;
  codexEl.innerHTML = html;
}

function useHotbar(){
  const p = state.player; if(!p) return;
  const it = p.inventory[state.selectedHotbar]; if(!it) return;
  const def = ITEMS[it.item];
  if(def.kind==='weapon'){ p.equip.weapon = it.item; popup('Wield '+def.name, p.x, p.y-22,'xp'); }
  else if(def.kind==='tool'){ p.equip.tool = it.item; popup('Wield '+def.name, p.x, p.y-22,'xp'); }
  else if(def.kind==='charm'){ p.equip.charm = it.item; }
  else if(def.kind==='food'){
    if(def.heal){ p.hp=Math.min(p.maxHp,p.hp+def.heal); popup('+'+def.heal,p.x,p.y-22,'heal'); }
    if(def.mana){ p.mp=Math.min(p.maxMp,p.mp+def.mana); popup('+'+def.mana,p.x,p.y-22,'mana'); }
    invRemove(p, it.item, 1);
    refreshHotbar();
  }
  else if(def.kind==='placeable'){
    const f = tileInFront(p);
    if(state.world.tileAt(f.tx,f.ty)===T.WATER){ popup('Not on water', p.x, p.y-22,''); return; }
    if(state.world.objectAt(f.tx,f.ty)){ popup('Blocked', p.x, p.y-22,''); return; }
    state.world.setObject(f.tx, f.ty, def.place);
    invRemove(p, it.item, 1);
    spark(f.tx*16+8, f.ty*16+8, '#ffd86b', 8, 1.4);
    popup('Placed', f.tx*16+8, f.ty*16+8, 'xp');
    refreshHotbar();
  }
}

window.MF = { state, ITEMS, RECIPES, invAdd, invCount, invRemove, popup, spark };
})();



