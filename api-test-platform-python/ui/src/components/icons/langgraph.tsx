/**
 * 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
 * 
 * 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
 * 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
 * 
 * 授权商业应用请联系微信：huice666
 */

import { useId } from "react";

export function PlatformLogoSVG({
  className,
  width,
  height,
}: {
  width?: number;
  height?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const goldId = `gold-${id}`;
  const coreGlowId = `coreGlow-${id}`;
  const glowId = `glow-${id}`;

  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={goldId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFE082" />
          <stop offset="50%" stopColor="#F5C542" />
          <stop offset="100%" stopColor="#C8941A" />
        </linearGradient>

        <radialGradient id={coreGlowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFD54F" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#FFD54F" stopOpacity="0" />
        </radialGradient>

        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <rect width="64" height="64" rx="12" fill="#1a1a1a" />

      <circle cx="32" cy="32" r="18" fill={`url(#${coreGlowId})`} />

      <path
        d="M20 10 Q30 32 20 54"
        fill="none"
        stroke="#FFD54F"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.15"
      />
      <path
        d="M20 10 Q30 32 20 54"
        fill="none"
        stroke={`url(#${goldId})`}
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M44 10 Q34 32 44 54"
        fill="none"
        stroke="#FFD54F"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.15"
      />
      <path
        d="M44 10 Q34 32 44 54"
        fill="none"
        stroke={`url(#${goldId})`}
        strokeWidth="3"
        strokeLinecap="round"
      />

      <circle
        cx="32"
        cy="32"
        r="11"
        fill="none"
        stroke={`url(#${goldId})`}
        strokeWidth="2"
        opacity="0.9"
      />

      <circle cx="32" cy="32" r="6" fill={`url(#${goldId})`} />

      <circle cx="32" cy="32" r="3" fill="#FFFFFF" filter={`url(#${glowId})`} />
    </svg>
  );
}
