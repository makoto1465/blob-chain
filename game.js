const COLS = 6;
const ROWS = 14;
const HIDDEN_ROWS = 2;
const VISIBLE_ROWS = ROWS - HIDDEN_ROWS;
const GROUP_SIZE = 4;
const BASE_INTERVAL = 820;

const COLORS = [
  { name: "ruby", fill: "#ff4778", rim: "#a80f3d", shine: "#ffd5df" },
  { name: "mint", fill: "#2dd4bf", rim: "#087f72", shine: "#c8fff6" },
  { name: "sun", fill: "#ffd166", rim: "#b87900", shine: "#fff0b8" },
  { name: "leaf", fill: "#7bd85b", rim: "#2f7c20", shine: "#e3ffd8" },
  { name: "violet", fill: "#9b7bff", rim: "#4c2fb4", shine: "#e4dcff" },
];

const DIRECTIONS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");
const nextCanvas = document.querySelector("#nextCanvas");
const nextCtx = nextCanvas.getContext("2d");

const scoreValue = document.querySelector("#scoreValue");
const bestValue = document.querySelector("#bestValue");
const chainValue = document.querySelector("#chainValue");
const levelValue = document.querySelector("#levelValue");
const overlay = document.querySelector("#statusOverlay");
const statusTitle = document.querySelector("#statusTitle");
const statusText = document.querySelector("#statusText");
const startButton = document.querySelector('[data-action="start"]');

let board = createBoard();
let activePair = null;
let nextPair = randomPair();
let score = 0;
let best = Number(localStorage.getItem("blob-chain-best") || 0);
let level = 1;
let chain = 0;
let clearedTotal = 0;
let state = "ready";
let dropAccumulator = 0;
let lastFrame = 0;
let softDropHeld = false;
let popEffects = [];
let resolverTimer = 0;

bestValue.textContent = best.toLocaleString();
updateHud();
updateOverlay();
requestAnimationFrame(loop);

window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", (event) => {
  if (event.code === "ArrowDown") {
    softDropHeld = false;
  }
});

document.querySelectorAll("[data-action]").forEach((button) => {
  const action = button.dataset.action;

  button.addEventListener("click", () => {
    if (action !== "soft") {
      runAction(action);
    }
  });

  if (action === "soft") {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      softDropHeld = true;
      softDrop();
    });

    ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
      button.addEventListener(type, () => {
        softDropHeld = false;
      });
    });
  }
});

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function randomPair() {
  return [
    Math.floor(Math.random() * COLORS.length),
    Math.floor(Math.random() * COLORS.length),
  ];
}

function startGame() {
  window.clearTimeout(resolverTimer);
  board = createBoard();
  activePair = null;
  nextPair = randomPair();
  score = 0;
  level = 1;
  chain = 0;
  clearedTotal = 0;
  dropAccumulator = 0;
  softDropHeld = false;
  popEffects = [];
  state = "playing";
  spawnPair();
  updateHud();
  updateOverlay();
}

function spawnPair() {
  activePair = {
    x: 2,
    y: HIDDEN_ROWS - 1,
    rotation: 0,
    colors: nextPair,
  };
  nextPair = randomPair();
  dropAccumulator = 0;

  if (!isValid(getPairCells(activePair))) {
    activePair = null;
    endGame();
    return;
  }

  state = "playing";
  updateOverlay();
}

function getPairCells(pair) {
  const dir = DIRECTIONS[pair.rotation];
  return [
    { x: pair.x, y: pair.y, color: pair.colors[0] },
    { x: pair.x + dir.x, y: pair.y + dir.y, color: pair.colors[1] },
  ];
}

function isValid(cells) {
  return cells.every((cell) => {
    const inside = cell.x >= 0 && cell.x < COLS && cell.y >= 0 && cell.y < ROWS;
    return inside && board[cell.y][cell.x] === null;
  });
}

function movePair(dx, dy) {
  if (state !== "playing" || !activePair) {
    return false;
  }

  const moved = { ...activePair, x: activePair.x + dx, y: activePair.y + dy };

  if (!isValid(getPairCells(moved))) {
    return false;
  }

  activePair = moved;
  return true;
}

function rotatePair() {
  if (state !== "playing" || !activePair) {
    return;
  }

  const nextRotation = (activePair.rotation + 1) % DIRECTIONS.length;
  const kicks = [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: -1 },
  ];

  for (const kick of kicks) {
    const rotated = {
      ...activePair,
      rotation: nextRotation,
      x: activePair.x + kick.x,
      y: activePair.y + kick.y,
    };

    if (isValid(getPairCells(rotated))) {
      activePair = rotated;
      return;
    }
  }
}

function softDrop() {
  if (state !== "playing") {
    return;
  }

  if (movePair(0, 1)) {
    score += 1;
    updateHud();
  } else {
    lockPair();
  }
}

function hardDrop() {
  if (state !== "playing" || !activePair) {
    return;
  }

  let distance = 0;

  while (movePair(0, 1)) {
    distance += 1;
  }

  score += distance * 2;
  updateHud();
  lockPair();
}

function lockPair() {
  if (state !== "playing" || !activePair) {
    return;
  }

  getPairCells(activePair).forEach((cell) => {
    board[cell.y][cell.x] = cell.color;
  });

  activePair = null;
  state = "resolving";
  chain = 0;
  updateOverlay();
  resolverTimer = window.setTimeout(resolveBoard, 90);
}

function resolveBoard() {
  if (state !== "resolving") {
    return;
  }

  const matches = findMatches();

  if (matches.length === 0) {
    chain = 0;

    if (topIsBlocked()) {
      endGame();
    } else {
      spawnPair();
    }

    updateHud();
    return;
  }

  chain += 1;
  const cellsToClear = new Map();
  const colorsCleared = new Set();

  matches.forEach((group) => {
    group.forEach((cell) => {
      cellsToClear.set(`${cell.x},${cell.y}`, cell);
      colorsCleared.add(board[cell.y][cell.x]);
    });
  });

  cellsToClear.forEach((cell) => {
    const color = board[cell.y][cell.x];
    board[cell.y][cell.x] = null;
    popEffects.push({
      x: cell.x,
      y: cell.y,
      color,
      age: 0,
      life: 360,
    });
  });

  const cleared = cellsToClear.size;
  const colorBonus = Math.max(1, colorsCleared.size);
  const chainBonus = chain * chain + colorBonus - 1;
  score += cleared * 10 * chainBonus;
  clearedTotal += cleared;
  level = 1 + Math.floor(clearedTotal / 36);
  updateHud();

  resolverTimer = window.setTimeout(() => {
    applyGravity();
    resolverTimer = window.setTimeout(resolveBoard, 170);
  }, 210);
}

function findMatches() {
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const groups = [];

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const color = board[y][x];

      if (color === null || visited[y][x]) {
        continue;
      }

      const group = [];
      const stack = [{ x, y }];
      visited[y][x] = true;

      while (stack.length > 0) {
        const current = stack.pop();
        group.push(current);

        [
          { x: current.x + 1, y: current.y },
          { x: current.x - 1, y: current.y },
          { x: current.x, y: current.y + 1 },
          { x: current.x, y: current.y - 1 },
        ].forEach((next) => {
          const inBounds =
            next.x >= 0 && next.x < COLS && next.y >= 0 && next.y < ROWS;

          if (
            inBounds &&
            !visited[next.y][next.x] &&
            board[next.y][next.x] === color
          ) {
            visited[next.y][next.x] = true;
            stack.push(next);
          }
        });
      }

      if (group.length >= GROUP_SIZE) {
        groups.push(group);
      }
    }
  }

  return groups;
}

function applyGravity() {
  for (let x = 0; x < COLS; x += 1) {
    let writeY = ROWS - 1;

    for (let y = ROWS - 1; y >= 0; y -= 1) {
      if (board[y][x] !== null) {
        board[writeY][x] = board[y][x];

        if (writeY !== y) {
          board[y][x] = null;
        }

        writeY -= 1;
      }
    }

    for (let y = writeY; y >= 0; y -= 1) {
      board[y][x] = null;
    }
  }
}

function topIsBlocked() {
  return board
    .slice(0, HIDDEN_ROWS)
    .some((row) => row.some((cell) => cell !== null));
}

function endGame() {
  state = "over";
  activePair = null;
  best = Math.max(best, score);
  localStorage.setItem("blob-chain-best", String(best));
  updateHud();
  updateOverlay();
}

function togglePause() {
  if (state === "playing") {
    state = "paused";
  } else if (state === "paused") {
    state = "playing";
    lastFrame = performance.now();
  }

  updateOverlay();
}

function runAction(action) {
  if (action === "restart") {
    startGame();
    return;
  }

  if (action === "start") {
    if (state === "paused") {
      togglePause();
    } else {
      startGame();
    }

    return;
  }

  if (state === "ready" || state === "over") {
    startGame();
  }

  if (action === "left") {
    movePair(-1, 0);
  } else if (action === "right") {
    movePair(1, 0);
  } else if (action === "rotate") {
    rotatePair();
  } else if (action === "drop") {
    hardDrop();
  } else if (action === "pause") {
    togglePause();
  }
}

function handleKeyDown(event) {
  const keys = [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Space",
    "KeyX",
    "KeyZ",
    "KeyP",
    "Enter",
  ];

  if (!keys.includes(event.code)) {
    return;
  }

  event.preventDefault();

  if (event.code === "Enter" && (state === "ready" || state === "over")) {
    startGame();
    return;
  }

  if (state === "ready" || state === "over") {
    startGame();
  }

  if (event.code === "ArrowLeft") {
    movePair(-1, 0);
  } else if (event.code === "ArrowRight") {
    movePair(1, 0);
  } else if (event.code === "ArrowUp" || event.code === "KeyX" || event.code === "KeyZ") {
    rotatePair();
  } else if (event.code === "ArrowDown") {
    softDropHeld = true;
    softDrop();
  } else if (event.code === "Space") {
    hardDrop();
  } else if (event.code === "KeyP") {
    togglePause();
  }
}

function updateHud() {
  best = Math.max(best, score);
  scoreValue.textContent = score.toLocaleString();
  bestValue.textContent = best.toLocaleString();
  chainValue.textContent = chain.toLocaleString();
  levelValue.textContent = level.toLocaleString();
}

function updateOverlay() {
  const visible = state === "ready" || state === "paused" || state === "over";
  overlay.classList.toggle("is-hidden", !visible);

  if (state === "ready") {
    statusTitle.textContent = "Blob Chain";
    statusText.textContent = "Ready";
    startButton.textContent = "Start";
  } else if (state === "paused") {
    statusTitle.textContent = "Paused";
    statusText.textContent = "Score " + score.toLocaleString();
    startButton.textContent = "Resume";
  } else if (state === "over") {
    statusTitle.textContent = "Game Over";
    statusText.textContent = "Score " + score.toLocaleString();
    startButton.textContent = "Retry";
  }
}

function loop(time) {
  const dt = Math.min(48, time - lastFrame || 16);
  lastFrame = time;

  if (state === "playing") {
    dropAccumulator += dt;
    const interval = Math.max(150, BASE_INTERVAL - (level - 1) * 52);
    const targetInterval = softDropHeld ? Math.max(45, interval / 12) : interval;

    if (dropAccumulator >= targetInterval) {
      dropAccumulator = 0;

      if (!movePair(0, 1)) {
        lockPair();
      }
    }
  }

  popEffects.forEach((effect) => {
    effect.age += dt;
  });
  popEffects = popEffects.filter((effect) => effect.age < effect.life);

  draw();
  requestAnimationFrame(loop);
}

function draw() {
  const view = prepareCanvas(canvas, ctx);
  const cell = view.cell;

  ctx.clearRect(0, 0, view.width, view.height);
  drawBoardBase(ctx, view);

  for (let y = HIDDEN_ROWS; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const color = board[y][x];

      if (color !== null) {
        drawBlob(
          ctx,
          view.offsetX + x * cell,
          view.offsetY + (y - HIDDEN_ROWS) * cell,
          cell,
          COLORS[color],
        );
      }
    }
  }

  if (activePair) {
    getPairCells(activePair).forEach((cellData) => {
      if (cellData.y >= HIDDEN_ROWS) {
        drawBlob(
          ctx,
          view.offsetX + cellData.x * cell,
          view.offsetY + (cellData.y - HIDDEN_ROWS) * cell,
          cell,
          COLORS[cellData.color],
        );
      }
    });
  }

  popEffects.forEach((effect) => {
    if (effect.y < HIDDEN_ROWS) {
      return;
    }

    drawPopEffect(
      ctx,
      view.offsetX + effect.x * cell,
      view.offsetY + (effect.y - HIDDEN_ROWS) * cell,
      cell,
      COLORS[effect.color],
      effect.age / effect.life,
    );
  });

  drawNext();
}

function prepareCanvas(targetCanvas, targetCtx) {
  const rect = targetCanvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);

  if (targetCanvas.width !== pixelWidth || targetCanvas.height !== pixelHeight) {
    targetCanvas.width = pixelWidth;
    targetCanvas.height = pixelHeight;
  }

  targetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return {
    width,
    height,
    cell: Math.min(width / COLS, height / VISIBLE_ROWS),
    offsetX: (width - Math.min(width / COLS, height / VISIBLE_ROWS) * COLS) / 2,
    offsetY:
      (height - Math.min(width / COLS, height / VISIBLE_ROWS) * VISIBLE_ROWS) /
      2,
  };
}

function drawBoardBase(targetCtx, view) {
  const cell = view.cell;
  targetCtx.fillStyle = "#11141b";
  targetCtx.fillRect(0, 0, view.width, view.height);

  for (let y = 0; y < VISIBLE_ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      targetCtx.fillStyle = (x + y) % 2 === 0 ? "#171a22" : "#141720";
      roundRect(
        targetCtx,
        view.offsetX + x * cell + 3,
        view.offsetY + y * cell + 3,
        cell - 6,
        cell - 6,
        7,
      );
      targetCtx.fill();
    }
  }

  targetCtx.strokeStyle = "rgba(246, 243, 234, 0.08)";
  targetCtx.lineWidth = 1;

  for (let x = 1; x < COLS; x += 1) {
    targetCtx.beginPath();
    targetCtx.moveTo(view.offsetX + x * cell, view.offsetY);
    targetCtx.lineTo(view.offsetX + x * cell, view.offsetY + VISIBLE_ROWS * cell);
    targetCtx.stroke();
  }

  for (let y = 1; y < VISIBLE_ROWS; y += 1) {
    targetCtx.beginPath();
    targetCtx.moveTo(view.offsetX, view.offsetY + y * cell);
    targetCtx.lineTo(view.offsetX + COLS * cell, view.offsetY + y * cell);
    targetCtx.stroke();
  }
}

function drawBlob(targetCtx, x, y, size, color) {
  const padding = size * 0.1;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const radius = size / 2 - padding;
  const gradient = targetCtx.createRadialGradient(
    cx - radius * 0.3,
    cy - radius * 0.38,
    radius * 0.1,
    cx,
    cy,
    radius,
  );

  gradient.addColorStop(0, color.shine);
  gradient.addColorStop(0.28, color.fill);
  gradient.addColorStop(1, color.rim);

  targetCtx.save();
  targetCtx.translate(cx, cy);
  targetCtx.beginPath();
  targetCtx.moveTo(0, -radius);
  targetCtx.bezierCurveTo(radius * 0.82, -radius, radius, -radius * 0.48, radius, 0);
  targetCtx.bezierCurveTo(radius, radius * 0.78, radius * 0.5, radius, 0, radius);
  targetCtx.bezierCurveTo(-radius * 0.82, radius, -radius, radius * 0.5, -radius, 0);
  targetCtx.bezierCurveTo(-radius, -radius * 0.7, -radius * 0.52, -radius, 0, -radius);
  targetCtx.closePath();
  targetCtx.fillStyle = gradient;
  targetCtx.fill();
  targetCtx.lineWidth = Math.max(2, size * 0.035);
  targetCtx.strokeStyle = "rgba(255, 255, 255, 0.26)";
  targetCtx.stroke();

  targetCtx.fillStyle = "rgba(255, 255, 255, 0.56)";
  targetCtx.beginPath();
  targetCtx.ellipse(-radius * 0.32, -radius * 0.36, radius * 0.2, radius * 0.11, -0.6, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.restore();
}

function drawPopEffect(targetCtx, x, y, size, color, progress) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const radius = size * (0.18 + progress * 0.55);

  targetCtx.save();
  targetCtx.globalAlpha = 1 - progress;
  targetCtx.strokeStyle = color.fill;
  targetCtx.lineWidth = Math.max(2, size * (0.08 - progress * 0.04));
  targetCtx.beginPath();
  targetCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  targetCtx.stroke();
  targetCtx.restore();
}

function drawNext() {
  const view = prepareCanvas(nextCanvas, nextCtx);
  const size = Math.min(view.width, view.height) * 0.34;
  const startX = view.width / 2 - size / 2;
  const startY = view.height / 2 - size * 1.05;

  nextCtx.clearRect(0, 0, view.width, view.height);
  nextCtx.fillStyle = "#11141b";
  nextCtx.fillRect(0, 0, view.width, view.height);
  drawBlob(nextCtx, startX, startY, size, COLORS[nextPair[1]]);
  drawBlob(nextCtx, startX, startY + size * 0.96, size, COLORS[nextPair[0]]);
}

function roundRect(targetCtx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);

  targetCtx.beginPath();
  targetCtx.moveTo(x + r, y);
  targetCtx.arcTo(x + width, y, x + width, y + height, r);
  targetCtx.arcTo(x + width, y + height, x, y + height, r);
  targetCtx.arcTo(x, y + height, x, y, r);
  targetCtx.arcTo(x, y, x + width, y, r);
  targetCtx.closePath();
}
