// フレンド対戦の自動操作：1人ぶん、出来ることを1つする
import { clickText } from './pw.mjs';

export /** 1人ぶん、出来ることを1つする。'wait'＝自分の番ではない／演出中、'acted'、'over' */
async function step(p, st) {
  const page = p.page;
  if (await page.locator('.result').count()) return 'over';
  const hint = ((await page.locator('.battle-hint').textContent().catch(() => '')) ?? '').trim();
  if (hint === '' || hint === '…' || /あいての ばん|まってるよ/.test(hint)) return 'wait';
  if (await page.getByText('バトルばに だす おてあげを').count()) {
    await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
    await clickText(page, 'バトルばに だす');
    return 'acted';
  }
  if (await page.getByText('くりだす おてあげを').count()) {
    await page.locator('.battle-slot--me.battle-slot--bench .battle-card').first().click({ force: true });
    return 'acted';
  }
  // ベンチに出せるなら出す
  const lit = page.locator('.battle-hand .battle-card.is-highlight:not(:has(.battle-card__note))');
  if ((await lit.count()) && (await page.locator('.battle-slot.battle-slot--me.battle-slot--bench:not(:has(.battle-card))').count())) {
    await lit.first().click();
    const drop = page.locator('.battle-slot.is-drop').first();
    if (await drop.count()) {
      await drop.click();
      return 'acted';
    }
    await page.keyboard.press('Escape');
  }
  // アイテムを1回だけ使う
  if (!st.item) {
    const item = page.locator('.battle-hand .battle-card.is-highlight:has(.battle-card__note)').first();
    if (await item.count()) {
      await item.click();
      const target = page.locator('.battle-slot--me .battle-card.is-highlight').first();
      if (await target.count()) {
        await target.click({ force: true });
        if (await page.getByRole('button', { name: 'つかう', exact: true }).count()) await clickText(page, 'つかう', { exact: true });
        st.item = true;
        return 'acted';
      }
    }
  }
  const end = page.locator('.battle-end button');
  if ((await end.getAttribute('aria-disabled')) !== 'true') {
    await end.click();
    st.ends += 1;
    return 'acted';
  }
  return 'wait';
}
