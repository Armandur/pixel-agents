import { useEffect, useState } from 'react';

import {
  providerBadge,
  QUOTA_SCREEN_HEIGHT,
  QUOTA_SCREEN_INSET_X,
  QUOTA_SCREEN_INSET_Y,
  QUOTA_SCREEN_WIDTH,
  QUOTA_SCREEN_Z_INDEX,
  QUOTA_STALE_OPACITY,
  QUOTA_SYMBOL_WORLD_PX,
  QUOTA_TV_PROVIDERS,
} from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import { overlayProjection } from '../projection.js';
import { quotaBars, type QuotaInfo, quotaTitle } from '../quotaFormat.js';
import { TILE_SIZE } from '../types.js';

interface QuotaScreensProps {
  officeState: OfficeState;
  /** Latest quota per provider id (quotaUpdate). */
  quotas: Record<string, QuotaInfo>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

/**
 * The screen of every placed TV_CLAUDE / TV_CODEX: the provider's symbol (its
 * card badge, large) beside two horizontal usage bars, 5 h over 7 d, filled
 * cell by cell along the statusline's green → red ramp. No text to read at
 * small zoom: the exact numbers and reset times are in the hover title. DOM,
 * not canvas, so it follows React state; nothing when no TV is placed.
 */
export function QuotaScreens({
  officeState,
  quotas,
  containerRef,
  zoom,
  panRef,
}: QuotaScreensProps) {
  // The pan lives in a ref, so follow it every frame (same as ToolOverlay); the same tick carries the clock.
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setNowSec(Date.now() / 1000);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const layout = officeState.getLayout();
  const tvs = layout.furniture.filter((f) => QUOTA_TV_PROVIDERS[f.type]);
  if (tvs.length === 0) return null;

  const dpr = window.devicePixelRatio || 1;
  const project = overlayProjection(layout, el.getBoundingClientRect(), zoom, panRef.current, dpr);
  const px = (worldPx: number) => (worldPx * zoom) / dpr;

  return (
    <>
      {tvs.map((tv) => {
        const { provider, title } = QUOTA_TV_PROVIDERS[tv.type];
        const info = quotas[provider];
        const bars = quotaBars(info, nowSec);
        const badge = providerBadge(provider);
        const hover = [quotaTitle(title, info, nowSec), ...bars.map((b) => b.title)].join('\n');
        return (
          <div
            key={tv.uid}
            className="absolute flex items-center"
            style={{
              left: project.toScreenX(tv.col * TILE_SIZE + QUOTA_SCREEN_INSET_X),
              top: project.toScreenY(tv.row * TILE_SIZE + QUOTA_SCREEN_INSET_Y),
              width: px(QUOTA_SCREEN_WIDTH),
              height: px(QUOTA_SCREEN_HEIGHT),
              padding: `0 ${px(1)}px`,
              gap: px(2),
              opacity: info?.stale ? QUOTA_STALE_OPACITY : 1,
              zIndex: QUOTA_SCREEN_Z_INDEX,
            }}
            title={hover}
            data-testid="quota-screen"
            data-provider={provider}
          >
            {badge && (
              <div
                className="shrink-0 flex items-center justify-center leading-none"
                style={{
                  width: px(QUOTA_SYMBOL_WORLD_PX),
                  height: px(QUOTA_SYMBOL_WORLD_PX),
                  background: badge.fill,
                  color: badge.border,
                  border: `${px(1)}px solid ${badge.border}`,
                  fontSize: px(QUOTA_SYMBOL_WORLD_PX * 0.8),
                }}
              >
                {badge.glyph}
              </div>
            )}
            <div className="flex flex-col flex-1" style={{ gap: px(2) }}>
              {bars.map((bar) => (
                <div
                  key={bar.label}
                  className="flex"
                  style={{ gap: px(0.5), height: px(3) }}
                  data-testid="quota-bar"
                  data-filled={bar.filled}
                >
                  {bar.cellColors.map((color, i) => (
                    <div key={i} className="flex-1" style={{ background: color }} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
