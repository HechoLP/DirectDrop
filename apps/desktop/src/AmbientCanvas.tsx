import { useEffect, useRef } from "react";
import type { AppVisualState } from "./visual-state";

type Palette = {
  from: [number, number, number];
  to: [number, number, number];
  glow: [number, number, number];
  pattern: "breathe" | "gather" | "connect" | "flow" | "settle";
};

const palettes: Record<AppVisualState, Palette> = {
  select: {
    from: [244, 190, 229],
    to: [166, 142, 219],
    glow: [255, 229, 198],
    pattern: "breathe",
  },
  ready: {
    from: [252, 211, 178],
    to: [187, 164, 224],
    glow: [255, 242, 213],
    pattern: "gather",
  },
  connect: {
    from: [164, 208, 242],
    to: [167, 136, 218],
    glow: [224, 244, 255],
    pattern: "connect",
  },
  live: {
    from: [196, 180, 236],
    to: [121, 180, 207],
    glow: [226, 255, 244],
    pattern: "breathe",
  },
  transfer: {
    from: [251, 221, 164],
    to: [201, 155, 196],
    glow: [255, 240, 214],
    pattern: "flow",
  },
  complete: {
    from: [158, 225, 200],
    to: [131, 188, 225],
    glow: [233, 255, 239],
    pattern: "settle",
  },
  error: {
    from: [244, 164, 166],
    to: [190, 130, 188],
    glow: [255, 222, 202],
    pattern: "connect",
  },
  about: {
    from: [175, 196, 239],
    to: [187, 155, 224],
    glow: [237, 231, 255],
    pattern: "settle",
  },
};

function rgb(color: [number, number, number], alpha = 1) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

export function AmbientCanvas({ state }: { state: AppVisualState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const palette = palettes[state];
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let width = 1;
    let height = 1;
    let animationFrame = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, canvas.clientWidth);
      height = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (time: number) => {
      const seconds = time / 1000;
      const background = context.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, rgb(palette.from));
      background.addColorStop(0.55, rgb(palette.glow));
      background.addColorStop(1, rgb(palette.to));
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      const spacing = width < 700 ? 11 : 10;
      const centerX = width / 2;
      const centerY = Math.min(height * 0.34, 290);
      const drift = reducedMotion ? 0 : seconds;

      for (let y = spacing / 2; y < height; y += spacing) {
        for (let x = spacing / 2; x < width; x += spacing) {
          const dx = x - centerX;
          const dy = y - centerY;
          const distance = Math.hypot(dx, dy);
          let movementX = 0;
          let movementY: number;
          let energy: number;

          if (palette.pattern === "flow") {
            const wave = Math.sin(x * 0.028 - drift * 3.2 + y * 0.008);
            movementX = wave * 4.5;
            movementY = wave * 2.2;
            energy = 0.48 + wave * 0.18;
          } else if (palette.pattern === "gather") {
            const ring = Math.sin(distance * 0.038 - drift * 2.4);
            movementX = (dx / Math.max(distance, 1)) * ring * 4;
            movementY = (dy / Math.max(distance, 1)) * ring * 4;
            energy = 0.43 + ring * 0.16;
          } else if (palette.pattern === "connect") {
            const wave =
              Math.sin(dx * 0.024 + drift * 2.5) * Math.cos(dy * 0.018);
            movementY = wave * 5;
            energy = 0.43 + wave * 0.17;
          } else if (palette.pattern === "settle") {
            const wave = Math.sin(distance * 0.025 - drift * 1.2);
            movementY = wave * 1.8;
            energy = 0.38 + wave * 0.1;
          } else {
            const wave = Math.sin(distance * 0.021 - drift * 1.7);
            movementX = Math.cos(y * 0.02 + drift) * 2.2;
            movementY = wave * 3.2;
            energy = 0.4 + wave * 0.14;
          }

          const focus = Math.max(0, 1 - distance / Math.max(width, height));
          const radius = Math.max(0.7, 1.05 + energy + focus * 0.65);
          context.beginPath();
          context.fillStyle = `rgba(255, 255, 255, ${Math.max(0.2, energy + focus * 0.22)})`;
          context.arc(x + movementX, y + movementY, radius, 0, Math.PI * 2);
          context.fill();
        }
      }

      const vignette = context.createRadialGradient(
        centerX,
        centerY,
        30,
        centerX,
        centerY,
        Math.max(width, height) * 0.75,
      );
      vignette.addColorStop(0, "rgba(255,255,255,0)");
      vignette.addColorStop(1, "rgba(37,26,48,0.22)");
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);

      if (!reducedMotion) animationFrame = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion) draw(0);
    });
    observer.observe(canvas);
    resize();
    animationFrame = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
    };
  }, [state]);

  return <canvas ref={canvasRef} className="dd-ambient" aria-hidden="true" />;
}
