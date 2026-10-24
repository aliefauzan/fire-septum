import { describe, expect, it } from 'vitest';
import { DEFAULT_RATES } from '../sim/doctrine';
import { runEnsemble } from '../sim/ensemble';
import { DEFAULT_PARAMS } from '../sim/model';
import { recommend } from '../sim/recommend';
import { SYNTHETIC_INVENTORY } from '../sim/resources';
import { sketchScenario } from '../sim/scenarios';
import { briefFileName, briefPdfData, buildBriefPdf, pdfText } from './briefPdf';

// An 8 × 8 JPEG stands in for the captured map canvas (the app captures JPEG, which jsPDF embeds as is).
const JPEG_8PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAyADIAAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAADIAAAAAQAAAMgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAAigAwAEAAAAAQAAAAgAAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/AABEIAAgACAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAQEBAQEBAYEBAYJBgYGCQwJCQkJDA8MDAwMDA8SDw8PDw8PEhISEhISEhIVFRUVFRUZGRkZGRwcHBwcHBwcHBz/2wBDAQQFBQcHBwwHBwwdFBAUHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR3/3QAEAAH/2gAMAwEAAhEDEQA/APqjRdR8Q33iDUYL2xmsrS0kVInbJ8472JdT02kY47V6Dum9DUMf/Hwf8960ap3e7Kkop2irKy79l3vvv+Wh/9k=';

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
        map: { jpeg: JPEG_8PX, caption: 'Chance of burning by +12 h' },
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
      // The map is embedded as a real image, not an empty XObject.
      expect(out).toMatch(/\/Subtype \/Image\s*\/Width 8\s*\/Height 8/);
      expect(out).not.toMatch(/\/Width undefined/);
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
