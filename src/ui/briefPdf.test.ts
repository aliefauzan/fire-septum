import { describe, expect, it } from 'vitest';
import { DEFAULT_RATES } from '../sim/doctrine';
import { runEnsemble } from '../sim/ensemble';
import { DEFAULT_PARAMS } from '../sim/model';
import { recommend } from '../sim/recommend';
import { SYNTHETIC_INVENTORY } from '../sim/resources';
import { sketchScenario } from '../sim/scenarios';
import { briefFileName, briefPdfData, buildBriefPdf, pdfText } from './briefPdf';

// A 1 × 1 grey PNG stands in for the captured map canvas.
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==';

describe('PDF brief', () => {
  const P = { ...DEFAULT_PARAMS, runs: 8, rates: DEFAULT_RATES };
  const scn = sketchScenario();
  const base = runEnsemble(scn, [], P);
  const rec = recommend(scn, P, [], { screeningRuns: 8, startTimes: [0, 6] });

  for (const lang of ['en', 'id'] as const) {
    it(`builds a one-page A4 document from a synthetic scenario (${lang})`, () => {
      const d = briefPdfData({
        lang, scn, base, plan: base, hasPlan: false, actions: 0, rec, params: P, inventory: SYNTHETIC_INVENTORY,
        observed: { tco2e: 1234, freMJ: 1, dryMatterT: 1, detections: 5, passes: 2, windowH: 48, peatShare: 0.8 },
        sealed: { receiptSha256: 'ab'.repeat(32), signedAt: '2026-10-24T01:02:03.000Z', keyId: '0123456789abcdef', anchored: true, matches: true },
        map: { png: PNG_1PX, caption: 'Chance of burning by +12 h' },
        now: new Date('2026-10-24T03:00:00Z'),
      });
      expect(d.synthetic).toBe(true);
      expect(d.zones.length).toBe(scn.landscape.zones.length);
      expect(d.recommendations.length).toBeLessThanOrEqual(3);
      const doc = buildBriefPdf(d);
      expect(doc.getNumberOfPages()).toBe(1);
      const size = doc.internal.pageSize;
      expect(Math.round(size.getWidth())).toBe(210);
      expect(Math.round(size.getHeight())).toBe(297);
      const out = doc.output();
      expect(out.startsWith('%PDF-')).toBe(true);
      expect(out.length).toBeGreaterThan(2000);
      expect(briefFileName(d)).toBe(`fireseptum-brief-${lang}-202610240300.pdf`);
    });
  }

  it('still builds without a map, a seal or satellite data', () => {
    const d = briefPdfData({ lang: 'en', scn, base, plan: null, hasPlan: false, actions: 0, rec: null, params: P, inventory: SYNTHETIC_INVENTORY, observed: null });
    expect(() => buildBriefPdf(d)).not.toThrow();
  });

  it('keeps text inside the standard PDF font', () => {
    expect(pdfText('≈ 1,200 t CO₂e · +3 h → +6 h – ok')).toBe('~ 1,200 t CO2e · +3 h -> +6 h - ok');
    expect(pdfText('fire \u{1F525}')).toBe('fire ');
  });
});
