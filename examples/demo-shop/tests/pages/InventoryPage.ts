import { expect, type Locator, type Page } from '@playwright/test';

export class InventoryPage {
  readonly cartBadge: Locator;
  readonly cartLink: Locator;

  constructor(private readonly page: Page) {
    this.cartBadge = page.getByTestId('cart-badge');
    this.cartLink = page.getByRole('link', { name: 'Cart' });
  }

  /** button "Add to cart" inside the item that contains `itemName` */
  addToCartButton(itemName: string): Locator {
    return this.page
      .getByRole('listitem')
      .filter({ hasText: itemName })
      .getByRole('button', { name: 'Add to cart' });
  }

  /** Readiness check used by the spec when it arrives on this page. */
  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/inventory\.html/);
    await expect(this.cartLink).toBeVisible();
  }

  async addToCart(itemName: string) {
    await this.addToCartButton(itemName).click();
  }

  async openCart() {
    await this.cartLink.click();
  }
}
