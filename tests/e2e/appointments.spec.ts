import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixture, password, signIn } from '../helpers';

async function login(page: Page, email: string) {
  await page.goto('/signin');
  await page.getByPlaceholder('name@domain.com').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByTestId('auth.password').fill(password);
  await page.getByRole('checkbox', { name: 'Remember me' }).check();
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('staff books and cancels an appointment; the patient sees only their own list', async ({ page }) => {
  const data = await fixture();
  const admin = await signIn('admin@hospital.test', data.projectId);
  const description = `Browser booking ${Date.now()}`;
  let appointmentId: string | undefined;
  try {
    await login(page, 'admin@hospital.test');
    await page.getByRole('link', { name: /Lịch hẹn/ }).click();
    await page.getByLabel('Bệnh nhân').selectOption(data.patients[0].id);
    await page.getByLabel('Khung giờ trống').selectOption(data.slots[0]);
    await page.getByLabel('Nội dung').fill(description);
    await page.getByRole('button', { name: 'Tạo lịch hẹn' }).click();

    const row = page.getByRole('row').filter({ hasText: description });
    await expect(row).toContainText('booked');
    appointmentId = (await row.getAttribute('data-resource-id')) ?? undefined;
    expect(appointmentId).toBeTruthy();

    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Hủy' }).click();
    await expect(row).toContainText('cancelled');

    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await login(page, 'patient1@hospital.test');
    await page.getByRole('link', { name: /Lịch hẹn/ }).click();
    await expect(page.getByRole('row').filter({ hasText: description })).toContainText('cancelled');
    await expect(page.getByRole('button', { name: 'Tạo lịch hẹn' })).toHaveCount(0);
  } finally {
    if (appointmentId) await admin.deleteResource('Appointment', appointmentId);
    await admin.signOut();
  }
});
