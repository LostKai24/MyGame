(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  var hudTime = document.getElementById("hud-time");
  var hudSpeed = document.getElementById("hud-speed");
  var hudDv = document.getElementById("hud-dv");
  var hudBurns = document.getElementById("hud-burns");

  var powerInput = document.getElementById("power");
  var angleInput = document.getElementById("angle");
  var powerValue = document.getElementById("power-value");
  var angleValue = document.getElementById("angle-value");

  var startBtn = document.getElementById("start-btn");
  var burnBtn = document.getElementById("burn-btn");
  var resetBtn = document.getElementById("reset-btn");
  var restartBtn = document.getElementById("restart-btn");

  var messageBox = document.getElementById("message");
  var messageTitle = document.getElementById("message-title");
  var messageText = document.getElementById("message-text");

  // Мир игры задан в условных единицах (мировые координаты).
  // Камера подбирает масштаб так, чтобы всё помещалось на экране.
  var WORLD = {
    width: 1000,
    height: 700,
    earth: { x: 160, y: 500, r: 70 },
    moon: { x: 840, y: 180, r: 45 },
    landing: { angleStart: Math.PI * 0.55, angleEnd: Math.PI * 1.15 }
  };

  // Физические параметры (упрощённые, не для реального полёта).
  var G_EARTH = 4200;   // гравитационный параметр Земли
  var G_MOON = 620;     // гравитационный параметр Луны
  var START_OFFSET = 90; // старт на расстоянии от центра Земли
  var START_SPEED = 55;  // начальная скорость по касательной
  var BURN_STRENGTH = 1.15; // во сколько раз умножается ползунок силы
  var MAX_BURNS = 3;
  var MAX_TIME = 120; // сек игрового времени

  var state = null;
  var running = false;
  var lastTimestamp = 0;
  var accumulatedTime = 0;
  var STEP = 1 / 120; // фиксированный шаг физики

  // ---------- Работа с размерами canvas ----------
  function fitCanvas() {
    var wrap = canvas.parentElement;
    var dpr = window.devicePixelRatio || 1;
    var w = wrap.clientWidth;
    var h = wrap.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", function () {
    fitCanvas();
    render();
  });

  // ---------- Преобразование мировых координат в экранные ----------
  function getView() {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    var scale = Math.min(w / WORLD.width, h / WORLD.height);
    var offsetX = (w - WORLD.width * scale) / 2;
    var offsetY = (h - WORLD.height * scale) / 2;
    return { scale: scale, offsetX: offsetX, offsetY: offsetY };
  }

  function toScreen(x, y) {
    var v = getView();
    return {
      x: v.offsetX + x * v.scale,
      y: v.offsetY + y * v.scale
    };
  }

  // ---------- Инициализация состояния ----------
  function resetState() {
    // Аппарат стартует над Землёй (условно "сверху") с касательной скоростью.
    var angle = -Math.PI / 2; // верх
    var sx = WORLD.earth.x + Math.cos(angle) * (WORLD.earth.r + START_OFFSET);
    var sy = WORLD.earth.y + Math.sin(angle) * (WORLD.earth.r + START_OFFSET);

    // Касательная скорость — перпендикулярно радиусу, "вправо".
    var vx = -Math.sin(angle) * START_SPEED;
    var vy = Math.cos(angle) * START_SPEED;

    state = {
      ship: { x: sx, y: sy, vx: vx, vy: vy },
      time: 0,
      dv: 0,
      burnsLeft: MAX_BURNS,
      trail: [{ x: sx, y: sy }],
      status: "idle" // idle | flying | won | lost
    };
    running = false;
    accumulatedTime = 0;
    lastTimestamp = 0;
    updateHud();
    hideMessage();
    updateButtons();
  }

  // ---------- HUD ----------
  function speedOf(ship) {
    return Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
  }

  function updateHud() {
    if (!state) return;
    hudTime.textContent = state.time.toFixed(1) + " с";
    hudSpeed.textContent = speedOf(state.ship).toFixed(1);
    hudDv.textContent = state.dv.toFixed(1);
    hudBurns.textContent = String(state.burnsLeft);
  }

  function updateButtons() {
    var flying = state && state.status === "flying";
    var finished = state && (state.status === "won" || state.status === "lost");

    startBtn.disabled = flying || finished;
    burnBtn.disabled = !flying || state.burnsLeft <= 0;
    resetBtn.disabled = false;

    powerInput.disabled = finished;
    angleInput.disabled = finished;
  }

  // ---------- Сообщения ----------
  function showMessage(title, text) {
    messageTitle.textContent = title;
    messageText.textContent = text;
    messageBox.classList.remove("hidden");
  }

  function hideMessage() {
    messageBox.classList.add("hidden");
  }

  // ---------- Физика ----------
  function accelAt(x, y) {
    // Притяжение к Земле
    var dxE = WORLD.earth.x - x;
    var dyE = WORLD.earth.y - y;
    var dE2 = dxE * dxE + dyE * dyE;
    var dE = Math.sqrt(dE2) || 1;
    var aE = G_EARTH / dE2;
    var axE = aE * (dxE / dE);
    var ayE = aE * (dyE / dE);

    // Притяжение к Луне
    var dxM = WORLD.moon.x - x;
    var dyM = WORLD.moon.y - y;
    var dM2 = dxM * dxM + dyM * dyM;
    var dM = Math.sqrt(dM2) || 1;
    var aM = G_MOON / dM2;
    var axM = aM * (dxM / dM);
    var ayM = aM * (dyM / dM);

    return { ax: axE + axM, ay: ayE + ayM };
  }

  function stepPhysics(dt) {
    var s = state.ship;
    var a = accelAt(s.x, s.y);

    // Метод Эйлера (полунеявный): сначала скорость, потом позиция.
    s.vx += a.ax * dt;
    s.vy += a.ay * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    state.time += dt;

    // Траектория: добавляем точки не слишком часто.
    var trail = state.trail;
    var last = trail[trail.length - 1];
    var dx = s.x - last.x;
    var dy = s.y - last.y;
    if (dx * dx + dy * dy > 4) {
      trail.push({ x: s.x, y: s.y });
      if (trail.length > 2000) trail.shift();
    }

    checkEndConditions();
  }

  function distanceTo(px, py, cx, cy) {
    var dx = px - cx;
    var dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function checkEndConditions() {
    var s = state.ship;

    // Столкновение с Землёй
    if (distanceTo(s.x, s.y, WORLD.earth.x, WORLD.earth.y) <= WORLD.earth.r) {
      endGame("lost", "Аппарат упал на Землю", "Попробуй другой угол или силу импульса.");
      return;
    }

    // Касание Луны
    var dMoon = distanceTo(s.x, s.y, WORLD.moon.x, WORLD.moon.y);
    if (dMoon <= WORLD.moon.r) {
      // Определяем, попал ли в зону посадки.
      var ang = Math.atan2(s.y - WORLD.moon.y, s.x - WORLD.moon.x);
      if (ang < 0) ang += Math.PI * 2;
      var a0 = WORLD.landing.angleStart;
      var a1 = WORLD.landing.angleEnd;
      var inZone = (ang >= a0 && ang <= a1);

      if (inZone) {
        endGame("won", "Успешная посадка!", "Ты попал в отмеченную зону. Время: " + state.time.toFixed(1) + " с, ΔV: " + state.dv.toFixed(1));
      } else {
        endGame("lost", "Жёсткая посадка мимо зоны", "Аппарат коснулся Луны вне посадочной площадки.");
      }
      return;
    }

    // Улёт за пределы мира
    if (s.x < -400 || s.x > WORLD.width + 400 || s.y < -400 || s.y > WORLD.height + 400) {
      endGame("lost", "Аппарат улетел в открытый космос", "Импульс оказался слишком сильным или направлен не туда.");
      return;
    }

    // Превышение времени
    if (state.time >= MAX_TIME) {
      endGame("lost", "Время вышло", "Не удалось достичь Луны за отведённое время.");
      return;
    }

    // Кончились импульсы и аппарат больше не движется к Луне (упрощённо: если близко к Земле и медленно)
    if (state.burnsLeft <= 0 && speedOf(s) < 5 && distanceTo(s.x, s.y, WORLD.earth.x, WORLD.earth.y) < 300) {
      endGame("lost", "Топливо закончилось", "Аппарат остался на околоземной орбите.");
    }
  }

  function endGame(status, title, text) {
    state.status = status;
    running = false;
    updateButtons();
    updateHud();
    showMessage(title, text);
    render();
  }

  // ---------- Отрисовка ----------
  function render() {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);

    // Фон-космос
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, w, h);

    drawStars();

    if (!state) return;

    // Земля
    drawBody(WORLD.earth.x, WORLD.earth.y, WORLD.earth.r, "#2b6fd6", "#1a4a94", "Земля");

    // Луна
    drawBody(WORLD.moon.x, WORLD.moon.y, WORLD.moon.r, "#9aa4b8", "#6a7386", "Луна");

    // Зона посадки
    drawLandingZone();

    // Траектория
    drawTrail();

    // Аппарат
    drawShip();
  }

  function drawStars() {
    // Простые "звёзды" по псевдослучайным координатам, без мерцания.
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (var i = 0; i < 60; i++) {
      var x = ((i * 137.5) % 1000) / 1000 * canvas.clientWidth;
      var y = ((i * 91.7) % 700) / 700 * canvas.clientHeight;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }

  function drawBody(wx, wy, wr, colorTop, colorBottom, label) {
    var p = toScreen(wx, wy);
    var v = getView();
    var r = wr * v.scale;

    var grad = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, r * 0.2, p.x, p.y, r);
    grad.addColorStop(0, colorTop);
    grad.addColorStop(1, colorBottom);

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, p.x, p.y + r + 16);
  }

  function drawLandingZone() {
    var v = getView();
    var p = toScreen(WORLD.moon.x, WORLD.moon.y);
    var r = WORLD.moon.r * v.scale;

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, WORLD.landing.angleStart, WORLD.landing.angleEnd);
    ctx.strokeStyle = "#ffd76a";
    ctx.lineWidth = Math.max(3, r * 0.12);
    ctx.stroke();
  }

  function drawTrail() {
    if (!state.trail || state.trail.length < 2) return;
    var v = getView();
    ctx.beginPath();
    for (var i = 0; i < state.trail.length; i++) {
      var pt = state.trail[i];
      var p = toScreen(pt.x, pt.y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = "rgba(120, 200, 255, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawShip() {
    var s = state.ship;
    var p = toScreen(s.x, s.y);
    var v = getView();

    var size = Math.max(5, 8 * v.scale);

    // Направление скорости — для ориентации треугольника.
    var ang = Math.atan2(s.vy, s.vx);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);

    ctx.beginPath();
    ctx.moveTo(size * 1.6, 0);
    ctx.lineTo(-size, size * 0.9);
    ctx.lineTo(-size, -size * 0.9);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.restore();
  }

  // ---------- Игровой цикл ----------
  function loop(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    var dt = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    if (dt > 0.1) dt = 0.1; // защита от больших пауз

    if (running && state && state.status === "flying") {
      accumulatedTime += dt;
      while (accumulatedTime >= STEP) {
        stepPhysics(STEP);
        accumulatedTime -= STEP;
        if (!running || state.status !== "flying") break;
      }
      updateHud();
    }

    render();
    requestAnimationFrame(loop);
  }

  // ---------- Управление ----------
  function startFlight() {
    if (!state || state.status === "flying") return;
    if (state.status === "won" || state.status === "lost") return;

    state.status = "flying";
    running = true;
    lastTimestamp = 0;
    accumulatedTime = 0;
    hideMessage();
    updateButtons();
  }

  function applyBurn() {
    if (!state || state.status !== "flying") return;
    if (state.burnsLeft <= 0) return;

    var power = parseFloat(powerInput.value);
    var angleDeg = parseFloat(angleInput.value);
    var angleRad = angleDeg * Math.PI / 180;

    var dv = power * BURN_STRENGTH;

    state.ship.vx += Math.cos(angleRad) * dv;
    state.ship.vy += Math.sin(angleRad) * dv;

    state.dv += dv;
    state.burnsLeft -= 1;

    updateHud();
    updateButtons();
  }

  function resetGame() {
    resetState();
    render();
  }

  // ---------- Обработчики ----------
  powerInput.addEventListener("input", function () {
    powerValue.textContent = powerInput.value;
  });

  angleInput.addEventListener("input", function () {
    angleValue.textContent = angleInput.value + "°";
  });

  startBtn.addEventListener("click", startFlight);
  burnBtn.addEventListener("click", applyBurn);
  resetBtn.addEventListener("click", resetGame);
  restartBtn.addEventListener("click", resetGame);

  // Клавиатура: стрелки меняют силу/угол, пробел — импульс, Enter — старт/сброс.
  document.addEventListener("keydown", function (e) {
    if (e.target && e.target.tagName === "INPUT" && e.target.type !== "range") return;

    var stepSmall = e.shiftKey ? 10 : 1;

    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      if (document.activeElement === angleInput) {
        angleInput.value = String((parseInt(angleInput.value, 10) + stepSmall) % 360);
        angleValue.textContent = angleInput.value + "°";
      } else {
        powerInput.value = String(Math.min(100, parseInt(powerInput.value, 10) + stepSmall));
        powerValue.textContent = powerInput.value;
      }
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      if (document.activeElement === angleInput) {
        var a = parseInt(angleInput.value, 10) - stepSmall;
        if (a < 0) a += 360;
        angleInput.value = String(a);
        angleValue.textContent = angleInput.value + "°";
      } else {
        powerInput.value = String(Math.max(0, parseInt(powerInput.value, 10) - stepSmall));
        powerValue.textContent = powerInput.value;
      }
      e.preventDefault();
    } else if (e.key === " ") {
      applyBurn();
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (state && (state.status === "won" || state.status === "lost" || state.status === "idle")) {
        if (state.status === "idle") startFlight();
        else resetGame();
      }
      e.preventDefault();
    }
  });

  // ---------- Старт ----------
  fitCanvas();
  resetState();
  powerValue.textContent = powerInput.value;
  angleValue.textContent = angleInput.value + "°";
  requestAnimationFrame(loop);
})();