# Moonforge

A handcrafted pixel realm where moonlit groves meet the spark of the forge.
A magical, open‑world, 8‑bit pixel art game that runs in any browser — laptop or phone, no install, saves locally.

![Moonforge splash](https://img.shields.io/badge/play-anywhere-7c5dd6?style=for-the-badge)

## Play

Open `index.html` directly in a browser, or serve the folder:

```bash
python3 -m http.server 8765
# then visit http://localhost:8765
```

Or host the static files anywhere (GitHub Pages, Netlify, Vercel) — there is no build step.

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Move | `WASD` / arrow keys | virtual joystick |
| Mine / attack | `E` or `Space` | ⚔ button |
| Cast spell | `Q` | ✦ button |
| Use selected hotbar | `F` | long‑press ⚔ |
| Hotbar slot | `1`–`8` | tap slot |
| Satchel | `I` | ▦ button |
| Forge | `C` | tap *Forge* tab |
| Close menu | `Esc` | × button |

## What's in the realm

- **Procedural open world** with eight biomes — meadow, forest, moon grove, rocky highlands, beach, desert, tundra, water — generated on demand from a per‑save seed.
- **Mine, fell, loot, craft.** Trees, ores (copper → silver → gold → mythril → moonstone), crystals, bushes, mushrooms, flowers. Tier up your tools through the forge.
- **Day & night cycle** with full ambient lighting. The world dims to deep blue at night and your lantern glows. Mobs roam after dusk.
- **Combat & magic.** Slimes, bats, and shadow wisps. Cast a magic bolt with mana — find a moonbird feather to make your spells home in on enemies.
- **Crafting tree** with 24 recipes from a wooden plank to the **Moonblade**, edged with starlight.
- **Self‑actualize.** Place campfires, chests, and anvils to build a camp. Level up; HP and MP grow with every level.
- **Saves automatically** to your device every few seconds — pick up where you left off.
- **Mobile‑first UI.** Touch controls auto‑appear on phones and tablets.

## Tech

- Pure HTML + CSS + vanilla JS, ~2,000 lines, no dependencies.
- Pixel art is **drawn at runtime** to small offscreen canvases (programmatic shapes, dithering, palette swaps) — no image assets to ship.
- World is chunked (32×32 tiles) and generated lazily with seeded value‑noise.
- Saves to `localStorage`.

## Files

- `index.html` — DOM scaffold (HUD, splash, modal, touch controls)
- `styles.css` — UI palette, animations, responsive layout
- `js/art.js` — palette + tile/object/entity/item sprite atlas
- `js/world.js` — seeded noise, biomes, chunk generation, harvest persistence
- `js/game.js` — input, camera, rendering, day/night, inventory, crafting, combat, magic, save/load

Built to be a beautiful, addictive thing you can pull up anywhere — bookmark the page on your phone and you're set.
