import React, { useEffect, useRef } from 'react';

const VERT = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;

#define pi 3.14159
#define oz vec2(1,0)

uniform float iTime;
uniform vec2 iResolution;
uniform vec3 iMouse;

// random [0,1]
float hash12(vec2 p) {
  vec3 p3  = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// random normalized vector
vec2 randVec(vec2 p) {
  float a = hash12(p);
  a *= 2.0*pi;
  a += iTime;
  return vec2(sin(a), cos(a));
}

// perlin noise
float perlin(vec2 p) {
  vec2 f = fract(p);
  vec2 s = smoothstep(0.0, 1.0, f);
  vec2 i = floor(p);
  float a = dot(randVec(i), f);
  float b = dot(randVec(i+oz.xy), f-oz.xy);
  float c = dot(randVec(i+oz.yx), f-oz.yx);
  float d = dot(randVec(i+oz.xx), f-oz.xx);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y)/0.707107;
}

// fractal noise
float fbm(vec2 p) {
  float a = 0.5;
  float r = 0.0;
  for (int i = 0; i < 8; i++) {
    r += a*perlin(p);
    a *= 0.5;
    p *= 2.0;
  }
  return r;
}

// 2D square sdf
float square(vec2 p, vec2 s) {
  vec2 d = abs(p)-s;
  return length(max(d, 0.)) + min(0., max(d.x,d.y));
}

out vec4 fragColor;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  // coordinates
  vec2 uv = fragCoord.xy/iResolution.y;
  uv.y = 1.-uv.y;
  float ar = iResolution.x/iResolution.y;
  uv -= vec2(ar/2.0,0.5);
  float uxy = uv.x+uv.y;
  // distortion noise
  float n = fbm(vec2(10.*uv.y, 3.*iTime));
  float g = 0.2*n-0.6+sin(0.3*iTime);
  uv.x += smoothstep(0.15, 0., abs(g))*n;
  // wave
  float s = perlin(vec2(0.3*iTime));
  vec2 p = vec2(perlin(vec2(0.5*iTime)), 0.5*perlin(vec2(-iTime)))*0.5*(iResolution.xy - vec2(300, 300))/iResolution.y;
  p.y -= 0.1*sin(6.*p.x+iTime);
  vec2 m = (vec2(iMouse.x/iResolution.x, 1.-iMouse.y/iResolution.y)-0.5);
  m.x = clamp(ar*m.x, -ar*0.35, ar*0.35);
  m.y = clamp(m.y, -0.25, 0.25);
  p = iMouse.z > 0.5 ? m : p;
  float a = smoothstep(-0.5, -0.1, s)*smoothstep(mix(0.01, 0.9, smoothstep(-0.5, 0.5, s)), 0., length(uv-p));
  float r = 0.;
  for (float i = 1.; i <= 8.; i++) {
    float f = uv.y;
    f += 0.2*sin(5.*uv.x+iTime+a*sin(i+iTime)*1.25*cos(5.*uv.x+0.5*i));
    r += 0.003/abs(f);
  }
  // ui
  float ob = square(uv, 0.5*vec2(0.9*ar,1.-0.1*ar));
  float ui = 1.5*smoothstep(fwidth(uxy), -fwidth(uxy), abs(ob));
  float ms = step(ob, -0.005) * smoothstep(0.01, 0.005, abs(abs(uv.y)-0.475*(1.-0.1*ar)));
  ms *= smoothstep(2.*fwidth(uv.x), fwidth(uv.x), fract(uv.x*100.)/100.);
  ui = max(ui, ms);
  float cr = smoothstep(fwidth(uxy), 0., abs(min(abs(uv.x-p.x), abs(uv.y-p.y))));
  cr = max(cr, 3.*smoothstep(fwidth(uxy), -fwidth(uxy), abs(square(uv-p, (0.1+smoothstep(-0.25, 0.5, s))*vec2(0.15)))));
  cr *= smoothstep(0., -0.1, ob);
  ui = max(ui, cr);
  r = max(r, 2.*ui);
  r *= 2.*pow(0.5+0.5*n, 2.);
  r *= 0.5+0.5*hash12(fragCoord.xy+iTime);
  r = clamp(r, 0., 1.);
  fragColor = vec4(mix(r, pow(1.-r, 3.), smoothstep(-0.025, 0.025, g)));
}

void main() {
  mainImage(fragColor, gl_FragCoord.xy);
}`;

export default function ShaderCanvas({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const mouseRef = useRef({ x: 0, y: 0, down: 0 });
  const startRef = useRef(performance.now());

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2');
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('Shader error:', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };

    const vtx = compile(gl.VERTEX_SHADER, VERT);
    const frag = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vtx || !frag) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vtx);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Shader program link error:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'iTime');
    const uRes  = gl.getUniformLocation(prog, 'iResolution');
    const uMouse = gl.getUniformLocation(prog, 'iMouse');

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };
    const onMouseDown = () => { mouseRef.current.down = 1; };
    const onMouseUp = () => { mouseRef.current.down = 0; };
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);

    const render = () => {
      const t = (performance.now() - startRef.current) / 1000;
      gl.uniform1f(uTime, t);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform3f(uMouse, mouseRef.current.x, mouseRef.current.y, mouseRef.current.down);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafRef.current = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      gl.deleteProgram(prog);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}
