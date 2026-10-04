import { expect, test } from "@playwright/test";

test("root and folder views retain files beyond the first core page", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const origin = new URL(baseURL!).origin;
  // A dedicated account keeps this volume fixture out of the narrative tests.
  const login = await page.request.post("/auth/login", {
    headers: { origin },
    data: { identifier: `pagination-${crypto.randomUUID()}@example.com`, password: "password" },
  });
  expect(login.ok()).toBe(true);
  const created = await page.request.post("/api/folders", {
    headers: { origin }, data: { name: "Many files", parent_id: null },
  });
  expect(created.status()).toBe(201);
  const folder = await created.json() as { id: string };
  for (let index = 0; index < 205; index++) {
    const name = `part-${String(index).padStart(3, "0")}.txt`;
    const upload = await page.request.post(`/api/files?folder_id=${folder.id}&name=${name}`, {
      headers: { origin, "content-type": "text/plain" }, data: Buffer.from("x"),
    });
    expect(upload.status(), name).toBe(201);
  }
  const rootUpload = await page.request.post("/api/files?name=root-only.txt", {
    headers: { origin, "content-type": "text/plain" }, data: Buffer.from("root"),
  });
  expect(rootUpload.status()).toBe(201);

  const root = await page.request.get("/api/files?root=true");
  expect((await root.json()).items.map((file: { name: string }) => file.name)).toEqual(["root-only.txt"]);
  const children = await page.request.get(`/api/files?folder_id=${folder.id}`);
  expect((await children.json()).items).toHaveLength(205);

  await page.goto("/drive");
  await expect(page.getByRole("link", { name: "root-only.txt", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "part-000.txt", exact: true })).toHaveCount(0);
  await page.goto(`/drive/folders/${folder.id}`);
  // The oldest item is on core's second page (stable created_at DESC order).
  await expect(page.getByRole("link", { name: "part-000.txt", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "part-204.txt", exact: true })).toBeVisible();
  await expect(page.locator('a[href^="/drive/files/"]')).toHaveCount(205);
  await expect(page.getByRole("link", { name: "root-only.txt", exact: true })).toHaveCount(0);
});
