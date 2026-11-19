shader_type spatial;
render_mode unshaded, fog_disabled, shadows_disabled;
// Earth as seen from the Moon, painted by noise on the GPU (the web version painted the same climate maps on a canvas):
// continents from warped fractal noise (about 30% land), climate bands by latitude (dark rainforest near the equator,
// tan deserts around 25 degrees, green and brown middle latitudes, dark boreal forest, grey tundra, ice caps), deep and
// shallow ocean, clouds (storms near the equator, swirls in the middle latitudes, clear skies over the deserts) and city
// lights on the night side. It is lit from the real Sun direction, so its phase changes through the day: sunlight glints
// off the oceans, the day side ends in a soft warm edge and a thin blue atmosphere glows around the rim.

uniform vec3 sun_dir = vec3(0.4, 0.5, 0.7);
uniform float cloud_shift = 0.0;

varying vec3 obj_p;
varying vec3 world_n;
varying vec3 world_p;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
	vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
		mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int o = 0; o < 6; o++) { if (o >= oct) break; s += n3(p) * a; n += a; a *= 0.5; p *= 2.03; } return s / n; }
float sm(float a, float b, float x) { return smoothstep(a, b, x); }

void vertex() {
	obj_p = normalize(VERTEX);
	world_n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	world_p = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec3 p = obj_p;
	float lat = asin(clamp(p.y, -1.0, 1.0)); float al = abs(lat) * 57.3;
	float wx = fbm(p * 1.3 + vec3(7.0, 0.0, 0.0), 2) - 0.5, wz = fbm(p * 1.3 + vec3(0.0, 3.0, 9.0), 2) - 0.5;
	float land = fbm(vec3(p.x * 1.55 + wx * 1.4, p.y * 1.55 + 11.0, p.z * 1.55 + wz * 1.4), 4);
	float e = land - 0.56;
	float dry = fbm(p * 3.1 + vec3(21.0, 0.0, 0.0), 3);
	vec3 col; float ocean = 0.0;
	if (e > 0.0) {
		float hgt = sm(0.02, 0.14, e);
		float desert = sm(14.0, 22.0, al) * (1.0 - sm(33.0, 42.0, al)) * sm(0.38, 0.6, dry + 0.12);
		float tropic = 1.0 - sm(10.0, 20.0, al), boreal = sm(48.0, 58.0, al), tundra = sm(62.0, 70.0, al);
		col = mix(vec3(104.0, 116.0, 66.0), vec3(50.0, 94.0, 40.0), tropic);
		col = mix(col, vec3(44.0, 66.0, 44.0), boreal * (1.0 - tundra));
		col = mix(col, vec3(128.0, 122.0, 104.0), tundra);
		col = mix(col, vec3(216.0, 178.0, 122.0), desert);
		col = mix(col, vec3(120.0, 108.0, 96.0), hgt * 0.6);
		float ice = max(sm(68.0, 76.0, al + (dry - 0.5) * 14.0), lat < 0.0 ? sm(60.0, 66.0, al) : 0.0);
		col = mix(col, vec3(240.0, 244.0, 250.0), ice);
	} else {
		float deep = sm(0.0, 0.12, -e);
		col = mix(vec3(34.0, 104.0, 168.0), vec3(8.0, 34.0, 104.0), deep);
		float sea_ice = sm(70.0, 80.0, al + (dry - 0.5) * 10.0);
		col = mix(col, vec3(218.0, 228.0, 238.0), sea_ice);
		ocean = 1.0 - sea_ice;
	}
	col = pow(col / 255.0, vec3(2.2));
	// clouds turn with their own drift
	float ca = cloud_shift * 6.2832; mat2 r = mat2(vec2(cos(ca), -sin(ca)), vec2(sin(ca), cos(ca)));
	vec3 q = p; q.xz = r * q.xz;
	float sw = fbm(vec3(q.x * 2.2 + 31.0, q.y * 5.5, q.z * 2.2 + 5.0), 2) - 0.5;
	float cl1 = fbm(vec3(q.x * 3.4 + sw * 2.6 + 40.0, q.y * 8.5 + sw * 1.5, q.z * 3.4 - sw * 2.6), 5);
	float belt = 0.16 * (1.0 - sm(4.0, 12.0, abs(lat * 57.3 - 5.0))) + 0.12 * sm(35.0, 48.0, al) * (1.0 - sm(66.0, 78.0, al)) - 0.1 * sm(14.0, 22.0, al) * (1.0 - sm(28.0, 36.0, al));
	float cl = sm(0.5, 0.86, cl1 + belt + (n3(q * 22.0) - 0.5) * 0.08) * 0.85;
	float lights = 0.0;
	if (e > 0.0 && e < 0.07 && al < 62.0) lights = sm(0.72, 0.9, n3(p * 60.0 + vec3(5.0, 0.0, 2.0))) * (1.0 - sm(0.03, 0.07, e));
	vec3 n = normalize(world_n), v = normalize(CAMERA_POSITION_WORLD - world_p), s = normalize(sun_dir);
	float ndl = dot(n, s), diff = max(ndl, 0.0);
	vec3 c = col * (1.0 - cl * 0.3) * diff * 1.3;
	vec3 hv = normalize(s + v);
	c += vec3(1.0, 0.94, 0.82) * pow(max(dot(n, hv), 0.0), 60.0) * ocean * (1.0 - cl) * step(0.0, ndl) * 0.9;
	c = mix(c, vec3(diff * 1.25), cl * 0.9);
	c *= mix(vec3(1.0, 0.72, 0.55), vec3(1.0), smoothstep(0.0, 0.35, ndl));
	float night = 1.0 - smoothstep(-0.15, 0.08, ndl);
	c += vec3(1.0, 0.745, 0.43) * lights * night * (1.0 - cl * 0.85) * 1.6;
	float fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);
	c += vec3(0.30, 0.55, 1.0) * fres * smoothstep(-0.25, 0.55, ndl) * 1.1;
	ALBEDO = c;
}
