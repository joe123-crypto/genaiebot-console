"use client";
import { useEffect, useRef } from "react";

type Mote = { x: number; y: number; r: number; vx: number; vy: number; alpha: number; phase: number; sway: number };

// A gradient on its own reads as static however fast it drifts: there are no edges to
// track. These motes give the eye something to follow, so the sky behind them reads as moving.
export function AuroraDust() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const motes: Mote[] = [];
    let width = 0, height = 0, frame = 0, tick = 0;

    const measure = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      motes.length = 0;
      const count = Math.round(Math.min(110, Math.max(36, (width * height) / 13000)));
      for (let i = 0; i < count; i++) motes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 1 + Math.random() * 2.6,
        vx: (Math.random() - 0.5) * 0.18,
        vy: -(0.22 + Math.random() * 0.62),
        alpha: 0.1 + Math.random() * 0.22,
        phase: Math.random() * Math.PI * 2,
        sway: 0.2 + Math.random() * 0.5,
      });
    };

    const draw = () => {
      tick += 1;
      context.clearRect(0, 0, width, height);
      for (const mote of motes) {
        mote.y += mote.vy;
        mote.x += mote.vx + Math.sin(tick * 0.006 + mote.phase) * mote.sway * 0.35;
        if (mote.y < -6) { mote.y = height + 6; mote.x = Math.random() * width; }
        if (mote.x < -6) mote.x = width + 6;
        if (mote.x > width + 6) mote.x = -6;
        context.beginPath();
        context.arc(mote.x, mote.y, mote.r, 0, Math.PI * 2);
        context.fillStyle = `rgba(15, 27, 45, ${mote.alpha})`;
        context.fill();
      }
      frame = requestAnimationFrame(draw);
    };

    measure();
    frame = requestAnimationFrame(draw);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", measure); };
  }, []);

  return <canvas ref={canvasRef} className="login-aurora-dust" aria-hidden="true" />;
}
