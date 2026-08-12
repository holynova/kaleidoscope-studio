import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./App.module.css";

const VERSION = "v1.0.1";
const REPO_URL = "https://github.com/holynova/kaleidoscope-studio";
const SOURCE_SIZE = 720;

type Point = { x: number; y: number };
type Selection = { x: number; y: number; size: number; angle: number };
type Preset = { id: string; name: string; src: string };

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePreset(id: string, name: string, seed: number, palette: string[]): Preset {
  const canvas = document.createElement("canvas");
  canvas.width = SOURCE_SIZE;
  canvas.height = SOURCE_SIZE;
  const ctx = canvas.getContext("2d")!;
  const random = mulberry32(seed);
  const base = ctx.createLinearGradient(0, 0, SOURCE_SIZE, SOURCE_SIZE);
  base.addColorStop(0, palette[0]);
  base.addColorStop(0.48, palette[1]);
  base.addColorStop(1, palette[2]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);

  ctx.globalCompositeOperation = "screen";
  for (let index = 0; index < 70; index += 1) {
    const x = random() * SOURCE_SIZE;
    const y = random() * SOURCE_SIZE;
    const radius = 18 + random() * 118;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `${palette[(index + 2) % palette.length]}e8`);
    glow.addColorStop(0.68, `${palette[(index + 3) % palette.length]}48`);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "overlay";
  ctx.lineCap = "round";
  for (let index = 0; index < 26; index += 1) {
    ctx.strokeStyle = `${palette[index % palette.length]}b8`;
    ctx.lineWidth = 5 + random() * 24;
    ctx.beginPath();
    ctx.moveTo(random() * SOURCE_SIZE, random() * SOURCE_SIZE);
    ctx.bezierCurveTo(
      random() * SOURCE_SIZE,
      random() * SOURCE_SIZE,
      random() * SOURCE_SIZE,
      random() * SOURCE_SIZE,
      random() * SOURCE_SIZE,
      random() * SOURCE_SIZE,
    );
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  return { id, name, src: canvas.toDataURL("image/jpeg", 0.91) };
}

function trianglePoints(selection: Selection): [Point, Point, Point] {
  const radius = selection.size * SOURCE_SIZE;
  const center = { x: selection.x * SOURCE_SIZE, y: selection.y * SOURCE_SIZE };
  return [0, 1, 2].map((index) => {
    const angle = selection.angle + index * ((Math.PI * 2) / 3) - Math.PI / 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  }) as [Point, Point, Point];
}

function affineTransform(source: [Point, Point, Point], target: [Point, Point, Point]) {
  const [s0, s1, s2] = source;
  const [t0, t1, t2] = target;
  const determinant = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(determinant) < 0.0001) return null;
  const solve = (v0: number, v1: number, v2: number) => ({
    a: (v0 * (s1.y - s2.y) + v1 * (s2.y - s0.y) + v2 * (s0.y - s1.y)) / determinant,
    c: (v0 * (s2.x - s1.x) + v1 * (s0.x - s2.x) + v2 * (s1.x - s0.x)) / determinant,
    e:
      (v0 * (s1.x * s2.y - s2.x * s1.y) +
        v1 * (s2.x * s0.y - s0.x * s2.y) +
        v2 * (s0.x * s1.y - s1.x * s0.y)) /
      determinant,
  });
  const x = solve(t0.x, t1.x, t2.x);
  const y = solve(t0.y, t1.y, t2.y);
  return { a: x.a, b: y.a, c: x.c, d: y.c, e: x.e, f: y.e };
}

function App() {
  const presets = useMemo(
    () => [
      makePreset("festival", "游园灯会", 41, ["#ff3d6e", "#ffb627", "#2457ff", "#29d3a2", "#f8e16c"]),
      makePreset("garden", "玻璃花房", 83, ["#133c55", "#386641", "#f2e8cf", "#bc4749", "#a7c957"]),
      makePreset("citrus", "柑橘汽水", 127, ["#ff7b00", "#ffea00", "#00b4d8", "#ff006e", "#8ac926"]),
      makePreset("night", "夜航星云", 211, ["#10002b", "#3c096c", "#ff6d00", "#7b2cbf", "#4cc9f0"]),
    ],
    [],
  );
  const [source, setSource] = useState(presets[0]);
  const [selection, setSelection] = useState<Selection>({ x: 0.53, y: 0.47, size: 0.2, angle: 0 });
  const [segments, setSegments] = useState(12);
  const [tileSize, setTileSize] = useState(270);
  const [spinning, setSpinning] = useState(false);
  const [speed, setSpeed] = useState(0.055);
  const [sourceReady, setSourceReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const stampCanvasRef = useRef<HTMLCanvasElement>(null);
  const wallCanvasRef = useRef<HTMLCanvasElement>(null);
  const wallRef = useRef<HTMLElement>(null);
  const uploadUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const canvas = sourceCanvasRef.current!;
    canvas.width = SOURCE_SIZE;
    canvas.height = SOURCE_SIZE;
    const ctx = canvas.getContext("2d")!;
    const image = new Image();
    image.onload = () => {
      const scale = Math.max(SOURCE_SIZE / image.width, SOURCE_SIZE / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      ctx.clearRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
      ctx.drawImage(image, (SOURCE_SIZE - width) / 2, (SOURCE_SIZE - height) / 2, width, height);
      setSourceReady(true);
    };
    setSourceReady(false);
    image.src = source.src;
  }, [source]);

  useEffect(() => {
    const wall = wallRef.current;
    const canvas = wallCanvasRef.current;
    if (!wall || !canvas) return;
    const resize = () => {
      const rect = wall.getBoundingClientRect();
      const density = Math.min(window.devicePixelRatio || 1, 1.6);
      canvas.width = Math.max(1, Math.round(rect.width * density));
      canvas.height = Math.max(1, Math.round(rect.height * density));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wall);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tile = document.createElement("canvas");
    const patternTile = document.createElement("canvas");

    const render = (time: number) => {
      const sourceCanvas = sourceCanvasRef.current;
      const stampCanvas = stampCanvasRef.current;
      const wallCanvas = wallCanvasRef.current;
      if (!sourceCanvas || !stampCanvas || !wallCanvas || !sourceReady) {
        frame = requestAnimationFrame(render);
        return;
      }

      const points = trianglePoints(selection);
      const stampCtx = stampCanvas.getContext("2d")!;
      stampCtx.clearRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
      stampCtx.drawImage(sourceCanvas, 0, 0);
      stampCtx.beginPath();
      stampCtx.rect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
      stampCtx.moveTo(points[0].x, points[0].y);
      stampCtx.lineTo(points[2].x, points[2].y);
      stampCtx.lineTo(points[1].x, points[1].y);
      stampCtx.closePath();
      stampCtx.fillStyle = "rgba(4, 5, 4, .48)";
      stampCtx.fill("evenodd");
      stampCtx.beginPath();
      stampCtx.moveTo(points[0].x, points[0].y);
      stampCtx.lineTo(points[1].x, points[1].y);
      stampCtx.lineTo(points[2].x, points[2].y);
      stampCtx.closePath();
      stampCtx.fillStyle = "rgba(255, 210, 110, .08)";
      stampCtx.fill();
      stampCtx.lineWidth = isDragging ? 8 : 5;
      stampCtx.strokeStyle = "#ffd36b";
      stampCtx.shadowColor = "rgba(255, 192, 63, .9)";
      stampCtx.shadowBlur = 18;
      stampCtx.stroke();
      stampCtx.shadowBlur = 0;
      stampCtx.fillStyle = "#ffd36b";
      stampCtx.beginPath();
      stampCtx.arc(selection.x * SOURCE_SIZE, selection.y * SOURCE_SIZE, isDragging ? 12 : 9, 0, Math.PI * 2);
      stampCtx.fill();

      const density = Math.min(window.devicePixelRatio || 1, 1.6);
      const tilePixels = Math.max(100, Math.round(tileSize * density));
      if (tile.width !== tilePixels || tile.height !== tilePixels) {
        tile.width = tilePixels;
        tile.height = tilePixels;
        patternTile.width = tilePixels * 2;
        patternTile.height = tilePixels * 2;
      }
      const tileCtx = tile.getContext("2d")!;
      tileCtx.clearRect(0, 0, tilePixels, tilePixels);
      const center = tilePixels / 2;
      const radius = tilePixels * 0.74;
      const wedge = (Math.PI * 2) / segments;
      const half = wedge / 2;
      const rotation = spinning && !reduceMotion ? (time / 1000) * speed : 0;
      const edgeA = { x: radius * Math.cos(-half), y: radius * Math.sin(-half) };
      const edgeB = { x: radius * Math.cos(half), y: radius * Math.sin(half) };

      tileCtx.save();
      tileCtx.translate(center, center);
      for (let index = 0; index < segments; index += 1) {
        tileCtx.save();
        tileCtx.rotate(index * wedge + rotation);
        tileCtx.beginPath();
        tileCtx.moveTo(0, 0);
        tileCtx.lineTo(edgeA.x, edgeA.y);
        tileCtx.lineTo(edgeB.x, edgeB.y);
        tileCtx.closePath();
        tileCtx.clip();
        const target: [Point, Point, Point] =
          index % 2 === 0 ? [{ x: 0, y: 0 }, edgeA, edgeB] : [{ x: 0, y: 0 }, edgeB, edgeA];
        const matrix = affineTransform(points, target);
        if (matrix) {
          tileCtx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
          tileCtx.drawImage(sourceCanvas, 0, 0);
        }
        tileCtx.restore();
      }
      tileCtx.restore();

      const patternCtx = patternTile.getContext("2d")!;
      patternCtx.clearRect(0, 0, patternTile.width, patternTile.height);
      patternCtx.drawImage(tile, 0, 0);
      patternCtx.save();
      patternCtx.translate(tilePixels * 2, 0);
      patternCtx.scale(-1, 1);
      patternCtx.drawImage(tile, 0, 0);
      patternCtx.restore();
      patternCtx.save();
      patternCtx.translate(0, tilePixels * 2);
      patternCtx.scale(1, -1);
      patternCtx.drawImage(tile, 0, 0);
      patternCtx.restore();
      patternCtx.save();
      patternCtx.translate(tilePixels * 2, tilePixels * 2);
      patternCtx.scale(-1, -1);
      patternCtx.drawImage(tile, 0, 0);
      patternCtx.restore();

      const wallCtx = wallCanvas.getContext("2d")!;
      wallCtx.clearRect(0, 0, wallCanvas.width, wallCanvas.height);
      const pattern = wallCtx.createPattern(patternTile, "repeat");
      if (pattern) {
        wallCtx.fillStyle = pattern;
        wallCtx.fillRect(0, 0, wallCanvas.width, wallCanvas.height);
      }
      const vignette = wallCtx.createRadialGradient(
        wallCanvas.width * 0.5,
        wallCanvas.height * 0.46,
        Math.min(wallCanvas.width, wallCanvas.height) * 0.18,
        wallCanvas.width * 0.5,
        wallCanvas.height * 0.46,
        Math.max(wallCanvas.width, wallCanvas.height) * 0.78,
      );
      vignette.addColorStop(0, "rgba(255,255,255,.035)");
      vignette.addColorStop(0.7, "transparent");
      vignette.addColorStop(1, "rgba(0,0,0,.38)");
      wallCtx.fillStyle = vignette;
      wallCtx.fillRect(0, 0, wallCanvas.width, wallCanvas.height);
      if (spinning && !reduceMotion) frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [isDragging, segments, selection, sourceReady, speed, spinning, tileSize]);

  useEffect(
    () => () => {
      if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
    },
    [],
  );

  const positionFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = stampCanvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const margin = selection.size * 0.66;
      const x = Math.min(1 - margin, Math.max(margin, (clientX - rect.left) / rect.width));
      const y = Math.min(1 - margin, Math.max(margin, (clientY - rect.top) / rect.height));
      setSelection((current) => ({ ...current, x, y }));
    },
    [selection.size],
  );

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
    uploadUrlRef.current = URL.createObjectURL(file);
    setSource({ id: "upload", name: file.name.replace(/\.[^.]+$/, ""), src: uploadUrlRef.current });
    event.target.value = "";
  };

  const randomize = () => {
    setSelection({
      x: 0.23 + Math.random() * 0.54,
      y: 0.23 + Math.random() * 0.54,
      size: 0.14 + Math.random() * 0.14,
      angle: Math.random() * Math.PI * 2,
    });
  };

  const exportWall = () => {
    const canvas = wallCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `镜花万象-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div className={styles.app}>
      <main className={styles.workspace}>
        <section ref={wallRef} id="main-content" className={styles.wall} aria-labelledby="wall-title">
          <canvas ref={wallCanvasRef} className={styles.wallCanvas} aria-label="实时平铺的万花筒图形" />
          <div className={styles.wallTop}>
            <div className={styles.brand}>
              <span className={styles.brandMark} aria-hidden="true"><i /></span>
              <span><strong id="wall-title">镜花万象</strong><small>KALEIDOSCOPE STUDIO</small></span>
            </div>
            <span className={styles.liveBadge}><i /> LIVE</span>
          </div>
          <div className={styles.wallStatus} aria-live="polite">
            <span>{segments} MIRRORS</span><span>{tileSize}px TILE</span><span>{spinning ? "MOTION ON" : "MOTION OFF"}</span>
          </div>
          <p className={styles.wallHint}>拖动右侧三角章，整面图案会同步变化</p>
        </section>

        <aside className={styles.panel} aria-label="万花筒控制台">
          <header className={styles.panelHeader}>
            <div><span>CONTROL PANEL</span><h1>取样与平铺</h1></div>
            <div className={styles.panelMeta}><a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a><span>{VERSION}</span></div>
          </header>

          <section className={styles.sampleSection} aria-labelledby="sample-title">
            <div className={styles.sectionTitle}>
              <span>01</span><h2 id="sample-title">移动三角章</h2><button type="button" onClick={randomize}>随机落点 ↗</button>
            </div>
            <div className={styles.sourceStage}>
              <canvas
                ref={stampCanvasRef}
                width={SOURCE_SIZE}
                height={SOURCE_SIZE}
                className={isDragging ? styles.dragging : ""}
                role="button"
                tabIndex={0}
                aria-label="图片取样区。点击或拖动三角章，左侧平铺图案会实时变化。"
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
              <span>DRAG TO SAMPLE</span>
            </div>
            <div className={styles.sourceStrip} aria-label="选择图片">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={source.id === preset.id ? styles.activeSource : ""}
                  onClick={() => setSource(preset)}
                  aria-label={`使用${preset.name}`}
                  title={preset.name}
                ><img src={preset.src} width="54" height="54" alt="" /></button>
              ))}
              <label className={styles.uploadButton} title="上传自己的图片">
                <input type="file" accept="image/*" onChange={handleUpload} />
                <b>＋</b><span>上传</span>
              </label>
            </div>
          </section>

          <section className={styles.tuningSection} aria-labelledby="tuning-title">
            <div className={styles.sectionTitle}><span>02</span><h2 id="tuning-title">调校图案</h2></div>
            <div className={styles.controlGrid}>
              <label className={styles.rangeControl}>
                <span><b>三角章大小</b><output>{Math.round(selection.size * 100)}</output></span>
                <input type="range" min="10" max="30" value={Math.round(selection.size * 100)} onChange={(event) => setSelection((current) => ({ ...current, size: Number(event.target.value) / 100 }))} />
              </label>
              <label className={styles.rangeControl}>
                <span><b>取样角度</b><output>{Math.round((selection.angle * 180) / Math.PI)}°</output></span>
                <input type="range" min="0" max="359" value={Math.round((selection.angle * 180) / Math.PI) % 360} onChange={(event) => setSelection((current) => ({ ...current, angle: (Number(event.target.value) * Math.PI) / 180 }))} />
              </label>
              <label className={`${styles.rangeControl} ${styles.wideControl}`}>
                <span><b>平铺尺寸</b><output>{tileSize}px</output></span>
                <input type="range" min="140" max="460" step="10" value={tileSize} onChange={(event) => setTileSize(Number(event.target.value))} />
              </label>
              <div className={`${styles.segmentControl} ${styles.wideControl}`}>
                <span><b>镜面数量</b><output>{segments}</output></span>
                <div>{[6, 8, 12, 16].map((count) => (
                  <button key={count} type="button" className={segments === count ? styles.activeSegment : ""} onClick={() => setSegments(count)}>{count}</button>
                ))}</div>
              </div>
              <label className={`${styles.rangeControl} ${styles.wideControl}`}>
                <span><b>旋转速度</b><output>{speed.toFixed(2)}</output></span>
                <input type="range" min="0" max="20" value={Math.round(speed * 100)} onChange={(event) => setSpeed(Number(event.target.value) / 100)} />
              </label>
            </div>
          </section>

          <footer className={styles.actions}>
            <button type="button" className={styles.motionButton} onClick={() => setSpinning((current) => !current)}><span>{spinning ? "Ⅱ" : "▶"}</span>{spinning ? "暂停流动" : "继续流动"}</button>
            <button type="button" className={styles.exportButton} onClick={exportWall}>保存平铺画面 <span>↓</span></button>
            <p>图片只在当前浏览器中处理，不会上传。</p>
          </footer>
        </aside>
      </main>
      <canvas ref={sourceCanvasRef} className={styles.hiddenCanvas} aria-hidden="true" />
    </div>
  );
}

export default App;
