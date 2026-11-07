import { describe, expect, it } from '@jest/globals';

import { addPoint, commit, historyOf, redo, Stroke, strokePath, touchesStroke, undo } from './drawing';

const stroke = (points: number[], width = 4): Stroke => ({ id: 'a', color: '#FFFFFF', width, points });

describe('dessin', () => {
  it('ignore les points trop proches', () => {
    expect(addPoint([0, 0], 1, 1)).toEqual([0, 0]);
    expect(addPoint([0, 0], 5, 0)).toEqual([0, 0, 5, 0]);
  });

  it('trace un rond pour un point, une courbe lissée pour un trait', () => {
    expect(strokePath([])).toBe('');
    expect(strokePath([10, 10])).toBe('M10 10 L10.01 10');
    expect(strokePath([0, 0, 10, 0, 20, 10, 30, 10])).toBe('M0 0 Q10 0 15 5 Q20 10 25 10 L30 10');
  });

  it('la gomme touche un trait près de son tracé', () => {
    const line = stroke([0, 0, 100, 0]);
    expect(touchesStroke(line, 50, 8, 6)).toBe(true);
    expect(touchesStroke(line, 50, 20, 6)).toBe(false);
    expect(touchesStroke(stroke([10, 10]), 14, 10, 3)).toBe(true);
  });

  it('annule et rétablit', () => {
    const first = [stroke([0, 0])];
    const second = [...first, { ...stroke([5, 5]), id: 'b' }];
    let history = commit(commit(historyOf([]), first), second);
    history = undo(history);
    expect(history.present).toBe(first);
    history = redo(history);
    expect(history.present).toBe(second);
    // Un nouveau trait après une annulation efface ce qui pouvait être rétabli.
    history = commit(undo(history), []);
    expect(history.future).toEqual([]);
    expect(undo(historyOf([])).present).toEqual([]);
  });
});
