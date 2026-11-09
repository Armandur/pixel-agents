import { useCallback, useEffect, useState } from 'react';

import {
  QUOTA_SCREEN_HEIGHT,
  QUOTA_SCREEN_INSET_X,
  QUOTA_SCREEN_INSET_Y,
  QUOTA_SCREEN_WIDTH,
  QUOTA_SCREEN_Z_INDEX,
  QUOTA_TV_PROVIDERS,
} from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import { overlayProjection } from '../projection.js';
import {
  placeQuotaPanel,
  QUOTA_PANEL_HEIGHT_PX,
  QUOTA_PANEL_MARGIN_PX,
  QUOTA_PANEL_WIDTH_PX,
  quotaBars,
  type QuotaInfo,
  quotaTitle,
} from '../quotaFormat.js';
import { TILE_SIZE } from '../types.js';
import { QuotaPanel } from './QuotaPanel.js';

interface QuotaScreensProps {
  officeState: OfficeState;
  /** Latest quota per provider id (quotaUpdate). */
  quotas: Record<string, QuotaInfo>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

/**
 * The hover target of every placed TV_CLAUDE / TV_CODEX: an invisible box over
 * the screen whose title carries the exact numbers and reset times. The
 * screen itself (symbol + bars) is drawn on the canvas (engine/quotaScreen.ts)
 * so characters in front of the TV cover it.
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

  const [hoverUid, setHoverUid] = useState<string | null>(null);
  const [pinnedUid, setPinnedUid] = useState<string | null>(null);
  const closePinned = useCallback(() => setPinnedUid(null), []);

  // A click outside the TV and the panel closes a pinned panel.
  useEffect(() => {
    if (!pinnedUid) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('[data-testid="quota-screen"], [data-testid="quota-panel"]')) return;
      setPinnedUid(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pinnedUid]);

  const el = containerRef.current;
  if (!el) return null;
  const layout = officeState.getLayout();
  const tvs = layout.furniture.filter((f) => QUOTA_TV_PROVIDERS[f.type]);
  if (tvs.length === 0) return null;

  const dpr = window.devicePixelRatio || 1;
  const project = overlayProjection(layout, el.getBoundingClientRect(), zoom, panRef.current, dpr);
  const px = (worldPx: number) => (worldPx * zoom) / dpr;
  const bounds = el.getBoundingClientRect();
  const shownUid = pinnedUid ?? hoverUid;

  return (
    <>
      {tvs.map((tv) => {
        const box = {
          left: project.toScreenX(tv.col * TILE_SIZE + QUOTA_SCREEN_INSET_X),
          top: project.toScreenY(tv.row * TILE_SIZE + QUOTA_SCREEN_INSET_Y),
          width: px(QUOTA_SCREEN_WIDTH),
          height: px(QUOTA_SCREEN_HEIGHT),
        };
        const { provider, title } = QUOTA_TV_PROVIDERS[tv.type];
        const info = quotas[provider];
        const bars = quotaBars(info, nowSec);
        const summary = [quotaTitle(title, info, nowSec), ...bars.map((b) => b.title)].join('\n');
        const panelWidth = Math.min(QUOTA_PANEL_WIDTH_PX, bounds.width - 2 * QUOTA_PANEL_MARGIN_PX);
        const place = placeQuotaPanel(
          box,
          { width: panelWidth, height: QUOTA_PANEL_HEIGHT_PX },
          bounds,
        );
        return (
          <div key={tv.uid}>
            <div
              className="absolute pointer-events-auto cursor-pointer"
              style={{ ...box, zIndex: QUOTA_SCREEN_Z_INDEX }}
              aria-label={summary}
              role="button"
              onPointerEnter={(e) => e.pointerType === 'mouse' && setHoverUid(tv.uid)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setHoverUid(null)}
              onClick={() => setPinnedUid((cur) => (cur === tv.uid ? null : tv.uid))}
              data-testid="quota-screen"
              data-provider={provider}
            />
            {shownUid === tv.uid && (
              <QuotaPanel
                title={title}
                info={info}
                nowSec={nowSec}
                left={place.left}
                top={place.top}
                maxWidth={bounds.width}
                pinned={pinnedUid === tv.uid}
                onClose={closePinned}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
