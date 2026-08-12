import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./App.module.css";

const VERSION = "v1.1.0";
const REPO_URL = "https://github.com/holynova/kaleidoscope-studio";
const SOURCE_SIZE = 720;

type Point = { x: number; y: number };
type Selection = { x: number; y: number; size: number; angle: number };
type Preset = { id: string; name: string; src: string };
type LayoutMode = "mirror" | "radial" | "pinwheel" | "hex";

const TRIANGLE_PRESETS = [
  { angle: 30, label: "30° 等腰" },
  { angle: 45, label: "45° 等腰" },
  { angle: 60, label: "60° 正三角" },
  { angle: 90, label: "90° 等腰" },
] as const;

const LAYOUT_MODES: Array<{ id: LayoutMode; label: string; note: string }> = [
  { id: "mirror", label: "镜像方铺", note: "四向翻折，无缝连续" },
  { id: "radial", label: "角度放射", note: "按步进旋转至 360°" },
  { id: "pinwheel", label: "风车旋转", note: "同向旋转，形成涡流" },
  { id: "hex", label: "六角错铺", note: "蜂巢交错，减少方格感" },
];

const ROTATION_STEPS = [10, 12, 15, 18, 20, 24, 30, 36, 40, 45, 60, 72, 90];

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

function trianglePoints(selection: Selection, apexAngle: number): [Point, Point, Point] {
  const height = selection.size * SOURCE_SIZE * 1.5;
  const halfWidth = height * Math.tan((apexAngle * Math.PI) / 360);
  const center = { x: selection.x * SOURCE_SIZE, y: selection.y * SOURCE_SIZE };
  const local: [Point, Point, Point] = [
    { x: 0, y: (-2 * height) / 3 },
    { x: halfWidth, y: height / 3 },
    { x: -halfWidth, y: height / 3 },
  ];
  const cosine = Math.cos(selection.angle);
  const sine = Math.sin(selection.angle);
  return local.map((point) => ({
    x: center.x + point.x * cosine - point.y * sine,
    y: center.y + point.x * sine + point.y * cosine,
  })) as [Point, Point, Point];
}

function selectionMargins(selection: Selection, apexAngle: number) {
  const centered = trianglePoints({ ...selection, x: 0.5, y: 0.5 }, apexAngle);
  const center = SOURCE_SIZE / 2;
  return {
    x: Math.max(...centered.map((point) => Math.abs(point.x - center))) / SOURCE_SIZE,
    y: Math.max(...centered.map((point) => Math.abs(point.y - center))) / SOURCE_SIZE,
  };
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
  const [apexAngle, setApexAngle] = useState(60);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("mirror");
  const [segments, setSegments] = useState(12);
  const [spreadAngle, setSpreadAngle] = useState(30);
  const [mirrorSlices, setMirrorSlices] = useState(true);
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
    setSelection((current) => {
      const margins = selectionMargins(current, apexAngle);
      const x = Math.min(1 - margins.x, Math.max(margins.x, current.x));
      const y = Math.min(1 - margins.y, Math.max(margins.y, current.y));
      return x === current.x && y === current.y ? current : { ...current, x, y };
    });
  }, [apexAngle, selection.angle, selection.size]);

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

      const points = trianglePoints(selection, apexAngle);
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
      const patternWidth = tilePixels * 2;
      const patternHeight = tilePixels * 2;
      if (tile.width !== tilePixels || tile.height !== tilePixels || patternTile.width !== patternWidth || patternTile.height !== patternHeight) {
        tile.width = tilePixels;
        tile.height = tilePixels;
        patternTile.width = patternWidth;
        patternTile.height = patternHeight;
      }
      const tileCtx = tile.getContext("2d")!;
      tileCtx.clearRect(0, 0, tilePixels, tilePixels);
      const center = tilePixels / 2;
      const radius = tilePixels * 0.92;
      const radialCopies = Math.max(3, Math.round(360 / spreadAngle));
      const activeSegments = layoutMode === "radial" || layoutMode === "pinwheel" ? radialCopies : layoutMode === "hex" ? 6 : segments;
      const wedge = (Math.PI * 2) / activeSegments;
      const half = wedge / 2;
      const rotation = spinning && !reduceMotion ? (time / 1000) * speed : 0;
      const edgeA = { x: radius * Math.cos(-half), y: radius * Math.sin(-half) };
      const edgeB = { x: radius * Math.cos(half), y: radius * Math.sin(half) };

      tileCtx.save();
      tileCtx.translate(center, center);
      for (let index = 0; index < activeSegments; index += 1) {
        tileCtx.save();
        tileCtx.rotate(index * wedge + rotation);
        tileCtx.beginPath();
        tileCtx.moveTo(0, 0);
        tileCtx.lineTo(edgeA.x, edgeA.y);
        tileCtx.lineTo(edgeB.x, edgeB.y);
        tileCtx.closePath();
        tileCtx.clip();
        const shouldMirror = layoutMode === "mirror" || layoutMode === "hex" || (layoutMode === "radial" && mirrorSlices);
        const target: [Point, Point, Point] = shouldMirror && index % 2 === 1
          ? [{ x: 0, y: 0 }, edgeB, edgeA]
          : [{ x: 0, y: 0 }, edgeA, edgeB];
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
      if (layoutMode === "mirror") {
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
      } else if (layoutMode === "hex") {
        patternCtx.drawImage(tile, 0, 0);
        patternCtx.drawImage(tile, tilePixels, 0);
        patternCtx.drawImage(tile, -tilePixels / 2, tilePixels);
        patternCtx.drawImage(tile, tilePixels / 2, tilePixels);
        patternCtx.drawImage(tile, tilePixels * 1.5, tilePixels);
      } else {
        const rotations = layoutMode === "pinwheel" ? [0, Math.PI / 2, -Math.PI / 2, Math.PI] : [0, 0, 0, 0];
        const positions = [[0, 0], [tilePixels, 0], [0, tilePixels], [tilePixels, tilePixels]];
        positions.forEach(([x, y], index) => {
          patternCtx.save();
          patternCtx.translate(x + tilePixels / 2, y + tilePixels / 2);
          patternCtx.rotate(rotations[index]);
          patternCtx.drawImage(tile, -tilePixels / 2, -tilePixels / 2);
          patternCtx.restore();
        });
      }

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
  }, [apexAngle, isDragging, layoutMode, mirrorSlices, segments, selection, sourceReady, speed, spinning, spreadAngle, tileSize]);

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
      const margins = selectionMargins(selection, apexAngle);
      const x = Math.min(1 - margins.x, Math.max(margins.x, (clientX - rect.left) / rect.width));
      const y = Math.min(1 - margins.y, Math.max(margins.y, (clientY - rect.top) / rect.height));
      setSelection((current) => ({ ...current, x, y }));
    },
    [apexAngle, selection],
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

  const layoutLabel = LAYOUT_MODES.find((mode) => mode.id === layoutMode)?.label ?? "镜像方铺";
  const effectiveSegments = layoutMode === "radial" || layoutMode === "pinwheel"
    ? Math.max(3, Math.round(360 / spreadAngle))
    : layoutMode === "hex" ? 6 : segments;

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
            <span>{apexAngle}° TRIANGLE</span><span>{effectiveSegments} SLICES</span><span>{layoutLabel}</span><span>{spinning ? "MOTION ON" : "MOTION OFF"}</span>
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
                  setSelection((current) => {
                    const margins = selectionMargins(current, apexAngle);
                    return {
                      ...current,
                      x: Math.min(1 - margins.x, Math.max(margins.x, current.x + move[0])),
                      y: Math.min(1 - margins.y, Math.max(margins.y, current.y + move[1])),
                    };
                  });
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
            <div className={styles.sectionTitle}><span>02</span><h2 id="tuning-title">取样几何</h2></div>
            <div className={styles.controlGrid}>
              <div className={`${styles.presetControl} ${styles.wideControl}`}>
                <span><b>三角形预设</b><output>{apexAngle}°</output></span>
                <div className={styles.presetRow}>
                  {TRIANGLE_PRESETS.map((preset) => (
                    <button
                      key={preset.angle}
                      type="button"
                      aria-pressed={apexAngle === preset.angle}
                      className={apexAngle === preset.angle ? styles.activePreset : ""}
                      onClick={() => setApexAngle(preset.angle)}
                    >{preset.label}</button>
                  ))}
                </div>
              </div>
              <label className={`${styles.rangeControl} ${styles.wideControl}`}>
                <span><b>顶角微调</b><output>{apexAngle}°</output></span>
                <input type="range" min="20" max="100" step="1" value={apexAngle} onChange={(event) => setApexAngle(Number(event.target.value))} />
              </label>
              <label className={styles.rangeControl}>
                <span><b>三角章大小</b><output>{Math.round(selection.size * 100)}</output></span>
                <input type="range" min="8" max="26" value={Math.round(selection.size * 100)} onChange={(event) => setSelection((current) => ({ ...current, size: Number(event.target.value) / 100 }))} />
              </label>
              <label className={styles.rangeControl}>
                <span><b>取样角度</b><output>{Math.round((selection.angle * 180) / Math.PI)}°</output></span>
                <input type="range" min="0" max="359" value={Math.round((selection.angle * 180) / Math.PI) % 360} onChange={(event) => setSelection((current) => ({ ...current, angle: (Number(event.target.value) * Math.PI) / 180 }))} />
              </label>
            </div>
          </section>

          <section className={styles.transformSection} aria-labelledby="transform-title">
            <div className={styles.sectionTitle}><span>03</span><h2 id="transform-title">展开与平铺</h2></div>
            <div className={styles.methodGrid}>
              {LAYOUT_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={layoutMode === mode.id}
                  className={layoutMode === mode.id ? styles.activeMethod : ""}
                  onClick={() => setLayoutMode(mode.id)}
                ><b>{mode.label}</b><small>{mode.note}</small></button>
              ))}
            </div>
            <div className={styles.controlGrid}>
              <label className={`${styles.rangeControl} ${styles.wideControl}`}>
                <span><b>平铺尺寸</b><output>{tileSize}px</output></span>
                <input type="range" min="140" max="460" step="10" value={tileSize} onChange={(event) => setTileSize(Number(event.target.value))} />
              </label>
              {layoutMode === "mirror" && (
                <div className={`${styles.segmentControl} ${styles.wideControl}`}>
                  <span><b>镜面数量</b><output>{segments}</output></span>
                  <div>{[6, 8, 12, 16].map((count) => (
                    <button key={count} type="button" className={segments === count ? styles.activeSegment : ""} onClick={() => setSegments(count)}>{count}</button>
                  ))}</div>
                </div>
              )}
              {(layoutMode === "radial" || layoutMode === "pinwheel") && (
                <label className={`${styles.selectControl} ${styles.wideControl}`}>
                  <span><b>旋转步进</b><output>{spreadAngle}° × {effectiveSegments}</output></span>
                  <select value={spreadAngle} onChange={(event) => setSpreadAngle(Number(event.target.value))}>
                    {ROTATION_STEPS.map((angle) => <option key={angle} value={angle}>{angle}°，{360 / angle} 片闭合 360°</option>)}
                  </select>
                </label>
              )}
              {layoutMode === "radial" && (
                <button
                  type="button"
                  className={`${styles.toggleButton} ${mirrorSlices ? styles.activeToggle : ""}`}
                  aria-pressed={mirrorSlices}
                  onClick={() => setMirrorSlices((current) => !current)}
                ><span>交替镜像</span><b>{mirrorSlices ? "开启" : "关闭"}</b></button>
              )}
              {layoutMode === "hex" && <p className={styles.modeNote}>六轴镜像后以蜂巢节奏错位排列，适合形成连续花砖。</p>}
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
