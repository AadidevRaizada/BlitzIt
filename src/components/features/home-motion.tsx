'use client';

import { useEffect, useRef } from 'react';
import { animate, createScope, createTimeline, stagger, utils } from 'animejs';

export function HomeMotion({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!root.current) return;

    const scope = createScope({ root }).add(() => {
      createTimeline()
        .add('.home-hero-line', {
          opacity: { from: 0, to: 1 },
          translateY: { from: 18, to: 0 },
          scaleX: { from: 1.06, to: 1 },
          letterSpacing: { from: '0.06em', to: '-0.02em' },
          delay: stagger(130),
          ease: 'out(4)',
          duration: 700,
        })
        .add(
          '.home-rise',
          {
            opacity: { from: 0, to: 1 },
            translateY: { from: 10, to: 0 },
            delay: stagger(100),
            ease: 'out(4)',
            duration: 600,
          },
          280,
        );

      animate('.home-ticker-track', {
        translateX: ['0%', '-50%'],
        loop: true,
        ease: 'linear',
        duration: 38000,
      });

      animate('.home-live-dot', {
        opacity: [1, 0.12],
        loop: true,
        alternate: true,
        duration: 600,
        ease: 'steps(1)',
      });

      animate('.home-sweep', {
        translateX: ['-120%', '420%'],
        loop: true,
        ease: 'linear',
        duration: (_target: unknown, index = 0) => 4200 + index * 520,
      });

      animate('.home-scanline', {
        translateY: ['-100%', '1200%'],
        loop: true,
        ease: 'linear',
        duration: 9000,
      });

      animate('.home-pulse-ring', {
        scale: [0.9, 1.9],
        opacity: [0.55, 0],
        loop: true,
        ease: 'out(3)',
        duration: 2600,
      });

      animate('.home-drift', {
        translateY: [0, -3],
        loop: true,
        alternate: true,
        ease: 'inOut(2)',
        duration: 1800,
      });

      for (const el of utils.$('.home-count')) {
        const target = Number(el.getAttribute('data-count'));
        if (!Number.isFinite(target)) continue;
        const state = { value: 0 };
        animate(state, {
          value: target,
          round: 1,
          ease: 'out(4)',
          duration: 900,
          onUpdate: () => {
            el.textContent = Math.round(state.value).toLocaleString('en-IN');
          },
        });
      }
    });

    return () => scope.revert();
  }, []);

  return <div ref={root}>{children}</div>;
}
