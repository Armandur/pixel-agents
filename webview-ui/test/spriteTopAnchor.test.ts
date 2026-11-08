import { describe, expect, it } from 'vitest';

import { getSpriteTopAnchor } from '../src/office/sprites/spriteAnchor.js';

describe('getSpriteTopAnchor', () => {
  it('finds the first drawn row and centres on its extent', () => {
    const _ = '';
    const H = 'x'; // any non-empty cell counts as drawn
    const sprite = [
      [_, _, _, _, _, _],
      [_, _, _, _, _, _],
      [_, H, H, H, _, _],
      [H, H, H, H, H, _],
    ];
    expect(getSpriteTopAnchor(sprite)).toEqual({ row: 2, centerCol: 2.5 });
  });
});
