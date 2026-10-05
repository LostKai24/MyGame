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

  // НОВОЕ: три двигателя
  var engineLeftBtn = document.getElementById("engine-left");
  var engineCenterBtn = document.getElementById("engine-center");
  var engineRightBtn = document.getElementById("engine-right");

  var startBtn = document.getElementById("start-btn");
  var burnBtn = document.getElementById("burn-btn");
  var resetBtn = document.getElementById("reset-btn");
  var restartBtn = document.getElementById("restart-btn");

  var messageBox = document.getElementById("message");
  var messageTitle = document.getElementById("message-title");
  var messageText = document.getElementById("message-text");

  var ENGINES = {
    light:    { name: "Лёгкий",      thrust: 22,  fuelRate: 6  },
    standard: { name: "Стандартный", thrust: 40,  fuelRate: 11 },
    heavy:    { name: "Тяжёлый",     thrust: 70,  fuelRate: 20 }
  };

  var WORLD = {
    width: 1000,
    height: 700,
    moon: { x: 500, y: 380, r: 140 }
  };

  var G_MOON = 900;
  var START_HEIGHT = 260;
  var MAX_TIME = 180;
  var MAX_LANDING_SPEED = 22;
  var ROTATE_SPEED = 70;
  var FUEL_MAX = 100;

  // НОВОЕ: старт по орбите + анимированные звёзды + случайная зона
  var ORBIT_SPEED = 55;
  var stars = [];
  var landingZone = { angleStart: 0, angleEnd: 0 };

  var state = null;
  var running = false;
  var lastTimestamp = 0;
  var accumulatedTime = 0;
  var STEP = 1 / 120;

  // НОВОЕ: три раздельные тяги вместо одной
  var thrustCenter = false;
  var thrustLeft = false;
  var thrustRight = false;
  var turnLeft = false;
  var turnRight = false;

  // ---------- Анимированные звёзды ----------
  function initStars() {
    stars = [];
    for (var i = 0; i < 120; i++) {
      stars.push({
        x: Math.random() * 1200,
        y: Math.random() * 800,
        size: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.5 + 0.2,
        twinkleSpeed: Math.random() * 0.02 + 0.005
      });
    }
  }

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
    // НОВОЕ: случайная посадочная зона (верхняя полусфера)
    var startAngle = Math.PI * (0.15 + Math.random() * 0.7);
    var endAngle = startAngle + Math.PI * (0.15 + Math.random() * 0.1);
    landingZone = { angleStart: startAngle, angleEnd: endAngle };

    // НОВОЕ: старт на орбите (горизонтальная скорость по касательной)
    var startAnglePos = -Math.PI / 2;
    var startX = WORLD.moon.x + Math.cos(startAnglePos) * (WORLD.moon.r + START_HEIGHT);
    var startY = WORLD.moon.y + Math.sin(startAnglePos) * (WORLD.moon.r + START_HEIGHT);

    state = {
      ship: {
        x: startX,
        y: startY,
        vx: ORBIT_SPEED,
        vy: 0,
        angle: Math.PI / 2
      },
      time: 0,
      fuel: FUEL_MAX,
      trail: [{ x: startX, y: startY }],
      status: "idle"
    };
    running = false;
    thrustCenter = false;
    thrustLeft = false;
    thrustRight = false;
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

    // НОВОЕ: три кнопки двигателей
    engineLeftBtn.disabled = !flying;
    engineCenterBtn.disabled = !flying;
    engineRightBtn.disabled = !flying;
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

  // НОВОЕ: вспомогательная функция для отдельного двигателя
  function applyThrust(angleOffset, accel, dt) {
    var angle = state.ship.angle + angleOffset;
    state.ship.vx += Math.cos(angle) * accel * dt;
    state.ship.vy += Math.sin(angle) * accel * dt;
  }

  function stepPhysics(dt) {
    var s = state.ship;

    if (turnLeft) s.angle -= ROTATE_SPEED * Math.PI / 180 * dt;
    if (turnRight) s.angle += ROTATE_SPEED * Math.PI / 180 * dt;

    var g = gravityAt(s.x, s.y);
    s.vx += g.ax * dt;
    s.vy += g.ay * dt;

    var engine = ENGINES[engineSelect.value];
    var throttle = parseFloat(throttleInput.value) / 100;
    var baseAccel = engine.thrust * throttle;
    var fuelUsed = 0;

    // НОВОЕ: три двигателя вместо одного
    // Центральный — прямо назад
    if (thrustCenter && state.fuel > 0) {
      applyThrust(Math.PI, baseAccel, dt);
      fuelUsed += engine.fuelRate * throttle * dt;
    }
    // Левый — назад и вправо
    if (thrustLeft && state.fuel > 0) {
      applyThrust(Math.PI - 0.3, baseAccel * 0.7, dt);
      fuelUsed += engine.fuelRate * throttle * 0.7 * dt;
    }
    // Правый — назад и влево
    if (thrustRight && state.fuel > 0) {
      applyThrust(Math.PI + 0.3, baseAccel * 0.7, dt);
      fuelUsed += engine.fuelRate * throttle * 0.7 * dt;
    }

    if (fuelUsed > 0) {
      state.fuel -= fuelUsed;
      if (state.fuel < 0) state.fuel = 0;
    }

    s.x += s.vx * dt;
    s.y += s.vy * dt;
    state.time += dt;

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

    var dMoon = distanceTo(s.x, s.y, WORLD.moon.x, WORLD.moon.y);
    if (dMoon <= WORLD.moon.r) {
      var speed = speedOf(s);
      var ang = Math.atan2(s.y - WORLD.moon.y, s.x - WORLD.moon.x);
      if (ang < 0) ang += Math.PI * 2;

      // НОВОЕ: зона посадки теперь динамическая
      var a0 = landingZone.angleStart;
      var a1 = landingZone.angleEnd;
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

    if (s.x < -600 || s.x > WORLD.width + 600 || s.y < -600 || s.y > WORLD.height + 600) {
      endGame("lost", "Аппарат улетел в космос", "Слишком сильно разогнался или не туда направил тягу.");
      return;
    }

    if (state.time >= MAX_TIME) {
      endGame("lost", "Время вышло", "Не удалось совершить посадку за отведённое время.");
      return;
    }
  }

  function endGame(status, title, text) {
    state.status = status;
    running = false;
    thrustCenter = false;
    thrustLeft = false;
    thrustRight = false;
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

    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, w, h);

    // НОВОЕ: анимированные звёзды
    drawStars();

    if (!state) return;

    drawMoon();
    drawLandingZone();
    drawTrail();
    drawShip();
  }

  // НОВОЕ: мерцающие и медленно плывущие звёзды
  function drawStars() {
    var t = Date.now() * 0.001;
    for (var i = 0; i < stars.length; i++) {
      var star = stars[i];
      var alpha = star.alpha + Math.sin(t * star.twinkleSpeed * 10 + i) * 0.2;
      alpha = Math.max(0.1, Math.min(1, alpha));
      ctx.fillStyle = "rgba(255,255,255," + alpha + ")";
      var x = (star.x + t * 5) % 1200;
      var y = star.y;
      var screenX = (x / 1200) * canvas.clientWidth;
      var screenY = (y / 800) * canvas.clientHeight;
      ctx.fillRect(screenX, screenY, star.size, star.size);
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

  // НОВОЕ: зона посадки теперь берётся из динамической переменной
  function drawLandingZone() {
    var v = getView();
    var p = toScreen(WORLD.moon.x, WORLD.moon.y);
    var r = WORLD.moon.r * v.scale;

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, landingZone.angleStart, landingZone.angleEnd);
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

    ctx.beginPath();
    ctx.moveTo(size * 1.6, 0);
    ctx.lineTo(-size, size * 0.9);
    ctx.lineTo(-size, -size * 0.9);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    // НОВОЕ: отдельное пламя для каждого из трёх двигателей
    var flameColor = "#ff8c42";
    if (state.status === "flying" && state.fuel > 0) {
      if (thrustCenter) {
        ctx.beginPath();
        ctx.moveTo(-size * 0.7, size * 0.4);
        ctx.lineTo(-size * 1.9, 0);
        ctx.lineTo(-size * 0.7, -size * 0.4);
        ctx.closePath();
        ctx.fillStyle = flameColor;
        ctx.fill();
      }
      if (thrustLeft) {
        ctx.beginPath();
        ctx.moveTo(-size * 0.5, size * 0.8);
        ctx.lineTo(-size * 1.5, size * 1.2);
        ctx.lineTo(-size * 0.5, size * 1.0);
        ctx.closePath();
        ctx.fillStyle = flameColor;
        ctx.fill();
      }
      if (thrustRight) {
        ctx.beginPath();
        ctx.moveTo(-size * 0.5, -size * 0.8);
        ctx.lineTo(-size * 1.5, -size * 1.2);
        ctx.lineTo(-size * 0.5, -size * 1.0);
        ctx.closePath();
        ctx.fillStyle = flameColor;
        ctx.fill();
      }
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

  engineSelect.addEventListener("change", function () {});

  // Старая кнопка «Тяга» — теперь управляет центральным двигателем
  burnBtn.addEventListener("mousedown", function () { if (state && state.status === "flying" && state.fuel > 0) thrustCenter = true; });
  burnBtn.addEventListener("mouseup", function () { thrustCenter = false; });
  burnBtn.addEventListener("mouseleave", function () { thrustCenter = false; });
  burnBtn.addEventListener("touchstart", function (e) { e.preventDefault(); if (state && state.status === "flying" && state.fuel > 0) thrustCenter = true; }, { passive: false });
  burnBtn.addEventListener("touchend", function () { thrustCenter = false; });

  // НОВОЕ: три кнопки двигателей
  engineLeftBtn.addEventListener("mousedown", function () { if (state && state.status === "flying") thrustLeft = true; });
  engineLeftBtn.addEventListener("mouseup", function () { thrustLeft = false; });
  engineLeftBtn.addEventListener("mouseleave", function () { thrustLeft = false; });
  engineLeftBtn.addEventListener("touchstart", function (e) { e.preventDefault(); if (state && state.status === "flying") thrustLeft = true; }, { passive: false });
  engineLeftBtn.addEventListener("touchend", function () { thrustLeft = false; });

  engineCenterBtn.addEventListener("mousedown", function () { if (state && state.status === "flying") thrustCenter = true; });
  engineCenterBtn.addEventListener("mouseup", function () { thrustCenter = false; });
  engineCenterBtn.addEventListener("mouseleave", function () { thrustCenter = false; });
  engineCenterBtn.addEventListener("touchstart", function (e) { e.preventDefault(); if (state && state.status === "flying") thrustCenter = true; }, { passive: false });
  engineCenterBtn.addEventListener("touchend", function () { thrustCenter = false; });

  engineRightBtn.addEventListener("mousedown", function () { if (state && state.status === "flying") thrustRight = true; });
  engineRightBtn.addEventListener("mouseup", function () { thrustRight = false; });
  engineRightBtn.addEventListener("mouseleave", function () { thrustRight = false; });
  engineRightBtn.addEventListener("touchstart", function (e) { e.preventDefault(); if (state && state.status === "flying") thrustRight = true; }, { passive: false });
  engineRightBtn.addEventListener("touchend", function () { thrustRight = false; });

  turnLeftBtn.addEventListener("mousedown", function () { turnLeft = true; });
  turnLeftBtn.addEventListener("mouseup", function () { turnLeft = false; });
  turnLeftBtn.addEventListener("mouseleave", function () { turnLeft = false; });
  turnLeftBtn.addEventListener("touchstart", function (e) { e.preventDefault(); turnLeft = true; }, { passive: false });
  turnLeftBtn.addEventListener("touchend", function () { turnLeft = false; });

  turnRightBtn.addEventListener("mousedown", function () { turnRight = true; });
  turnRightBtn.addEventListener("mouseup", function () { turnRight = false; });
  turnRightBtn.addEventListener("mouseleave", function () { turnRight = false; });
  turnRightBtn.addEventListener("touchstart", function (e) { e.preventDefault(); turnRight = true; }, { passive: false });
  turnRightBtn.addEventListener("tou