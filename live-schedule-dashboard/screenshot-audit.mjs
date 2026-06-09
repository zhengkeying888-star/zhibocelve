import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(2000);

  const auditBtn = await page.locator('button:has-text("规则审计")').first();
  if (await auditBtn.isVisible()) {
    await auditBtn.click();
    await page.waitForTimeout(800);
  }

  const warningItems = await page.locator('button:has-text("⚠️")').all();
  for (const item of warningItems.slice(0, 2)) {
    await item.click();
    await page.waitForTimeout(300);
  }

  await page.screenshot({ path: '/tmp/dashboard-audit-v2.png', fullPage: false });
  await browser.close();
  console.log('Screenshot saved to /tmp/dashboard-audit-v2.png');
})();
