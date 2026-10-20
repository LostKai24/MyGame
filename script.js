(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  var hudTime = document.getElementById("hud-time");
  var hudSpeed = document.getElementById("hud-speed");
  var hudFuel = document.getElementById("hud-fuel");
  var hudTarget = document.getElementById("hud-target");

  var engineContainer = document.getElementById("engine-container");
  var engineBtns = engineContainer.querySelectorAll(".engine-btn");
  var fuelSlider = document.getElementById("fuel-slider");
  var fuelValue = document.getElementById("fuel-value");

  var startBtn = document.getElementById("start-btn");
  var burnBtn = document.getElementById("burn-btn");
  var resetBtn = document.getElementById("reset-btn");
  var restartBtn = document.getElementById("restart-btn");
  
  var rcsLeftBtn = document.getElementById("rcs-left");
  var rcsRightBtn = document.getElementById("rcs-right");
  var rcsDownBtn = document.getElementById("rcs-down");

  var messageBox = document.getElementById("message");
  var messageTitle = document.getElementById("message-title");
  var messageText = document.getElementById("message-text");

  var WORLD = {
    earth: { x: -220, y: -40, z: -60, r: 70 },
    moon:  { x:  260, y:  70, z:  40, r: 45 }
  };

  var G_EARTH = 4200;
  var G_MOON = 620;
  var START_ORBIT_OFFSET = 90;
  var START_SPEED = 55;
  var MAX_TIME = 300;
  var LANDING_SPEED_LIMIT = 15; // Максимальная скорость для успешной посадки

  var ENGINES = [
    { force: 10 },
    { force: 25 },
    { force: 50 }
  ];
  var currentEngine = 1;

  var camera = { yaw: 0.6, pitch: 0.25, distance: 900, target: { x: 20, y: 10, z: -10 }, fov: 60 };

  var state = null;
  var running = false;
  var lastTimestamp = 0;
  var accumulatedTime = 0;
  var STEP = 1 / 120;
  
  // Переменные управления
  var engineThrusting = false;
  var rcsLeft = false;
  var rcsRight = false;
  var rcsDown = false;
  var keys = { left: false, right: false, down: false };

  function fitCanvas() {
    var wrap = canvas.parentElement;
    var dpr = window.devicePixelRatio || 1;
    var w = wrap.clientWidth, h = wrap.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", function () { fitCanvas(); render(); });

  function project(p) {
    var dx = p.x - camera.target.x, dy = p.y - camera.target.y, dz = p.z - camera.target.z;
    var cosY = Math.cos(-camera.yaw), sinY = Math.sin(-camera.yaw);
    var rx = dx * cosY - dz * sinY, rz = dx * sinY + dz * cosY, ry = dy;
    var cosP = Math.cos(-camera.pitch), sinP = Math.sin(-camera.pitch);
    var ry2 = ry * cosP - rz * sinP, rz2 = ry * sinP + rz * cosP;
    var camZ = rz2 + camera.distance;
    if (camZ <= 1) return null;

    var w = canvas.clientWidth, h = canvas.clientHeight;
    var f = (h / 2) / Math.tan((camera.fov * Math.PI / 180) / 2);
    var sx = w / 2 + (rx * f) / camZ, sy = h / 2 - (ry2 * f) / camZ;
    return { x: sx, y: sy, depth: camZ, scale: f / camZ };
  }

  function v3(x, y, z) { return { x: x, y: y, z: z }; }
  function length(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
  function dist(a, b) { return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2); }

  // ---------- Зоны посадки (Синие дуги) ----------
  function randomLandingZones(count) {
    var zones = [];
    for (var i = 0; i < count; i++) {
      // Случайная точка на сфере (широта/долгота)
      var u = Math.random() * 2 - 1;
      var phi = Math.random() * Math.PI * 2;
      var theta = Math.acos(u);
      if (theta < 0.35) theta = 0.35 + Math.random() * 0.2;
      if (theta > Math.PI - 0.35) theta = Math.PI - 0.35 - Math.random() * 0.2;

      var dx = Math.sin(theta) * Math.cos(phi);
      var dy = Math.cos(theta);
      var dz = Math.sin(theta) * Math.sin(phi);

      // Задаем дугу: угловой радиус
      zones.push({ 
        dir: v3(dx, dy, dz), 
        radius: 0.20 + Math.random() * 0.1, // Размер дуги (радианы)
        id: i + 1 
      });
    }
    return zones;
  }

  // Проверка: попали ли мы в зону касания
  function checkLandedInZone(point, moon, zone) {
    var dx = point.x - moon.x, dy = point.y - moon.y, dz = point.z - moon.z;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len === 0) return false;
    dx /= len; dy /= len; dz /= len;

    var dot = dx * zone.dir.x + dy * zone.dir.y + dz * zone.dir.z;
    var angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    
    // Мы в зоне, если угол между точкой касания и центром зоны меньше углового радиуса
    return angle <= zone.radius;
  }

  function resetState() {
    var e = WORLD.earth, m = WORLD.moon;
    var dirToMoon = v3(m.x - e.x, m.y - e.y, m.z - e.z);
    var len = length(dirToMoon);
    dirToMoon.x /= len; dirToMoon.y /= len; dirToMoon.z /= len;

    var startR = e.r + START_ORBIT_OFFSET;
    var sx = e.x + dirToMoon.x * startR, sy = e.y + dirToMoon.y * startR, sz = e.z + dirToMoon.z * startR;

    var up = v3(0, 1, 0);
    var tangent = v3(
      dirToMoon.y * up.z - dirToMoon.z * up.y,
      dirToMoon.z * up.x - dirToMoon.x * up.z,
      dirToMoon.x * up.y - dirToMoon.y * up.x
    );
    var tlen = length(tangent) || 1;
    tangent.x /= tlen; tangent.y /= tlen; tangent.z /= tlen;

    var startFuel = parseFloat(fuelSlider.value);

    state = {
      ship: { x: sx, y: sy, z: sz, vx: tangent.x * START_SPEED, vy: tangent.y * START_SPEED, vz: tangent.z * START_SPEED },
      time: 0, fuel: startFuel,
      trail: [v3(sx, sy, sz)], status: "idle",
      zones: randomLandingZones(2), // Всего 2 зоны (как дуги)
      heading: 90
    };

    running = false; accumulatedTime = 0; lastTimestamp = 0;
    engineThrusting = false; rcsLeft = false; rcsRight = false; rcsDown = false;
    
    hudTarget.textContent = "1–2";
    updateHud(); hideMessage(); updateButtons();
  }

  function shipSpeed() {
    var s = state.ship;
    return Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
  }

  function updateHud() {
    if (!state) return;
    hudTime.textContent = state.time.toFixed(1) + " с";
    hudSpeed.textContent = shipSpeed().toFixed(1);
    hudFuel.textContent = Math.max(0, state.fuel).toFixed(1);
  }

  function updateButtons() {
    var flying = state && state.status === "flying";
    var finished = state && (state.status === "won" || state.status === "lost");

    startBtn.disabled = flying || finished;
    resetBtn.disabled = false;
    burnBtn.disabled = !flying || state.fuel <= 0;
    
    rcsLeftBtn.disabled = !flying || state.fuel <= 0;
    rcsRightBtn.disabled = !flying || state.fuel <= 0;
    rcsDownBtn.disabled = !flying || state.fuel <= 0;
    
    fuelSlider.disabled = flying || finished;
    engineBtns.forEach(b => b.disabled = flying || finished);
  }

  function showMessage(title, text) {
    messageTitle.textContent = title; messageText.textContent = text;
    messageBox.classList.remove("hidden");
  }
  function hideMessage() { messageBox.classList.add("hidden"); }

  function accelAt(p) {
    var e = WORLD.earth, m = WORLD.moon;
    var dxE = e.x - p.x, dyE = e.y - p.y, dzE = e.z - p.z;
    var dE2 = dxE*dxE + dyE*dyE + dzE*dzE;
    var dE = Math.sqrt(dE2) || 1;
    var aE = G_EARTH / dE2;
    var axE = aE * (dxE/dE), ayE = aE * (dyE/dE), azE = aE * (dzE/dE);

    var dxM = m.x - p.x, dyM = m.y - p.y, dzM = m.z - p.z;
    var dM2 = dxM*dxM + dyM*dyM + dzM*dzM;
    var dM = Math.sqrt(dM2) || 1;
    var aM = G_MOON / dM2;
    var axM = aM * (dxM/dM), ayM = aM * (dyM/dM), azM = aM * (dzM/dM);

    return { ax: axE + axM, ay: ayE + ayM, az: azE + azM };
  }

  function stepPhysics(dt) {
    var s = state.ship;
    var a = accelAt(s);

    var force = 0;
    if (engineThrusting && state.fuel > 0) {
      force = ENGINES[currentEngine].force;
      state.fuel -= force * dt * 0.5;
      if (state.fuel < 0) state.fuel = 0;
    }

    // Маршевый двигатель
    var rad = state.heading * Math.PI / 180;
    var thrustX = Math.cos(rad) * force;
    var thrustZ = Math.sin(rad) * force;

    // RCS двигатели (боковые и тормозные)
    var rcsForce = 15; 
    var rcsX = 0, rcsZ = 0;
    
    if (state.fuel > 0) {
      // Поворот влево/вправо (используем боковую тягу)
      if (rcsLeft || keys.left) {
        state.heading = (state.heading - 90 * dt) % 360;
        if (state.heading < 0) state.heading += 360;
        rcsX += -Math.sin(rad) * rcsForce; // Толкаем вбок
        rcsZ += Math.cos(rad) * rcsForce;
        state.fuel -= rcsForce * dt * 0.1;
      }
      if (rcsRight || keys.right) {
        state.heading = (state.heading + 90 * dt) % 360;
        rcsX += Math.sin(rad) * rcsForce;
        rcsZ += -Math.cos(rad) * rcsForce;
        state.fuel -= rcsForce * dt * 0.1;
      }
      // Торможение (толкаем назад)
      if (rcsDown || keys.down) {
        rcsX += -Math.cos(rad) * rcsForce;
        rcsZ += -Math.sin(rad) * rcsForce;
        state.fuel -= rcsForce * dt * 0.1;
      }
    }

    s.vx += (a.ax + thrustX + rcsX) * dt;
    s.vy += a.ay * dt;
    s.vz += (a.az + thrustZ + rcsZ) * dt;
    
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    state.time += dt;

    var trail = state.trail, last = trail[trail.length - 1];
    if (dist(s, last) > 4) {
      trail.push(v3(s.x, s.y, s.z));
      if (trail.length > 2500) trail.shift();
    }
    checkEndConditions();
  }

  function checkEndConditions() {
    var s = state.ship;

    if (dist(s, WORLD.earth) <= WORLD.earth.r) {
      endGame("lost", "Аппарат упал на Землю", "Вы слишком близко подошли к Земле."); return;
    }

    if (dist(s, WORLD.moon) <= WORLD.moon.r) {
      var speed = shipSpeed();
      if (speed > LANDING_SPEED_LIMIT) {
        endGame("lost", "Слишком высокая скорость!", "Вы разбились о Луну. Скорость при касании: " + speed.toFixed(1) + " (Максимум: " + LANDING_SPEED_LIMIT + ").");
        return;
      }
      
      var hitZone = null;
      for (var i = 0; i < state.zones.length; i++) {
        if (checkLandedInZone(s, WORLD.moon, state.zones[i])) {
          hitZone = state.zones[i]; break;
        }
      }
      if (hitZone) {
        endGame("won", "Мягкая посадка!", "Вы прилунились на площадку №" + hitZone.id + ". Скорость: " + speed.toFixed(1));
      } else {
        endGame("lost", "Посадка вне зоны", "Вы коснулись Луны, но не попали в синюю посадочную зону.");
      }
      return;
    }

    if (Math.sqrt(s.x*s.x + s.y*s.y + s.z*s.z) > 2500) {
      endGame("lost", "Аппарат улетел в космос", "Потерян в открытом космосе."); return;
    }
    if (state.time >= MAX_TIME) {
      endGame("lost", "Время вышло", "Прошло слишком много времени."); return;
    }
  }

  function endGame(status, title, text) {
    state.status = status; running = false; 
    engineThrusting = false; rcsLeft = false; rcsRight = false; rcsDown = false;
    updateButtons(); updateHud(); showMessage(title, text); render();
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
    for (var i = 0; i < state.zones.length; i++) drawables.push({ kind: "zone", zone: state.zones[i] });

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
    for (var i = 0; i < 70; i++) ctx.fillRect(((i*137.5)%1000)/1000 * canvas.clientWidth, ((i*91.7)%700)/700 * canvas.clientHeight, 1.5, 1.5);
  }

  function drawSphere(body, color1, color2, label) {
    var p = project(body); if (!p) return;
    var r = body.r * p.scale; if (r < 1) return;

    var grad = ctx.createRadialGradient(p.x - r*0.3, p.y - r*0.3, r*0.1, p.x, p.y, r);
    grad.addColorStop(0, color1); grad.addColorStop(1, color2);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2);
    ctx.fillStyle = grad; ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = "12px system-ui"; ctx.textAlign = "center"; ctx.fillText(label, p.x, p.y + r + 16);
  }

  function zoneCenterWorld(zone) {
    var m = WORLD.moon;
    return v3(m.x + zone.dir.x * m.r, m.y + zone.dir.y * m.r, m.z + zone.dir.z * m.r);
  }

  // Отрисовка синей дуги (посадочной зоны)
  function drawZone(zone) {
    var m = WORLD.moon;
    var centerW = zoneCenterWorld(zone);
    
    // Вычисляем базис для дуги
    var n = zone.dir; // Нормаль
    var t1 = v3(1, 0, 0);
    if (Math.abs(n.x) > 0.9) t1 = v3(0, 1, 0);
    
    var t2 = v3(
      n.y * t1.z - n.z * t1.y,
      n.z * t1.x - n.x * t1.z,
      n.x * t1.y - n.y * t1.x
    );
    var t2len = length(t2);
    t2.x /= t2len; t2.y /= t2len; t2.z /= t2len;
    
    var t1f = v3(
      t2.y * n.z - t2.z * n.y,
      t2.z * n.x - t2.x * n.z,
      t2.x * n.y - t2.y * n.x
    );

    // Строим дугу в 3D и проецируем
    var points = [];
    var segments = 20;
    var arcRadius = zone.radius;
    
    for (var j = 0; j <= segments; j++) {
      var angle = (j / segments) * Math.PI * 2; // Полный круг (или часть)
      // Координаты на поверхности сферы
      var px = Math.cos(angle) * arcRadius;
      var py = Math.sin(angle) * arcRadius;
      
      // Точка в 3D на сфере вокруг центра
      var wx = m.x + m.r * (n.x * Math.cos(arcRadius) + (t1f.x * px + t2.x * py) * Math.sin(arcRadius));
      var wy = m.y + m.r * (n.y * Math.cos(arcRadius) + (t1f.y * px + t2.y * py) * Math.sin(arcRadius));
      var wz = m.z + m.r * (n.z * Math.cos(arcRadius) + (t1f.z * px + t2.z * py) * Math.sin(arcRadius));
      
      var proj = project(v3(wx, wy, wz));
      if (proj) points.push(proj);
    }

    if (points.length < 2) return;

    var c = centerW;
    var toCam = v3(camera.target.x - c.x, camera.target.y - c.y, camera.target.z - c.z);
    var len = length(toCam) || 1;
    toCam.x /= len; toCam.y /= len; toCam.z /= len;
    var facing = toCam.x*n.x + toCam.y*n.y + toCam.z*n.z;
    var alpha = Math.max(0.15, Math.min(1, (facing + 0.3) / 1.3));

    // Рисуем линию (дугу)
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var k = 1; k < points.length; k++) {
      ctx.lineTo(points[k].x, points[k].y);
    }
    
    // Отрисовка (синий цвет, как на твоем рисунке)
    ctx.strokeStyle = "rgba(80, 180, 255, " + alpha + ")";
    ctx.lineWidth = 4;
    ctx.stroke();
    
    // Легкая заливка внутри
    ctx.fillStyle = "rgba(80, 180, 255, " + (alpha * 0.15) + ")";
    ctx.fill();

    // Номер зоны
    var labelP = project(centerW);
    if (labelP) {
      ctx.fillStyle = "rgba(255, 255, 255, " + alpha + ")";
      ctx.font = "bold 14px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(zone.id), labelP.x, labelP.y);
    }
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
    ctx.strokeStyle = "rgba(120, 200, 255, 0.75)"; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function drawShip() {
    var p = project(state.ship); if (!p) return;
    var size = Math.max(4, Math.min(14, 10 * p.scale));
    
    var ang = state.heading * Math.PI / 180;
    var ahead = v3(state.ship.x + Math.cos(ang)*10, state.ship.y, state.ship.z + Math.sin(ang)*10);
    var pa = project(ahead);
    var drawAng = pa ? Math.atan2(pa.y - p.y, pa.x - p.x) : 0;

    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(drawAng);
    
    // Пламя маршевого двигателя
    if (engineThrusting && state.fuel > 0) {
      ctx.beginPath(); ctx.moveTo(-size*1.5, size*0.5); ctx.lineTo(-size*2.5, 0); ctx.lineTo(-size*1.5, -size*0.5);
      ctx.fillStyle = "#ff9e4e"; ctx.fill();
    }
    // Пламя RCS (торможение)
    if ((rcsDown || keys.down) && state.fuel > 0) {
      ctx.beginPath(); ctx.moveTo(size*1.5, size*0.5); ctx.lineTo(size*2.5, 0); ctx.lineTo(size*1.5, -size*0.5);
      ctx.fillStyle = "#4ea1ff"; ctx.fill();
    }
    
    ctx.beginPath(); ctx.moveTo(size*1.6, 0); ctx.lineTo(-size, size*0.9); ctx.lineTo(-size, -size*0.9); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); 
    ctx.restore();
  }

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

  function startFlight() {
    if (!state || state.status === "flying" || state.status === "won" || state.status === "lost") return;
    state.status = "flying"; running = true; lastTimestamp = 0; accumulatedTime = 0;
    hideMessage(); updateButtons();
  }

  function resetGame() { resetState(); render(); }

  // --- Обработчики интерфейса ---
  engineBtns.forEach(function(btn) {
    btn.addEventListener("click", function() {
      if (state && state.status === "flying") return;
      currentEngine = parseInt(btn.dataset.idx, 10);
      engineBtns.forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
    });
  });

  fuelSlider.addEventListener("input", function() { fuelValue.textContent = fuelSlider.value; });

  // Маршевый двигатель
  burnBtn.addEventListener("mousedown", function() { if(state && state.status==="flying" && state.fuel>0) engineThrusting = true; });
  burnBtn.addEventListener("mouseup", function() { engineThrusting = false; });
  burnBtn.addEventListener("mouseleave", function() { engineThrusting = false; });
  burnBtn.addEventListener("touchstart", function(e) { e.preventDefault(); if(state && state.status==="flying" && state.fuel>0) engineThrusting = true; });
  burnBtn.addEventListener("touchend", function(e) { e.preventDefault(); engineThrusting = false; });

  // RCS кнопки
  function bindHold(btn, on, off) {
    btn.addEventListener("mousedown", function() { if(state && state.status==="flying" && state.fuel>0) on(); });
    btn.addEventListener("mouseup", off);
    btn.addEventListener("mouseleave", off);
    btn.addEventListener("touchstart", function(e) { e.preventDefault(); if(state && state.status==="flying" && state.fuel>0) on(); });
    btn.addEventListener("touchend", function(e) { e.preventDefault(); off(); });
  }
  bindHold(rcsLeftBtn, function(){ rcsLeft = true; }, function(){ rcsLeft = false; });
  bindHold(rcsRightBtn, function(){ rcsRight = true; }, function(){ rcsRight = false; });
  bindHold(rcsDownBtn, function(){ rcsDown = true; }, function(){ rcsDown = false; });

  startBtn.addEventListener("click", startFlight);
  resetBtn.addEventListener("click", resetGame);
  restartBtn.addEventListener("click", resetGame);

  // Клавиатура (W, A, S, D и стрелки)
  document.addEventListener("keydown", function (e) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Spacebar", "w", "a", "s", "d", "W", "A", "S", "D"].includes(e.key)) {
      e.preventDefault();
    }
    
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = true;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = true;
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") keys.down = true;
    
    if ((e.key === " " || e.key === "Spacebar" || e.key === "ArrowUp" || e.key === "w" || e.key === "W") && state && state.status === "flying" && state.fuel > 0) {
      engineThrusting = true;
    }
    if (e.key === "Enter") {
      if (state && state.status === "idle") startFlight();
      else if (state && (state.status === "won" || state.status === "lost")) resetGame();
    }
  });

  document.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") keys.down = false;
    if (e.key === " " || e.key === "Spacebar" || e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      engineThrusting = false;
    }
  });

  // Инициализация
  fuelValue.textContent = fuelSlider.value;
  engineBtns[1].classList.add("active");
  fitCanvas();
  resetState();
  requestAnimationFrame(loop);
})();
