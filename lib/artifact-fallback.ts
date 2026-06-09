import type { Artifact } from '@/types/models'

type ArtifactFallbackSpec = {
  language: Artifact['language']
  title: string
  code: string
}

function buildFlappyBirdHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg-top: #7dd3fc;
      --bg-bottom: #1d4ed8;
      --panel: rgba(15, 23, 42, 0.72);
      --panel-border: rgba(255, 255, 255, 0.18);
      --accent: #facc15;
      --danger: #fb7185;
      --bird: #fde047;
      --pipe: #22c55e;
      --pipe-dark: #15803d;
      --text: #e2e8f0;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at top, rgba(255,255,255,0.2), transparent 30%),
        linear-gradient(180deg, var(--bg-top), var(--bg-bottom));
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
      color: var(--text);
      overflow: hidden;
    }

    .shell {
      width: min(92vw, 980px);
      display: grid;
      gap: 16px;
    }

    .hud {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
      padding: 14px 18px;
      border-radius: 20px;
      background: var(--panel);
      border: 1px solid var(--panel-border);
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.28);
      backdrop-filter: blur(14px);
    }

    .title h1 {
      margin: 0;
      font-size: clamp(24px, 4vw, 38px);
      letter-spacing: 0.03em;
    }

    .title p {
      margin: 6px 0 0;
      color: rgba(226, 232, 240, 0.85);
      font-size: 14px;
    }

    .stats {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .stat {
      min-width: 104px;
      padding: 10px 14px;
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.56);
      border: 1px solid rgba(255,255,255,0.1);
    }

    .stat-label {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: rgba(226, 232, 240, 0.64);
    }

    .stat-value {
      display: block;
      margin-top: 4px;
      font-size: 24px;
      font-weight: 700;
    }

    .game-wrap {
      position: relative;
      border-radius: 28px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.18);
      box-shadow: 0 28px 90px rgba(15, 23, 42, 0.34);
      background: rgba(2, 6, 23, 0.25);
    }

    canvas {
      display: block;
      width: 100%;
      height: auto;
      background: linear-gradient(180deg, #7dd3fc 0%, #38bdf8 52%, #93c5fd 100%);
      cursor: pointer;
      touch-action: manipulation;
    }

    .overlay {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background: linear-gradient(180deg, rgba(15,23,42,0.08), rgba(15,23,42,0.58));
      text-align: center;
      transition: opacity 180ms ease;
    }

    .overlay.hidden {
      opacity: 0;
      pointer-events: none;
    }

    .card {
      width: min(100%, 420px);
      padding: 22px;
      border-radius: 24px;
      background: rgba(15, 23, 42, 0.82);
      border: 1px solid rgba(255,255,255,0.16);
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.38);
    }

    .card h2 {
      margin: 0 0 10px;
      font-size: clamp(24px, 4vw, 34px);
    }

    .card p {
      margin: 0 0 18px;
      line-height: 1.6;
      color: rgba(226, 232, 240, 0.9);
    }

    .actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
    }

    button {
      border: 0;
      border-radius: 999px;
      padding: 12px 18px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
    }

    button:hover { transform: translateY(-1px); }
    button:active { transform: translateY(1px); }

    .primary {
      background: var(--accent);
      color: #111827;
      box-shadow: 0 14px 34px rgba(250, 204, 21, 0.3);
    }

    .secondary {
      background: rgba(255,255,255,0.1);
      color: var(--text);
      border: 1px solid rgba(255,255,255,0.14);
    }

    .footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
      padding: 14px 18px;
      border-radius: 20px;
      background: var(--panel);
      border: 1px solid var(--panel-border);
      font-size: 14px;
    }

    .footer strong {
      color: white;
    }

    .footer .hint {
      color: rgba(226, 232, 240, 0.8);
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hud">
      <div class="title">
        <h1>Flappy Bird</h1>
        <p>Space, click, tap, or Arrow Up to flap. Pass through the pipes.</p>
      </div>
      <div class="stats">
        <div class="stat">
          <span class="stat-label">Score</span>
          <span class="stat-value" id="score">0</span>
        </div>
        <div class="stat">
          <span class="stat-label">Best</span>
          <span class="stat-value" id="best">0</span>
        </div>
        <div class="stat">
          <span class="stat-label">State</span>
          <span class="stat-value" id="state">Ready</span>
        </div>
      </div>
    </section>

    <section class="game-wrap">
      <canvas id="game" width="960" height="540" aria-label="Flappy Bird Game"></canvas>
      <div class="overlay" id="overlay">
        <div class="card">
          <h2 id="overlayTitle">Ready to Fly</h2>
          <p id="overlayText">Start the game, then keep the bird alive by flapping through the gaps.</p>
          <div class="actions">
            <button class="primary" id="startButton" type="button">Start Game</button>
            <button class="secondary" id="restartButton" type="button">Restart</button>
          </div>
        </div>
      </div>
    </section>

    <section class="footer">
      <div class="hint">Collision is precise. Flying too high or too low ends the run.</div>
      <div><strong>Controls:</strong> Space / Arrow Up / Click / Tap</div>
    </section>
  </main>

  <script>
    (function () {
      const canvas = document.getElementById('game');
      const context = canvas.getContext('2d');
      const overlay = document.getElementById('overlay');
      const overlayTitle = document.getElementById('overlayTitle');
      const overlayText = document.getElementById('overlayText');
      const scoreEl = document.getElementById('score');
      const bestEl = document.getElementById('best');
      const stateEl = document.getElementById('state');
      const startButton = document.getElementById('startButton');
      const restartButton = document.getElementById('restartButton');

      const state = {
        phase: 'ready',
        score: 0,
        best: Number(localStorage.getItem('easyplus-flappy-best') || 0),
        bird: { x: 220, y: 260, velocity: 0, radius: 18, tilt: 0 },
        pipes: [],
        pipeTimer: 0,
        frames: 0,
      };

      const config = {
        gravity: 0.42,
        flapStrength: -7.2,
        pipeWidth: 92,
        pipeGap: 170,
        pipeSpeed: 3.2,
        pipeInterval: 115,
        floorHeight: 82,
      };

      bestEl.textContent = String(state.best);

      function setOverlay(title, text, visible) {
        overlayTitle.textContent = title;
        overlayText.textContent = text;
        overlay.classList.toggle('hidden', !visible);
      }

      function resetGame(phase) {
        state.phase = phase || 'ready';
        state.score = 0;
        state.frames = 0;
        state.pipeTimer = 0;
        state.bird.x = 220;
        state.bird.y = 260;
        state.bird.velocity = 0;
        state.bird.tilt = 0;
        state.pipes = [];
        updateHud();
      }

      function startGame() {
        resetGame('playing');
        flap();
        setOverlay('', '', false);
      }

      function gameOver() {
        state.phase = 'gameover';
        if (state.score > state.best) {
          state.best = state.score;
          localStorage.setItem('easyplus-flappy-best', String(state.best));
        }
        updateHud();
        setOverlay('Game Over', 'Final score: ' + state.score + '. Press restart or flap to try again.', true);
      }

      function updateHud() {
        scoreEl.textContent = String(state.score);
        bestEl.textContent = String(state.best);
        stateEl.textContent =
          state.phase === 'ready' ? 'Ready' :
          state.phase === 'playing' ? 'Flying' :
          'Game Over';
      }

      function flap() {
        if (state.phase === 'ready') {
          startGame();
          return;
        }

        if (state.phase === 'gameover') {
          startGame();
          return;
        }

        if (state.phase !== 'playing') return;
        state.bird.velocity = config.flapStrength;
      }

      function spawnPipe() {
        const minTop = 70;
        const maxTop = canvas.height - config.floorHeight - config.pipeGap - 70;
        const topHeight = Math.random() * (maxTop - minTop) + minTop;
        state.pipes.push({
          x: canvas.width + config.pipeWidth,
          topHeight,
          scored: false,
        });
      }

      function updateBird() {
        state.bird.velocity += config.gravity;
        state.bird.y += state.bird.velocity;
        state.bird.tilt = Math.max(-0.45, Math.min(1.1, state.bird.velocity * 0.08));

        const ceiling = state.bird.radius;
        const floor = canvas.height - config.floorHeight - state.bird.radius;
        if (state.bird.y < ceiling) {
          state.bird.y = ceiling;
          state.bird.velocity = 0;
        }
        if (state.bird.y > floor) {
          state.bird.y = floor;
          gameOver();
        }
      }

      function updatePipes() {
        state.pipeTimer += 1;
        if (state.pipeTimer >= config.pipeInterval) {
          state.pipeTimer = 0;
          spawnPipe();
        }

        for (let index = state.pipes.length - 1; index >= 0; index -= 1) {
          const pipe = state.pipes[index];
          pipe.x -= config.pipeSpeed;

          if (!pipe.scored && pipe.x + config.pipeWidth < state.bird.x) {
            pipe.scored = true;
            state.score += 1;
            updateHud();
          }

          if (pipe.x + config.pipeWidth < -40) {
            state.pipes.splice(index, 1);
            continue;
          }

          const withinX =
            state.bird.x + state.bird.radius > pipe.x &&
            state.bird.x - state.bird.radius < pipe.x + config.pipeWidth;

          if (withinX) {
            const gapTop = pipe.topHeight;
            const gapBottom = pipe.topHeight + config.pipeGap;
            const hitsTop = state.bird.y - state.bird.radius < gapTop;
            const hitsBottom = state.bird.y + state.bird.radius > gapBottom;
            if (hitsTop || hitsBottom) {
              gameOver();
            }
          }
        }
      }

      function drawBackground() {
        const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#7dd3fc');
        gradient.addColorStop(0.6, '#38bdf8');
        gradient.addColorStop(1, '#bfdbfe');
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.fillStyle = 'rgba(255,255,255,0.28)';
        for (let i = 0; i < 6; i += 1) {
          const x = (state.frames * 0.35 + i * 180) % (canvas.width + 200) - 100;
          const y = 70 + (i % 3) * 50;
          context.beginPath();
          context.arc(canvas.width - x, y, 24, Math.PI * 0.65, Math.PI * 2.35);
          context.arc(canvas.width - x + 28, y + 4, 20, Math.PI, Math.PI * 2);
          context.arc(canvas.width - x + 52, y, 18, Math.PI * 1.35, Math.PI * 0.15);
          context.closePath();
          context.fill();
        }
      }

      function drawPipes() {
        state.pipes.forEach((pipe) => {
          const capHeight = 22;
          const gapBottom = pipe.topHeight + config.pipeGap;

          context.fillStyle = '#22c55e';
          context.fillRect(pipe.x, 0, config.pipeWidth, pipe.topHeight);
          context.fillRect(pipe.x, gapBottom, config.pipeWidth, canvas.height - gapBottom - config.floorHeight);

          context.fillStyle = '#15803d';
          context.fillRect(pipe.x - 6, pipe.topHeight - capHeight, config.pipeWidth + 12, capHeight);
          context.fillRect(pipe.x - 6, gapBottom, config.pipeWidth + 12, capHeight);
        });
      }

      function drawFloor() {
        context.fillStyle = '#65a30d';
        context.fillRect(0, canvas.height - config.floorHeight, canvas.width, config.floorHeight);
        context.fillStyle = '#854d0e';
        for (let x = -((state.frames * 3) % 48); x < canvas.width + 48; x += 48) {
          context.fillRect(x, canvas.height - config.floorHeight + 12, 26, 10);
        }
      }

      function drawBird() {
        context.save();
        context.translate(state.bird.x, state.bird.y);
        context.rotate(state.bird.tilt);

        context.fillStyle = '#fde047';
        context.beginPath();
        context.arc(0, 0, state.bird.radius, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = '#f59e0b';
        context.beginPath();
        context.moveTo(10, 2);
        context.lineTo(34, 10);
        context.lineTo(10, 16);
        context.closePath();
        context.fill();

        context.fillStyle = '#111827';
        context.beginPath();
        context.arc(6, -6, 3.5, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = '#f97316';
        context.beginPath();
        context.ellipse(-4, 8, 9, 5, -0.4, 0, Math.PI * 2);
        context.fill();

        context.restore();
      }

      function drawScoreText() {
        context.fillStyle = 'rgba(15, 23, 42, 0.24)';
        context.font = 'bold 78px Trebuchet MS, sans-serif';
        context.textAlign = 'center';
        context.fillText(String(state.score), canvas.width / 2 + 4, 110 + 4);
        context.fillStyle = '#ffffff';
        context.fillText(String(state.score), canvas.width / 2, 110);
      }

      function drawReadyHint() {
        if (state.phase !== 'ready') return;
        context.fillStyle = 'rgba(15, 23, 42, 0.42)';
        context.fillRect(canvas.width / 2 - 150, 150, 300, 54);
        context.fillStyle = '#ffffff';
        context.font = 'bold 26px Trebuchet MS, sans-serif';
        context.textAlign = 'center';
        context.fillText('Tap, Click, or Press Space', canvas.width / 2, 186);
      }

      function frame() {
        state.frames += 1;

        if (state.phase === 'playing') {
          updateBird();
          updatePipes();
        }

        drawBackground();
        drawPipes();
        drawFloor();
        drawBird();
        drawScoreText();
        drawReadyHint();

        requestAnimationFrame(frame);
      }

      function handlePrimaryAction(event) {
        if (event) event.preventDefault();
        flap();
      }

      startButton.addEventListener('click', startGame);
      restartButton.addEventListener('click', startGame);
      canvas.addEventListener('pointerdown', handlePrimaryAction);
      window.addEventListener('keydown', function (event) {
        if (event.code === 'Space' || event.code === 'ArrowUp') {
          event.preventDefault();
          flap();
        }
      });

      resetGame('ready');
      setOverlay('Ready to Fly', 'Start the game, then keep the bird alive by flapping through the gaps.', true);
      frame();
    })();
  </script>
</body>
</html>`
}

function buildCalculatorHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #0f172a, #1e293b);
      font-family: "Segoe UI", sans-serif;
      color: white;
    }
    .calc {
      width: min(92vw, 360px);
      padding: 22px;
      border-radius: 28px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(255,255,255,0.14);
      box-shadow: 0 28px 80px rgba(0,0,0,0.38);
    }
    .screen {
      width: 100%;
      border: 0;
      border-radius: 20px;
      padding: 18px;
      margin-bottom: 16px;
      background: rgba(255,255,255,0.06);
      color: white;
      font-size: 34px;
      text-align: right;
    }
    .keys {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    button {
      border: 0;
      border-radius: 18px;
      padding: 16px;
      font: inherit;
      font-size: 18px;
      font-weight: 700;
      color: white;
      background: rgba(255,255,255,0.08);
      cursor: pointer;
    }
    button.operator { background: #7c3aed; }
    button.equals { background: #22c55e; }
    button.clear { background: #ef4444; }
    button.zero { grid-column: span 2; }
  </style>
</head>
<body>
  <main class="calc">
    <input id="display" class="screen" value="0" readonly />
    <div class="keys" id="keys">
      <button class="clear" data-action="clear">AC</button>
      <button data-action="delete">DEL</button>
      <button class="operator" data-value="%">%</button>
      <button class="operator" data-value="/">/</button>
      <button data-value="7">7</button>
      <button data-value="8">8</button>
      <button data-value="9">9</button>
      <button class="operator" data-value="*">*</button>
      <button data-value="4">4</button>
      <button data-value="5">5</button>
      <button data-value="6">6</button>
      <button class="operator" data-value="-">-</button>
      <button data-value="1">1</button>
      <button data-value="2">2</button>
      <button data-value="3">3</button>
      <button class="operator" data-value="+">+</button>
      <button class="zero" data-value="0">0</button>
      <button data-value=".">.</button>
      <button class="equals" data-action="equals">=</button>
    </div>
  </main>
  <script>
    (function () {
      const display = document.getElementById('display');
      const keys = document.getElementById('keys');
      let expression = '0';

      function render() {
        display.value = expression;
      }

      function append(value) {
        expression = expression === '0' ? value : expression + value;
        render();
      }

      function clearAll() {
        expression = '0';
        render();
      }

      function deleteLast() {
        expression = expression.length > 1 ? expression.slice(0, -1) : '0';
        render();
      }

      function evaluateExpression() {
        try {
          const safe = expression.replace(/%/g, '/100');
          const result = Function('return (' + safe + ')')();
          expression = String(Number.isFinite(result) ? result : 'Error');
        } catch (error) {
          expression = 'Error';
        }
        render();
      }

      keys.addEventListener('click', function (event) {
        const button = event.target.closest('button');
        if (!button) return;
        const action = button.getAttribute('data-action');
        const value = button.getAttribute('data-value');
        if (action === 'clear') return clearAll();
        if (action === 'delete') return deleteLast();
        if (action === 'equals') return evaluateExpression();
        if (value) append(value);
      });

      window.addEventListener('keydown', function (event) {
        if (/^[0-9.+\\-*/%]$/.test(event.key)) append(event.key);
        if (event.key === 'Enter') evaluateExpression();
        if (event.key === 'Backspace') deleteLast();
        if (event.key === 'Escape') clearAll();
      });

      render();
    })();
  </script>
</body>
</html>`
}

export function buildArtifactFallback(userPrompt?: string, requestedLanguage?: Artifact['language'] | null): ArtifactFallbackSpec | null {
  const prompt = String(userPrompt || '').trim()
  if (!prompt) return null

  const lower = prompt.toLowerCase()
  if (requestedLanguage && requestedLanguage !== 'html' && requestedLanguage !== 'canva') {
    return null
  }

  if (/\bflappy\s*bird\b/i.test(lower)) {
    return {
      language: 'html',
      title: 'Flappy Bird Game',
      code: buildFlappyBirdHtml('Flappy Bird Game'),
    }
  }

  if (/\bcalculator\b/i.test(lower)) {
    return {
      language: 'html',
      title: 'Interactive Calculator',
      code: buildCalculatorHtml('Interactive Calculator'),
    }
  }

  return null
}
