import { expect, test } from '@playwright/test';
import { CartPage } from '../pages/CartPage';
import { CheckoutPage } from '../pages/CheckoutPage';
import { InventoryPage } from '../pages/InventoryPage';
import { LoginPage } from '../pages/LoginPage';
import data from '../fixtures/standard-user-buys-a-backpack.data.json';

// Secrets are not stored in the fixtures file. Set them before running, for example in PowerShell:
//   $env:TEST_PASSWORD = '...'
test.use({ viewport: { width: 1280, height: 720 } });

test('standard user buys a backpack', async ({ page }) => {
  const login = new LoginPage(page);
  const inventory = new InventoryPage(page);
  const cart = new CartPage(page);
  const checkout = new CheckoutPage(page);

  await test.step('Open the login page', async () => {
    // 1. Open /
    await login.goto();
    await login.expectLoaded();
  });

  await test.step('Login', async () => {
    // 2-4. Fill textbox "Username", fill textbox "Password" and click button "Login"
    await expect(login.usernameInput).toBeVisible(); // pre-assertion
    await expect(login.usernameInput).toBeEnabled();
    await login.login(data.username, process.env.TEST_PASSWORD ?? data.password);
    await expect(page).toHaveURL(/\/inventory\.html/); // suggested: URL changed to /inventory.html
    await inventory.expectLoaded();
  });

  await test.step('Add to cart (Trail Backpack)', async () => {
    // 5. Click button "Add to cart" in "Trail Backpack"
    await expect(inventory.addToCartButton('Trail Backpack')).toBeVisible(); // pre-assertion
    await inventory.addToCart('Trail Backpack');
    await expect(inventory.cartBadge).toHaveText('1'); // suggested: cart-badge '1' appeared
  });

  await test.step('Add to cart (Bike Light)', async () => {
    // 6. Click button "Add to cart" in "Bike Light"
    await expect(inventory.addToCartButton('Bike Light')).toBeVisible(); // pre-assertion
    await inventory.addToCart('Bike Light');
    await expect(inventory.cartBadge).toHaveText('2'); // suggested: cart-badge text changed to '2'
  });

  await test.step('Open cart', async () => {
    // 7. Click link "Cart"
    await expect(inventory.cartLink).toBeVisible(); // pre-assertion
    await inventory.openCart();
    await expect(page).toHaveURL(/\/cart\.html/); // suggested: URL changed to /cart.html
    await cart.expectLoaded();
  });

  await test.step('Remove (Bike Light)', async () => {
    // 8. Click button "Remove" in "Bike Light"
    await expect(cart.removeButton('Bike Light')).toBeVisible(); // pre-assertion
    await cart.remove('Bike Light');
    await expect(cart.cartBadge).toHaveText('1'); // suggested: cart-badge text changed to '1'
  });

  await test.step('Checkout', async () => {
    // 9. Click button "Checkout"
    await expect(cart.checkoutButton).toBeVisible(); // pre-assertion
    await cart.checkout();
    await expect(page).toHaveURL(/\/checkout\.html/); // suggested: URL changed to /checkout.html
    await checkout.expectLoaded();
  });

  await test.step('Fill checkout form', async () => {
    // 10-13. Fill textbox "First Name", fill textbox "Last Name", fill textbox "Postal Code" and check checkbox "I agree to the terms"
    await expect(checkout.firstNameInput).toBeVisible(); // pre-assertion
    await expect(checkout.firstNameInput).toBeEnabled();
    await checkout.fillCheckoutForm(data.firstName, data.lastName, data.postalCode);
    await expect(checkout.iAgreeToTheCheckbox).toBeChecked(); // suggested: checkbox 'I agree to the terms' is now checked
  });

  await test.step('Continue checkout', async () => {
    // 14. Click button "Continue"
    await expect(checkout.continueButton).toBeVisible(); // pre-assertion
    await checkout.continueCheckout();
    await expect(checkout.confirmYourOrderDialog).toBeVisible(); // suggested: modal 'Confirm your order' appeared
  });

  await test.step('Place order', async () => {
    // 15. Click button "Place order"
    await expect(checkout.placeOrderButton).toBeVisible(); // pre-assertion
    await checkout.placeOrder();
    await expect(checkout.thankYouForYourHeading).toBeVisible(); // suggested: heading 'Thank you for your order!' appeared
  });
});
