import { expect, test, type Page } from "@playwright/test";
import { countSlides, reportSrcDoc } from "../src/components/reports/report-document";
import { fixtureLedger } from "../src/lib/reports/ledger.fixture";
import { renderReport } from "../src/lib/reports/render/index";
import { wideReport } from "../src/lib/reports/wide-report.fixture";

/**
 * A rendered report must fit the column it is shown in: a page that scrolls sideways hides the
 * end of every line. The report is laid out on its own, with no server, at a phone's width, the
 * panel's default and a wide panel, as it ships and as the panel wraps it.
 */

const WIDTHS = [360, 600, 800];
const ledger = fixtureLedger();
const doc = renderReport(wideReport, ledger, "doc").html;
const deck = renderReport(wideReport, ledger, "slides").html;

/** How far `selector`'s content runs past its box, in pixels; 1px of rounding is allowed. */
async function overflow(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((element) => element.scrollWidth - element.clientWidth - 1);
}

for (const width of WIDTHS) {
  test.describe(`a wide report at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("fits as rendered", async ({ page }) => {
      await page.setContent(doc);
      expect(await overflow(page, "html")).toBeLessThanOrEqual(0);
    });

    test("fits in the panel, with an origin box open", async ({ page }) => {
      await page.setContent(reportSrcDoc(doc, "light"));
      expect(await overflow(page, "html")).toBeLessThanOrEqual(0);
      // The rightmost KPI's box hangs from its right edge rather than off the page.
      await page.locator(".kpi:last-child .src").focus();
      expect(await overflow(page, "html")).toBeLessThanOrEqual(0);
    });

    test("fits on every slide", async ({ page }) => {
      for (let slide = 1; slide <= countSlides(deck); slide += 1) {
        await page.setContent(reportSrcDoc(deck, "light", { format: "slides", slide }));
        const shown = `body > section:nth-of-type(${slide})`;
        expect(await overflow(page, shown), `slide ${slide}`).toBeLessThanOrEqual(0);
      }
    });
  });
}
