/* ============================================================
 *  Snake — Modern Canvas Game
 *  Pure vanilla JavaScript, no external dependencies.
 * ============================================================
 *  Bootstraps the whole game on an HTML <canvas id="game">.
 *
 *  Expected HTML elements:
 *    <canvas  id="game">
 *    <span    id="score">        — live score
 *    <span    id="highScore">    — persisted best (localStorage "snakeHighScore")
 *    <button  id="startBtn">     — start / pause toggle
 *    <button  id="restartBtn">   — full restart
 *    <div     id="overlay">      — full-screen overlay (idle / game over)
 *    <span    id="overlayMessage">  — message shown inside the overlay
 *    <button  id="overlayRestart">  — restart button inside the overlay
 *
 *  Game state machine:
 *    idle      -> initial "press start" state, overlay shown
 *    running   -> the snake moves, input accepted
 *    paused    -> loop frozen, overlay shown
 *    gameover  -> overlay shows final score, waiting to restart
 * ============================================================ */

(function () {
  "use strict";

  /* ------------------------------------------------------------------
   * 1. Canvas setup & constants
   * ------------------------------------------------------------------ */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // Grid dimensions
  const COLS = 20;
  const ROWS = 20;

  // Render size (used to compute each cell's pixel size)
  const SIZE = Math.min(canvas.width, canvas.height);

  // Resize canvas backing store to a crisp square resolution.
  canvas.width = SIZE;
  canvas.height = SIZE;

  const CELL = SIZE / COLS; // pixel width/height of a single cell

  // Base step interval grows shorter as the score rises -> the snake speeds up.
  const BASE_STEP_MS = 220;      // starting interval (ms) per cell
  const MIN_STEP_MS = 60;        // fastest allowed
  const STEP_DECREASE = 6;       // ms shaved off per point scored

  // Colors (modern, dark sleek theme)
  const COLOR_BG = "#0f172a";
  const COLOR_GRID = "rgba(148, 163, 184, 0.06)";
  const COLOR_SNAKE_BODY = "#22c55e";
  const COLOR_SNAKE_HEAD = "#4ade80";
  const COLOR_HEAD_GLOW = "rgba(74, 222, 128, 0.55)";
  const COLOR_BERRY = "#fb7185";
  const COLOR_BERRY_GLOW = "rgba(251, 113, 133, 0.6)";

  /* ------------------------------------------------------------------
   * 2. DOM wiring
   * ------------------------------------------------------------------ */
  const scoreEl = document.getElementById("score");
  const highScoreEl = document.getElementById("highScore");
  const startBtn = document.getElementById("startBtn");
  const restartBtn = document.getElementById("restartBtn");
  const overlay = document.getElementById("overlay");
  const overlayMessage = document.getElementById("overlayMessage");
  const overlayRestart = document.getElementById("overlayRestart");

  // localStorage persistence key
  const HIGH_SCORE_KEY = "snakeHighScore";

  /* ------------------------------------------------------------------
   * 3. Game state
   * ------------------------------------------------------------------ */
  // State machine states: "idle" | "running" | "paused" | "gameover"
  let state = "idle";

  // Snake: array of {x, y} segments; index 0 is the head.
  let snake = [];
  let direction = { x: 1, y: 0 };   // current travel direction
  let nextDirection = { x: 1, y: 0 }; // queued, applied on next fixed step
  let food = null;
  let score = 0;
  let highScore = 0;

  // Timing
  let lastTime = 0;      // timestamp of the previous animation frame
  let acc = 0;           // accumulator for fixed-step updates
  let stepMs = BASE_STEP_MS; // current interval between snake steps

  // A monotonically increasing pulse clock (in seconds) used for glows/berry pulse.
  let pulse = 0;

  /* ------------------------------------------------------------------
   * 4. High score persistence
   * ------------------------------------------------------------------ */
  function loadHighScore() {
    const stored = Number(localStorage.getItem(HIGH_SCORE_KEY));
    highScore = Number.isFinite(stored) && stored > 0 ? stored : 0;
    highScoreEl.textContent = String(highScore);
  }

  function saveHighScore() {
    if (score > highScore) {
      highScore = score;
      localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
      highScoreEl.textContent = String(highScore);
    }
  }

  /* ------------------------------------------------------------------
   * 5. Helpers
   * ------------------------------------------------------------------ */
  // Whether a given cell is inside the board (avoids re-computing bounds inline).
  function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
  }

  // Collides with any snake segment?
  function hitsSnake(x, y) {
    return snake.some((seg) => seg.x === x && seg.y === y);
  }

  // Spawn food on a random empty cell.
  function spawnFood() {
    // Collect all free cells (excluding the snake).
    const free = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!hitsSnake(x, y)) free.push({ x, y });
      }
    }
    // If the board is completely full (win condition edge case),
    // end the game gracefully.
    if (free.length === 0) {
      food = null;
      gameOver();
      return;
    }
    food = free[Math.floor(Math.random() * free.length)];
  }

  // Draw the 2D UI hints inside the canvas (header area texts are DOM, so none here).
  function updateScoreUI() {
    scoreEl.textContent = String(score);
  }

  /* ------------------------------------------------------------------
   * 6. Reset / device
   * ------------------------------------------------------------------ */
  // Reset to the starting layout without leaving "idle".
  function resetBoard() {
    const cx = COLS >> 1;
    const cy = ROWS >> 1;
    snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
    score = 0;
    stepMs = BASE_STEP_MS;
    acc = 0;
    updateScoreUI();
    spawnFood();
  }

  // Move to "gameover": persist high score, show overlay.
  function gameOver() {
    state = "gameover";
    saveHighScore();
    overlayMessage.textContent = "Game Over — Score: " + score;
    overlay.classList.remove("hidden");
  }

  /* ------------------------------------------------------------------
   * 7. Fixed-step game update (one cell move)
   * ------------------------------------------------------------------ */
  function step() {
    // Apply the queue: allow turning, but never reverse into the body.
    const canTurnX = !(nextDirection.x === -direction.x && nextDirection.y === 0);
    const canTurnY = !(nextDirection.x === 0 && nextDirection.y === -direction.y);
    if (canTurnX || canTurnY) {
      direction = { ...nextDirection };
    }

    const head = snake[0];
    const nx = head.x + direction.x;
    const ny = head.y + direction.y;

    // Wall collision -> game over.
    if (!inBounds(nx, ny)) {
      gameOver();
      return;
    }

    // Growing: if the target cell holds food, that tail segment should not be removed.
    const eating = food && nx === food.x && ny === food.y;

    // Self collision check. The tail moves away during non-eating moves,
    // so only collision with the body (excluding the tail if *not* eating) matters.
    const collideWithBody = eating
      ? snake.some((seg, i) => i < snake.length && seg.x === nx && seg.y === ny)
      : snake
          .slice(0, snake.length - 1)
          .some((seg) => seg.x === nx && seg.y === ny);

    if (collideWithBody) {
      gameOver();
      return;
    }

    // Move: insert new head.
    snake.unshift({ x: nx, y: ny });

    if (eating) {
      // Keep the tail (snake grows) and update score/speed.
      score += 1;
      updateScoreUI();
      highScoreEl.textContent = String(Math.max(highScore, score));
      // Recompute step interval (higher score -> faster).
      stepMs = Math.max(MIN_STEP_MS, BASE_STEP_MS - score * STEP_DECREASE);
      spawnFood();
    } else {
      // Remove tail (constant length).
      snake.pop();
    }
  }

  /* ------------------------------------------------------------------
   * 8. Rendering
   * ------------------------------------------------------------------ */
  // Rounded rectangle path helper (for snake segments).
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    // Background
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Subtle grid lines (modern touch)
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL, 0);
      ctx.lineTo(i * CELL, SIZE);
      ctx.moveTo(0, i * CELL);
      ctx.lineTo(SIZE, i * CELL);
      ctx.stroke();
    }

    // Board inset (soft padding)
    const pad = 2;

    // Berry (pulsing glow)
    if (food) {
      const fx = food.x * CELL;
      const fy = food.y * CELL;
      const s = CELL * (0.45 + 0.08 * Math.sin(pulse * 3)); // pulse size
      const g = ctx.createRadialGradient(
        fx + CELL / 2, fy + CELL / 2, CELL * 0.15,
        fx + CELL / 2, fy + CELL / 2, CELL * 0.8
      );
      g.addColorStop(0, COLOR_BERRY_GLOW);
      g.addColorStop(1, "rgba(251, 113, 133, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx + CELL / 2, fy + CELL / 2, CELL * 0.7, 0, Math.PI * 2);
      ctx.fill();
      // Berry body
      ctx.fillStyle = COLOR_BERRY;
      ctx.beginPath();
      ctx.arc(fx + CELL / 2, fy + CELL / 2, s, 0, Math.PI * 2);
      ctx.fill();
      // Little leaf
      ctx.fillStyle = "#4ade80";
      ctx.beginPath();
      ctx.ellipse(fx + CELL / 2, fy + CELL / 2 - s * 0.9, s * 0.55, s * 0.28, -0.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Snake body (from tail -> so the head draws last / on top)
    for (let i = snake.length - 1; i >= 0; i--) {
      const seg = snake[i];
      const px = seg.x * CELL;
      const py = seg.y * CELL;
      const inset = pad;

      if (i === 0) {
        // Glowing head
        const g = ctx.createRadialGradient(
          px + CELL / 2, py + CELL / 2, CELL * 0.2,
          px + CELL / 2, py + CELL / 2, CELL * 1.1
        );
        g.addColorStop(0, COLOR_HEAD_GLOW);
        g.addColorStop(1, "rgba(74, 222, 128, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px + CELL / 2, py + CELL / 2, CELL * 1.0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = COLOR_SNAKE_HEAD;
        roundRect(px + inset, py + inset, CELL - inset * 2, CELL - inset * 2, CELL * 0.28);
        ctx.fill();


        // Eyes
        ctx.fillStyle = "#0f172a";
        const er = CELL * 0.1;
        // Eyes offset toward travel direction
        const dirX = direction.x;
        const dirY = direction.y;
        if (dirY === 0) {
          // horizontal: eyes above/below
          const off = dirX;
          ctx.beginPath();
          ctx.arc(px + CELL * off * 0.45, py + CELL * 0.28, er, 0, Math.PI * 2);
          ctx.arc(px + CELL * off * 0.45, py + CELL * 0.72, er, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // vertical
          const off = dirY;
          ctx.beginPath();
          ctx.arc(px + CELL * 0.28, py + CELL * (0.5 + off * 0.28), er, 0, Math.PI * 2);
          ctx.arc(px + CELL * 0.72, py + CELL * (0.5 + off * 0.28), er, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Body segments: slightly tapered, rounded, newer (closer to head) brighter.
        const t = 0.75 + 0.25 * (i / Math.max(snake.length - 1, 1));
        ctx.fillStyle = COLOR_SNAKE_BODY;
        roundRect(px + inset, py + inset, CELL - inset * 2, CELL - inset * 2, CELL * 0.25);
        ctx.fill();
      }
    }
  }

  /* ------------------------------------------------------------------
   * 9. Visibility change — auto-pause when the tab is hidden
   * ------------------------------------------------------------------ */
  function onVisibilityChange() {
    if (document.hidden && state === "running") {
      setState("paused");
    }
  }

  /* ------------------------------------------------------------------
   * 10. State transitions
   * ------------------------------------------------------------------ */
  function showIdleOverlay() {
    overlayMessage.textContent = "Press Start / Arrow keys to play";
    overlay.classList.remove("hidden");
  }

  function setState(next) {
    state = next;
    switch (next) {
      case "running":
        startBtn.textContent = "Pause";

        overlay.classList.add("hidden");
        lastTime = performance.now(); // reset timing anchor to avoid a jump
        acc = 0;
        break;
      case "paused":
        startBtn.textContent = "Resume";
        overlayMessage.textContent = "Paused";
        overlay.classList.remove("hidden");
        break;
      case "idle":
        startBtn.textContent = "Start";
        showIdleOverlay();
        break;
      case "gameover":
        startBtn.textContent = "Start";
        // (overlay already handled in gameOver())
        break;
    }
  }

  // Guard for toggling start from paused vs idle, and starting from gameover.
  function startBtnHandler() {
    if (state === "running") {
      setState("paused");
    } else if (state === "paused" || state === "idle") {
      setState("running");
    } else if (state === "gameover") {
      resetBoard();
      setState("running");
    }
  }

  function restart() {
    resetBoard();
    setState("running");
  }

  /* ------------------------------------------------------------------
   * 11. Input: keyboard
   * ------------------------------------------------------------------ */
  const KEY_UP = ["ArrowUp", "w", "W"];
  const KEY_DOWN = ["ArrowDown", "s", "S"];
  const KEY_LEFT = ["ArrowLeft", "a", "A"];
  const KEY_RIGHT = ["ArrowRight", "d", "D"];

  function onKeydown(e) {
    // Pause/resume with Space.
    if (e.code === "Space") {
      e.preventDefault();
      if (state === "running") setState("paused");
      else if (state === "paused") setState("running");
      else if (state === "idle") setState("running");
      return;
    }

    // Arrow/WASD just queue the direction (prevent reversing handled in step()).
    let desired = null;
    if (KEY_UP.includes(e.key)) desired = { x: 0, y: -1 };
    else if (KEY_DOWN.includes(e.key)) desired = { x: 0, y: 1 };
    else if (KEY_LEFT.includes(e.key)) desired = { x: -1, y: 0 };
    else if (KEY_RIGHT.includes(e.key)) desired = { x: 1, y: 0 };

    if (!desired) return; // not a direction key

    // Prevent the page from scrolling when arrow keys are pressed.
    if (e.key.startsWith("Arrow")) e.preventDefault();

    // If the game is still idle, pressing a direction starts it.
    if (state === "idle") {
      setState("running");
    }

    // Let the step() function apply the direction; only queue it here.
    if (state === "running") {
      // Prevent reversing into the snake's own body:
      // a 180° turn is disallowed (e.g. going right then pressing left).
      const r180 = desired.x === -direction.x && desired.y === -direction.y;
      if (!r180) {
        nextDirection = { ...desired };
      }
    }
  }

  /* ------------------------------------------------------------------
   * 12. Touch / swipe support
   * ------------------------------------------------------------------ */
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  // Minimum swipe distance (device-independent pixels) to register a direction.
  const SWIPE_THRESHOLD = 30;
  // Maximum time (ms) for a swipe gesture.
  const SWIPE_MAX_TIME = 400;

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    // Prevent default so the page doesn't scroll/zoom.
    e.preventDefault();
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchStartTime = performance.now();
  }

  function onTouchEnd(e) {
    if (e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    e.preventDefault();

    const dt = performance.now() - touchStartTime;
    if (dt > SWIPE_MAX_TIME) return; // too slow, ignore

    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (Math.max(absDx, absDy) < SWIPE_THRESHOLD) return; // too short

    let desired = null;
    if (absDx > absDy) {
      desired = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
    } else {
      desired = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
    }

    if (!desired) return;

    // Start the game if idle.
    if (state === "idle") {
      setState("running");
    }

    // Queue direction (prevent 180° reversal).
    if (state === "running") {
      const r180 = desired.x === -direction.x && desired.y === -direction.y;
      if (!r180) {
        nextDirection = { ...desired };
      }
    }
  }

  /* ------------------------------------------------------------------
   * 13. Game loop
   * ------------------------------------------------------------------ */
  function loop(timestamp) {
    // pulse is a continuous clock used for animations (glow, berry pulse).
    // It runs even when paused so the visual doesn't freeze abruptly.
    pulse = timestamp / 1000;

    if (state === "running") {
      const elapsed = timestamp - lastTime;
      lastTime = timestamp;

      // Fixed-step accumulator. Cap the delta to avoid spiral-of-death
      // when the tab comes back from being hidden.
      acc += Math.min(elapsed, 200);

      while (acc >= stepMs) {
        step();
        acc -= stepMs;
        // If the game ended during step(), stop processing further steps.
        if (state === "gameover") break;
      }
    }

    // Always draw the current state (even when paused / gameover / idle).
    draw();

    requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------------
   * 14. Event binding
   * ------------------------------------------------------------------ */
  // Keyboard
  document.addEventListener("keydown", onKeydown);

  // Touch / swipe (on the canvas itself)
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd, { passive: false });

  // Visibility change: pause when tab becomes hidden.
  document.addEventListener("visibilitychange", onVisibilityChange);

  // Buttons
  startBtn.addEventListener("click", startBtnHandler);
  restartBtn.addEventListener("click", restart);
  overlayRestart.addEventListener("click", restart);

  /* ------------------------------------------------------------------
   * 15. Bootstrap
   * ------------------------------------------------------------------ */
  loadHighScore();
  resetBoard();
  setState("idle");
  // Start the animation loop immediately (it draws).
  requestAnimationFrame(loop);
})();
