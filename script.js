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

  var zoomInBtn = document.getElementById("zoom-in");
  var zoomOutBtn = document.getElementById("zoom-out");
  var zoomResetBtn = document.getElementById("zoom-reset");

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

  var stars = [];
  var landingZone = { angleStart: 0, angleEnd: 0 };

  var state = null;
  var running = false;
  var lastTimestamp = 0;
  var accumulatedTime = 0;
  var STEP = 1 / 120;

  var thrustCenter = false;
  var thrustLeft = false;
  var thrustRight = false;
  var turnLeft = false;
  var turnRight = false;

  var zoom = 1;
  var zoomMin = 0.5;
  var zoomMax = 4;
  var panX = 0;
  var panY = 0;

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

  // ---------- Мир -> экран (с учётом зума и панорамирования) ----------
  function getView() {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    var baseScale = Math.min(w / WORLD.width, h / WORLD.height);
    var scale = baseScale * zoom;

    var worldCenterX = WORLD.width / 2;
    var worldCenterY = WORLD.height / 2;

    var offsetX = w / 2 - (worldCenterX + panX) * scale;
    var offsetY = h / 2 - (worldCenterY + panY) * scale;

    return { scale: scale, offsetX: offsetX, offsetY: offsetY };
  }

  function toScreen(x, y) {
    var v = getView();
    return { x: v.offsetX + x * v.scale, y: v.offsetY + y * v.scale };
  }

  function screenToWorld(sx, sy, z) {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    var baseScale = Math.min(w / WORLD.width, h / WORLD.height);
    var scale = baseScale * z;
    var worldCenterX = WORLD.width / 2;
    var worldCenterY = WORLD.height / 2;

    var offsetX = w / 2 - (worldCenterX + panX) * scale;
    var offsetY = h / 2 - (worldCenterY + panY) * scale;

    return {
      x: (sx - offsetX) / scale,
      y: (sy - offsetY) / scale
    };
  }

  function setZoom(newZoom, focusScreenX, focusScreenY) {
    var oldZoom = zoom;
    zoom = Math.max(zoomMin, Math.min(zoomMax, newZoom));
    if (zoom === oldZoom) return;

    if (focusScreenX != null && focusScreenY != null) {
      var before = screenToWorld(focusScreenX, focusScreenY, oldZoom);
      var after = screenToWorld(focusScreenX, focusScreenY, zoom);
      panX += before.x - after.x;
      panY += before.y - after.y;
    }

    render();
  }

  function resetZoom() {
    zoom = 1;
    panX = 0;
    panY = 0;
    render();
  }

  // ---------- Состояние ----------
  function resetState() {
    // Случайная посадочная зона (верхняя полусфера)
    var startAngle = Math.PI * (0.15 + Math.random() * 0.7);
    var endAngle = startAngle + Math.PI * (0.15 + Math.random() * 0.1);
    landingZone = { angleStart: startAngle, angleEnd: endAngle };

    // Старт строго сверху над Луной
    var startAnglePos = -Math.PI / 2;
    var startX = WORLD.moon.x + Math.cos(startAnglePos) * (WORLD.moon.r + START_HEIGHT);
    var startY = WORLD.moon.y + Math.sin(startAnglePos) * (WORLD.moon.r + START_HEIGHT);

    state = {
      ship: {
        x: startX,
        y: startY,
        vx: 0,                  // <-- ИСПРАВЛЕНО: больше не летит вбок
        vy: 0,
        angle: Math.PI / 2      // нос смотрит вниз (к Луне)
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

    zoom = 1;
    panX = 0;
    panY = 0;

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

  // angleOffset считается ОТ носа корабля: PI = прямо назад
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

    // Центральный двигатель — строго назад (вверх от Луны при старте)
    if (thrustCenter && state.fuel > 0) {
      applyThrust(Math.PI, baseAccel, dt);
      fuelUsed += engine.fuelRate * throttle * dt;
    }
    // Левый — назад и вбок
    if (thrustLeft && state.fuel > 0) {
      applyThrust(Math.PI - 0.3, baseAccel * 0.7, dt);
      fuelUsed += engine.fuelRate * throttle * 0.7 * dt;
    }
    // Правый — назад и вбок
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

    drawStars();

    if (!state) return;

    drawMoon();
    drawLandingZone();
    drawTrail();
    drawShip();
  }

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

    // Корпус: нос смотрит в +X
    ctx.beginPath();
    ctx.moveTo(size * 1.6, 0);
    ctx.lineTo(-size, size * 0.9);
    ctx.lineTo(-size, -size * 0.9);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    // Пламя: бьёт в -X (назад от носа)
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

  // ---------- События интерфейса ----------
  throttleInput.addEventListener("input", function () {
    throttleValue.textContent = throttleInput.value + "%";
  });

  engineSelect.addEventListener("change", function () {});

  // Кнопка «Тяга» = центральный двигатель
  burnBtn.addEventListener("mousedown", function () { if (state && state.status === "flying" && state.fuel > 0) thrustCenter = true; });
  burnBtn.addEventListener("mouseup", function () { thrustCenter = false; });
  burnBtn.addEventListener("mouseleave", function () { thrustCenter = false; });
  burnBtn.addEventListener("touchstart", function (e) { e.preventDefault(); if (state && state.status === "flying" && state.fuel > 0) thrustCenter = true; }, { passive: false });
  burnBtn.addEventListener("touchend", function () { thrustCenter = false; });

  // Три отдельных двигателя
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

  // Повороты
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

  // Зум кнопками
  zoomInBtn.addEventListener("click", function () { setZoom(zoom * 1.25); });
  zoomOutBtn.addEventListener("click", function () { setZoom(zoom / 1.25); });
  zoomResetBtn.addEventListener("click", resetZoom);

  // Зум колесом мыши
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom(zoom * factor, mx, my);
  }, { passive: false });

  // Pinch-to-zoom + панорамирование одним пальцем
  var activeTouches = {};
  var lastPinchDist = 0;

  canvas.addEventListener("touchstart", function (e) {
    if (e.touches.length === 1) {
      activeTouches[e.touches[0].identifier] = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist = Math.sqrt(dx * dx + dy * dy);
      activeTouches = {};
    }
  }, { passive: true });

  canvas.addEventListener("touchmove", function (e) {
    if (e.touches.length === 1 && activeTouches[e.touches[0].identifier]) {
      var prev = activeTouches[e.touches[0].identifier];
      var cur = e.touches[0];
      var dxScreen = cur.clientX - prev.x;
      var dyScreen = cur.clientY - prev.y;

      var v = getView();
      panX -= dxScreen / v.scale;
      panY -= dyScreen / v.scale;

      activeTouches[e.touches[0].identifier] = { x: cur.clientX, y: cur.clientY };
      render();
      e.preventDefault();
    } else if (e.touches.length === 2) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (lastPinchDist > 0) {
        var factor = dist / lastPinchDist;
        var midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        var midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        var rect = canvas.getBoundingClientRect();
        setZoom(zoom * factor, midX - rect.left, midY - rect.top);
      }
      lastPinchDist = dist;
      e.preventDefault();
    }
  }, { passive: false });

  canvas.addEventListener("touchend", function (e) {
    for (var id in activeTouches) {
      var found = false;
      for (var i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier == id) { found = true; break; }
      }
      if (!found) delete activeTouches[id];
    }
    if (e.touches.length < 2) lastPinchDist = 0;
  }, { passive: true });

  // Клавиатура
  document.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if (state && state.status === "flying") {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "ф") { turnLeft = true; e.preventDefault(); }
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "в") { turnRight = true; e.preventDefault(); }
      if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "ц") {
        if (state.fuel > 0) thrustCenter = true;
        e.preventDefault();
      }
      if (e.key === "q" || e.key === "й") {
        if (state.fuel > 0) thrustLeft = true;
        e.preventDefault();
      }
      if (e.key === "e" || e.key === "у") {
        if (state.fuel > 0) thrustRight = true;
        e.preventDefault();
      }
    }
    if (e.key === "+" || e.key === "=") { setZoom(zoom * 1.15); e.preventDefault(); }
    if (e.key === "-" || e.key === "_") { setZoom(zoom / 1.15); e.preventDefault(); }
    if (e.key === "0") { resetZoom(); e.preventDefault(); }

    if (e.key === "Enter") {
      if (state && state.status === "idle") startFlight();
      else if (state && (state.status === "won" || state.status === "lost")) resetGame();
      e.preventDefault();
    }
  });

  document.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "ф") turnLeft = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "в") turnRight = false;
    if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "ц") thrustCenter = false;
    if (e.key === "q" || e.key === "й") thrustLeft = false;
    if (e.key === "e" || e.key === "у") thrustRight = false;
  });

  // ---------- Старт ----------
  fitCanvas();
  initStars();
  resetState();
  throttleValue.textContent = throttleInput.value + "%";
  updateAngleLabel();
  requestAnimationFrame(loop);
})();