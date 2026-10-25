/* game.js — 트레일 오브 더 비숍 화면/입력
   아트 방향: 체스 × 모뉴먼트 밸리. 파스텔 하늘, 면 명암만으로 그린 건축(룩 성탑), 검은 비숍 주인공, 왕관 목표.
   아이소메트릭 캔버스 렌더링, 첫 시작 인트로 애니메이션, 키보드/터치 입력, 되돌리기, HUD, 사망/클리어 처리 */
(function () {
  'use strict';
  const E = window.Engine;
  const LEVELS = window.LEVELS;

  // --- 아이소메트릭 치수 (논리 픽셀) ---
  const TW = 76, TH = 38;   // 타일 마름모 폭/높이
  const THICK = 16;         // 판 두께 (떠 있는 섬처럼 두껍게)
  const UNIT = 26;          // 탑 높이 1당 픽셀
  const PAD = 58;
  const LIGHT_Z = 1.6;      // 빛이 떠 있는 높이 (격자 단위)
  const LIGHT_R = 14;       // 해/달 원반 반지름
  const GHOST_ALPHA = 0.18; // 뭔가를 가리는 탑의 투명도
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ANIM_MS = REDUCED ? 0 : 200, SHAKE_MS = 260, MSG_MS = 1600;
  const DEATH_MS = REDUCED ? 300 : 900;

  const COLORS = {
    lit:      { top: '#efe6d6', left: '#cdc1aa', right: '#ddd2bd', edge: 'rgba(80,60,40,0.10)' },
    litNight: { top: '#cfcbe0', left: '#a6a1bf', right: '#bab5d0', edge: 'rgba(40,40,80,0.12)' },
    shade:    { top: '#34323f', left: '#1f1e27', right: '#292731', edge: 'rgba(0,0,0,0.25)' },
    base:     { top: '#5a4a52', left: '#3b2f36', right: '#4a3b42', edge: 'rgba(0,0,0,0)' },
    tower:    { top: '#e9b49c', faceLit: '#d99b83', faceDark: '#a46d5c', night: '#6c6796', edge: 'rgba(0,0,0,0)' },
    piece: '#17161e', pieceRim: 'rgba(245,238,225,0.5)', pieceShadow: 'rgba(20,16,40,0.32)',
    gold: '#e8c15a', goldDark: '#b58f2e',
    fwd: { fill: '#8fe0b5', line: '#52c48a' },
    back: { fill: '#9cc7f5', line: '#5b9ee6' },
    sun: '#ffd98a', sunGlow: 'rgba(255,214,140,0.55)', moon: '#eef0ff', moonGlow: 'rgba(200,210,255,0.45)',
    ring: 'rgba(255,255,255,0.4)', label: 'rgba(255,255,255,0.75)',
  };
  const MSG = {
    death: '흰 칸을 밟았어요. 비숍이 쓰러집니다.',
    building: '탑이에요.',
    void: '그쪽엔 판이 없어요.',
  };
  // 자리별 하늘색 (파스텔 그라데이션)
  const SKY = {
    morning: { top: '#f2c3a2', bottom: '#f9e7d4' },
    noon:    { top: '#bcdcee', bottom: '#f4f1e8' },
    evening: { top: '#9a7fb8', bottom: '#f0a98a' },
    night:   { top: '#23275a', bottom: '#5a4f8d' },
  };

  const $ = (id) => document.getElementById(id);
  const canvas = $('board'), ctx = canvas.getContext('2d');
  const ui = {
    levelName: $('levelName'), time: $('timeLabel'), moves: $('moves'), msg: $('msg'),
    overlay: $('overlay'), overlayTitle: $('overlayTitle'), overlayText: $('overlayText'),
    sky: $('sky'), btnNext: $('btnNext'), btnAgain: $('btnAgain'),
    prevLevel: $('prevLevel'), nextLevel: $('nextLevel'),
  };

  let levelIndex = 0, level = null, state = null, history = [], moves = 0, won = false;
  let anim = null, shake = null, raf = 0, msgTimer = 0;
  let dying = null, pendingDeath = false;   // 사망 효과 진행 중 / 흰 칸으로 걸어가는 중
  let intro = null;                          // 첫 시작 인트로 { start, lastCaption }
  let geo = null, stars = [], bIndex = null;

  const clamp01 = (k) => Math.max(0, Math.min(1, k));
  const easeOut = (k) => 1 - Math.pow(1 - clamp01(k), 3);

  // ---------- 색 유틸 ----------
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mix(a, b, k) {
    if (k <= 0) return a;
    if (k >= 1) return b;
    const A = hexToRgb(a), B = hexToRgb(b);
    const c = A.map((v, i) => Math.round(v + (B[i] - v) * k));
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }
  function mixCols(a, b, k) {
    if (k <= 0) return a;
    if (k >= 1) return b;
    return { top: mix(a.top, b.top, k), left: mix(a.left, b.left, k), right: mix(a.right, b.right, k), edge: a.edge };
  }
  // s: 그림자 정도 0~1, night: 달빛 정도 0~1
  function floorColors(s, night) {
    const lit = mixCols(COLORS.lit, COLORS.litNight, night);
    return mixCols(lit, COLORS.shade, s);
  }
  // 빛 방향에 따른 탑 면 명암: 화면 왼쪽 면은 남쪽을, 오른쪽 면은 동쪽을 향한다
  function towerColors(sun, night, lightK) {
    const B = COLORS.tower;
    const top = mix(B.top, B.night, 0.5 * night), lit = mix(B.faceLit, B.night, 0.5 * night);
    const dark = mix(B.faceDark, B.night, 0.35 * night);
    const kS = Math.max(0, sun.sy) * lightK, kE = Math.max(0, sun.sx) * lightK;
    const flat = mix(dark, lit, 0.5);   // 빛이 없을 때(인트로 초반)는 양면 중간 톤
    return { top, left: mix(flat, mix(dark, lit, kS), lightK), right: mix(flat, mix(dark, lit, kE), lightK), edge: B.edge };
  }

  // ---------- 좌표 ----------
  function proj(gx, gy, z) {
    return { x: geo.ox + TW / 2 + (gx - gy) * TW / 2, y: geo.oy + (gx + gy) * TH / 2 - (z || 0) * UNIT };
  }
  function tileOrigin(gx, gy) { return { sx: geo.ox + (gx - gy) * TW / 2, sy: geo.oy + (gx + gy) * TH / 2 }; }
  function screenDir(gx, gy) {
    const x = (gx - gy) * TW / 2, y = (gx + gy) * TH / 2;
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }
  function lightRadius() { return Math.max(level.W, level.H) / 2 + 1.3; }
  function lightPosAt(sx, sy) {
    const R = lightRadius();
    const l = Math.hypot(sx, sy) || 1;
    return proj(level.W / 2 + sx / l * R, level.H / 2 + sy / l * R, LIGHT_Z);
  }
  function computeGeometry() {
    let maxH = 0;
    for (const b of level.buildings) maxH = Math.max(maxH, b.h);
    const mapW = (level.W + level.H) * TW / 2;
    const mapH = (level.W + level.H - 2) * TH / 2 + TH;
    const R = lightRadius();
    const ringB = R * TH / 2 * Math.SQRT2;
    const ringTopNeed = ringB + LIGHT_Z * UNIT + 46 - (level.W + level.H) * TH / 4;
    const oy = Math.max(PAD + maxH * UNIT + 10, ringTopNeed, 70);
    const ox = PAD + (level.H - 1) * TW / 2;
    const w = mapW + PAD * 2;
    const h = oy + mapH + THICK + PAD * 0.7;
    geo = { w, h, ox, oy };
    // 밤하늘 별: 위치 고정 (의사난수)
    stars = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 40; i++) stars.push({ x: rnd() * w, y: rnd() * oy * 0.9, r: 0.6 + rnd() * 1.1, p: rnd() * Math.PI * 2 });
    // 탑 번호표 (인트로 낙하 순서용)
    bIndex = new Map();
    level.buildings.forEach((b, i) => bIndex.set(b.y * level.W + b.x, i));
    const S = 1.2;   // 화면 확대 배율 (논리 좌표는 그대로)
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * S * dpr);
    canvas.height = Math.round(h * S * dpr);
    canvas.style.maxWidth = Math.round(w * S) + 'px';
    ctx.setTransform(dpr * S, 0, 0, dpr * S, 0, 0);
  }
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // ---------- 인트로 타임라인 ----------
  /* 순서: 멀리서 줌인(흰 판 + 비숍) → 왕관 등장 → 탑이 위에서 툭툭 떨어짐 → 해가 켜지며 그림자 → 해가 한 바퀴 → 시작 */
  function introView(now) {
    const e = now - intro.start;
    const n = level.buildings.length;
    const ZOOM_D = 1500;
    const T_CROWN = 900, CROWN_D = 450;
    const T_TOW = 1500, TOW_D = 480, TOW_GAP = 110;
    const towEnd = T_TOW + TOW_D + TOW_GAP * Math.max(0, n - 1);
    const T_LIGHT = towEnd + 250, LIGHT_D = 550;
    const T_ROT = T_LIGHT + LIGHT_D + 500, STEP = 680, MOVE = 320;
    const T_END = T_ROT + STEP * 4 + 350;
    const v = { zoom: 0.72 + 0.28 * easeOut(e / ZOOM_D), crown: clamp01((e - T_CROWN) / CROWN_D), drops: [], t0: state.t, t1: state.t, ease: 1, caption: null, done: e >= T_END };
    for (let i = 0; i < n; i++) {
      const k = (e - T_TOW - i * TOW_GAP) / TOW_D;
      v.drops.push(k <= 0 ? null : (1 - easeOut(k)) * 170);   // null = 아직 안 보임, 숫자 = 위로 떠 있는 픽셀
    }
    v.light = clamp01((e - T_LIGHT) / LIGHT_D);
    v.shadow = v.light;
    if (e >= T_ROT) {
      const i = Math.min(4, Math.floor((e - T_ROT) / STEP));
      if (i < 4) { v.t0 = state.t + i; v.t1 = state.t + i + 1; v.ease = easeOut(((e - T_ROT) - i * STEP) / MOVE); }
      else { v.t0 = v.t1 = state.t + 4; }
    }
    if (e >= T_ROT) v.caption = '걸을 때마다 빛이 한 자리씩 돕니다';
    else if (e >= T_LIGHT) v.caption = '탑이 그림자를 드리웁니다. 비숍은 검은 칸만 밟을 수 있어요';
    else if (e >= T_TOW) v.caption = '탑이 세워집니다';
    else if (e >= T_CROWN) v.caption = '왕관까지 가세요';
    return v;
  }
  function startIntro() {
    intro = { start: performance.now(), lastCaption: null };
    const at = +(new URLSearchParams(location.search).get('introAt') || 0);   // 디버그: ?introAt=2600 → 2.6초 지점부터
    if (at > 0) intro.start -= at;
  }
  function endIntro() {
    intro = null;
    ui.msg.hidden = true;
    applyTime(state.t);
    if (level.hint) showMsg(level.hint, 4200);
    loop();
  }

  // ---------- 기본 도형 ----------
  function rhombusSub(sx, sy, lift, tw, th) {
    tw = tw || TW; th = th || TH;
    const y = sy - lift;
    ctx.moveTo(sx + tw / 2, y);
    ctx.lineTo(sx + tw, y + th / 2);
    ctx.lineTo(sx + tw / 2, y + th);
    ctx.lineTo(sx, y + th / 2);
    ctx.closePath();
  }
  function rhombus(sx, sy, lift, tw, th) { ctx.beginPath(); rhombusSub(sx, sy, lift, tw, th); }
  // 윗면이 lift 만큼 떠 있고, 옆면이 depth 만큼 내려오는 각기둥. tw/th 로 작은 기둥도 그린다
  function drawPrism(sx, sy, lift, depth, col, tw, th) {
    tw = tw || TW; th = th || TH;
    const y = sy - lift;
    const Lx = sx, Ly = y + th / 2, Bx = sx + tw / 2, By = y + th, Rx = sx + tw, Ry = y + th / 2;
    ctx.fillStyle = col.left;
    ctx.beginPath(); ctx.moveTo(Lx, Ly); ctx.lineTo(Bx, By); ctx.lineTo(Bx, By + depth); ctx.lineTo(Lx, Ly + depth); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col.right;
    ctx.beginPath(); ctx.moveTo(Bx, By); ctx.lineTo(Rx, Ry); ctx.lineTo(Rx, Ry + depth); ctx.lineTo(Bx, By + depth); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col.top;
    rhombus(sx, sy, lift, tw, th);
    ctx.fill();
    if (col.edge && col.edge !== 'rgba(0,0,0,0)') {
      ctx.strokeStyle = col.edge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  // 탑(룩) 실루엣 (화면 다각형): 가림 판정에 사용
  function silhouette(sx, sy, lift) {
    return [
      [sx + TW / 2, sy - lift - 8], [sx + TW, sy - lift + TH / 2], [sx + TW, sy + TH / 2],
      [sx + TW / 2, sy + TH], [sx, sy + TH / 2], [sx, sy - lift + TH / 2],
    ];
  }
  function flashIfShaking(gx, gy, o, lift, now) {
    if (!shake || shake.x !== gx || shake.y !== gy) return;
    const k = Math.min(1, (now - shake.start) / SHAKE_MS);
    ctx.fillStyle = 'rgba(240,120,110,' + (0.6 * (1 - k)).toFixed(3) + ')';
    rhombus(o.sx, o.sy, lift);
    ctx.fill();
  }

  // ---------- 하늘: 별, 빛 궤도, 해/달 ----------
  function drawStars(now, night) {
    if (night <= 0) return;
    for (const s of stars) {
      const tw = REDUCED ? 1 : 0.7 + 0.3 * Math.sin(now / 900 + s.p);
      ctx.fillStyle = 'rgba(255,250,235,' + (0.85 * night * tw).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawLightRing() {
    const R = lightRadius();
    const c = proj(level.W / 2, level.H / 2, LIGHT_Z);
    ctx.save();
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = COLORS.ring;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, R * TW / 2 * Math.SQRT2, R * TH / 2 * Math.SQRT2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // 정거장 점과 이름표. 탑에 가리지 않도록 맵 위에 그린다
  function drawLightStops(sunTo) {
    ctx.font = '300 11px "Noto Sans KR", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    E.PHASES.forEach((p, i) => {
      const q = lightPosAt(p.sx, p.sy);
      const cur = i === sunTo.index;
      ctx.fillStyle = cur ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(q.x, q.y, cur ? 3 : 2, 0, Math.PI * 2); ctx.fill();
      const d = screenDir(p.sx, p.sy);
      const off = cur ? 36 : 20;
      ctx.fillStyle = cur ? 'rgba(255,255,255,0.95)' : COLORS.label;
      ctx.fillText(p.name, q.x + d.x * off, q.y + d.y * off + 1);
    });
  }
  function lightDiscPos(sunFrom, sunTo, ease) {
    if (ease >= 1 || sunFrom.phase === sunTo.phase) return lightPosAt(sunTo.sx, sunTo.sy);
    const a0 = Math.atan2(sunFrom.sy, sunFrom.sx), a1 = Math.atan2(sunTo.sy, sunTo.sx);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const a = a0 + d * ease;
    return lightPosAt(Math.cos(a), Math.sin(a));
  }
  function drawLightDisc(sunFrom, sunTo, ease) {
    const q = lightDiscPos(sunFrom, sunTo, ease);
    const moon = sunTo.moon;
    const g = ctx.createRadialGradient(q.x, q.y, LIGHT_R * 0.6, q.x, q.y, LIGHT_R * 3.4);
    g.addColorStop(0, moon ? COLORS.moonGlow : COLORS.sunGlow);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(q.x, q.y, LIGHT_R * 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = moon ? COLORS.moon : COLORS.sun;
    ctx.beginPath(); ctx.arc(q.x, q.y, LIGHT_R, 0, Math.PI * 2); ctx.fill();
    if (moon) { // 초승달: 한쪽을 도려낸다 (캔버스 뒤의 하늘이 비친다)
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(q.x + LIGHT_R * 0.45, q.y - LIGHT_R * 0.2, LIGHT_R * 0.82, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  // 탑의 실제 그림자 다각형을 판 위에 깐다 (판 영역으로 클리핑)
  function drawShadowPolys(sunFrom, sunTo, ease, shadowK) {
    if (shadowK <= 0) return;
    ctx.save();
    ctx.beginPath();
    for (let gy = 0; gy < level.H; gy++) for (let gx = 0; gx < level.W; gx++) {
      if (level.tiles[gy][gx].type === 'void') continue;
      const o = tileOrigin(gx, gy);
      rhombusSub(o.sx, o.sy, 0);
    }
    ctx.clip();
    const draw = (sun, alpha) => {
      ctx.fillStyle = 'rgba(38,30,70,' + (alpha * shadowK).toFixed(3) + ')';
      ctx.beginPath();
      for (const b of level.buildings) {
        const rect = E.shadowRect(b, sun);
        rect.forEach((p, i) => { const q = proj(p[0], p[1], 0); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
        ctx.closePath();
      }
      ctx.fill();
    };
    if (ease < 1) { draw(sunFrom, 0.34 * (1 - ease)); draw(sunTo, 0.34 * ease); }
    else draw(sunTo, 0.34);
    ctx.restore();
  }

  // ---------- 판 위 요소 ----------
  function drawGoal(o, now, k) {
    if (k <= 0) return;
    const cx = o.sx + TW / 2, cy = o.sy + TH / 2;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate(cx, cy);
    ctx.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
    ctx.translate(-cx, -cy);
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85 * k;
    ctx.beginPath(); ctx.ellipse(cx, cy, TW * 0.3, TH * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = k;
    // 떠 있는 왕관
    const y = cy - 24 + (REDUCED ? 0 : Math.sin(now / 520) * 2);
    ctx.fillStyle = COLORS.pieceShadow;
    ctx.beginPath(); ctx.ellipse(cx, cy + 1, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COLORS.gold;
    ctx.beginPath();
    ctx.moveTo(cx - 10, y + 6); ctx.lineTo(cx - 10, y - 4); ctx.lineTo(cx - 5, y + 1); ctx.lineTo(cx, y - 8);
    ctx.lineTo(cx + 5, y + 1); ctx.lineTo(cx + 10, y - 4); ctx.lineTo(cx + 10, y + 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = COLORS.goldDark;
    ctx.fillRect(cx - 10, y + 4, 20, 2.5);
    ctx.restore();
  }
  // 앞 칸은 초록, 뒤 칸은 파랑으로 판이 은은하게 깜빡인다 (갈 수 있는지와 무관)
  function drawFlash(gx, gy, o, now) {
    const d = E.DIRS[state.facing];
    let col = null;
    if (gx === state.x + d.dx && gy === state.y + d.dy) col = COLORS.fwd;
    else if (gx === state.x - d.dx && gy === state.y - d.dy) col = COLORS.back;
    if (!col) return;
    const pulse = REDUCED ? 0.5 : 0.5 + 0.5 * Math.sin(now / 260);
    ctx.fillStyle = col.fill;
    ctx.globalAlpha = 0.28 + 0.3 * pulse;
    rhombus(o.sx, o.sy, 0);
    ctx.fill();
    ctx.globalAlpha = 0.65 + 0.35 * pulse;
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 룩 성탑: 각기둥 + 윗면 네 모서리의 총안
  function drawTower(tile, o, col) {
    const lift = tile.h * UNIT;
    drawPrism(o.sx, o.sy, lift, lift, col);
    // 층 선: 높이 1마다 한 칸처럼 (아주 연하게)
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let k = 1; k < tile.h; k++) {
      const y = o.sy - k * UNIT;
      ctx.beginPath(); ctx.moveTo(o.sx, y + TH / 2); ctx.lineTo(o.sx + TW / 2, y + TH); ctx.lineTo(o.sx + TW, y + TH / 2); ctx.stroke();
    }
    // 총안: 타일 네 모서리에 작은 기둥 (먼 것부터)
    const s = 0.28, mh = 7, tw = TW * s, th = TH * s;
    const corners = [[0, 0], [1 - s, 0], [0, 1 - s], [1 - s, 1 - s]];
    for (const c of corners) {
      const sx = o.sx + TW / 2 - tw / 2 + (c[0] - c[1]) * TW / 2, sy = o.sy + (c[0] + c[1]) * TH / 2;
      drawPrism(sx, sy, lift + mh, mh, col, tw, th);
    }
  }
  function drawBuilding(gx, gy, tile, o, col, keyPts, drop) {
    const lift = tile.h * UNIT;
    if (drop) {   // 인트로: 위에서 떨어지는 중. 가림 판정 없이 들어 올려 그린다
      ctx.save();
      ctx.translate(0, -drop);
      drawTower(tile, o, col);
      ctx.restore();
      return;
    }
    const poly = silhouette(o.sx, o.sy, lift);
    let ghost = false;
    for (const p of keyPts) {
      if (gx + gy > p.sum && pointInPoly(p.x, p.y, poly)) { ghost = true; break; }
    }
    if (ghost) ctx.globalAlpha = GHOST_ALPHA;
    drawTower(tile, o, col);
    ctx.globalAlpha = 1;
    if (ghost) {   // 실루엣 한 줄만 남긴다. 층 선은 뒤를 가리므로 생략
      ctx.strokeStyle = 'rgba(255,245,235,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      poly.forEach((p, i) => { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.closePath();
      ctx.stroke();
    }
  }
  // 검은 비숍. (cx, cy) 는 발밑 중심. (ux, uy) 는 바라보는 방향의 화면 단위벡터. tilt 는 쓰러지는 각도
  function drawBishop(cx, cy, ux, uy, alpha, tilt) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate((tilt || 0) + ux * 0.09);   // 바라보는 쪽으로 살짝 기운다
    const ink = COLORS.piece, rim = COLORS.pieceRim;
    const outline = () => { ctx.strokeStyle = rim; ctx.lineWidth = 1.1; ctx.stroke(); };
    ctx.fillStyle = ink;
    // 받침
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 5.5, 0, 0, Math.PI * 2); ctx.fill(); outline();
    // 몸통
    ctx.beginPath();
    ctx.moveTo(-10.5, -2);
    ctx.bezierCurveTo(-9, -12, -6.5, -16, -5.5, -22);
    ctx.lineTo(5.5, -22);
    ctx.bezierCurveTo(6.5, -16, 9, -12, 10.5, -2);
    ctx.closePath(); ctx.fill(); outline();
    // 목 테
    ctx.beginPath(); ctx.ellipse(0, -22, 8, 3.2, 0, 0, Math.PI * 2); ctx.fill(); outline();
    // 머리(미트라)
    ctx.beginPath();
    ctx.moveTo(0, -48);
    ctx.bezierCurveTo(9.5, -40, 9.5, -29, 0, -24);
    ctx.bezierCurveTo(-9.5, -29, -9.5, -40, 0, -48);
    ctx.closePath(); ctx.fill(); outline();
    // 꼭대기 구슬
    ctx.beginPath(); ctx.arc(0, -50.5, 3, 0, Math.PI * 2); ctx.fill(); outline();
    // 머리 홈: 바라보는 쪽에 굵은 사선
    const sx = ux >= 0 ? 1 : -1;
    ctx.strokeStyle = 'rgba(245,238,225,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx * 1, -46); ctx.lineTo(sx * 6.5, -30); ctx.stroke();
    // 눈: 바라보는 쪽으로 치우친 두 점. 앞을 보면 아래로, 뒤돌아보면 위로 올라간다
    const ex = ux * 4.2, ey = -37 + uy * 3.5, gap = 3.1;
    ctx.fillStyle = '#f6efe2';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(ex + s * gap, ey, 1.9, 2.4, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = ink;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(ex + s * gap + ux * 0.9, ey + uy * 0.7, 0.95, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function drawPlayer(gx, gy) {
    const c = proj(gx + 0.5, gy + 0.5, 0);
    const d = E.DIRS[state.facing];
    const fx = (d.dx - d.dy) * TW / 2, fy = (d.dx + d.dy) * TH / 2;
    const fl = Math.hypot(fx, fy), ux = fx / fl, uy = fy / fl;
    ctx.fillStyle = COLORS.pieceShadow;
    ctx.beginPath(); ctx.ellipse(c.x, c.y + 3, 15, 7, 0, 0, Math.PI * 2); ctx.fill();
    drawBishop(c.x, c.y, ux, uy, 1, 0);
  }
  // 사망: 비숍이 바라보던 쪽으로 쓰러지며 흐려지고, 먼지가 피어오른다
  function drawDeath(now) {
    const k = Math.min(1, (now - dying.start) / DEATH_MS);
    const c = proj(dying.x + 0.5, dying.y + 0.5, 0);
    const fall = Math.min(1, k / 0.55);
    const tilt = (dying.ux >= 0 ? 1 : -1) * (Math.PI / 2) * (1 - Math.pow(1 - fall, 3));
    const alpha = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
    drawBishop(c.x, c.y, dying.ux, dying.uy, alpha, tilt);
    if (k > 0.3) {
      const kk = (k - 0.3) / 0.7;
      ctx.fillStyle = 'rgba(245,238,225,' + (0.7 * (1 - kk)).toFixed(3) + ')';
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI * (0.15 + 0.7 * i / 6);
        const r = 10 + 34 * kk;
        ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * r * (dying.ux >= 0 ? 1 : -1) * 0.8, c.y - 6 + Math.sin(a) * r * 0.6, 2.2 - kk * 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  // 탑에 가려지면 안 되는 지점들: 비숍, 왕관 (앞뒤 칸 표시는 탑 위에 따로 그리므로 제외)
  function importantPoints(px, py, playerCell) {
    const pts = [];
    const pc = proj(px + 0.5, py + 0.5, 0), ps = playerCell.x + playerCell.y;
    pts.push({ x: pc.x, y: pc.y - 14, sum: ps }, { x: pc.x, y: pc.y - 36, sum: ps }, { x: pc.x - 8, y: pc.y - 12, sum: ps }, { x: pc.x + 8, y: pc.y - 12, sum: ps });
    const g = level.goal, gc = proj(g.x + 0.5, g.y + 0.5, 0), gs = g.x + g.y;
    pts.push({ x: gc.x, y: gc.y, sum: gs }, { x: gc.x, y: gc.y - 30, sum: gs }, { x: gc.x - 14, y: gc.y, sum: gs }, { x: gc.x + 14, y: gc.y, sum: gs });
    return pts;
  }
  function forEachCell(fn) {
    for (let sum = 0; sum <= level.W + level.H - 2; sum++) {
      for (let gx = 0; gx < level.W; gx++) {
        const gy = sum - gx;
        if (gy < 0 || gy >= level.H) continue;
        fn(gx, gy, level.tiles[gy][gx], tileOrigin(gx, gy));
      }
    }
  }

  function render(now) {
    let ease = 1, from = state, t0 = state.t, t1 = state.t;
    if (anim) {
      const k = Math.max(0, Math.min(1, (now - anim.start) / anim.dur));
      ease = 1 - Math.pow(1 - k, 3);
      from = anim.from;
      t0 = from.t;
    }
    const iv = intro ? introView(now) : null;
    if (iv) { t0 = iv.t0; t1 = iv.t1; ease = iv.ease; }
    const lightK = iv ? iv.light : 1, shadowK = iv ? iv.shadow : 1, crownK = iv ? iv.crown : 1;
    const smFrom = E.shadowMap(level, t0), smTo = E.shadowMap(level, t1);
    const sunFrom = E.sunAt(level, t0), sunTo = E.sunAt(level, t1);
    const night = ((sunFrom.moon ? 1 : 0) * (1 - ease) + (sunTo.moon ? 1 : 0) * ease) * lightK;
    const px = from.x + (state.x - from.x) * ease, py = from.y + (state.y - from.y) * ease;
    const playerCell = (from.x + from.y > state.x + state.y) ? from : state;
    const showIndicators = !anim && !won && !dying && !pendingDeath && !intro;
    const s = sunTo.sx + sunTo.sy;
    const lightInFront = s > 0 || (s === 0 && sunTo.sy > 0);
    const towerCol = towerColors(sunTo, night, lightK);

    ctx.clearRect(0, 0, geo.w, geo.h);
    ctx.save();
    if (iv && iv.zoom < 1) {   // 인트로 줌인: 판 중심을 기준으로 확대
      const c = proj(level.W / 2, level.H / 2, 0);
      ctx.translate(c.x, c.y);
      ctx.scale(iv.zoom, iv.zoom);
      ctx.translate(-c.x, -c.y);
    }
    // 1. 하늘: 별, 빛 궤도, 뒤편 빛
    drawStars(now, night);
    if (lightK > 0) {
      ctx.globalAlpha = lightK;
      drawLightRing();
      if (!lightInFront) drawLightDisc(sunFrom, sunTo, ease);
      ctx.globalAlpha = 1;
    }
    // 2. 판 (바닥 타일 + 탑 밑판)
    forEachCell((gx, gy, tile, o) => {
      if (tile.type === 'floor') {
        const sh = ((smFrom[gy][gx] ? 1 : 0) * (1 - ease) + (smTo[gy][gx] ? 1 : 0) * ease) * shadowK;
        drawPrism(o.sx, o.sy, 0, THICK, floorColors(sh, night));
      } else if (tile.type === 'building') {
        const drop = iv ? iv.drops[bIndex.get(gy * level.W + gx)] : 0;
        drawPrism(o.sx, o.sy, 0, THICK, drop === null ? floorColors(0, night) : COLORS.base);
      }
    });
    // 3. 실제 그림자 다각형
    drawShadowPolys(sunFrom, sunTo, ease, shadowK);
    // 4. 판 위 요소와 탑, 비숍 (화가 순서)
    const keyPts = importantPoints(px, py, playerCell);
    forEachCell((gx, gy, tile, o) => {
      if (tile.type === 'floor') {
        flashIfShaking(gx, gy, o, 0, now);
        if (gx === level.goal.x && gy === level.goal.y) drawGoal(o, now, crownK);
      } else if (tile.type === 'building') {
        const drop = iv ? iv.drops[bIndex.get(gy * level.W + gx)] : 0;
        if (drop !== null) drawBuilding(gx, gy, tile, o, towerCol, keyPts, drop);
        flashIfShaking(gx, gy, o, tile.h * UNIT, now);
      }
      if (!dying && gx === playerCell.x && gy === playerCell.y) drawPlayer(px, py);
    });
    // 5. 앞뒤 칸 표시는 탑에 가리지 않게 맨 위에 그린다
    if (showIndicators) {
      const d = E.DIRS[state.facing];
      for (const sign of [1, -1]) {
        const ix = state.x + d.dx * sign, iy = state.y + d.dy * sign;
        if (E.isFloor(level, ix, iy)) drawFlash(ix, iy, tileOrigin(ix, iy), now);
      }
    }
    // 6. 앞쪽(동/남) 빛은 판 위에 그린다. 정거장 이름표는 항상 맨 위
    if (lightK > 0) {
      ctx.globalAlpha = lightK;
      if (lightInFront) drawLightDisc(sunFrom, sunTo, ease);
      drawLightStops(sunTo);
      ctx.globalAlpha = 1;
    }
    if (dying) drawDeath(now);
    ctx.restore();
  }

  function loop() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (anim && now - anim.start >= anim.dur) {
      anim = null;
      if (pendingDeath) { pendingDeath = false; startDeath(now); }
    }
    if (shake && now - shake.start >= SHAKE_MS) shake = null;
    if (dying && now - dying.start >= DEATH_MS) { dying = null; restart(); return; }
    if (intro) {
      const iv = introView(now);
      if (iv.caption !== intro.lastCaption) { intro.lastCaption = iv.caption; if (iv.caption) showMsg(iv.caption, 2600); }
      if (iv.t1 !== intro.lastT) { intro.lastT = iv.t1; applyTime(iv.t1); }
      if (iv.done) { endIntro(); return; }
    }
    render(now);
    const pulsing = !REDUCED && !won && !dying;   // 앞뒤 칸 깜빡임, 왕관 떠 있기, 별 반짝임
    if (anim || shake || dying || intro || pulsing) loop();
  }
  function startDeath(now) {
    const d = E.DIRS[state.facing];
    const fx = (d.dx - d.dy) * TW / 2, fy = (d.dx + d.dy) * TH / 2;
    const fl = Math.hypot(fx, fy) || 1;
    dying = { x: state.x, y: state.y, ux: fx / fl, uy: fy / fl, start: now };
    showMsg(MSG.death);
  }

  // ---------- HUD ----------
  // 시각 t 의 자리 이름과 하늘색을 HUD 에 반영 (게임 중엔 state.t, 인트로 회전 중엔 인트로의 t)
  function applyTime(t) {
    const sun = E.sunAt(level, t);
    ui.time.textContent = sun.name;
    const sky = SKY[sun.key] || SKY.noon;
    ui.sky.style.background = 'linear-gradient(180deg, ' + sky.top + ' 0%, ' + sky.bottom + ' 100%)';
  }
  function updateHud() {
    ui.levelName.textContent = level.name;
    ui.moves.textContent = String(moves);
    applyTime(state.t);
    ui.prevLevel.disabled = levelIndex === 0;
    ui.nextLevel.disabled = levelIndex >= LEVELS.length - 1;
  }
  function showMsg(text, ms) {
    ui.msg.textContent = text;
    ui.msg.hidden = false;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { ui.msg.hidden = true; }, ms || MSG_MS);
  }
  function bestKey() { return 'shade-walk-best-' + levelIndex; }
  function readBest() { try { const v = localStorage.getItem(bestKey()); return v ? +v : null; } catch (e) { return null; } }
  function writeBest(n) { try { localStorage.setItem(bestKey(), String(n)); } catch (e) { /* 저장 불가 환경 */ } }
  function showWin() {
    const prev = readBest();
    const isBest = prev === null || moves < prev;
    if (isBest) writeBest(moves);
    ui.overlayTitle.textContent = '체크메이트';
    let text = moves + '수';
    if (isBest && prev !== null) text += ' · 최고 기록 갱신';
    else if (!isBest) text += ' · 최고 ' + prev + '수';
    ui.overlayText.textContent = text;
    ui.btnNext.hidden = levelIndex >= LEVELS.length - 1;
    ui.overlay.hidden = false;
    ui.btnAgain.focus();
  }

  // ---------- 상태 전이 ----------
  function loadLevel(i, keep, withIntro) {
    levelIndex = Math.max(0, Math.min(LEVELS.length - 1, i));
    level = E.parseLevel(LEVELS[levelIndex]);
    if (keep && keep.state) { state = keep.state; history = keep.history || []; moves = keep.moves || 0; }
    else { state = Object.assign({}, level.start); history = []; moves = 0; }
    won = E.isGoal(level, state);
    anim = null; shake = null; dying = null; pendingDeath = false; intro = null;
    ui.overlay.hidden = true;
    ui.msg.hidden = true;
    computeGeometry();
    updateHud();
    if (withIntro && !REDUCED) startIntro();
    else if (level.hint) showMsg(level.hint, 4200);
    loop();
    if (won) showWin();
  }
  function doAction(a) {
    if (won || dying || pendingDeath) return;
    if (anim) anim = null;  // 진행 중인 이동은 즉시 완료
    const r = E.applyAction(level, state, a);
    if (!r.ok) {
      shake = { x: r.target.x, y: r.target.y, start: performance.now() };
      showMsg(MSG[r.problem]);
      loop();
      return;
    }
    history.push({ state, moves });
    const prev = state;
    state = r.state;
    if (r.step) {
      moves++;
      if (ANIM_MS > 0) anim = { from: prev, start: performance.now(), dur: ANIM_MS };
    }
    updateHud();
    if (r.fatal) {   // 흰 칸: 걸어 들어간 뒤 쓰러지고, 그 다음 처음부터
      if (anim) pendingDeath = true;
      else startDeath(performance.now());
      loop();
      return;
    }
    loop();
    if (r.step && E.isGoal(level, state)) { won = true; setTimeout(showWin, ANIM_MS + 60); }
  }
  function undo() {
    if (dying || pendingDeath || !history.length) return;
    const h = history.pop();
    state = h.state; moves = h.moves; won = false; anim = null;
    ui.overlay.hidden = true;
    updateHud();
    loop();
  }
  function restart() { loadLevel(levelIndex); }

  // ---------- 입력 ----------
  const KEYS = {
    ArrowUp: 'F', ArrowDown: 'B', ArrowLeft: 'L', ArrowRight: 'R',
    w: 'F', s: 'B', a: 'L', d: 'R', W: 'F', S: 'B', A: 'L', D: 'R',
  };
  document.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (intro) { ev.preventDefault(); endIntro(); return; }   // 아무 키나 누르면 인트로 건너뛰기
    if (KEYS[ev.key]) { ev.preventDefault(); doAction(KEYS[ev.key]); return; }
    if (ev.key === 'z' || ev.key === 'Z' || ev.key === 'Backspace') { ev.preventDefault(); undo(); return; }
    if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); restart(); return; }
    if ((ev.key === 'n' || ev.key === 'N') && won && levelIndex < LEVELS.length - 1) { ev.preventDefault(); loadLevel(levelIndex + 1); }
  });
  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (intro) { endIntro(); return; }
      const a = btn.getAttribute('data-action');
      if (a === 'undo') undo();
      else if (a === 'restart') restart();
      else doAction(a);
    });
  });
  canvas.addEventListener('pointerdown', () => { if (intro) endIntro(); });
  ui.btnAgain.addEventListener('click', restart);
  ui.btnNext.addEventListener('click', () => loadLevel(levelIndex + 1));
  ui.prevLevel.addEventListener('click', () => loadLevel(levelIndex - 1));
  ui.nextLevel.addEventListener('click', () => loadLevel(levelIndex + 1));
  window.addEventListener('resize', () => { if (level) { computeGeometry(); loop(); } });

  // ---------- 시작 (아티팩트 핫 리로드 시 상태 유지) ----------
  function start(data) {
    data = data || {};
    const m = /^#l(\d+)$/.exec(location.hash || '');   // #l3 → 3번째 스테이지로 시작 (인트로 없음)
    if (typeof data.levelIndex === 'number' && data.state) loadLevel(data.levelIndex, data);
    else if (m) loadLevel(+m[1] - 1);
    else loadLevel(0, null, true);
  }
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => ({ levelIndex, state, history, moves }));
  if (hot && typeof hot.ready === 'function') hot.ready(start); else start(hot && hot.data);
})();
