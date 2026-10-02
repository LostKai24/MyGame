(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  var hudTime = document.getElementById("hud-time");
  var hudSpeed = document.getElementById("hud-speed");
  var hudHeight = document.getElementById("hud-height");
  var hudFuel = document.getElementById("hud-fuel");

  var engineSelect = document.getElementById("engine");
  var throttleInput = document.getElementById("throttle");
  var throttleValue = document.getElementById("throttle-value");
  var angleValue = document.getElementById("angle-value");

  var turnLeftBtn = document.getElementById("turn-left");
  var turnRightBtn = document.getElementById("turn-right");

  var startBtn = document.getElementById("start-btn");
  var burnBtn = document.getElementById("burn-btn");
  var resetBtn = document.getElementById("reset-btn");
  var restartBtn = document.getElementById("restart-btn");

  var messageBox = document.getElementById("message");
  var messageTitle = document.getElementById("message-title");
  var messageText = document.getElementById("message-text");

  // Двигатели: тяга (ускорение при 100% тяги) и расход топлива (в секунду при 100%).
  var ENGINES = {
    light:    { name: "Лёгкий",      thrust: 22,  fuelRate: 6  },
    standard: { name: "Стандартный", thrust: 40,  fuelRate: 11 },
    heavy:    { name: "Тяжёлый",     thrust: 70,  fuelRate: 20 }
  };

  // Мир в условных единицах. Луна в центре.
  var WORLD = {
    width: 1000,
    height: 700,
    moon: { x: 500, y: 380, r: 140 },
    // Зона посадки — дуга сверху Луны.
    landing: { angleStart: -Math.PI * 0.85, angleEnd: -Math.PI * 0.15 }
  };

  var G_MOON = 900;        // гравитационный параметр Луны
  var START_HEIGHT = 260;  // начальная высота над поверхностью
  var START_VX = 28;       // начальная горизонтальная скорость (влево-вправо)
  var MAX_TIME = 180;      // сек
  var MAX_LANDING_SPEED = 22; // макс. скорость касания для мягкой посадки
  var ROTATE_SPEED = 70;   // градусов в секунду
  var FUEL_MAX = 100;

  var state = null;
  var running = false;
  var lastTimestamp = 0;
  var accumulatedTime = 0;
  var STEP = 1 / 120;

  var thrustOn = false;
  var turnLeft = false;
  var turnRight = false;

  // ---------- Размеры canvas ----------
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

  // ---------- Мир -> экран ----------
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
    return { x: v.offsetX + x * v.scale, y: v.offsetY + y * v.scale };
  }

  // ---------- Состояние ----------
  function resetState() {
    // Старт: над Луной, чуть выше посадочной зоны.
    var startAngle = -Math.PI / 2; // строго сверху
    var startX = WORLD.moon.x + Math.cos(startAngle) * (WORLD.moon.r + START_HEIGHT);
    var startY = WORLD.moon.y + Math.sin(startAngle) * (WORLD.moon.r + START_HEIGHT);

    state = {
      ship: {
        x: startX,
        y: startY,
        vx: START_VX,
        vy: 0,
        angle: Math.PI / 2 // нос смотрит "вниз" к Луне (в экранных координатах +y — вниз)
      },
      time: 0,
      fuel: FUEL_MAX,
      trail: [{ x: startX, y: startY }],
      status: "idle" // idle | flying | won | lost
    };
    running = false;
    thrustOn = false;
    turnLeft = false;
    turnRight = false;
    accumulatedTime = 0;
    lastTimestamp = 0;
    updateHud();
    hideMessage();
    updateButtons();
    updateAngleLabel();
  }

  function updateAngleLabel() {
    if (!state) return;
    // Показываем угол в градусах так, чтобы 90° = нос вниз к Луне.
    var deg = Math.round((state.ship.angle * 180 / Math.PI + 90 + 360) % 360);
    angleValue.textContent = deg + "°";
  }

  function speedOf(ship) {
    return Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
  }

  function heightAboveSurface(ship) {
    var dx = ship.x - WORLD.moon.x;
    var dy = ship.y - WORLD.moon.y;
    return Math.max(0, Math.sqrt(dx * dx + dy * dy) - WORLD.moon.r);
  }

  function updateHud() {
    if (!state) return;
    hudTime.textContent = state.time.toFixed(1) + " с";
    hudSpeed.textContent = speedOf(state.ship).toFixed(1);
    hudHeight.textContent = Math.round(heightAboveSurface(state.ship));
    hudFuel.textContent = Math.round(state.fuel) + "%";
  }

  function updateButtons() {
    var flying = state && state.status === "flying";
    var finished = state && (state.status === "won" || state.status === "lost");

    startBtn.disabled = flying || finished;
    burnBtn.disabled = !flying || state.fuel <= 0;
    resetBtn.disabled = false;

    engineSelect.disabled = flying || finished;
    throttleInput.disabled = finished;
    turnLeftBtn.disabled = !flying;
    turnRightBtn.disabled = !flying;
  }

  function showMessage(title, text) {
    messageTitle.textContent = title;
    messageText.textContent = text;
    messageBox.classList.remove("hidden");
  }

  function hideMessage() {
    messageBox.classList.add("hidden");
  }

  // ---------- Физика ----------
  function gravityAt(x, y) {
    var dx = WORLD.moon.x - x;
    var dy = WORLD.moon.y - y;
    var d2 = dx * dx + dy * dy;
    var d = Math.sqrt(d2) || 1;
    var a = G_MOON / d2;
    return { ax: a * (dx / d), ay: a * (dy / d) };
  }

  function stepPhysics(dt) {
    var s = state.ship;

    // Поворот носа
    if (turnLeft) s.angle -= ROTATE_SPEED * Math.PI / 180 * dt;
    if (turnRight) s.angle += ROTATE_SPEED * Math.PI / 180 * dt;

    // Гравитация Луны
    var g = gravityAt(s.x, s.y);
    s.vx += g.ax * dt;
    s.vy += g.ay * dt;

    // Тяга: пока кнопка нажата и есть топливо.
    if (thrustOn && state.fuel > 0) {
      var engine = ENGINES[engineSelect.value];
      var throttle = parseFloat(throttleInput.value) / 100;
      var accel = engine.thrust * throttle;
      s.vx += Math.cos(s.angle) * accel * dt;
      s.vy += Math.sin(s.angle) * accel * dt;

      state.fuel -= engine.fuelRate * throttle * dt;
      if (state.fuel < 0) state.fuel = 0;
    }

    // Интегрирование позиции
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    state.time += dt;

    // Траектория
    var trail = state.trail;
    var last = trail[trail.length - 1];
    var dx = s.x - last.x;
    var dy = s.y - last.y;
    if (dx * dx + dy * dy > 4) {
      trail.push({ x: s.x, y: s.y });
      if (trail.length > 3000) trail.shift();
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

    // Касание поверхности Луны
    var dMoon = distanceTo(s.x, s.y, WORLD.moon.x, WORLD.moon.y);
    if (dMoon <= WORLD.moon.r) {
      var speed = speedOf(s);
      var ang = Math.atan2(s.y - WORLD.moon.y, s.x - WORLD.moon.x);
      if (ang < 0) ang += Math.PI * 2;

      // Приводим зону к [0..2π]
      var a0 = WORLD.landing.angleStart;
      var a1 = WORLD.landing.angleEnd;
      if (a0 < 0) a0 += Math.PI * 2;
      if (a1 < 0) a1 += Math.PI * 2;

      var inZone;
      if (a0 <= a1) inZone = (ang >= a0 && ang <= a1);
      else inZone = (ang >= a0 || ang <= a1);

      if (!inZone) {
        endGame("lost", "Мимо посадочной зоны", "Аппарат коснулся Луны вне жёлтой площадки.");
      } else if (speed > MAX_LANDING_SPEED) {
        endGame("lost", "Жёсткая посадка", "Скорость касания " + speed.toFixed(1) + " — слишком большая. Нужно мягче.");
      } else {
        endGame("won", "Мягкая посадка!", "Скорость касания: " + speed.toFixed(1) + ", время: " + state.time.toFixed(1) + " с");
      }
      return;
    }

    // Улёт за пределы мира
    if (s.x < -600 || s.x > WORLD.width + 600 || s.y < -600 || s.y > WORLD.height + 600) {
      endGame("lost", "Аппарат улетел в космос", "Слишком сильно разогнался или не туда направил тягу.");
      return;
    }

    // Время
    if (state.time >= MAX_TIME) {
      endGame("lost", "Время вышло", "Не удалось совершить посадку за отведённое время.");
      return;
    }

    // Топливо кончилось, но аппарат ещё летит — тоже проигрыш, если скорость высокая и падает
    if (state.fuel <= 0 && speedOf(s) > MAX_LANDING_SPEED) {
      // Не заканчиваем сразу: дадим упасть. Упадёт — сработает проверка касания.
    }
  }

  function endGame(status, title, text) {
    state.status = status;
    running = false;
    thrustOn = false;
    turnLeft = false;
    turnRight = false;
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

    // Космос
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, w, h);
    drawStars();

    if (!state) return;

    drawMoon();
    drawLandingZone();
    drawTrail();
    drawShip();
  }

  function drawStars() {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (var i = 0; i < 90; i++) {
      var x = ((i * 137.5) % 1000) / 1000 * canvas.clientWidth;
      var y = ((i * 91.7) % 700) / 700 * canvas.clientHeight;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }

  function drawMoon() {
    var p = toScreen(WORLD.moon.x, WORLD.moon.y);
    var v = getView();
    var r = WORLD.moon.r * v.scale;

    var grad = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, r * 0.2, p.x, p.y, r);
    grad.addColorStop(0, "#c9d2e2");
    grad.addColorStop(1, "#6a7386");

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Кратеры (для вида)
    ctx.fillStyle = "rgba(90, 100, 120, 0.55)";
    drawCrater(p.x - r * 0.35, p.y + r * 0.25, r * 0.12);
    drawCrater(p.x + r * 0.30, p.y + r * 0.45, r * 0.09);
    drawCrater(p.x + r * 0.05, p.y - r * 0.30, r * 0.07);
    drawCrater(p.x - r * 0.55, p.y - r * 0.10, r * 0.06);
  }

  function drawCrater(cx, cy, cr) {
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLandingZone() {
    var v = getView();
    var p = toScreen(WORLD.moon.x, WORLD.moon.y);
    var r = WORLD.moon.r * v.scale;

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, WORLD.landing.angleStart, WORLD.landing.angleEnd);
    ctx.strokeStyle = "#ffd76a";
    ctx.lineWidth = Math.max(4, r * 0.10);
    ctx.stroke();
  }

  function drawTrail() {
    if (!state.trail || state.trail.length < 2) return;
    ctx.beginPath();
    for (var i = 0; i < state.trail.length; i++) {
      var pt = state.trail[i];
      var p = toScreen(pt.x, pt.y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = "rgba(120, 200, 255, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawShip() {
    var s = state.ship;
    var p = toScreen(s.x, s.y);
    var v = getView();
    var size = Math.max(6, 9 * v.scale);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(s.angle);

    // Корпус — треугольник, нос по направлению angle.
    ctx.beginPath();
    ctx.moveTo(size * 1.6, 0);
    ctx.lineTo(-size, size * 0.9);
    ctx.lineTo(-size, -size * 0.9);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    // Сопло и "пламя" при работающей тяге.
    ctx.beginPath();
    ctx.moveTo(-size * 0.6, size * 0.5);
    ctx.lineTo(-size * 0.6, -size * 0.5);
    ctx.strokeStyle = "#9aa4b8";
    ctx.lineWidth = 2;
    ctx.stroke();

    if (thrustOn && state.fuel > 0 && state.status === "flying") {
      ctx.beginPath();
      ctx.moveTo(-size * 0.7, size * 0.4);
      ctx.lineTo(-size * 1.9, 0);
      ctx.lineTo(-size * 0.7, -size * 0.4);
      ctx.closePath();
      ctx.fillStyle = "#ff8c42";
      ctx.fill();
    }

    ctx.restore();
  }

  // ---------- Игровой цикл ----------
  function loop(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    var dt = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    if (dt > 0.1) dt = 0.1;

    if (running && state && state.status === "flying") {
      accumulatedTime += dt;
      while (accumulatedTime >= STEP) {
        stepPhysics(STEP);
        accumulatedTime -= STEP;
        if (!running || state.status !== "flying") break;
      }
      updateHud();
      updateAngleLabel();
    }

    render();
    requestAnimationFrame(loop);
  }

  // ---------- Управление ----------
  function startFlight() {
    if (!state) return;
    if (state.status === "flying" || state.status === "won" || state.status === "lost") return;
    state.status = "flying";
    running = true;
    lastTimestamp = 0;
    accumulatedTime = 0;
    hideMessage();
    updateButtons();
  }

  function resetGame() {
    resetState();
    render();
  }

  // ---------- События ----------
  throttleInput.addEventListener("input", function () {
    throttleValue.textContent = throttleInput.value + "%";
  });

  engineSelect.addEventListener("change", function () {
    // Ничего не сбрасываем, просто меняется модель двигателя.
  });

  // Кнопка «Тяга»: нажата — включена.
  burnBtn.addEventListener("mousedown", function () { if (state && state.status === "flying" && state.fuel > 0) thrustOn = true; });
  burnBtn.addEventListener("mouseup", function () { thrustOn = false; });
  burnBtn.addEventListener("mouseleave", function () { thrustOn = false; });
  burnBtn.addEventListener("touchstart", function (e) { e.preventDefault(); if (state && state.status === "flying" && state.fuel > 0) thrustOn = true; }, { passive: false });
  burnBtn.addEventListener("touchend", function () { thrustOn = false; });

  turnLeftBtn.addEventListener("mousedown", function () { turnLeft = true; });
  turnLeftBtn.addEventListener("mouseup", function () { turnLeft = false; });
  turnLeftBtn.addEventListener("mouseleave", function () { turnLeft = false; });
  turnLeftBtn.addEventListener("touchstart", function (e) { e.preventDefault(); turnLeft = true; }, { passive: false });
  turnLeftBtn.addEventListener("touchend", function () { turnLeft = false; });

  turnRightBtn.addEventListener("mousedown", function () { turnRight = true; });
  turnRightBtn.addEventListener("mouseup", function () { turnRight = false; });
  turnRightBtn.addEventListener("mouseleave", function () { turnRight = false; });
  turnRightBtn.addEventListener("touchstart", function (e) { e.preventDefault(); turnRight = true; }, { passive: false });
  turnRightBtn.addEventListener("touchend", function () { turnRight = false; });

  startBtn.addEventListener("click", startFlight);
  resetBtn.addEventListener("click", resetGame);
  restartBtn.addEventListener("click", resetGame);

  // Клавиатура
  document.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if (state && state.status === "flying") {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "ф") { turnLeft = true; e.preventDefault(); }
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "в") { turnRight = true; e.preventDefault(); }
      if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "ц") {
        if (state.fuel > 0) thrustOn = true;
        e.preventDefault();
      }
    }
    if (e.key === "Enter") {
      if (state && state.status === "idle") startFlight();
      else if (state && (state.status === "won" || state.status === "lost")) resetGame();
      e.preventDefault();
    }
  });

  document.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "ф") turnLeft = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "в") turnRight = false;
    if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "ц") thrustOn = false;
  });

  // ---------- Старт ----------
  fitCanvas();
  resetState();
  throttleValue.textContent = throttleInput.value + "%";
  updateAngleLabel();
  requestAnimationFrame(loop);
})();