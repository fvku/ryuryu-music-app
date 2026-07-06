export function checkAdminPassword(password: string | undefined): boolean {
  return !!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD;
}
