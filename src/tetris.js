// Pure game logic — no rendering. Board is rows × cols of color | null.

export const COLS = 10;
export const ROWS = 20;

export const PIECES = {
  I: { color: 0x22e0e0, shape: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]] },
  O: { color: 0xe5c633, shape: [[1,1],[1,1]] },
  T: { color: 0xb148f0, shape: [[0,1,0],[1,1,1],[0,0,0]] },
  S: { color: 0x46d758, shape: [[0,1,1],[1,1,0],[0,0,0]] },
  Z: { color: 0xee4854, shape: [[1,1,0],[0,1,1],[0,0,0]] },
  J: { color: 0x4a78ee, shape: [[1,0,0],[1,1,1],[0,0,0]] },
  L: { color: 0xee9b30, shape: [[0,0,1],[1,1,1],[0,0,0]] },
};

const NAMES = Object.keys(PIECES);

function newPiece() {
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  const def = PIECES[name];
  return { name, color: def.color, shape: def.shape.map(r => [...r]) };
}

function rotateShape(shape) {
  const rows = shape.length, cols = shape[0].length;
  const out = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    out[c][rows - 1 - r] = shape[r][c];
  }
  return out;
}

export class Tetris {
  constructor() { this.reset(); }

  reset() {
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.score = 0;
    this.level = 1;
    this.lines = 0;
    this.gameOver = false;
    this.next = newPiece();
    this.spawn();
  }

  spawn() {
    this.current = this.next;
    this.next = newPiece();
    this.x = Math.floor((COLS - this.current.shape[0].length) / 2);
    this.y = 0;
    if (this.collides(this.x, this.y, this.current.shape)) {
      this.gameOver = true;
    }
  }

  collides(x, y, shape) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const nx = x + c, ny = y + r;
        if (nx < 0 || nx >= COLS) return true;
        if (ny >= ROWS) return true;
        if (ny >= 0 && this.board[ny][nx]) return true;
      }
    }
    return false;
  }

  move(dx) {
    if (this.gameOver) return false;
    if (!this.collides(this.x + dx, this.y, this.current.shape)) {
      this.x += dx;
      return true;
    }
    return false;
  }

  rotate(dir = 1) {
    if (this.gameOver) return false;
    let shape = this.current.shape;
    const turns = dir > 0 ? 1 : 3;
    for (let i = 0; i < turns; i++) shape = rotateShape(shape);
    for (const dx of [0, -1, 1, -2, 2]) {
      if (!this.collides(this.x + dx, this.y, shape)) {
        this.x += dx;
        this.current = { ...this.current, shape };
        return true;
      }
    }
    return false;
  }

  step() {
    if (this.gameOver) return { locked: false };
    if (!this.collides(this.x, this.y + 1, this.current.shape)) {
      this.y++;
      return { locked: false };
    }
    return this.lock();
  }

  softDrop() {
    if (this.gameOver) return { locked: false };
    if (!this.collides(this.x, this.y + 1, this.current.shape)) {
      this.y++;
      this.score += 1;
      return { locked: false };
    }
    return this.lock();
  }

  hardDrop() {
    if (this.gameOver) return { locked: false };
    let dropped = 0;
    while (!this.collides(this.x, this.y + 1, this.current.shape)) {
      this.y++;
      dropped++;
    }
    this.score += dropped * 2;
    return this.lock();
  }

  lock() {
    const { shape, color } = this.current;
    for (let r = 0; r < shape.length; r++) for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) {
        const y = this.y + r, x = this.x + c;
        if (y >= 0 && y < ROWS) this.board[y][x] = color;
      }
    }
    const cleared = this.clearLines();
    this.spawn();
    return { locked: true, cleared };
  }

  clearLines() {
    const cleared = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.board[r].every(c => c !== null)) cleared.push(r);
    }
    if (!cleared.length) return [];
    const remaining = this.board.filter((_, r) => !cleared.includes(r));
    const empty = Array.from({ length: cleared.length }, () => Array(COLS).fill(null));
    this.board = [...empty, ...remaining];
    const n = cleared.length;
    this.score += [0, 100, 300, 500, 800][n] * this.level;
    this.lines += n;
    this.level = Math.floor(this.lines / 10) + 1;
    return cleared;
  }

  ghostY() {
    let y = this.y;
    while (!this.collides(this.x, y + 1, this.current.shape)) y++;
    return y;
  }

  get fallInterval() {
    return Math.max(80, 800 * Math.pow(0.85, this.level - 1));
  }

  get spinSpeed() {
    return 0.08 + (this.level - 1) * 0.045;
  }
}
