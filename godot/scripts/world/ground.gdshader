shader_type spatial;
// The ground: colours painted per vertex (the same maths as the web version), a tiling patch of real regolith
// baked in Blender (grain, craterlets, pebbles) on top, and on the Moon the permanently shadowed ice crater:
// with the Sun only a few degrees above the horizon at the south pole, the crater rim hides its floor from the Sun
// all year round, which is why the ice survives there. The terrain casts no shadows of its own, so this shader blocks
// direct sunlight on the crater floor. The floor keeps a little of the sky fill (sunlight bounced off the walls).

uniform sampler2D tile_a : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D tile_n : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float repeat = 66.0;
uniform vec3 psr = vec3(108.0, -42.0, 30.0);
uniform bool use_psr = false;

varying vec3 world_pos;
varying float psr_sun;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 uv = UV * repeat;
	ALBEDO = COLOR.rgb * texture(tile_a, uv).rgb;
	NORMAL_MAP = texture(tile_n, uv).rgb;
	NORMAL_MAP_DEPTH = 1.5;
	ROUGHNESS = 1.0;
	METALLIC = 0.0;
	SPECULAR = 0.0;
	psr_sun = use_psr ? smoothstep(0.6, 0.92, length(world_pos.xz - psr.xy) / psr.z) : 1.0;
	AO = mix(0.18, 1.0, psr_sun);
	AO_LIGHT_AFFECT = 0.0;
}

void light() {
	float block = LIGHT_IS_DIRECTIONAL ? psr_sun : 1.0;
	DIFFUSE_LIGHT += clamp(dot(NORMAL, LIGHT), 0.0, 1.0) * ATTENUATION * LIGHT_COLOR / PI * block;
}
