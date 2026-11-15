import { expect, type Locator, type Page } from '@playwright/test';

export class CheckoutPage {
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly postalCodeInput: Locator;
  readonly iAgreeToTheCheckbox: Locator;
  readonly continueButton: Locator;
  readonly confirmYourOrderDialog: Locator;
  readonly placeOrderButton: Locator;
  readonly thankYouForYourHeading: Locator;

  constructor(private readonly page: Page) {
    this.firstNameInput = page.getByRole('textbox', { name: 'First Name' });
    this.lastNameInput = page.getByRole('textbox', { name: 'Last Name' });
    this.postalCodeInput = page.getByRole('textbox', { name: 'Postal Code' });
    this.iAgreeToTheCheckbox = page.getByRole('checkbox', { name: 'I agree to the terms' });
    this.continueButton = page.getByRole('button', { name: 'Continue' });
    this.confirmYourOrderDialog = page.getByRole('dialog', { name: 'Confirm your order' });
    this.placeOrderButton = page.getByRole('button', { name: 'Place order' });
    this.thankYouForYourHeading = page.getByRole('heading', { name: 'Thank you for your order!' });
  }

  /** Readiness check used by the spec when it arrives on this page. */
  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/checkout\.html/);
    await expect(this.firstNameInput).toBeVisible();
  }

  async fillCheckoutForm(firstName: string, lastName: string, postalCode: string) {
    await this.firstNameInput.fill(firstName);
    await this.lastNameInput.fill(lastName);
    await this.postalCodeInput.fill(postalCode);
    await this.iAgreeToTheCheckbox.check();
  }

  async continueCheckout() {
    await this.continueButton.click();
  }

  async placeOrder() {
    await this.placeOrderButton.click();
  }
}
