shader_type sky;
// Astro Outpost sky: the web version's sky dome, Sun glow sprite and star points in one shader.
// Colours are linear values, as in the web version. In the cubemap pass (the light the scene receives) it is the old
// hemisphere light instead: the sky colour from above, the ground colour from below.

uniform vec3 zenith = vec3(0.0);
uniform vec3 horizon = vec3(0.0);
uniform vec3 glow_col = vec3(1.0);
uniform vec3 sun_dir = vec3(0.4, 0.5, 0.7);
uniform float glow_amt = 1.0;
uniform float sun_size = 0.069;          // the glow sprite's half size, as an angle
uniform float sun_opacity = 1.0;
uniform vec3 sun_tint = vec3(1.0);
uniform float star_opacity = 0.9;
uniform vec3 sky_amb = vec3(0.6);
uniform vec3 ground_amb = vec3(0.2);
uniform float amb_energy = 0.4;

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

vec3 stars(vec3 d) {
	if (d.y < 0.02) return vec3(0.0);
	vec3 col = vec3(0.0);
	// two layers: many faint white stars, and a few brighter ones, some warm and some cool
	for (int layer = 0; layer < 2; layer++) {
		float scale = layer == 0 ? 180.0 : 60.0;
		vec3 p = d * scale;
		vec3 cell = floor(p);
		float h = hash13(cell + float(layer) * 17.0);
		float keep = layer == 0 ? 0.93 : 0.985;
		if (h > keep) {
			vec3 jitter = vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 4.1)) * 0.8 + 0.1;
			float dist = length(p - (cell + jitter));
			float size = layer == 0 ? 0.09 : 0.11;
			float s = smoothstep(size, size * 0.3, dist);
			vec3 tint = layer == 0 ? vec3(1.0) : (hash13(cell + 9.0) < 0.3 ? vec3(1.0, 0.86, 0.7) : vec3(0.8, 0.9, 1.0));
			col += tint * s * (layer == 0 ? 0.9 : 1.4);
		}
	}
	return col;
}

void sky() {
	vec3 d = normalize(EYEDIR);
	if (AT_CUBEMAP_PASS) {
		float k = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
		COLOR = mix(ground_amb, sky_amb, k) * amb_energy;
	} else {
		float h = clamp(d.y, 0.0, 1.0);
		vec3 c = mix(horizon, zenith, pow(h, 0.45));
		vec3 sd = normalize(sun_dir);
		float s = max(dot(d, sd), 0.0);
		c += glow_col * (pow(s, 40.0) * 0.5 + pow(s, 5.0) * 0.14) * glow_amt;
		c += stars(d) * star_opacity;
		// the Sun: a white core in a warm glow (additive, like the web version's sprite)
		float ang = acos(clamp(dot(d, sd), -1.0, 1.0)) / sun_size;
		vec4 g;
		if (ang < 0.1) g = mix(vec4(1.0), vec4(1.0, 0.988, 0.92, 1.0), ang / 0.1);
		else if (ang < 0.2) g = mix(vec4(1.0, 0.988, 0.92, 1.0), vec4(1.0, 0.9, 0.667, 0.45), (ang - 0.1) / 0.1);
		else g = mix(vec4(1.0, 0.9, 0.667, 0.45), vec4(1.0, 0.784, 0.47, 0.0), clamp((ang - 0.2) / 0.8, 0.0, 1.0));
		c += g.rgb * g.a * sun_tint * sun_opacity * (ang < 0.1 ? 3.0 : 1.0);
		COLOR = c;
	}
}
