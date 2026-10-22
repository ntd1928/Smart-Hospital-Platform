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
test('Admin creates, finds, updates and soft-deletes a patient', async ({ page }) => {
  await login(page, 'admin@hospital.test');
  await expect(page.getByRole('heading', { name: 'Tổng quan quản trị viên' })).toBeVisible();
  await page.getByRole('link', { name: '♡ Bệnh nhân', exact: true }).click();
  await page.getByRole('link', { name: '+ Thêm bệnh nhân' }).click();
  await page.getByLabel('Họ', { exact: true }).fill('Browser');
  await page.getByLabel('Tên', { exact: true }).fill('WeekSixTest');
  await page.getByLabel('Ngày sinh').fill('2000-01-15');
  await page.getByLabel('Giới tính').selectOption('female');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByRole('heading', { name: 'WeekSixTest Browser' })).toBeVisible();
  await page.getByRole('link', { name: 'Chỉnh sửa hồ sơ' }).click();
  await page.getByLabel('Điện thoại').fill('0901234567');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByText('0901234567', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '♡ Bệnh nhân', exact: true }).click();
  await page.getByLabel('Tìm theo tên').fill('WeekSixTest');
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
  await page.getByRole('link', { name: 'WeekSixTest Browser', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Xóa mềm hồ sơ' }).click();
  await expect(page).toHaveURL(/\/patients$/);
});
test('Doctor session survives reload and has no user administration', async ({ page }) => {
  await login(page, 'doctor1@hospital.test');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tổng quan bác sĩ' })).toBeVisible();
  await expect(page.getByRole('link', { name: '▤ Người dùng' })).toHaveCount(0);
  await page.goto('/users');
  await expect(page.getByRole('alert')).toContainText('không có quyền');
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/signin$/);
});
test('Patient sees own dashboard and cannot open another patient by URL', async ({ page }) => {
  const data = await fixture();
  await login(page, 'patient1@hospital.test');
  await expect(page.getByRole('heading', { name: 'Tổng quan bệnh nhân' })).toBeVisible();
  await page.getByRole('link', { name: '♡ Hồ sơ của tôi' }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${data.patients[0].id}$`));
  await expect(page.getByRole('heading', { name: 'An Nguyen' })).toBeVisible();
  await page.goto(`/patients/${data.patients[1].id}`);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mai Nguyen' })).toHaveCount(0);
  await page.goto(`/patients/${data.patients[1].id}/edit`);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lưu hồ sơ' })).toHaveCount(0);
});

test('Admin provisions and locks a Patient account from user management', async ({ page }) => {
  const data = await fixture();
  const email = `browser-${Date.now()}@hospital.test`;
  const admin = await signIn('admin@hospital.test', data.projectId);
  try {
    await login(page, 'admin@hospital.test');
    await page.getByRole('link', { name: '▤ Người dùng', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Smart Hospital Demo Default Client', exact: true })).toHaveCount(0);
    await page.getByLabel('Tên người dùng', { exact: true }).fill('Browser');
    await page.getByLabel('Họ người dùng', { exact: true }).fill('Temporary');
    await page.getByLabel('Email đăng nhập', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu ban đầu', { exact: true }).fill(password);
    await page.getByRole('combobox', { name: 'Vai trò', exact: true }).selectOption('Patient');
    await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('thành công');
    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row).toContainText('Patient');
    await row.getByRole('button', { name: 'Khóa tài khoản', exact: true }).click();
    await expect(row).toContainText('Đã khóa');
    await row.getByRole('button', { name: 'Mở khóa', exact: true }).click();
    await expect(row).toContainText('Hoạt động');
  } finally {
    const members = await admin.searchResources('ProjectMembership', { 'user:User.email': email });
    for (const member of members) {
      await admin.deleteResource('ProjectMembership', member.id!);
      await admin.deleteResource('Patient', member.profile.reference!.split('/')[1]);
      await admin.deleteResource('User', member.user.reference!.split('/')[1]);
    }
    await admin.signOut();
  }
});
