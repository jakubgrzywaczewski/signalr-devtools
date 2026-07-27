import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('DevTools panel registration', () => {
  it('registers the panel with an existing icon and page', () => {
    const create = vi.fn();
    const source = readFileSync(path.resolve('devtools.js'), 'utf8');

    vm.runInNewContext(source, {
      chrome: { devtools: { panels: { create } } },
    });

    expect(create).toHaveBeenCalledWith(
      'SignalR Inspector',
      'icons/icon32.png',
      'panel.html',
      expect.any(Function),
    );
  });
});
