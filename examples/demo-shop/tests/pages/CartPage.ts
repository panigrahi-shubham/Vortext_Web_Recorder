import { expect, type Locator, type Page } from '@playwright/test';

export class CartPage {
  readonly cartBadge: Locator;
  readonly checkoutButton: Locator;

  constructor(private readonly page: Page) {
    this.cartBadge = page.getByTestId('cart-badge');
    this.checkoutButton = page.getByRole('button', { name: 'Checkout' });
  }

  /** button "Remove" inside the item that contains `rowText` */
  removeButton(rowText: string): Locator {
    return this.page
      .getByRole('row')
      .filter({ hasText: rowText })
      .getByRole('button', { name: 'Remove' });
  }

  /** Readiness check used by the spec when it arrives on this page. */
  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/cart\.html/);
    await expect(this.checkoutButton).toBeVisible();
  }

  async remove(rowText: string) {
    await this.removeButton(rowText).click();
  }

  async checkout() {
    await this.checkoutButton.click();
  }
}
