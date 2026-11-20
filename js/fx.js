/* Astro Outpost — the camera look. The 3D world is drawn into an off-screen picture, then
   finished like real space footage before it reaches the screen:
     - light glow and a wide lens streak on anything bright (the Sun, lamps, rocket fire)
     - a sun flare with ghost rings that hides when a mountain covers the Sun
     - a colour grade per world: the Moon like Apollo slide film, Mars like a rover camera
     - film grain, soft corners and a little colour fringing
   and it reacts to what is happening in the game:
     - radiation storm: an aurora glow round the edges and tiny streaks of light (astronauts
       really see these when space radiation passes through their eyes)
     - Mars dust: moving sheets of haze
     - low air: the view narrows and loses colour, pulsing like slow breathing
     - cold and dark: frost creeping in from the visor edges
     - postcard photo: the cross marks of an Apollo Hasselblad camera
   Key X switches between full, lite and off (?fx=2, 1 or 0 in the address forces one); it steps
   down by itself if the frame rate drops. Key L picks a space-camera filter on top of the look:
   Apollo film, rover eye, false colour or heat view ("Natural" is the look above).
   game.js and skyfall.js talk to it through JA.fx: pulse() for flashes and jolts, the levels,
   the filters, and JA.fx.state, which game.js fills in every frame. */
(function (JA) {
  'use strict';
  var T = window.THREE;
  var FX = JA.fx = { level: 0, on: false, failed: false, filter: 0, LEVELS: ['Off', 'Lite', 'Full'],
    state: { mode: 'title', site: 'mars', room: '', pov: false, air: 100 },     // game.js fills this in every frame
    render: function () { return false; }, snap: function () {}, pulse: function () {},
    available: function () { return false; }, setLevel: function () { return 0; }, nextLevel: function () { return 0; },
    setOn: function () { return false; }, current: function () { return FX.FILTERS[0]; },
    setFilter: function () { return FX.FILTERS[0]; }, nextFilter: function () { return FX.FILTERS[0]; } };
  // space-camera filters, picked with key L ("natural" is the normal look)
  FX.FILTERS = [
    { id: 'natural', icon: '🎥', name: 'Natural', note: 'Camera filter off: natural colours.' },
    { id: 'apollo', icon: '🎞️', name: 'Apollo film', note: 'Apollo film! The astronauts\' Moon cameras printed little crosses on every photo, so scientists could measure things in them.' },
    { id: 'rover', icon: '🤖', name: 'Rover eye', note: 'Rover eye! The hazard cameras on the Curiosity rover see in black and white through a fisheye lens, to spot rocks near the wheels.' },
    { id: 'false', icon: '🌈', name: 'False colour', note: 'False colour! Scientists stretch the colours in space photos so that different rocks and soils stand out.' },
    { id: 'heat', icon: '🌡️', name: 'Heat view', note: 'Heat view (pretend)! Sunlit ground is hot and shadows are freezing. Real orbiters use heat cameras to map this.' }
  ];
  if (!T) return;

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var touch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
  var KEY = 'ja-fx', saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
  FX.level = saved === null ? (touch ? 1 : 2) : Math.max(0, Math.min(2, parseInt(saved, 10) || 0));
  var userSet = saved !== null;
  var q = /[?&]fx=([0-2])/.exec(location.search);   // ?fx=0|1|2 forces a level for this visit (handy for comparing)
  if (q) { FX.level = +q[1]; userSet = true; }
  FX.on = FX.level > 0;

  var R = null, built = false, failed = false, checked = false, gl2 = false, fType = T.UnsignedByteType;
  var pScene, pCam, quad, rt = {}, M = {}, msaa = -1, bw = 0, bh = 0;
  var v1 = new T.Vector3(), v2 = new T.Vector2(), fwd = new T.Vector3();
  var time = 0, playT = 0, snapT = 0, perfT = 0, perfN = 0, perfSum = 0;
  // smoothed game state that drives the look
  var S = { storm: 0, warn: 0, dust: 0, air: 0, cold: 0, kick: 0, cine: 0, title: 0, inside: 0, site: 1, sunVis: 0, teal: 0, heat: 0, horizon: 0.5 };
  var hz = null;
  // short jolts the game asks for: 'flash' (white), 'shock' (the lens is shaken), 'glitch' (the picture tears), 'glow' (a warm swell)
  var PU = { flash: 0, shock: 0, glitch: 0, glow: 0 };

  // ---------------------------------------------------------------- shaders
  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  // keep only the bright parts (soft knee), averaged over 4 taps so it does not flicker
  var BRIGHT = [
    'uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThresh; uniform float uKnee; uniform float uCap; varying vec2 vUv;',
    'void main(){',
    '  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb',
    '         + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;',
    '  c *= 0.25;',
    '  float l = max(c.r, max(c.g, c.b));',
    '  float s = clamp(l - uThresh + uKnee, 0.0, 2.0 * uKnee); s = s * s / (4.0 * uKnee + 1e-4);',
    '  c *= max(s, l - uThresh) / max(l, 1e-4);',
    '  float lc = max(c.r, max(c.g, c.b));',
    '  c *= min(1.0, uCap / max(lc, 1e-4));',   // a big bright sky must not wash the whole frame
    '  gl_FragColor = vec4(c, 1.0);',
    '}'].join('\n');

  var DOWN = [
    'uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;',
    'void main(){',
    '  gl_FragColor = 0.25 * (texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)) + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0))',
    '                      + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)) + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)));',
    '}'].join('\n');

  var BLUR = [
    'uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;',
    'void main(){',
    '  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270;',
    '  c += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.3162;',
    '  c += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.0703;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'].join('\n');

  // a long sideways smear of the brightest light: the "anamorphic" streak of film lenses
  var STREAK = [
    'uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;',
    'void main(){',
    '  vec3 c = texture2D(tSrc, vUv).rgb; float wsum = 1.0;',
    '  for (int i = 1; i <= 12; i++) {',
    '    float fi = float(i), w = exp(-fi * 0.28);',
    '    vec2 o = vec2(uTexel.x * fi * 3.0, 0.0);',
    '    c += (texture2D(tSrc, vUv + o).rgb + texture2D(tSrc, vUv - o).rgb) * w; wsum += 2.0 * w;',
    '  }',
    '  c /= wsum; float l = max(c.r, max(c.g, c.b));',
    '  gl_FragColor = vec4(c * smoothstep(0.05, 0.6, l), 1.0);',
    '}'].join('\n');

  var FINAL = [
    'uniform sampler2D tScene; uniform sampler2D tBloomA; uniform sampler2D tBloomB; uniform sampler2D tStreak;',
    'uniform vec2 uRes; uniform float uTime; uniform float uMotion; uniform float uFull;',
    'uniform vec2 uSun; uniform float uSunVis; uniform float uOccLo; uniform float uSite;',
    'uniform float uBloom; uniform float uStreakAmt; uniform vec3 uStreakTint;',
    'uniform float uStorm; uniform float uWarn; uniform float uDust; uniform float uAir; uniform float uCold;',
    'uniform float uKick; uniform float uCine; uniform float uTitle; uniform float uInside; uniform float uSnap;',
    'uniform float uFlash; uniform float uShock; uniform float uGlitch; uniform float uGlow; uniform float uFilter;',
    'uniform float uTeal; uniform float uHeat; uniform float uHorizon;',
    'varying vec2 vUv;',
    'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y); }',
    'float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }',
    'float inv(float a, float b, float x){ return 1.0 - smoothstep(a, b, x); }',   // 1 below a, fading to 0 at b
    'float seg(vec2 p, vec2 a, vec2 b, float w){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return inv(0.0, w, length(pa - ba * h)); }',
    'float disc(vec2 p, vec2 c, float r, float soft){ return inv(r * (1.0 - soft), r, length(p - c)); }',
    'float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    'float crosses(vec2 uv, float aspect){ vec2 cell = abs(fract(vec2(uv.x * aspect, uv.y) * 4.0 + 0.5) - 0.5) / 4.0; return step(min(cell.x, cell.y), 0.0013) * step(max(cell.x, cell.y), 0.017); }',
    'vec3 heat(float t){ vec3 a = vec3(0.02, 0.0, 0.14); vec3 b = vec3(0.46, 0.02, 0.6); vec3 c = vec3(0.95, 0.26, 0.2); vec3 e = vec3(1.0, 0.76, 0.12); vec3 f = vec3(1.0, 1.0, 0.92);',
    '  return t < 0.25 ? mix(a, b, t / 0.25) : (t < 0.5 ? mix(b, c, (t - 0.25) / 0.25) : (t < 0.75 ? mix(c, e, (t - 0.5) / 0.25) : mix(e, f, (t - 0.75) / 0.25))); }',
    // highlights roll off gently instead of clipping; everything below 0.82 is untouched
    'vec3 shoulder(vec3 x){ vec3 t = max(x - 0.82, 0.0); return min(x, vec3(0.82)) + 0.18 * (1.0 - exp(-t / 0.18)); }',
    'void main(){',
    '  float asp = uRes.x / uRes.y;',
    '  vec2 uv = vUv;',
    '  float tq = floor(uTime * 18.0);',
    // film gate weave during the films
    '  uv += uCine * uMotion * (vec2(noise(vec2(uTime * 7.0, 1.3)), noise(vec2(2.1, uTime * 6.0))) - 0.5) * 0.0018;',
    // storm interference: thin bands of the picture slip sideways
    '  float tear = step(0.992 - uStorm * 0.03, noise(vec2(uv.y * 38.0, tq)));',
    '  uv.x += tear * uStorm * uMotion * (hash(vec2(tq, floor(uv.y * 90.0))) - 0.5) * 0.02;',
    '  if (uGlitch > 0.001) { float band = floor(uv.y * 34.0 + uTime * 9.0); float rg = hash(vec2(band, floor(uTime * 22.0))); if (rg > 0.78) uv.x += (rg - 0.89) * 0.5 * uGlitch * uMotion; }',
    // heat shimmer: hot air near the ground bends light a little differently from moment to moment, so the horizon wobbles
    '  if (uHeat > 0.001) { float hb = inv(0.0, 0.07, abs(uv.y - uHorizon + 0.01)) * uHeat * uMotion;',
    '    uv.x += (noise(vec2(uv.y * 170.0, uTime * 3.2)) - 0.5) * 0.003 * hb; uv.y += (noise(vec2(uv.x * 95.0, uTime * 2.5 + 5.0)) - 0.5) * 0.0011 * hb; }',
    '  vec2 cc = uv - 0.5, ca = vec2(cc.x * asp, cc.y);',
    '  float r2 = dot(cc, cc), rr = length(ca);',
    // colour fringing, stronger toward the corners and when something hits hard
    '  float ab = (0.5 + 3.0 * uKick + 4.0 * uShock + 1.6 * uStorm + 0.8 * uCine) * r2 * 0.018;',
    '  vec3 c = vec3(texture2D(tScene, uv + cc * ab).r, texture2D(tScene, uv).g, texture2D(tScene, uv - cc * ab).b);',
    '  if (uShock > 0.001) { vec3 acc = c; for (int i = 1; i < 6; i++) acc += texture2D(tScene, uv - cc * uShock * 0.035 * float(i)).rgb; c = acc / 6.0; }',
    '  if (uHeat > 0.001) { float below = uHorizon - uv.y;',
    '    float mw = smoothstep(0.0, 0.008, below) * (1.0 - smoothstep(0.02, 0.045, below)) * uHeat;',
    '    if (mw > 0.001) { vec2 mu = vec2(uv.x + (noise(vec2(uv.y * 320.0, uTime * 4.0)) - 0.5) * 0.004 * uMotion, uHorizon + below * 1.3 + 0.003);',
    '      c = mix(c, texture2D(tScene, mu).rgb * vec3(0.94, 0.98, 1.06) + 0.02, mw * 0.42); } }',
    // glow
    '  vec3 bloom = texture2D(tBloomA, uv).rgb * 0.55 + texture2D(tBloomB, uv).rgb * 0.6 * uFull;',
    '  c += bloom * (uBloom + uGlow * 0.8);',
    '  c += texture2D(tStreak, uv).rgb * uStreakTint * uStreakAmt * uFull;',
    // sun flare: is the Sun really visible? read the picture right where it should be
    '  if (uSunVis > 0.001) {',
    '    vec2 sp = uSun; float lum = 0.0;',
    '    if (sp.x > 0.0 && sp.x < 1.0 && sp.y > 0.0 && sp.y < 1.0) {',
    '      vec2 o = vec2(0.006 / asp, 0.006);',
    '      vec3 s = texture2D(tScene, sp).rgb + texture2D(tScene, sp + o).rgb + texture2D(tScene, sp - o).rgb',
    '             + texture2D(tScene, sp + vec2(o.x, -o.y)).rgb + texture2D(tScene, sp + vec2(-o.x, o.y)).rgb;',
    '      s *= 0.2; lum = max(s.r, max(s.g, s.b));',
    '    }',
    '    float occ = smoothstep(uOccLo, uOccLo + 0.35, lum) * uSunVis;',
    '    vec2 sa = vec2((sp.x - 0.5) * asp, sp.y - 0.5), d = ca - sa;',
    '    float dl = length(d), ang = atan(d.y, d.x);',
    '    vec3 warm = mix(vec3(1.0, 0.97, 0.92), vec3(1.0, 0.86, 0.66), uSite);',
    '    float rays = pow(noise(vec2(ang * 9.0, 3.0)) * noise(vec2(ang * 23.0 + 5.0, 1.0)), 2.0);',
    '    c += warm * occ * (exp(-dl * 9.0) * 0.35 + rays * exp(-dl * 4.5) * 0.5);',
    // ghosts: little coloured rings lined up through the middle of the lens
    '    vec2 ax = -sa; vec3 g = vec3(0.0);',
    '    g += vec3(0.35, 0.7, 1.0) * disc(ca, sa + ax * 0.55, 0.035, 0.6) * 0.18;',
    '    g += vec3(0.6, 1.0, 0.55) * disc(ca, sa + ax * 1.25, 0.06, 0.3) * 0.10;',
    '    g += vec3(1.0, 0.5, 0.85) * disc(ca, sa + ax * 1.6, 0.022, 0.8) * 0.22;',
    '    g += mix(vec3(0.5, 0.6, 1.0), vec3(1.0, 0.55, 0.3), uSite) * disc(ca, sa + ax * 2.1, 0.13, 0.15) * 0.06;',
    '    float halo = inv(0.0, 0.03, abs(length(ca) - 0.42 - 0.1 * length(sa))) * 0.04;',
    '    g += vec3(1.0, 0.7, 0.9) * halo;',
    '    c += g * occ * (1.0 - 0.6 * uInside);',
    '  }',
    '  c = shoulder(c + uFlash);',
    // the grade: Moon = cold Apollo slide film, Mars = warm rover camera, inside = cosy lamp light
    '  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '  vec3 shadowT = mix(vec3(0.86, 0.95, 1.10), vec3(0.98, 0.84, 0.78), uSite);',
    '  vec3 highT = mix(vec3(1.03, 1.00, 0.96), vec3(1.05, 0.99, 0.90), uSite);',
    '  c *= mix(shadowT, highT, smoothstep(0.0, 0.5, L));',
    '  c = mix(c, c * vec3(1.08, 1.0, 0.86), uInside);',
    '  float sat = mix(0.88, 1.08, uSite) + 0.06 * uInside + 0.08 * uTitle;',
    '  L = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '  c = max(mix(vec3(L), c, sat), 0.0);',
    '  float con = mix(1.10, 1.08, uSite);',
    '  c = max((c - 0.16) * con + 0.16, 0.0) * mix(0.97, 1.0, uSite);',
    '  if (uTeal > 0.001) { float Lt = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '    vec3 split = mix(vec3(0.82, 0.97, 1.08), vec3(1.08, 0.98, 0.84), smoothstep(0.06, 0.6, Lt));',
    '    split = mix(split, vec3(0.92, 1.0, 1.1), clamp((c.b - max(c.r, c.g)) * 4.0, 0.0, 1.0));',     // blue sky stays blue: only warm things are warmed
    '    c = mix(c, c * split, uTeal);',
    '    c = max(mix(vec3(Lt), c, 1.0 + 0.14 * uTeal), 0.0); c = max((c - 0.18) * (1.0 + 0.12 * uTeal) + 0.18, 0.0); }',
    // Mars dust: moving sheets of haze
    '  if (uDust > 0.001) {',
    '    float hz = fbm(vec2(uv.x * 2.4 * asp - uTime * 0.22 * uMotion, uv.y * 3.0 + uTime * 0.03));',
    '    vec3 haze = vec3(0.86, 0.62, 0.42) * (0.55 + 0.6 * L);',
    '    c = mix(c, haze, uDust * (0.12 + 0.38 * hz) * (0.6 + 0.4 * (1.0 - uv.y)));',
    '  }',
    // radiation storm: aurora at the edges and streaks of light
    '  float edge = smoothstep(0.2, 0.75, rr);',
    '  if (uStorm + uWarn > 0.001) {',
    '    float a = fbm(vec2(atan(ca.y, ca.x) * 2.5 + uTime * 0.25 * uMotion, rr * 5.0 - uTime * 0.9 * uMotion));',
    '    c += vec3(1.0, 0.22, 0.72) * edge * a * uStorm * 0.55;',
    '    c += vec3(0.25, 1.0, 0.75) * edge * edge * (1.0 - a) * uStorm * 0.18;',
    '    c += vec3(1.0, 0.25, 0.65) * edge * edge * uWarn * (0.10 + 0.08 * sin(uTime * 6.0));',
    '    if (uMotion > 0.5) {',
    '      for (int i = 0; i < 9; i++) {',
    '        float fi = float(i), ph = uTime * 7.0 + fi * 0.37, slot = floor(ph), age = fract(ph);',
    '        if (hash(vec2(slot, fi)) < uStorm * 0.6) {',
    '          vec2 p = vec2((hash(vec2(slot + 1.3, fi)) - 0.5) * asp, hash(vec2(slot + 7.1, fi)) - 0.5);',
    '          float an = hash(vec2(slot, fi + 3.0)) * 6.2832, ln = 0.01 + 0.07 * hash(vec2(fi, slot + 2.0));',
    '          vec2 dir = vec2(cos(an), sin(an)) * ln;',
    '          float fade = pow(1.0 - age, 4.0);',
    '          c += vec3(1.0, 0.92, 1.0) * fade * (seg(ca, p, p + dir, 0.0022) * 1.6 + disc(ca, p, 0.012, 1.0) * 0.5);',
    '        }',
    '      }',
    '    }',
    '  }',
    // cold and dark: frost creeps in from the visor edges
    '  if (uCold > 0.001) {',
    '    float fr = fbm(ca * 7.0 + 3.0), ridge = 1.0 - abs(fbm(ca * 16.0) * 2.0 - 1.0);',
    '    float m = smoothstep(0.42, 0.85, rr + (fr - 0.5) * 0.4) * uCold;',
    '    c = mix(c, vec3(0.72, 0.84, 0.98) * (0.35 + 0.8 * L), m * (0.25 + 0.5 * pow(ridge, 5.0)));',
    '  }',
    // low air: the view narrows and fades, pulsing like breathing
    '  if (uAir > 0.001) {',
    '    float br = 0.5 + 0.5 * sin(uTime * (1.6 + uAir * 1.4));',
    '    float tun = smoothstep(0.18, 0.72, rr) * uAir * (0.65 + 0.35 * br * uMotion);',
    '    L = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '    c = mix(c, vec3(L) * vec3(0.85, 0.92, 1.05), uAir * 0.55);',
    '    c *= 1.0 - tun * 0.9;',
    '  }',
    // warm light leak drifting across the title and the films
    '  float leakAmt = max(uTitle, uCine * 0.6);',
    '  if (leakAmt > 0.001) {',
    '    vec2 lp = vec2(-0.75 * asp + 0.25 * sin(uTime * 0.11), 0.45 + 0.1 * sin(uTime * 0.07));',
    '    c += mix(vec3(1.0, 0.42, 0.18), vec3(1.0, 0.6, 0.25), uSite) * inv(0.0, 1.1, length(ca - lp)) * 0.06 * leakAmt;',
    '    vec2 lq = vec2(0.8 * asp, -0.5 + 0.1 * cos(uTime * 0.09));',
    '    c += vec3(0.3, 0.45, 1.0) * inv(0.0, 0.9, length(ca - lq)) * 0.04 * leakAmt;',
    '  }',
    // soft dark corners
    '  float vig = inv(0.28, 1.05, length(ca * vec2(0.85, 1.0)));',
    '  c *= mix(1.0, vig, 0.5 + 0.25 * uCine + 0.2 * uSnap + 0.18 * uTeal);',
    // postcard photo: the black cross marks of an Apollo Hasselblad camera
    '  if (uSnap > 0.001) {',
    '    float sp2 = uRes.y / 5.0; vec2 px = vUv * uRes - uRes * 0.5;',
    '    vec2 f = mod(px + sp2 * 0.5, sp2) - sp2 * 0.5;',
    '    float arm = sp2 * 0.07, w = max(0.8, uRes.y / 900.0);',
    '    float cr = max(step(abs(f.x), arm) * step(abs(f.y), w), step(abs(f.y), arm) * step(abs(f.x), w));',
    '    c = mix(c, vec3(0.015), cr * min(1.0, uSnap * 1.5) * 0.85);',
    '  }',
    '  vec4 outC = linearToOutputTexel(vec4(c, 1.0));',
    // space-camera filters (key L)
    '  if (uFilter > 0.5) {',
    '    vec3 col = outC.rgb;',
    '    if (uFilter < 1.5) {',
    '      float g = luma(col); col = mix(col, vec3(g), 0.5); col = col * vec3(1.03, 1.0, 0.93) + vec3(0.0, 0.014, 0.034) * (1.0 - g); col = (col - 0.5) * 1.14 + 0.5;',
    '      col = mix(col, vec3(0.03), crosses(vUv, asp) * 0.85);',
    '    } else if (uFilter < 2.5) {',
    '      float g2 = (luma(col) - 0.5) * 1.3 + 0.52; col = vec3(g2) * (1.0 - smoothstep(0.6, 0.72, rr)) * (0.95 + 0.05 * sin(vUv.y * uRes.y * 1.4));',
    '    } else if (uFilter < 3.5) {',
    '      float g3 = luma(col); col = g3 + (col - g3) * 2.7; col = (col - 0.5) * 1.1 + 0.5;',
    '    } else { col = heat(clamp(luma(col) * 1.08, 0.0, 1.0)); }',
    '    outC.rgb = clamp(col, 0.0, 1.0);',
    '  }',
    // film grain, after the colour is final so it looks even everywhere
    '  float seed = uMotion > 0.5 ? fract(uTime * 7.31) * 91.0 : 0.0;',
    '  float gr = hash(floor(vUv * uRes) + seed) - 0.5;',
    '  float amt = 0.035 + 0.035 * uCine + 0.035 * uDust + 0.03 * uStorm + 0.02 * uTitle;',
    '  outC.rgb += gr * amt * (1.0 - 0.5 * dot(outC.rgb, vec3(0.33)));',
    '  gl_FragColor = outC;',
    '}'].join('\n');

  function mat(frag, uniforms) {
    return new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms: uniforms, depthTest: false, depthWrite: false });
  }
  function target(w, h, o) {
    var t = new T.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), Object.assign({
      type: fType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false, stencilBuffer: false }, o || {}));
    t.texture.generateMipmaps = false;
    return t;
  }

  function build(renderer) {
    R = renderer; built = true;
    gl2 = !!renderer.capabilities.isWebGL2;
    var ex = renderer.extensions;
    fType = gl2 && (ex.has('EXT_color_buffer_float') || ex.has('EXT_color_buffer_half_float')) ? T.HalfFloatType : T.UnsignedByteType;
    pScene = new T.Scene(); pCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quad = new T.Mesh(new T.PlaneGeometry(2, 2), null); quad.frustumCulled = false; pScene.add(quad);
    var tx = function () { return { value: new T.Vector2() }; };
    M.bright = mat(BRIGHT, { tSrc: { value: null }, uTexel: tx(), uThresh: { value: 1.05 }, uKnee: { value: 0.2 }, uCap: { value: 0.5 } });
    M.down = mat(DOWN, { tSrc: { value: null }, uTexel: tx() });
    M.blur = mat(BLUR, { tSrc: { value: null }, uDir: tx() });
    M.streak = mat(STREAK, { tSrc: { value: null }, uTexel: tx() });
    M.final = mat(FINAL, {
      tScene: { value: null }, tBloomA: { value: null }, tBloomB: { value: null }, tStreak: { value: null },
      uRes: tx(), uTime: { value: 0 }, uMotion: { value: reduce ? 0 : 1 }, uFull: { value: 1 },
      uSun: tx(), uSunVis: { value: 0 }, uOccLo: { value: 0.6 }, uSite: { value: 1 },
      uBloom: { value: 0.8 }, uStreakAmt: { value: 0.6 }, uStreakTint: { value: new T.Color(0.55, 0.75, 1.0) },
      uStorm: { value: 0 }, uWarn: { value: 0 }, uDust: { value: 0 }, uAir: { value: 0 }, uCold: { value: 0 },
      uKick: { value: 0 }, uCine: { value: 0 }, uTitle: { value: 0 }, uInside: { value: 0 }, uSnap: { value: 0 },
      uFlash: { value: 0 }, uShock: { value: 0 }, uGlitch: { value: 0 }, uGlow: { value: 0 }, uFilter: { value: 0 },
      uTeal: { value: 0 }, uHeat: { value: 0 }, uHorizon: { value: 0.5 }
    });
  }

  function sizeTargets(w, h) {
    var want = FX.level >= 2 && gl2 ? 4 : 0;
    if (w === bw && h === bh && want === msaa && rt.scene) return;
    for (var k in rt) rt[k].dispose();
    rt = {}; bw = w; bh = h; msaa = want;
    rt.scene = target(w, h, { depthBuffer: true, samples: want });
    var w2 = w >> 1, h2 = h >> 1, w4 = w >> 2, h4 = h >> 2, w8 = w >> 3, h8 = h >> 3;
    rt.half = target(w2, h2);
    rt.q1 = target(w4, h4); rt.q2 = target(w4, h4);
    rt.e1 = target(w8, h8); rt.e2 = target(w8, h8);
    rt.streak = target(w8, h4);
  }

  function pass(m, out) { quad.material = m; R.setRenderTarget(out || null); R.render(pScene, pCam); }
  function blur2(a, b, w, h, spread) {
    var u = M.blur.uniforms;
    u.tSrc.value = a.texture; u.uDir.value.set(spread / w, 0); pass(M.blur, b);
    u.tSrc.value = b.texture; u.uDir.value.set(0, spread / h); pass(M.blur, a);
  }

  function ease(key, want, dt, speed) { S[key] += (want - S[key]) * Math.min(1, dt * (speed || 3)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // The colour grade of each planet. warm blends the shader between a cold Apollo slide film (0) and a warm rover
  // camera (1); occLo, bloom, streak, tint: lens flare and glow; cold: how blue the night goes; glowFrom, glowCap: what is bright enough to glow.
  // teal: a desert-film grade, teal shadows and warm highlights; heat: shimmer and a mirage at the horizon on a hot, clear day;
  // heatAt: [distance, height] of the far ground where the mirage shows (the foot of Sahrun's dune ring), else the eye-level horizon.
  var GRADES = {
    moon: { warm: 0, occLo: 0.55, bloom: 0.45, streak: 0.9, tint: [0.5, 0.72, 1.0], cold: 0.8, glowFrom: 1.3, glowCap: 1.2 },
    mars: { warm: 1, occLo: 1.0, bloom: 0.4, streak: 0.55, tint: [1.0, 0.72, 0.45], cold: 0.7, glowFrom: 1.5, glowCap: 0.3 },
    // Sahrun (made up): sun-bleached and golden, between the two: warm light but neutral shadows, a soft golden glare
    sahrun: { warm: 0.6, occLo: 1.0, bloom: 0.5, streak: 0.7, tint: [1.0, 0.82, 0.55], cold: 0.55, glowFrom: 1.45, glowCap: 0.35, teal: 1, heat: 1, heatAt: [430, 23] }
  };
  var GR = GRADES.mars;
  function readGame(dt, camera) {
    var W = JA.world, G = JA.game || {}, s = G.s, mode = G.mode || 'title', env = W.env;
    var out = mode === 'play';
    GR = JA.pick(W.site || 'mars', GRADES);
    var phase = s && JA.sim && JA.sim.stormPhase ? JA.sim.stormPhase(s) : '';
    S.site = GR.warm; S.teal = GR.teal || 0;
    ease('storm', env.stormShown * (out ? 1 : mode === 'inside' ? 0.15 : 0.6), dt, 4);
    ease('warn', out && phase === 'warning' ? 1 : 0, dt, 3);
    var dAir = env.dustAir != null ? env.dustAir : env.dustShown;      // a haboob: the air is clear until its wall arrives
    ease('dust', JA.siteOf(W.site || 'mars').dusty ? dAir : 0, dt, 2);
    ease('air', s && (out || mode === 'inside') ? clamp((28 - s.air) / 24, 0, 1) : 0, dt, 1.5);
    ease('cold', out ? clamp((env.dark - 0.55) / 0.4, 0, 1) * GR.cold : 0, dt, 0.6);
    ease('cine', W.cam.mode === 'cine' || mode === 'intro' || mode === 'launch' ? 1 : 0, dt, 2);
    ease('title', mode === 'title' || mode === 'brief' ? 1 : 0, dt, 2);
    ease('inside', mode === 'inside' ? 1 : 0, dt, 2.5);
    S.kick = clamp(W.cam.shake * 2.2, 0, 1);
    // where is the Sun on screen, and is it in front of us?
    camera.getWorldDirection(fwd);
    var front = fwd.dot(W.sunDir);
    v1.copy(camera.position).addScaledVector(W.sunDir, 1000).project(camera);
    var sx = v1.x * 0.5 + 0.5, sy = v1.y * 0.5 + 0.5;
    var onScreen = clamp(1 - (Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5)) - 0.5) / 0.4, 0, 1);   // fades out just past the screen edge
    var vis = front > 0.05 ? clamp((front - 0.05) * 4, 0, 1) * onScreen : 0;
    M.final.uniforms.uSun.value.set(sx, sy);
    ease('sunVis', vis * (1 - S.dust * 0.85), dt, 6);
    // a hot, clear day outside: where is the horizon on screen? (a point far ahead, at eye height)
    ease('heat', out && GR.heat ? GR.heat * clamp(1 - dAir * 3, 0, 1) * clamp(1 - env.dark * 2, 0, 1) : 0, dt, 1);
    if (S.heat > 0.001) {
      hz = hz || new T.Vector3();
      var ha = GR.heatAt || [3000, null];
      hz.set(fwd.x, 0, fwd.z).normalize().multiplyScalar(ha[0]).add(camera.position);
      if (ha[1] != null) hz.y = ha[1];
      hz.project(camera);
      S.horizon = hz.y * 0.5 + 0.5;
    }
  }

  function setUniforms(w, h) {
    var u = M.final.uniforms, full = FX.level >= 2;
    u.uRes.value.set(w, h); u.uTime.value = time; u.uFull.value = full ? 1 : 0;
    u.uSite.value = S.site; u.uSunVis.value = S.sunVis; u.uOccLo.value = GR.occLo;
    u.uBloom.value = GR.bloom + 0.15 * S.title + 0.2 * S.cine;
    u.uStreakAmt.value = GR.streak + 0.5 * S.cine;
    u.uStreakTint.value.setRGB(GR.tint[0], GR.tint[1], GR.tint[2]);
    u.uStorm.value = S.storm; u.uWarn.value = S.warn; u.uDust.value = S.dust; u.uAir.value = S.air; u.uCold.value = S.cold;
    u.uKick.value = reduce ? 0 : S.kick; u.uCine.value = S.cine; u.uTitle.value = S.title; u.uInside.value = S.inside;
    u.uSnap.value = clamp(snapT / 1.6, 0, 1);
    u.uFlash.value = PU.flash; u.uShock.value = PU.shock; u.uGlitch.value = PU.glitch; u.uGlow.value = PU.glow; u.uFilter.value = FX.filter;
    u.uTeal.value = S.teal * (1 - 0.7 * S.inside); u.uHeat.value = S.heat; u.uHorizon.value = S.horizon;
  }

  // watch the frame rate while playing and step down if it struggles
  function watchPerf(dt) {
    if (userSet || FX.level === 0) return;
    perfT += dt; perfSum += dt; perfN++;
    if (perfT < 4) return;
    var avg = perfSum / perfN;
    perfT = perfSum = perfN = 0;
    if (avg > 1 / 38) setLevel(FX.level - 1, false);
  }

  function setLevel(n, byUser) {
    FX.level = (n + 3) % 3; FX.on = FX.level > 0 && !failed;
    if (byUser) { userSet = true; try { localStorage.setItem(KEY, String(FX.level)); } catch (e) {} }
    document.body.classList.toggle('fx-on', FX.level > 0);
    bw = 0;   // rebuild targets (MSAA may change)
  }
  FX.setLevel = function (n) { setLevel(n, true); return FX.level; };
  FX.nextLevel = function () { return FX.setLevel(FX.level === 0 ? 2 : FX.level - 1); };     // full, lite, off, full...
  FX.setOn = function (v) { return FX.setLevel(v ? (JA.world && JA.world.lite ? 1 : 2) : 0) > 0; };
  FX.available = function () { return !failed; };
  FX.setFilter = function (i) { var n = FX.FILTERS.length; FX.filter = ((i % n) + n) % n; return FX.FILTERS[FX.filter]; };
  FX.nextFilter = function () { return FX.setFilter(FX.filter + 1); };
  FX.current = function () { return FX.FILTERS[FX.filter]; };
  FX.pulse = function (kind, amount) {
    if (PU[kind] == null || (reduce && (kind === 'shock' || kind === 'glitch'))) return;
    PU[kind] = Math.max(PU[kind], amount == null ? 1 : amount);
  };
  FX.snap = function () { snapT = 1.6; };
  FX.look = S;   // read-only view of the live look values (for testing)

  FX.render = function (renderer, scene, camera, dt) {
    if (FX.level === 0 || failed) return false;
    try {
      if (!built) build(renderer);
      renderer.getDrawingBufferSize(v2);
      var w = v2.x | 0, h = v2.y | 0;
      if (w < 16 || h < 16) return false;
      sizeTargets(w, h);
      time += dt; snapT = Math.max(0, snapT - dt);
      PU.flash *= Math.exp(-dt * 6); PU.shock *= Math.exp(-dt * 4.5); PU.glitch *= Math.exp(-dt * 5); PU.glow *= Math.exp(-dt * 2.4);
      readGame(dt, camera);
      var G = JA.game;
      if (G && G.mode === 'play') { playT += dt; if (playT > 3) watchPerf(dt); } else playT = 0;   // skip the loading hiccup when a day starts

      R.setRenderTarget(rt.scene); R.render(scene, camera);

      var ub = M.bright.uniforms;
      ub.tSrc.value = rt.scene.texture; ub.uTexel.value.set(1 / w, 1 / h);
      ub.uThresh.value = GR.glowFrom; ub.uCap.value = GR.glowCap;   // only real lights glow, not bright ground
      pass(M.bright, rt.half);
      var ud = M.down.uniforms;
      ud.tSrc.value = rt.half.texture; ud.uTexel.value.set(1 / (w >> 1), 1 / (h >> 1)); pass(M.down, rt.q1);
      blur2(rt.q1, rt.q2, w >> 2, h >> 2, 1.0);
      if (FX.level >= 2) {
        ud.tSrc.value = rt.q1.texture; ud.uTexel.value.set(1 / (w >> 2), 1 / (h >> 2)); pass(M.down, rt.e1);
        blur2(rt.e1, rt.e2, w >> 3, h >> 3, 1.6);
        blur2(rt.e1, rt.e2, w >> 3, h >> 3, 2.4);
        var us = M.streak.uniforms;
        us.tSrc.value = rt.half.texture; us.uTexel.value.set(1 / (w >> 3), 1 / (h >> 2));
        pass(M.streak, rt.streak);
      }
      var u = M.final.uniforms;
      u.tScene.value = rt.scene.texture; u.tBloomA.value = rt.q1.texture;
      u.tBloomB.value = FX.level >= 2 ? rt.e1.texture : rt.q1.texture;
      u.tStreak.value = FX.level >= 2 ? rt.streak.texture : rt.q2.texture;
      setUniforms(w, h);
      pass(M.final, null);
      if (!checked) {   // a shader that did not compile draws nothing: fall back to the plain picture
        checked = true;
        for (var k in M) { var pr = R.properties.get(M[k]).currentProgram; if (pr && pr.diagnostics && !pr.diagnostics.runnable) throw new Error('shader ' + k + ' did not compile'); }
      }
      return true;
    } catch (e) {
      failed = true; FX.failed = true; FX.on = false;
      if (window.console) console.warn('Visual effects turned off:', e);
      R && R.setRenderTarget(null);
      document.body.classList.remove('fx-on');
      return false;
    }
  };

  if (document.body) document.body.classList.toggle('fx-on', FX.level > 0);
})(window.JA);
