import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./App.module.css";

const VERSION = "v1.0.0";
const REPO_URL = "https://github.com/holynova/kaleidoscope-studio";
const CANVAS_SIZE = 720;

type Point = { x: number; y: number };
type Selection = { x: number; y: number; size: number; angle: number };
type Preset = { id: string; name: string; note: string; src: string };

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePreset(id: string, name: string, note: string, seed: number, palette: string[]): Preset {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d")!;
  const random = mulberry32(seed);

  const base = ctx.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  base.addColorStop(0, palette[0]);
  base.addColorStop(0.5, palette[1]);
  base.addColorStop(1, palette[2]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 64; i += 1) {
    const x = random() * CANVAS_SIZE;
    const y = random() * CANVAS_SIZE;
    const radius = 16 + random() * 110;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `${palette[(i + 2) % palette.length]}e8`);
    gradient.addColorStop(0.65, `${palette[(i + 3) % palette.length]}52`);
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "overlay";
  ctx.lineCap = "round";
  for (let i = 0; i < 24; i += 1) {
    ctx.strokeStyle = `${palette[i % palette.length]}aa`;
    ctx.lineWidth = 6 + random() * 22;
    ctx.beginPath();
    ctx.moveTo(random() * CANVAS_SIZE, random() * CANVAS_SIZE);
    ctx.bezierCurveTo(
      random() * CANVAS_SIZE,
      random() * CANVAS_SIZE,
      random() * CANVAS_SIZE,
      random() * CANVAS_SIZE,
      random() * CANVAS_SIZE,
      random() * CANVAS_SIZE,
    );
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";

  return { id, name, note, src: canvas.toDataURL("image/jpeg", 0.9) };
}

function trianglePoints(selection: Selection): [Point, Point, Point] {
  const radius = selection.size * CANVAS_SIZE;
  const center = { x: selection.x * CANVAS_SIZE, y: selection.y * CANVAS_SIZE };
  return [0, 1, 2].map((index) => {
    const angle = selection.angle + index * ((Math.PI * 2) / 3) - Math.PI / 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  }) as [Point, Point, Point];
}

function affineTransform(source: [Point, Point, Point], target: [Point, Point, Point]) {
  const [s0, s1, s2] = source;
  const [t0, t1, t2] = target;
  const det = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(det) < 0.0001) return null;

  const solve = (v0: number, v1: number, v2: number) => ({
    a: (v0 * (s1.y - s2.y) + v1 * (s2.y - s0.y) + v2 * (s0.y - s1.y)) / det,
    c: (v0 * (s2.x - s1.x) + v1 * (s0.x - s2.x) + v2 * (s1.x - s0.x)) / det,
    e:
      (v0 * (s1.x * s2.y - s2.x * s1.y) +
        v1 * (s2.x * s0.y - s0.x * s2.y) +
        v2 * (s0.x * s1.y - s1.x * s0.y)) /
      det,
  });
  const x = solve(t0.x, t1.x, t2.x);
  const y = solve(t0.y, t1.y, t2.y);
  return { a: x.a, b: y.a, c: x.c, d: y.c, e: x.e, f: y.e };
}

function App() {
  const presets = useMemo(
    () => [
      makePreset("festival", "游园灯会", "明亮、热烈", 41, ["#ff3d6e", "#ffb627", "#2457ff", "#29d3a2", "#f8e16c"]),
      makePreset("garden", "玻璃花房", "清透、柔和", 83, ["#133c55", "#386641", "#f2e8cf", "#bc4749", "#a7c957"]),
      makePreset("citrus", "柑橘汽水", "酸甜、跳跃", 127, ["#ff7b00", "#ffea00", "#00b4d8", "#ff006e", "#8ac926"]),
      makePreset("night", "夜航星云", "幽深、闪烁", 211, ["#10002b", "#3c096c", "#ff6d00", "#7b2cbf", "#4cc9f0"]),
    ],
    [],
  );
  const [source, setSource] = useState(presets[0]);
  const [selection, setSelection] = useState<Selection>({ x: 0.52, y: 0.48, size: 0.19, angle: 0 });
  const [segments, setSegments] = useState(12);
  const [spinning, setSpinning] = useState(true);
  const [speed, setSpeed] = useState(0.12);
  const [sourceReady, setSourceReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const stampCanvasRef = useRef<HTMLCanvasElement>(null);
  const kaleidoscopeRef = useRef<HTMLCanvasElement>(null);
  const uploadUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const canvas = sourceCanvasRef.current!;
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext("2d")!;
    const image = new Image();
    image.onload = () => {
      const scale = Math.max(CANVAS_SIZE / image.width, CANVAS_SIZE / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.drawImage(image, (CANVAS_SIZE - width) / 2, (CANVAS_SIZE - height) / 2, width, height);
      setSourceReady(true);
    };
    setSourceReady(false);
    image.src = source.src;
  }, [source]);

  useEffect(() => {
    let frame = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const render = (time: number) => {
      const sourceCanvas = sourceCanvasRef.current;
      const stampCanvas = stampCanvasRef.current;
      const kaleidoscope = kaleidoscopeRef.current;
      if (!sourceCanvas || !stampCanvas || !kaleidoscope || !sourceReady) {
        frame = requestAnimationFrame(render);
        return;
      }

      const stampCtx = stampCanvas.getContext("2d")!;
      const kaleidoCtx = kaleidoscope.getContext("2d")!;
      const points = trianglePoints(selection);
      const pulse = reduceMotion ? 1 : 1 + Math.sin(time / 540) * 0.018;

      stampCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      stampCtx.drawImage(sourceCanvas, 0, 0);
      const shade = stampCtx.createRadialGradient(CANVAS_SIZE / 2, CANVAS_SIZE / 2, 90, CANVAS_SIZE / 2, CANVAS_SIZE / 2, 510);
      shade.addColorStop(0, "transparent");
      shade.addColorStop(1, "rgba(0, 0, 0, .28)");
      stampCtx.fillStyle = shade;
      stampCtx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      stampCtx.save();
      stampCtx.translate(selection.x * CANVAS_SIZE, selection.y * CANVAS_SIZE);
      stampCtx.scale(pulse, pulse);
      stampCtx.translate(-selection.x * CANVAS_SIZE, -selection.y * CANVAS_SIZE);
      stampCtx.beginPath();
      stampCtx.moveTo(points[0].x, points[0].y);
      stampCtx.lineTo(points[1].x, points[1].y);
      stampCtx.lineTo(points[2].x, points[2].y);
      stampCtx.closePath();
      stampCtx.fillStyle = "rgba(255, 208, 105, .12)";
      stampCtx.fill();
      stampCtx.lineWidth = isDragging ? 7 : 5;
      stampCtx.strokeStyle = "#ffd675";
      stampCtx.shadowColor = "rgba(255, 192, 70, .8)";
      stampCtx.shadowBlur = 18;
      stampCtx.stroke();
      stampCtx.restore();

      const size = kaleidoscope.width;
      const center = size / 2;
      const lensRadius = size * 0.46;
      kaleidoCtx.clearRect(0, 0, size, size);
      kaleidoCtx.fillStyle = "#050605";
      kaleidoCtx.fillRect(0, 0, size, size);
      kaleidoCtx.save();
      kaleidoCtx.translate(center, center);
      kaleidoCtx.beginPath();
      kaleidoCtx.arc(0, 0, lensRadius, 0, Math.PI * 2);
      kaleidoCtx.clip();
      const wedge = (Math.PI * 2) / segments;
      const viewRotation = spinning && !reduceMotion ? (time / 1000) * speed : 0;
      const half = wedge / 2;
      const edgeA = { x: lensRadius * Math.cos(-half), y: lensRadius * Math.sin(-half) };
      const edgeB = { x: lensRadius * Math.cos(half), y: lensRadius * Math.sin(half) };

      for (let index = 0; index < segments; index += 1) {
        kaleidoCtx.save();
        kaleidoCtx.rotate(index * wedge + viewRotation);
        kaleidoCtx.beginPath();
        kaleidoCtx.moveTo(0, 0);
        kaleidoCtx.lineTo(edgeA.x, edgeA.y);
        kaleidoCtx.lineTo(edgeB.x, edgeB.y);
        kaleidoCtx.closePath();
        kaleidoCtx.clip();
        const target: [Point, Point, Point] =
          index % 2 === 0 ? [{ x: 0, y: 0 }, edgeA, edgeB] : [{ x: 0, y: 0 }, edgeB, edgeA];
        const matrix = affineTransform(points, target);
        if (matrix) {
          kaleidoCtx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
          kaleidoCtx.drawImage(sourceCanvas, 0, 0);
        }
        kaleidoCtx.restore();
      }

      const vignette = kaleidoCtx.createRadialGradient(0, 0, lensRadius * 0.32, 0, 0, lensRadius);
      vignette.addColorStop(0, "rgba(255,255,255,.03)");
      vignette.addColorStop(0.72, "transparent");
      vignette.addColorStop(1, "rgba(0,0,0,.48)");
      kaleidoCtx.fillStyle = vignette;
      kaleidoCtx.fillRect(-center, -center, size, size);
      kaleidoCtx.restore();

      const glare = kaleidoCtx.createLinearGradient(size * 0.2, size * 0.12, size * 0.56, size * 0.54);
      glare.addColorStop(0, "rgba(255,255,255,.18)");
      glare.addColorStop(0.38, "rgba(255,255,255,.025)");
      glare.addColorStop(1, "transparent");
      kaleidoCtx.save();
      kaleidoCtx.beginPath();
      kaleidoCtx.arc(center, center, lensRadius - 2, 0, Math.PI * 2);
      kaleidoCtx.clip();
      kaleidoCtx.fillStyle = glare;
      kaleidoCtx.fillRect(0, 0, size, size);
      kaleidoCtx.restore();
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [isDragging, segments, selection, sourceReady, speed, spinning]);

  useEffect(
    () => () => {
      if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
    },
    [],
  );

  const positionFromPointer = useCallback((clientX: number, clientY: number) => {
    const canvas = stampCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const margin = selection.size * 0.62;
    const x = Math.min(1 - margin, Math.max(margin, (clientX - rect.left) / rect.width));
    const y = Math.min(1 - margin, Math.max(margin, (clientY - rect.top) / rect.height));
    setSelection((current) => ({ ...current, x, y }));
  }, [selection.size]);

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
    uploadUrlRef.current = URL.createObjectURL(file);
    setSource({ id: "upload", name: file.name.replace(/\.[^.]+$/, ""), note: "你的图片", src: uploadUrlRef.current });
    event.target.value = "";
  };

  const randomizeStamp = () => {
    setSelection({
      x: 0.24 + Math.random() * 0.52,
      y: 0.24 + Math.random() * 0.52,
      size: 0.14 + Math.random() * 0.13,
      angle: Math.random() * Math.PI * 2,
    });
  };

  const exportImage = () => {
    const canvas = kaleidoscopeRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `镜花万象-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <a className={styles.brand} href="./" aria-label="镜花万象首页">
          <span className={styles.brandMark} aria-hidden="true"><i /></span>
          <span>
            <strong>镜花万象</strong>
            <small>KALEIDOSCOPE STUDIO</small>
          </span>
        </a>
        <div className={styles.headerMeta}>
          <span className={styles.liveLight}><i /> 实时折射</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
          <span className={styles.version}>{VERSION}</span>
        </div>
      </header>

      <main id="main-content" className={styles.main}>
        <section className={styles.intro} aria-labelledby="page-title">
          <p>OPTICAL PLAYGROUND · 01</p>
          <h1 id="page-title">从一枚三角章，<br />看见一整个宇宙。</h1>
          <span>选择图片，在左侧点按或拖动三角章。镜片会实时把它折射成连续图案。</span>
        </section>

        <section className={styles.instrument} aria-label="电子万花筒工作台">
          <div className={styles.sourcePanel}>
            <div className={styles.panelHeading}>
              <div><span>01</span><h2>选择取样</h2></div>
              <p>点按盖章 · 拖动移动</p>
            </div>
            <div className={styles.sourceStage}>
              <canvas
                ref={stampCanvasRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                className={isDragging ? styles.dragging : ""}
                aria-label="图片取样区。点按或拖动以移动三角取样章。"
                role="button"
                tabIndex={0}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setIsDragging(true);
                  positionFromPointer(event.clientX, event.clientY);
                }}
                onPointerMove={(event) => {
                  if (isDragging) positionFromPointer(event.clientX, event.clientY);
                }}
                onPointerUp={(event) => {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  setIsDragging(false);
                }}
                onPointerCancel={() => setIsDragging(false)}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 0.04 : 0.015;
                  const moves: Record<string, [number, number]> = {
                    ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
                  };
                  const move = moves[event.key];
                  if (!move) return;
                  event.preventDefault();
                  setSelection((current) => ({
                    ...current,
                    x: Math.min(0.88, Math.max(0.12, current.x + move[0])),
                    y: Math.min(0.88, Math.max(0.12, current.y + move[1])),
                  }));
                }}
              />
              <span className={styles.stageBadge}>TRIANGLE SAMPLE</span>
            </div>
            <div className={styles.sourceStrip} aria-label="默认图片">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={source.id === preset.id ? styles.activeSource : ""}
                  onClick={() => setSource(preset)}
                  aria-label={`使用${preset.name}`}
                >
                  <img src={preset.src} width="64" height="64" alt="" />
                  <span>{preset.name}<small>{preset.note}</small></span>
                </button>
              ))}
              <label className={styles.uploadButton}>
                <input type="file" accept="image/*" onChange={handleUpload} />
                <b>＋</b><span>上传图片<small>JPG / PNG / WEBP</small></span>
              </label>
            </div>
          </div>

          <div className={styles.lensPanel}>
            <div className={styles.panelHeading}>
              <div><span>02</span><h2>观察折射</h2></div>
              <p>{segments} 面镜 · {spinning ? "缓慢旋转" : "已静止"}</p>
            </div>
            <div className={styles.scopeShell}>
              <div className={styles.scopeTicks} aria-hidden="true" />
              <div className={styles.scopeRing}>
                <canvas ref={kaleidoscopeRef} width={760} height={760} aria-label="根据三角取样实时生成的万花筒视图" />
              </div>
              <span className={styles.lensLabel}>MIRROR ARRAY · {segments}</span>
            </div>
          </div>
        </section>

        <section className={styles.controls} aria-label="万花筒控制台">
          <div className={styles.controlIntro}>
            <span>03 / CALIBRATION</span>
            <h2>调校镜片</h2>
            <button type="button" onClick={randomizeStamp}>换个落点 ↗</button>
          </div>
          <label className={styles.rangeControl}>
            <span><b>三角章大小</b><output>{Math.round(selection.size * 100)}</output></span>
            <input
              type="range"
              min="10"
              max="30"
              value={Math.round(selection.size * 100)}
              onChange={(event) => setSelection((current) => ({ ...current, size: Number(event.target.value) / 100 }))}
            />
            <small>精细取样</small><small>宽阔取样</small>
          </label>
          <label className={styles.rangeControl}>
            <span><b>取样角度</b><output>{Math.round((selection.angle * 180) / Math.PI)}°</output></span>
            <input
              type="range"
              min="0"
              max="359"
              value={Math.round((selection.angle * 180) / Math.PI) % 360}
              onChange={(event) => setSelection((current) => ({ ...current, angle: (Number(event.target.value) * Math.PI) / 180 }))}
            />
            <small>0°</small><small>359°</small>
          </label>
          <div className={styles.segmentControl}>
            <span><b>镜面数量</b><output>{segments}</output></span>
            <div>{[8, 12, 16, 20].map((count) => (
              <button key={count} type="button" onClick={() => setSegments(count)} className={segments === count ? styles.activeSegment : ""}>{count}</button>
            ))}</div>
            <small>越多越细密</small>
          </div>
          <label className={styles.rangeControl}>
            <span><b>旋转速度</b><output>{speed.toFixed(2)}</output></span>
            <input type="range" min="2" max="32" value={Math.round(speed * 100)} onChange={(event) => setSpeed(Number(event.target.value) / 100)} />
            <small>慢</small><small>快</small>
          </label>
          <div className={styles.actions}>
            <button type="button" className={styles.spinButton} onClick={() => setSpinning((current) => !current)}>
              <span aria-hidden="true">{spinning ? "Ⅱ" : "▶"}</span>{spinning ? "暂停旋转" : "继续旋转"}
            </button>
            <button type="button" className={styles.exportButton} onClick={exportImage}>保存这幅万花筒 <span>↓</span></button>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <p id="privacy">你的图片只在当前浏览器中处理，不会上传。刷新页面即可清除。</p>
        <div><span>镜花万象 © 2026</span><a href="#privacy">隐私说明</a><a href={REPO_URL} target="_blank" rel="noreferrer">查看源码</a></div>
      </footer>
      <canvas ref={sourceCanvasRef} className={styles.hiddenCanvas} aria-hidden="true" />
    </div>
  );
}

export default App;
