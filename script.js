(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  var hudTime = document.getElementById("hud-time");
  var hudSpeed = document.getElementById("hud-speed");
  var hudDv = document.getElementById("hud-dv");
  var hudBurns = document.getElementById("hud-burns");
  var hudTarget = document.getElementById("hud-target");

  // Получаем элементы управления
  var powerInput = document.getElementById("power");
  var azimuthInput = document.getElementById("azimuth");
  var powerValue = document.getElementById("power-value");
  var azimuthValue = document.getElementById("azimuth-value");
  
  // Скрываем ползунок возвышения, так как управляем только в плоскости
  var elevationRow = document.getElementById("elevation").parentElement;
  if (elevationRow) elevationRow.style.display = "none";

  var startBtn = document.getElementById("start-btn");
  var burnBtn = document.getElementById("burn-btn");
  var resetBtn = document.getElementById("reset-btn");
  var restartBtn = document.getElementById("restart-btn");

  var messageBox = document.getElementById("message");
  var messageTitle = document.getElementById("message-title");
  var messageText = document.getElementById("message-text");

  // ---------- Мир 3D ----------
  var WORLD = {
    earth: { x: -220, y: -40, z: -60, r: 70 },
    moon:  { x:  260, y:  70, z:  40, r: 45 }
  };

  var G_EARTH = 4200;
  var G_MOON = 620;
  var START_ORBIT_OFFSET = 90;
  var START_SPEED = 55;
  var BURN_STRENGTH = 1.15;
  var MAX_BURNS = 3;
  var MAX_TIME = 150;

  // ---------- Камера ----------
  var camera = {
    yaw: 0.6,
    pitch: 0.25,
    distance: 900,
    target: { x: 20, y: 10, z: -10 },
    fov: 60
  };

  // ---------- Состояние ----------
  var state = null;
  var running = false;
  var lastTimestamp = 0;
  var accumulatedTime = 0;
  var STEP = 1 / 120;

  // ---------- Canvas ----------
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

  // ---------- 3D → 2D проекция ----------
  function project(p) {
    var dx = p.x - camera.target.x;
    var dy = p.y - camera.target.y;
    var dz = p.z - camera.target.z;

    var cosY = Math.cos(-camera.yaw);
    var sinY = Math.sin(-camera.yaw);
    var rx = dx * cosY - dz * sinY;
    var rz = dx * sinY + dz * cosY;
    var ry = dy;

    var cosP = Math.cos(-camera.pitch);
    var sinP = Math.sin(-camera.pitch);
    var ry2 = ry * cosP - rz * sinP;
    var rz2 = ry * sinP + rz * cosP;

    var camZ = rz2 + camera.distance;
    if (camZ <= 1) return null;

    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    var f = (h / 2) / Math.tan((camera.fov * Math.PI / 180) / 2);

    var sx = w / 2 + (rx * f) / camZ;
    var sy = h / 2 - (ry2 * f) / camZ;

    return { x: sx, y: sy, depth: camZ, scale: f / camZ };
  }

  // ---------- Векторные операции ----------
  function v3(x, y, z) { return { x: x, y: y, z: z }; }
  function length(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
  function dist(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // ---------- Рандомные зоны посадки ----------
  function randomLandingZones(count) {
    var zones = [];
    for (var i = 0; i < count; i++) {
      var u = Math.random() * 2 - 1;
      var phi = Math.random() * Math.PI * 2;
      var theta = Math.acos(u);
      if (theta < 0.35) theta = 0.35 + Math.random() * 0.2;
      if (theta > Math.PI - 0.35) theta = Math.PI - 0.35 - Math.random() * 0.2;

      var dx = Math.sin(theta) * Math.cos(phi);
      var dy = Math.cos(theta);
      var dz = Math.sin(theta) * Math.sin(phi);
      zones.push({ dir: v3(dx, dy, dz), r: 0.28 + Math.random() * 0.12, id: i + 1 });
    }
    zones.sort(function (a, b) { return a.id - b.id; });
    return zones;
  }

  function insideZone(point, moon, zone) {
    var dx = point.x - moon.x, dy = point.y - moon.y, dz = point.z - moon.z;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len === 0) return false;
    dx /= len; dy /= len; dz /= len;

    var dot = dx * zone.dir.x + dy * zone.dir.y + dz * zone.dir.z;
    var angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    return angle <= zone.r;
  }

  // ---------- Стартовое состояние ----------
  function resetState() {
    var e = WORLD.earth, m = WORLD.moon;

    var dirToMoon = v3(m.x - e.x, m.y - e.y, m.z - e.z);
    var len = length(dirToMoon);
    dirToMoon.x /= len; dirToMoon.y /= len; dirToMoon.z /= len;

    var startR = e.r + START_ORBIT_OFFSET;
    var sx = e.x + dirToMoon.x * startR;
    var sy = e.y + dirToMoon.y * startR;
    var sz = e.z + dirToMoon.z * startR;

    var up = v3(0, 1, 0);
    var tangent = v3(
      dirToMoon.y * up.z - dirToMoon.z * up.y,
      dirToMoon.z * up.x - dirToMoon.x * up.z,
      dirToMoon.x * up.y - dirToMoon.y * up.x
    );
    var tlen = length(tangent) || 1;
    tangent.x /= tlen; tangent.y /= tlen; tangent.z /= tlen;

    state = {
      ship: {
        x: sx, y: sy, z: sz,
        vx: tangent.x * START_SPEED,
        vy: tangent.y * START_SPEED,
        vz: tangent.z * START_SPEED
      },
      time: 0, dv: 0, burnsLeft: MAX_BURNS,
      trail: [v3(sx, sy, sz)], status: "idle",
      zones: randomLandingZones(3)
    };

    running = false; accumulatedTime = 0; lastTimestamp = 0;

    hudTarget.textContent = "1–3";
    updateHud();
    hideMessage();
    updateButtons();
  }

  // ---------- HUD ----------
  function shipSpeed() {
    var s = state.ship;
    return Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
  }

  function updateHud() {
    if (!state) return;
    hudTime.textContent = state.time.toFixed(1) + " с";
    hudSpeed.textContent = shipSpeed().toFixed(1);
    hudDv.textContent = state.dv.toFixed(1);
    hudBurns.textContent = String(state.burnsLeft);
  }

  function updateButtons() {
    var flying = state && state.status === "flying";
    var finished = state && (state.status === "won" || state.status === "lost");

    startBtn.disabled = flying || finished;
    burnBtn.disabled = !flying || state.burnsLeft <= 0;
    resetBtn.disabled = false;
    
    // Не блокируем ползунки, чтобы можно было настраивать импульс в полёте
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
  function accelAt(p) {
    var e = WORLD.earth, m = WORLD.moon;

    var dxE = e.x - p.x, dyE = e.y - p.y, dzE = e.z - p.z;
    var dE2 = dxE * dxE + dyE * dyE + dzE * dzE;
    var dE = Math.sqrt(dE2) || 1;
    var aE = G_EARTH / dE2;
    var axE = aE * (dxE / dE), ayE = aE * (dyE / dE), azE = aE * (dzE / dE);

    var dxM = m.x - p.x, dyM = m.y - p.y, dzM = m.z - p.z;
    var dM2 = dxM * dxM + dyM * dyM + dzM * dzM;
    var dM = Math.sqrt(dM2) || 1;
    var aM = G_MOON / dM2;
    var axM = aM * (dxM / dM), ayM = aM * (dyM / dM), azM = aM * (dzM / dM);

    return { ax: axE + axM, ay: ayE + ayM, az: azE + azM };
  }

  function stepPhysics(dt) {
    var s = state.ship;
    var a = accelAt(s);

    s.vx += a.ax * dt; s.vy += a.ay * dt; s.vz += a.az * dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    state.time += dt;

    var trail = state.trail, last = trail[trail.length - 1];
    var dx = s.x - last.x, dy = s.y - last.y, dz = s.z - last.z;
    if (dx * dx + dy * dy + dz * dz > 4) {
      trail.push(v3(s.x, s.y, s.z));
      if (trail.length > 2500) trail.shift();
    }
    checkEndConditions();
  }

  function checkEndConditions() {
    var s = state.ship;

    if (dist(s, WORLD.earth) <= WORLD.earth.r) {
      endGame("lost", "Аппарат упал на Землю", "Попробуй другой угол или силу импульса.");
      return;
    }

    if (dist(s, WORLD.moon) <= WORLD.moon.r) {
      var hitZone = null;
      for (var i = 0; i < state.zones.length; i++) {
        if (insideZone(s, WORLD.moon, state.zones[i])) {
          hitZone = state.zones[i]; break;
        }
      }
      if (hitZone) {
        endGame("won", "Успешная посадка!", "Попал в зону №" + hitZone.id + ". Время: " + state.time.toFixed(1) + " с, ΔV: " + state.dv.toFixed(1));
      } else {
        endGame("lost", "Жёсткая посадка мимо зоны", "Аппарат коснулся Луны вне отмеченной зоны.");
      }
      return;
    }

    if (Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z) > 2500) {
      endGame("lost", "Аппарат улетел в открытый космос", "Импульс оказался слишком сильным.");
      return;
    }

    if (state.time >= MAX_TIME) {
      endGame("lost", "Время вышло", "Не удалось достичь Луны за отведённое время.");
    }
  }

  function endGame(status, title, text) {
    state.status = status; running = false;
    updateButtons(); updateHud();
    showMessage(title, text); render();
  }

  // ---------- Отрисовка ----------
  function render() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#05060a"; ctx.fillRect(0, 0, w, h);
    drawStars();

    if (!state) return;

    var drawables = [
      { kind: "sphere", body: WORLD.earth, color1: "#2b6fd6", color2: "#1a4a94", label: "Земля" },
      { kind: "sphere", body: WORLD.moon,  color1: "#9aa4b8", color2: "#6a7386", label: "Луна" }
    ];

    for (var i = 0; i < state.zones.length; i++) {
      drawables.push({ kind: "zone", zone: state.zones[i] });
    }

    drawPredictionTrail(); // Рисуем предсказание до реальной траектории
    drawTrail();

    for (var j = 0; j < drawables.length; j++) {
      var d = drawables[j];
      var c = (d.kind === "sphere") ? project(d.body) : project(zoneCenterWorld(d.zone));
      d.depth = c ? c.depth : Infinity;
    }
    drawables.sort(function (a, b) { return b.depth - a.depth; });

    for (var k = 0; k < drawables.length; k++) {
      var item = drawables[k];
      if (item.kind === "sphere") drawSphere(item.body, item.color1, item.color2, item.label);
      else if (item.kind === "zone") drawZone(item.zone);
    }

    drawShip();
  }

  function drawStars() {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (var i = 0; i < 70; i++) {
      ctx.fillRect(((i * 137.5) % 1000) / 1000 * canvas.clientWidth, ((i * 91.7) % 700) / 700 * canvas.clientHeight, 1.5, 1.5);
    }
  }

  function drawSphere(body, color1, color2, label) {
    var p = project(body); if (!p) return;
    var r = body.r * p.scale; if (r < 1) return;

    var grad = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, r * 0.1, p.x, p.y, r);
    grad.addColorStop(0, color1); grad.addColorStop(1, color2);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad; ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(label, p.x, p.y + r + 16);
  }

  function zoneCenterWorld(zone) {
    var m = WORLD.moon;
    return v3(m.x + zone.dir.x * m.r, m.y + zone.dir.y * m.r, m.z + zone.dir.z * m.r);
  }

  function drawZone(zone) {
    var m = WORLD.moon, center = project(zoneCenterWorld(zone));
    if (!center) return;

    var rScreen = m.r * center.scale * Math.sin(zone.r); if (rScreen < 2) return;
    var c = zoneCenterWorld(zone);
    var toCam = v3(camera.target.x - c.x, camera.target.y - c.y, camera.target.z - c.z);
    var len = length(toCam) || 1;
    toCam.x /= len; toCam.y /= len; toCam.z /= len;
    var alpha = Math.max(0.15, Math.min(1, ((toCam.x*zone.dir.x + toCam.y*zone.dir.y + toCam.z*zone.dir.z) + 0.3) / 1.3));

    ctx.beginPath(); ctx.arc(center.x, center.y, rScreen, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 215, 106, " + (alpha * 0.35) + ")"; ctx.fill();
    ctx.strokeStyle = "rgba(255, 215, 106, " + alpha + ")"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "rgba(255, 215, 106, " + alpha + ")";
    ctx.font = "bold 12px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(String(zone.id), center.x, center.y + 4);
  }

  // Рисуем примерную траекторию (пунктир)
  function drawPredictionTrail() {
    if (!state || state.status !== "flying") return;

    var power = parseFloat(powerInput.value);
    var azRad = parseFloat(azimuthInput.value) * Math.PI / 180;
    var dv = power * BURN_STRENGTH;

    // Вектор гипотетического импульса (только по осям X и Z, для наглядности)
    var pvx = Math.cos(azRad) * dv;
    var pvy = 0; 
    var pvz = Math.sin(azRad) * dv;

    var sim = {
      x: state.ship.x, y: state.ship.y, z: state.ship.z,
      vx: state.ship.vx + pvx, vy: state.ship.vy + pvy, vz: state.ship.vz + pvz
    };

    var points = [];
    var simDt = 1 / 30; // Шаг для симуляции
    for (var i = 0; i < 80; i++) {
      var a = accelAt(sim);
      sim.vx += a.ax * simDt; sim.vy += a.ay * simDt; sim.vz += a.az * simDt;
      sim.x += sim.vx * simDt; sim.y += sim.vy * simDt; sim.z += sim.vz * simDt;
      
      points.push(v3(sim.x, sim.y, sim.z));

      // Если предсказанная траектория врезалась в Землю или Луну, прекращаем
      if (dist(sim, WORLD.earth) <= WORLD.earth.r || dist(sim, WORLD.moon) <= WORLD.moon.r) break;
    }

    ctx.beginPath();
    var started = false;
    for (var j = 0; j < points.length; j++) {
      var p = project(points[j]);
      if (!p) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]); // Сбрасываем обратно
  }

  function drawTrail() {
    if (!state.trail || state.trail.length < 2) return;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < state.trail.length; i++) {
      var p = project(state.trail[i]);
      if (!p) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = "rgba(120, 200, 255, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawShip() {
    var p = project(state.ship); if (!p) return;
    var size = Math.max(4, Math.min(14, 10 * p.scale));
    var s = state.ship;
    var sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz) || 1;
    var ahead = v3(s.x + (s.vx / sp) * 10, s.y + (s.vy / sp) * 10, s.z + (s.vz / sp) * 10);
    var pa = project(ahead);
    var ang = pa ? Math.atan2(pa.y - p.y, pa.x - p.x) : 0;

    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(size * 1.6, 0); ctx.lineTo(-size, size * 0.9); ctx.lineTo(-size, -size * 0.9); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.restore();
  }

  // ---------- Игровой цикл ----------
  function loop(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    var dt = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp; if (dt > 0.1) dt = 0.1;

    if (running && state && state.status === "flying") {
      accumulatedTime += dt;
      while (accumulatedTime >= STEP) {
        stepPhysics(STEP); accumulatedTime -= STEP;
        if (!running || state.status !== "flying") break;
      }
      updateHud();
    }
    render();
    requestAnimationFrame(loop);
  }

  // ---------- Управление ----------
  function startFlight() {
    if (!state || state.status === "flying" || state.status === "won" || state.status === "lost") return;
    state.status = "flying"; running = true; lastTimestamp = 0; accumulatedTime = 0;
    hideMessage(); updateButtons();
  }

  function applyBurn() {
    if (!state || state.status !== "flying" || state.burnsLeft <= 0) return;

    var power = parseFloat(powerInput.value);
    var azRad = parseFloat(azimuthInput.value) * Math.PI / 180;
    var dv = power * BURN_STRENGTH;

    // Применяем импульс строго в плоскости X-Z (без изменения Y, чтобы не улететь случайно)
    state.ship.vx += Math.cos(azRad) * dv;
    state.ship.vz += Math.sin(azRad) * dv;

    state.dv += dv; state.burnsLeft -= 1;
    updateHud(); updateButtons();
  }

  function resetGame() { resetState(); render(); }

  // ---------- Обработчики ----------
  powerInput.addEventListener("input", function () { powerValue.textContent = powerInput.value; });
  azimuthInput.addEventListener("input", function () { azimuthValue.textContent = azimuthInput.value + "°"; });

  startBtn.addEventListener("click", startFlight);
  burnBtn.addEventListener("click", applyBurn);
  resetBtn.addEventListener("click", resetGame);
  restartBtn.addEventListener("click", resetGame);

  // Обработка клавиатуры: стрелки меняют ползунки
  document.addEventListener("keydown", function (e) {
    // Предотвращаем скролл страницы стрелками
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
      e.preventDefault();
    }

    var step = e.shiftKey ? 5 : 1; // С зажатым Shift меняем быстрее

    if (e.key === "ArrowUp") {
      powerInput.value = Math.min(100, parseInt(powerInput.value, 10) + step);
      powerValue.textContent = powerInput.value;
    } else if (e.key === "ArrowDown") {
      powerInput.value = Math.max(0, parseInt(powerInput.value, 10) - step);
      powerValue.textContent = powerInput.value;
    } else if (e.key === "ArrowRight") {
      var az = parseInt(azimuthInput.value, 10) + step;
      if (az >= 360) az -= 360;
      azimuthInput.value = az;
      azimuthValue.textContent = az + "°";
    } else if (e.key === "ArrowLeft") {
      var az2 = parseInt(azimuthInput.value, 10) - step;
      if (az2 < 0) az2 += 360;
      azimuthInput.value = az2;
      azimuthValue.textContent = az2 + "°";
    } else if (e.key === " " || e.key === "Spacebar") {
      applyBurn();
    } else if (e.key === "Enter") {
      if (state && state.status === "idle") startFlight();
      else if (state && (state.status === "won" || state.status === "lost")) resetGame();
    }
  });

  // ---------- Старт ----------
  fitCanvas();
  resetState();
  requestAnimationFrame(loop);
})();
