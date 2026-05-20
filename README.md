# Spintris

3D Tetris inside a slowly-spinning archway. As the arch rotates past 90°, your
left and right invert from screen perspective — you have to mentally re-orient
to play from the back. Higher levels speed up both fall rate and arch rotation.

## Run

```
python3 -m http.server 8765
```

Open <http://localhost:8765/> in Chrome 113+ (or any browser with WebGPU; falls
back to WebGL2 automatically). The top-right badge shows which backend is live.

## Controls

| Key             | Action       |
| --------------- | ------------ |
| `←` / `→`       | Move         |
| `↑` / `X`       | Rotate CW    |
| `Z`             | Rotate CCW   |
| `↓`             | Soft drop    |
| `Space`         | Hard drop    |
| `P`             | Pause        |
| `R`             | Restart (after game over) |

Movement is in the *piece's local frame* — so when the arch rotates the field
behind you, pressing `←` still moves the piece toward its own left, which from
your point of view looks like it's going right. That's the game.

## Stack

- [Three.js](https://threejs.org) `0.184.0`, loaded from `unpkg` via import map
  (no build step).
- `WebGPURenderer` — uses WebGPU when available, transparent fallback to WebGL2.
- TSL (Three Shading Language) node-based post-processing for bloom.
- PCF-soft shadow maps, ACES tone mapping, exponential fog.

## Files

- `index.html` — page shell, HUD, import map.
- `src/tetris.js` — pure game logic (board, pieces, scoring, level scaling).
- `src/world.js` — scene assembly (arch geometry, lights, brick factory).
- `src/main.js` — renderer, postprocessing, input, game loop.
